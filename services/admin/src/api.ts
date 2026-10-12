/**
 * 관리자 API Lambda (docs/ADMIN.md 접근 통제, ADR-011).
 * - API Gateway JWT 권한 부여자가 Cognito 토큰(x-admin-token)을 먼저 검사하고, 여기서 admin 그룹인지 다시 본다
 * - CloudFront를 거친 요청만 받는다 (오리진 확인 헤더, ADR-031)
 * - 관리자가 무엇을 봤는지 모두 감사 로그(AUDIT#yyyymm)에 남긴다
 * GET /api/admin/stats?days=7|30 : 일별 집계(STATS#날짜), 어제부터 거꾸로
 * GET /api/admin/audit?month=YYYYMM : 감사 로그 최근 100개
 * GET /api/admin/retained : 보관 동의 파일 목록 (F16, 최신 100개)
 * GET /api/admin/retained/{id}?file=input|output : 5분짜리 열람 주소
 * DELETE /api/admin/retained/{id} : 보관 파일 지우기
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteObjectsCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { timingSafeEqual } from 'node:crypto';
import { statsKey } from './aggregate';
import { seoulYesterday } from './stats';

export type Env = { TABLE_NAME: string; ORIGIN_PARAM: string; RETAINED_BUCKET: string };
export type Deps = {
  env: Env;
  ddb: DynamoDBDocumentClient;
  ssm: SSMClient;
  s3: S3Client;
  now: () => Date;
};

const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});
const error = (statusCode: number, code: string, message: string) =>
  json(statusCode, { error: { code, message } });

/** HTTP API는 배열 클레임을 "[admin other]" 문자열로 넘긴다 */
export function groupsOf(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.map(String);
  if (typeof claim !== 'string') return [];
  return claim
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .filter(Boolean);
}

