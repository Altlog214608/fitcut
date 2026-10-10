import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
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
const sqs = new SQSClient({ region: 'ap-northeast-2' });
// presigned POST는 로컬에서 서명만 하므로 가짜 자격 증명으로 충분하다
const s3 = new S3Client({
  region: 'ap-northeast-2',
  credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
});
const ddbMock = mockClient(ddb);
const ssmMock = mockClient(ssm);
const sqsMock = mockClient(sqs);
const s3Mock = mockClient(s3);

const ID = '0b8f4c56-1d7e-4c3b-9a55-2f0d6c1e9a10';
const UPLOAD_ID = '7d2e9a41-5b6c-4f8d-8e1a-3c9b0f2d4e6a';
const NOW = new Date('2026-10-10T03:00:00Z');

function handler() {
  return makeHandler({
    env: {
      TABLE_NAME: 'fitcut-dev-main',
      UPLOADS_BUCKET: 'fitcut-dev-uploads-x',
      OUTPUTS_BUCKET: 'fitcut-dev-outputs-x',
      QUEUE_URL: 'https://sqs.ap-northeast-2.amazonaws.com/000000000000/fitcut-dev-worker',
      SALT_PARAM: '/fitcut/dev/ip-salt',
      ORIGIN_PARAM: '/fitcut/dev/origin-verify',
      DAILY_JOB_LIMIT: '20',
      DAILY_UPLOAD_LIMIT: '20',
    },
    ddb,
    s3,
    sqs,
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

const uploadBody = JSON.stringify({ fileSize: 5_000_000, contentType: 'video/mp4' });
const body = JSON.stringify({ uploadId: UPLOAD_ID, kind: 'gif', start: 1, end: 6 });

const upload = {
  PK: `UPLOAD#${UPLOAD_ID}`,
  SK: 'META',
  id: UPLOAD_ID,
  inputKey: `in/${UPLOAD_ID}`,
  contentType: 'video/mp4',
  fileSize: 5_000_000,
  createdAt: NOW.toISOString(),
  ttl: NOW.getTime() / 1000 + 3600,
};

const conditionFailed = () => new ConditionalCheckFailedException({ message: 'no', $metadata: {} });

/** 업로드가 끝난 상태에서 잡 만들기가 성공하는 가짜 응답 */
function uploaded() {
  ddbMock.on(GetCommand).resolves({ Item: upload });
  s3Mock.on(HeadObjectCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
}

beforeEach(() => {
  ddbMock.reset();
  ssmMock.reset();
  sqsMock.reset();
  s3Mock.reset();
  ssmMock.on(GetParametersCommand).resolves({
    Parameters: [
      { Name: '/fitcut/dev/ip-salt', Value: 'salt' },
      { Name: '/fitcut/dev/origin-verify', Value: 'origin-secret' },
    ],
  });
});

describe('업로드', () => {
  it('CloudFront를 거치지 않은 요청(오리진 확인 헤더 없음)은 거절한다', async () => {
    const res = await handler()(event('POST /api/uploads', { body: uploadBody, headers: {} }));
    expect(res.statusCode).toBe(403);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('업로드 기록을 만들고 업로드 주소를 준다 (원본 IP는 저장하지 않는다)', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    const res = await handler()(event('POST /api/uploads', { body: uploadBody }));
    expect(res.statusCode).toBe(201);
    const out = JSON.parse(res.body ?? '{}');
    expect(out.upload.id).toBe(ID);
    expect(out.upload.url).toContain('fitcut-dev-uploads-x');
    expect(out.upload.fields).toMatchObject({ key: `in/${ID}`, 'Content-Type': 'video/mp4' });

    const quota = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(quota?.Key?.PK).toMatch(/^QUOTA#[0-9a-f]{32}#20261010$/);
    expect(quota?.ExpressionAttributeNames).toMatchObject({ '#c': 'uploads' });
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      PK: `UPLOAD#${ID}`,
      inputKey: `in/${ID}`,
    });
    expect(JSON.stringify(ddbMock.calls().map((c) => c.args[0].input))).not.toContain(
      '203.0.113.7',
    );
  });

  it('하루 업로드 할당량을 넘으면 429와 안내 문구', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed());
    const res = await handler()(event('POST /api/uploads', { body: uploadBody }));
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body ?? '{}').error.message).toContain('영상을 20번까지');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('입력이 잘못되면 할당량을 쓰지 않고 400', async () => {
    const res = await handler()(
      event('POST /api/uploads', {
        body: JSON.stringify({ fileSize: 1, contentType: 'image/gif' }),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

describe('잡 만들기', () => {
  it('올린 영상으로 잡을 만들어 워커 큐에 넣는다', async () => {
    uploaded();
    sqsMock.on(SendMessageCommand).resolves({});
    const res = await handler()(event('POST /api/jobs', { body }));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body ?? '{}').job).toMatchObject({
      id: ID,
      status: 'queued',
      kind: 'gif',
      params: { start: 1, end: 6, fps: 15, width: 480 },
    });
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      PK: `JOB#${ID}`,
      uploadId: UPLOAD_ID,
      inputKey: `in/${UPLOAD_ID}`,
      fileSize: 5_000_000,
    });
    const quota = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(quota?.ExpressionAttributeNames).toMatchObject({ '#c': 'count' });
    expect(sqsMock.commandCalls(SendMessageCommand)[0]?.args[0].input.MessageBody).toBe(
      JSON.stringify({ jobId: ID }),
    );
  });

  it('업로드가 끝나지 않았으면 할당량을 쓰지 않고 409', async () => {
    ddbMock.on(GetCommand).resolves({ Item: upload });
    s3Mock.on(HeadObjectCommand).rejects(Object.assign(new Error('nf'), { name: 'NotFound' }));
    const res = await handler()(event('POST /api/jobs', { body }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body ?? '{}').error.code).toBe('not_uploaded');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(sqsMock.calls()).toHaveLength(0);
  });

  it('없거나 만료된 업로드면 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...upload, ttl: NOW.getTime() / 1000 - 1 } });
    const res = await handler()(event('POST /api/jobs', { body }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body ?? '{}').error.code).toBe('upload_not_found');
    expect(s3Mock.calls()).toHaveLength(0);
  });

  it('하루 잡 할당량을 넘으면 429와 안내 문구', async () => {
    uploaded();
    ddbMock.on(UpdateCommand).rejects(conditionFailed());
    const res = await handler()(event('POST /api/jobs', { body }));
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body ?? '{}').error.message).toContain('오늘은 20번까지');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('큐에 넣지 못하면 잡을 failed로 바꾸고 오류를 던진다', async () => {
    uploaded();
    sqsMock.on(SendMessageCommand).rejects(new Error('sqs down'));
    await expect(handler()(event('POST /api/jobs', { body }))).rejects.toThrow('sqs down');
    const last = ddbMock.commandCalls(UpdateCommand).at(-1)?.args[0].input;
    expect(last?.Key).toEqual({ PK: `JOB#${ID}`, SK: 'META' });
    expect(last?.ExpressionAttributeValues).toMatchObject({ ':failed': 'failed' });
  });

  it('입력이 잘못되면 할당량을 쓰지 않고 400', async () => {
    const res = await handler()(
      event('POST /api/jobs', {
        body: JSON.stringify({ uploadId: UPLOAD_ID, kind: 'gif', start: 0, end: 99 }),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

describe('잡 상태', () => {
  const item = {
    PK: `JOB#${ID}`,
    SK: 'META',
    id: ID,
    kind: 'gif',
    params: { start: 1, end: 6, fps: 15, width: 480 },
    uploadId: UPLOAD_ID,
    inputKey: `in/${UPLOAD_ID}`,
    createdAt: NOW.toISOString(),
    ttl: NOW.getTime() / 1000 + 3600,
  };

  it('잡 상태를 돌려준다', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...item, status: 'queued' } });
    const res = await handler()(event('GET /api/jobs/{id}', { pathParameters: { id: ID } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? '{}').job).toMatchObject({ id: ID, status: 'queued' });
  });

  it('끝난 잡은 결과 내려받기 주소(첨부 파일 이름 포함)를 준다', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { ...item, status: 'done', outputKey: `out/${ID}.gif`, outputBytes: 123456 },
    });
    const res = await handler()(event('GET /api/jobs/{id}', { pathParameters: { id: ID } }));
    const job = JSON.parse(res.body ?? '{}').job;
    expect(job).toMatchObject({ status: 'done', outputBytes: 123456 });
    const url = new URL(job.downloadUrl);
    expect(url.hostname).toContain('fitcut-dev-outputs-x');
    expect(url.pathname).toBe(`/out/${ID}.gif`);
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="fitcut_gif_480_0b8f4c56.gif"',
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
  });

  it('없는 잡이나 이상한 ID는 404 (DynamoDB를 부르지 않는다)', async () => {
    const res = await handler()(event('GET /api/jobs/{id}', { pathParameters: { id: '../x' } }));
    expect(res.statusCode).toBe(404);
    expect(ddbMock.calls()).toHaveLength(0);
  });
});
