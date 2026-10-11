import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
} from '@aws-sdk/client-athena';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeHandler } from './aggregate';
import { assemble, costOf, queries, rowsOf, seoulYesterday } from './stats';

describe('집계 계산', () => {
  it('서울 기준 어제', () => {
    expect(seoulYesterday(new Date('2026-10-11T18:00:00Z'))).toBe('2026-10-11'); // 서울 12일 03시
    expect(seoulYesterday(new Date('2026-10-11T14:00:00Z'))).toBe('2026-10-10'); // 서울 11일 23시
  });

  it('쿼리는 그날 파티션만 읽고, 이상한 날짜는 거절한다', () => {
    const q = queries('fitcut_dev.events', '2026-10-10');
    for (const sql of Object.values(q)) expect(sql).toContain("dt = '2026-10-10'");
    expect(() => queries('t', "2026-10-10' OR 1=1 --")).toThrow();
  });

  it('Athena 결과 표 → 객체 (첫 행은 머리글)', () => {
    expect(
      rowsOf([
        { Data: [{ VarCharValue: 'name' }, { VarCharValue: 'n' }] },
        { Data: [{ VarCharValue: 'tool_open' }, { VarCharValue: '3' }] },
      ]),
    ).toEqual([{ name: 'tool_open', n: '3' }]);
  });

  it('도구별 열기·선택·저장, 잡 p50·p95, 링크, 비용을 하루 기록으로', () => {
    const s = assemble(
      '2026-10-10',
      {
        sessions: [{ n: '12' }],
        tools: [
          { name: 'tool_open', tool: 'photo', n: '10' },
          { name: 'file_selected', tool: 'photo', n: '8' },
          { name: 'export_done', tool: 'photo', n: '5' },
          { name: 'session_start', tool: '', n: '12' },
        ],
        jobs: [{ type: 'gif', ok: '4', failed: '1', p50: '6000.4', p95: '9100', cost: '0.0008' }],
        links: [{ name: 'link_saved', n: '2' }],
      },
      costOf([
        { Keys: ['AWS Lambda'], Metrics: { UnblendedCost: { Amount: '0.002' } } },
        { Keys: ['Amazon S3'], Metrics: { UnblendedCost: { Amount: '0' } } },
      ]),
    );
    expect(s.sessions).toBe(12);
    expect(s.tools.photo).toEqual({ open: 10, selected: 8, exported: 5, errors: 0 });
    expect(s.jobs[0]).toEqual({
      type: 'gif',
      ok: 4,
      failed: 1,
      p50Ms: 6000,
      p95Ms: 9100,
      costUsd: 0.0008,
    });
    expect(s.links).toEqual({ saved: 2, blocked: 0 });
    expect(s.cost).toEqual({ totalUsd: 0.002, services: [{ service: 'AWS Lambda', usd: 0.002 }] });
  });
});

describe('집계 Lambda', () => {
  const athena = new AthenaClient({ region: 'ap-northeast-2' });
  const ce = new CostExplorerClient({ region: 'us-east-1' });
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2' }));
  const athenaMock = mockClient(athena);
  const ceMock = mockClient(ce);
  const ddbMock = mockClient(ddb);
  const handler = makeHandler({
    env: {
      TABLE_NAME: 't',
      WORKGROUP: 'fitcut-dev-analytics',
      DATABASE: 'fitcut_dev',
      EVENTS_TABLE: 'events',
    },
    athena,
    ce,
    ddb,
    now: () => new Date('2026-10-11T18:00:00Z'),
    sleep: async () => undefined,
  });

  beforeEach(() => {
    athenaMock.reset();
    ceMock.reset();
    ddbMock.reset();
    athenaMock.on(StartQueryExecutionCommand).resolves({ QueryExecutionId: 'q' });
    athenaMock
      .on(GetQueryExecutionCommand)
      .resolvesOnce({ QueryExecution: { Status: { State: 'RUNNING' } } })
      .resolves({ QueryExecution: { Status: { State: 'SUCCEEDED' } } });
    athenaMock.on(GetQueryResultsCommand).resolves({
      ResultSet: { Rows: [{ Data: [{ VarCharValue: 'n' }] }, { Data: [{ VarCharValue: '7' }] }] },
    });
    ddbMock.on(PutCommand).resolves({});
  });

  it('워크그룹으로 쿼리하고 하루 기록을 STATS#날짜에 쓴다', async () => {
    ceMock.on(GetCostAndUsageCommand).resolves({
      ResultsByTime: [
        { Groups: [{ Keys: ['AWS Lambda'], Metrics: { UnblendedCost: { Amount: '0.01' } } }] },
      ],
    });
    const s = await handler({});
    expect(s.day).toBe('2026-10-11');
    expect(s.sessions).toBe(7);
    const start = athenaMock.commandCalls(StartQueryExecutionCommand)[0]?.args[0].input;
    expect(start?.WorkGroup).toBe('fitcut-dev-analytics');
    const cost = ceMock.commandCalls(GetCostAndUsageCommand)[0]?.args[0].input;
    expect(cost?.TimePeriod).toEqual({ Start: '2026-10-11', End: '2026-10-12' });
    const put = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(put).toMatchObject({
      PK: 'STATS#2026-10-11',
      SK: 'DAY',
      sessions: 7,
      cost: { totalUsd: 0.01 },
    });
  });

  it('비용을 못 읽어도 사용 통계는 남긴다, 날짜를 정해 다시 돌릴 수 있다', async () => {
    ceMock.on(GetCostAndUsageCommand).rejects(new Error('denied'));
    const s = await handler({ day: '2026-10-05' });
    expect(s).toMatchObject({ day: '2026-10-05', cost: null });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});