/** 어제부터 거꾸로 n일 (서울) */
export function lastDays(now: Date, n: number): string[] {
  const first = new Date(`${seoulYesterday(now)}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(first);
    d.setUTCDate(d.getUTCDate() - i);
    return d.toISOString().slice(0, 10);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 관리자 열람 주소는 5분만 쓸 수 있다 (docs/ADMIN.md) */
const VIEW_SECONDS = 300;

type RetainedJob = {
  createdAt: string;
  kind: string;
  retainedInputKey?: string;
  retainedOutputKey?: string;
};

const sameSecret = (a: string | undefined, b: string) => {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function makeHandler(deps: Deps) {
  const { env, ddb } = deps;
  let origin: Promise<string> | null = null;
  const loadOrigin = () =>
    (origin ??= deps.ssm
      .send(new GetParameterCommand({ Name: env.ORIGIN_PARAM, WithDecryption: true }))
      .then((r) => {
        const v = r.Parameter?.Value;
        if (!v) throw new Error('missing origin secret');
        return v;
      })
      .catch((e: unknown) => {
        origin = null;
        throw e;
      }));

  async function audit(who: string, action: string, target: string) {
    const now = deps.now();
    const month = now.toISOString().slice(0, 7).replace('-', '');
    await ddb.send(
      new PutCommand({
        TableName: env.TABLE_NAME,
        Item: {
          PK: `AUDIT#${month}`,
          SK: `${now.toISOString()}#${who}`,
          admin: who,
          action,
          target,
          // 감사 로그는 12개월 보관 (docs/ADMIN.md)
          ttl: Math.floor(now.getTime() / 1000) + 365 * 24 * 60 * 60,
        },
      }),
    );
  }

  async function stats(days: number) {
    const keys = lastDays(deps.now(), days).map(statsKey);
    const items: Record<string, unknown>[] = [];
    // BatchGet은 한 번에 100개까지
    for (let i = 0; i < keys.length; i += 100) {
      const r = await ddb.send(
        new BatchGetCommand({
          RequestItems: { [env.TABLE_NAME]: { Keys: keys.slice(i, i + 100) } },
        }),
      );
      items.push(...(r.Responses?.[env.TABLE_NAME] ?? []));
    }
    const days_ = items
      .map((item) =>
        Object.fromEntries(Object.entries(item).filter(([k]) => k !== 'PK' && k !== 'SK')),
      )
      .sort((a, b) => String(b.day).localeCompare(String(a.day)));
    return json(200, { days: days_ });
  }

  async function auditLog(month: string) {
    const r = await ddb.send(
      new QueryCommand({
        TableName: env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `AUDIT#${month}` },
        ScanIndexForward: false,
        Limit: 100,
      }),
    );
    const entries = (r.Items ?? []).map((x) => ({
      at: String(x.SK).split('#')[0],
      admin: x.admin,
      action: x.action,
      target: x.target,
    }));
    return json(200, { entries });
  }

  async function retainedList() {
    const r = await ddb.send(
      new QueryCommand({
        TableName: env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'RETAINED' },
        ScanIndexForward: false,
        Limit: 100,
      }),
    );
    const files = (r.Items ?? []).map((x) => ({
      id: x.jobId,
      kind: x.kind,
      createdAt: String(x.SK).split('#')[0],
      retainUntil: x.retainUntil,
      inputBytes: x.inputBytes,
      outputBytes: x.outputBytes,
    }));
    return json(200, { files });
  }

  async function retainedJob(id: string) {
    const r = await ddb.send(
      new GetCommand({ TableName: env.TABLE_NAME, Key: { PK: `JOB#${id}`, SK: 'META' } }),
    );
    const job = r.Item as RetainedJob | undefined;
    return job?.retainedOutputKey ? job : null;
  }

  async function viewUrl(job: RetainedJob, file: 'input' | 'output') {
    const key = file === 'input' ? job.retainedInputKey : job.retainedOutputKey;
    if (!key) return error(404, 'not_found', '보관 파일이 없어요.');
    const url = await getSignedUrl(
      deps.s3,
      new GetObjectCommand({ Bucket: env.RETAINED_BUCKET, Key: key }),
      { expiresIn: VIEW_SECONDS },
    );
    return json(200, { url, expiresIn: VIEW_SECONDS });
  }

  async function removeRetained(id: string, job: RetainedJob) {
    const keys = [job.retainedInputKey, job.retainedOutputKey].filter((k): k is string => !!k);
    await deps.s3.send(
      new DeleteObjectsCommand({
        Bucket: env.RETAINED_BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    );
    await ddb.send(
      new UpdateCommand({
        TableName: env.TABLE_NAME,
        Key: { PK: `JOB#${id}`, SK: 'META' },
        UpdateExpression:
          'SET #s = :deleted REMOVE outputKey, retainedInputKey, retainedOutputKey, deleteTokenHash',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':deleted': 'deleted' },
      }),
    );
    await ddb.send(
      new DeleteCommand({
        TableName: env.TABLE_NAME,
        Key: { PK: 'RETAINED', SK: `${job.createdAt}#${id}` },
      }),
    );
    return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  }

  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    if (!sameSecret(event.headers['x-origin-verify'], await loadOrigin())) {
      return error(403, 'forbidden', '허용되지 않은 요청이에요.');
    }
    const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
    // 권한 부여자가 토큰을 검사했어도, 관리자 그룹인지 한 번 더 본다 (ADR-011)
    if (!groupsOf(claims['cognito:groups']).includes('admin')) {
      return error(403, 'not_admin', '관리자만 볼 수 있어요.');
    }
    const who = String(claims.email ?? claims.username ?? claims.sub ?? 'unknown');
    const q = event.queryStringParameters ?? {};
    switch (event.routeKey) {
      case 'GET /api/admin/stats': {
        const days = q.days === '30' ? 30 : q.days === '90' ? 90 : 7;
        await audit(who, 'view_stats', `${days}d`);
        return stats(days);
      }
      case 'GET /api/admin/audit': {
        const month = /^\d{6}$/.test(q.month ?? '')
          ? (q.month as string)
          : deps.now().toISOString().slice(0, 7).replace('-', '');
        await audit(who, 'view_audit', month);
        return auditLog(month);
      }
      case 'GET /api/admin/retained':
        await audit(who, 'list_retained', '-');
        return retainedList();
      case 'GET /api/admin/retained/{id}':
      case 'DELETE /api/admin/retained/{id}': {
        const id = event.pathParameters?.id ?? '';
        if (!UUID.test(id)) return error(404, 'not_found', '보관 파일이 없어요.');
        const job = await retainedJob(id);
        if (!job) return error(404, 'not_found', '보관 파일이 없어요.');
        if (event.routeKey.startsWith('DELETE')) {
          // 지우기 전에 남긴다: 지우다 실패해도 시도한 기록은 있어야 한다
          await audit(who, 'delete_retained', id);
          return removeRetained(id, job);
        }
        const file = q.file === 'input' ? 'input' : 'output';
        // 파일을 열 때마다 감사 로그에 남긴다 (F16 수용 기준)
        await audit(who, 'view_file', `${id}/${file}`);
        return viewUrl(job, file);
      }
      default:
        return error(404, 'not_found', '없는 주소예요.');
    }
  };
}

let real: ReturnType<typeof makeHandler> | null = null;
export const handler = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const TABLE_NAME = process.env.TABLE_NAME;
  const ORIGIN_PARAM = process.env.ORIGIN_PARAM;
  const RETAINED_BUCKET = process.env.RETAINED_BUCKET;
  if (!TABLE_NAME || !ORIGIN_PARAM || !RETAINED_BUCKET) {
    throw new Error('env TABLE_NAME, ORIGIN_PARAM, RETAINED_BUCKET are required');
  }
  real ??= makeHandler({
    env: { TABLE_NAME, ORIGIN_PARAM, RETAINED_BUCKET },
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    ssm: new SSMClient({}),
    s3: new S3Client({}),
    now: () => new Date(),
  });
  return real(event);
};
