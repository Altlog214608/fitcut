import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { groupsOf, lastDays, makeHandler } from './api';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2' }));
const ssm = new SSMClient({ region: 'ap-northeast-2' });
const ddbMock = mockClient(ddb);
const ssmMock = mockClient(ssm);
const NOW = new Date('2026-10-11T18:00:00Z'); // 서울 12일 03시

const handler = makeHandler({
  env: { TABLE_NAME: 't', ORIGIN_PARAM: '/fitcut/dev/origin-verify' },
  ddb,
  ssm,
  now: () => NOW,
});

function event(
  routeKey: string,
  groups: string,
  query: Record<string, string> = {},
  origin = 'secret',
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    routeKey,
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
});
