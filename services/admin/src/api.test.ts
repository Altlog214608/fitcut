import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
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
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { groupsOf, lastDays, makeHandler } from './api';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2' }));
const ssm = new SSMClient({ region: 'ap-northeast-2' });
const ddbMock = mockClient(ddb);
const ssmMock = mockClient(ssm);
// 서명 주소는 로컬에서 만들기만 하므로 가짜 자격 증명으로 충분하다
const s3 = new S3Client({
  region: 'ap-northeast-2',
  credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
});
const s3Mock = mockClient(s3);
const JOB = '0b8f4c56-1d7e-4c3b-9a55-2f0d6c1e9a10';
const NOW = new Date('2026-10-11T18:00:00Z'); // 서울 12일 03시

const handler = makeHandler({
  env: { TABLE_NAME: 't', ORIGIN_PARAM: '/fitcut/dev/origin-verify', RETAINED_BUCKET: 'keep' },
  ddb,
  ssm,
  s3,
  now: () => NOW,
});

function event(
  routeKey: string,
  groups: string,
  query: Record<string, string> = {},
  origin = 'secret',
  id?: string,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    routeKey,
    ...(id ? { pathParameters: { id } } : {}),
    headers: { 'x-origin-verify': origin },
    queryStringParameters: query,
    requestContext: {
      authorizer: {
        jwt: { claims: { 'cognito:groups': groups, email: 'admin@example.com' }, scopes: [] },
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

beforeEach(() => {
  ddbMock.reset();
  ssmMock.reset();
  s3Mock.reset();
  ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: 'secret' } });
  ddbMock.on(PutCommand).resolves({});
});

