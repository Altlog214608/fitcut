import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeHandler } from './handler';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2' }));
const ssm = new SSMClient({ region: 'ap-northeast-2' });
// presigned POST는 로컬에서 서명만 하므로 가짜 자격 증명으로 충분하다
const s3 = new S3Client({
  region: 'ap-northeast-2',
  credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
});
const ddbMock = mockClient(ddb);
const ssmMock = mockClient(ssm);

const ID = '0b8f4c56-1d7e-4c3b-9a55-2f0d6c1e9a10';
const NOW = new Date('2026-10-10T03:00:00Z');

function handler() {
  return makeHandler({
    env: {
      TABLE_NAME: 'fitcut-dev-main',
      UPLOADS_BUCKET: 'fitcut-dev-uploads-x',
      SALT_PARAM: '/fitcut/dev/ip-salt',
      ORIGIN_PARAM: '/fitcut/dev/origin-verify',
      DAILY_JOB_LIMIT: '20',
    },
    ddb,
    s3,
    ssm,
    now: () => NOW,
    newId: () => ID,
  });
}

function event(
  routeKey: string,
  init: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey,
    rawPath: '/',
    rawQueryString: '',
    headers: {
      'x-origin-verify': 'origin-secret',
      'cloudfront-viewer-address': '203.0.113.7:5555',
    },
    isBase64Encoded: false,
    requestContext: {
      http: { sourceIp: '130.176.0.1', method: 'POST' },
    } as APIGatewayProxyEventV2['requestContext'],
    ...init,
  };
}

const body = JSON.stringify({
  kind: 'gif',
  start: 1,
  end: 6,
  fileSize: 5_000_000,
  contentType: 'video/mp4',
});

beforeEach(() => {
  ddbMock.reset();
  ssmMock.reset();
  ssmMock.on(GetParametersCommand).resolves({
    Parameters: [
      { Name: '/fitcut/dev/ip-salt', Value: 'salt' },
      { Name: '/fitcut/dev/origin-verify', Value: 'origin-secret' },
    ],
  });
});

describe('잡 API', () => {
  it('CloudFront를 거치지 않은 요청(오리진 확인 헤더 없음)은 거절한다', async () => {
    const res = await handler()(event('POST /api/jobs', { body, headers: {} }));
    expect(res.statusCode).toBe(403);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('잡을 만들고 업로드 주소를 준다 (원본 IP는 저장하지 않는다)', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    const res = await handler()(event('POST /api/jobs', { body }));
    expect(res.statusCode).toBe(201);
    const out = JSON.parse(res.body ?? '{}');
    expect(out.job).toMatchObject({ id: ID, status: 'created', kind: 'gif' });
    expect(out.upload.url).toContain('fitcut-dev-uploads-x');
    expect(out.upload.fields).toMatchObject({ key: `in/${ID}`, 'Content-Type': 'video/mp4' });

    const quota = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(quota?.Key?.PK).toMatch(/^QUOTA#[0-9a-f]{32}#20261010$/);
    expect(JSON.stringify(ddbMock.calls().map((c) => c.args[0].input))).not.toContain(
      '203.0.113.7',
    );
  });

  it('하루 할당량을 넘으면 429와 안내 문구', async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'no', $metadata: {} }));
    const res = await handler()(event('POST /api/jobs', { body }));
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body ?? '{}').error.message).toContain('오늘은 20번까지');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('입력이 잘못되면 할당량을 쓰지 않고 400', async () => {
    const res = await handler()(
      event('POST /api/jobs', { body: JSON.stringify({ kind: 'gif', start: 0, end: 99 }) }),
    );
    expect(res.statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('잡 상태를 돌려준다', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: `JOB#${ID}`,
        SK: 'META',
        id: ID,
        status: 'queued',
        kind: 'gif',
        params: { start: 1, end: 6, fps: 15, width: 480 },
        inputKey: `in/${ID}`,
        createdAt: NOW.toISOString(),
        ttl: NOW.getTime() / 1000 + 3600,
      },
    });
    const res = await handler()(event('GET /api/jobs/{id}', { pathParameters: { id: ID } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? '{}').job).toMatchObject({ id: ID, status: 'queued' });
  });

  it('없는 잡이나 이상한 ID는 404 (DynamoDB를 부르지 않는다)', async () => {
    const res = await handler()(event('GET /api/jobs/{id}', { pathParameters: { id: '../x' } }));
    expect(res.statusCode).toBe(404);
    expect(ddbMock.calls()).toHaveLength(0);
  });
});
