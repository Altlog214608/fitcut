/**
 * 일별 집계 Lambda (docs/ADMIN.md 파이프라인). 매일 새벽 EventBridge 규칙이 부른다.
 * 전날(서울) 사용 이벤트를 Athena로 집계하고, Cost Explorer로 전날 비용을 읽어 DynamoDB에 하루 한 줄로 둔다.
 * 관리자 화면은 이 집계만 읽는다. 다시 돌려도 같은 날 기록을 덮어쓴다.
 */
import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
} from '@aws-sdk/client-athena';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  assemble,
  costOf,
  isDay,
  queries,
  rowsOf,
  seoulYesterday,
  type DayStats,
  type ResultRow,
  type Row,
} from './stats';

export type Env = { TABLE_NAME: string; WORKGROUP: string; DATABASE: string; EVENTS_TABLE: string };

export type Deps = {
  env: Env;
  athena: AthenaClient;
  ce: CostExplorerClient;
  ddb: DynamoDBDocumentClient;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

export const statsKey = (day: string) => ({ PK: `STATS#${day}`, SK: 'DAY' });

async function runQuery(deps: Deps, sql: string): Promise<Row[]> {
  const { athena, env } = deps;
  const { QueryExecutionId: id } = await athena.send(
    new StartQueryExecutionCommand({
      QueryString: sql,
      WorkGroup: env.WORKGROUP,
      QueryExecutionContext: { Database: env.DATABASE },
    }),
  );
  if (!id) throw new Error('no query id');
  for (let i = 0; i < 120; i++) {
    const r = await athena.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
    const state = r.QueryExecution?.Status?.State;
    if (state === 'SUCCEEDED') break;
    if (state === 'FAILED' || state === 'CANCELLED') {
      throw new Error(`query ${state}: ${r.QueryExecution?.Status?.StateChangeReason ?? ''}`);
    }
    await deps.sleep(1000);
  }
  const rows: ResultRow[] = [];
  let token: string | undefined;
  do {
    const page = await athena.send(
      new GetQueryResultsCommand({ QueryExecutionId: id, NextToken: token }),
    );
    rows.push(...(page.ResultSet?.Rows ?? []));
    token = page.NextToken;
  } while (token);
  return rowsOf(rows);
}

/** 전날 비용 (Cost Explorer는 UTC 날짜). 실패해도 사용 통계는 남긴다 */
async function dayCost(deps: Deps, day: string): Promise<DayStats['cost']> {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  try {
    const r = await deps.ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: day, End: next.toISOString().slice(0, 10) },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      }),
    );
    return costOf(r.ResultsByTime?.[0]?.Groups ?? []);
  } catch (e) {
    console.error(JSON.stringify({ msg: 'cost failed', error: String(e) }));
    return null;
  }
}

export function makeHandler(deps: Deps) {
  return async (event: { day?: string } = {}): Promise<DayStats> => {
    const day = event.day && isDay(event.day) ? event.day : seoulYesterday(deps.now());
    const table = `${deps.env.DATABASE}.${deps.env.EVENTS_TABLE}`;
    const entries = Object.entries(queries(table, day));
    const results = await Promise.all(entries.map(([, sql]) => runQuery(deps, sql)));
    const byName = Object.fromEntries(entries.map(([name], i) => [name, results[i] ?? []]));
    const stats = assemble(day, byName, await dayCost(deps, day));
    await deps.ddb.send(
      new PutCommand({
        TableName: deps.env.TABLE_NAME,
        Item: { ...statsKey(day), ...stats, createdAt: deps.now().toISOString() },
      }),
    );
    console.log(JSON.stringify({ msg: 'aggregated', day, sessions: stats.sessions }));
    return stats;
  };
}

let real: ReturnType<typeof makeHandler> | null = null;
export const handler = (event: { day?: string }) => {
  const names = ['TABLE_NAME', 'WORKGROUP', 'DATABASE', 'EVENTS_TABLE'] as const;
  const env = {} as Env;
  for (const n of names) {
    const v = process.env[n];
    if (!v) throw new Error(`env ${n} is required`);
    env[n] = v;
  }
  real ??= makeHandler({
    env,
    athena: new AthenaClient({}),
    // Cost Explorer는 us-east-1 엔드포인트만 있다
    ce: new CostExplorerClient({ region: 'us-east-1' }),
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    }),
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  return real(event);
};