describe('관리자 API', () => {
  it('그룹 클레임 읽기 ("[admin other]" 문자열·배열)', () => {
    expect(groupsOf('[admin other]')).toEqual(['admin', 'other']);
    expect(groupsOf(['admin'])).toEqual(['admin']);
    expect(groupsOf(undefined)).toEqual([]);
  });

  it('어제부터 거꾸로 n일 (서울)', () => {
    expect(lastDays(NOW, 3)).toEqual(['2026-10-11', '2026-10-10', '2026-10-09']);
  });

  it('CloudFront를 거치지 않았거나 admin 그룹이 아니면 403', async () => {
    expect((await handler(event('GET /api/admin/stats', '[admin]', {}, 'wrong'))).statusCode).toBe(
      403,
    );
    const r = await handler(event('GET /api/admin/stats', '[viewer]'));
    expect(r.statusCode).toBe(403);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('일별 집계를 최신순으로 돌려주고, 본 기록을 감사 로그에 남긴다', async () => {
    ddbMock.on(BatchGetCommand).resolves({
      Responses: {
        t: [
          { PK: 'STATS#2026-10-10', SK: 'DAY', day: '2026-10-10', sessions: 4 },
          { PK: 'STATS#2026-10-11', SK: 'DAY', day: '2026-10-11', sessions: 5 },
        ],
      },
    });
    const r = await handler(event('GET /api/admin/stats', '[admin]', { days: '7' }));
    expect(JSON.parse(r.body ?? '{}').days.map((d: { day: string }) => d.day)).toEqual([
      '2026-10-11',
      '2026-10-10',
    ]);
    const keys = ddbMock.commandCalls(BatchGetCommand)[0]?.args[0].input.RequestItems?.t?.Keys;
    expect(keys).toHaveLength(7);
    const auditItem = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(auditItem).toMatchObject({
      PK: 'AUDIT#202610',
      action: 'view_stats',
      target: '7d',
      admin: 'admin@example.com',
    });
  });

  it('감사 로그는 달별로 최신부터', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          SK: '2026-10-11T18:00:00.000Z#admin@example.com',
          admin: 'admin@example.com',
          action: 'view_stats',
          target: '7d',
        },
      ],
    });
    const r = await handler(event('GET /api/admin/audit', '[admin]', { month: '202610' }));
    expect(JSON.parse(r.body ?? '{}').entries[0]).toEqual({
      at: '2026-10-11T18:00:00.000Z',
      admin: 'admin@example.com',
      action: 'view_stats',
      target: '7d',
    });
    expect(ddbMock.commandCalls(QueryCommand)[0]?.args[0].input.ExpressionAttributeValues).toEqual({
      ':pk': 'AUDIT#202610',
    });
  });

  const retainedJob = {
    PK: `JOB#${JOB}`,
    SK: 'META',
    kind: 'gif',
    createdAt: '2026-10-12T03:00:00.000Z',
    retainedInputKey: `jobs/${JOB}/input`,
    retainedOutputKey: `jobs/${JOB}/output.gif`,
  };
  const audits = () =>
    ddbMock.commandCalls(PutCommand).map((c) => c.args[0].input.Item?.action as string);

  it('보관 파일 목록 (최신순, 파일명 없음)을 돌려주고 감사 로그에 남긴다', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          SK: `2026-10-12T03:00:00.000Z#${JOB}`,
          jobId: JOB,
          kind: 'gif',
          inputBytes: 10,
          outputBytes: 20,
          retainUntil: '2026-11-11T03:00:00.000Z',
        },
      ],
    });
    const r = await handler(event('GET /api/admin/retained', '[admin]'));
    expect(JSON.parse(r.body ?? '{}').files[0]).toEqual({
      id: JOB,
      kind: 'gif',
      createdAt: '2026-10-12T03:00:00.000Z',
      retainUntil: '2026-11-11T03:00:00.000Z',
      inputBytes: 10,
      outputBytes: 20,
    });
    expect(audits()).toEqual(['list_retained']);
  });

  it('파일을 열면 5분짜리 주소를 주고, 열 때마다 감사 로그에 남긴다', async () => {
    ddbMock.on(GetCommand).resolves({ Item: retainedJob });
    const r = await handler(
      event('GET /api/admin/retained/{id}', '[admin]', { file: 'input' }, 'secret', JOB),
    );
    const url = new URL(JSON.parse(r.body ?? '{}').url);
    expect(url.hostname).toContain('keep');
    expect(url.pathname).toBe(`/jobs/${JOB}/input`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    const item = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(item).toMatchObject({ action: 'view_file', target: `${JOB}/input` });
  });

  it('지우면 보관본·목록 항목을 지우고 잡을 deleted로, 감사 로그를 남긴다', async () => {
    ddbMock.on(GetCommand).resolves({ Item: retainedJob });
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(DeleteCommand).resolves({});
    s3Mock.on(DeleteObjectsCommand).resolves({});
    const r = await handler(event('DELETE /api/admin/retained/{id}', '[admin]', {}, 'secret', JOB));
    expect(r.statusCode).toBe(204);
    expect(
      s3Mock
        .commandCalls(DeleteObjectsCommand)[0]
        ?.args[0].input.Delete?.Objects?.map((o) => o.Key),
    ).toEqual([`jobs/${JOB}/input`, `jobs/${JOB}/output.gif`]);
    expect(ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input.Key).toEqual({
      PK: 'RETAINED',
      SK: `2026-10-12T03:00:00.000Z#${JOB}`,
    });
    expect(audits()).toEqual(['delete_retained']);
  });

  it('보관하지 않았거나 이상한 ID면 404, 관리자가 아니면 아무것도 하지 않는다', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...retainedJob, retainedOutputKey: undefined } });
    expect(
      (await handler(event('GET /api/admin/retained/{id}', '[admin]', {}, 'secret', JOB)))
        .statusCode,
    ).toBe(404);
    expect(
      (await handler(event('GET /api/admin/retained/{id}', '[admin]', {}, 'secret', '../x')))
        .statusCode,
    ).toBe(404);
    ddbMock.reset();
    expect(
      (await handler(event('DELETE /api/admin/retained/{id}', '[viewer]', {}, 'secret', JOB)))
        .statusCode,
    ).toBe(403);
    expect(ddbMock.calls()).toHaveLength(0);
    expect(s3Mock.calls()).toHaveLength(0);
  });
});
