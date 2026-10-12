import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkRange, DAILY_CLIPS, makeClips } from './clips';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2' }));
const sqs = new SQSClient({ region: 'ap-northeast-2' });
const ddbMock = mockClient(ddb);
const sqsMock = mockClient(sqs);
const B = '20261012090000-abcdef';
const clips = makeClips({
  table: 't',
  queueUrl: 'https://sqs/worker',
  ddb,
  sqs,
  now: () => new Date('2026-10-12T10:00:00Z'),
});
const uploaded = { key: `rec/ch1/${B}/u1`, size: 5e9, status: 'uploaded' };

beforeEach(() => {
  ddbMock.reset();
  sqsMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
  sqsMock.on(SendMessageCommand).resolves({});
});

describe('checkRange', () => {
  it('0 이상, 끝 > 시작, 1분까지', () => {
    expect(checkRange({ start: 10.12345, end: 35 })).toEqual({ start: 10.123, end: 35 });
    expect(() => checkRange({ start: -1, end: 5 })).toThrow();
    expect(() => checkRange({ start: 5, end: 5 })).toThrow();
    expect(() => checkRange({ start: 0, end: 61 })).toThrow('1분');
    expect(() => checkRange({ start: 'a', end: 5 })).toThrow();
  });
});

describe('clips', () => {
  it('녹화 파일에서 자르는 잡을 만들고 워커 큐에 넣는다', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { recording: uploaded } });
    const r = await clips.create('ch1', B, { start: 3600, end: 3625 });
    expect(r).toMatchObject({ start: 3600, end: 3625 });
    const job = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(job).toMatchObject({
      PK: `JOB#${r.jobId}`,
      status: 'queued',
      kind: 'clip',
      inputKey: uploaded.key,
      inputBucket: 'recordings',
      params: { start: 3600, end: 3625, fps: 30, width: 0 },
    });
    const msg = sqsMock.commandCalls(SendMessageCommand)[0]?.args[0].input;
    expect(msg?.QueueUrl).toBe('https://sqs/worker');
    expect(JSON.parse(String(msg?.MessageBody))).toEqual({ jobId: r.jobId });
    const quota = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(quota?.Key).toEqual({ PK: 'QUOTA#chzzk#ch1#20261012', SK: 'CLIP' });
    expect(quota?.ExpressionAttributeValues?.[':max']).toBe(DAILY_CLIPS);
  });

  it('녹화 파일을 다 올리지 않았으면 409', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { recording: { ...uploaded, status: 'uploading' } } });
    await expect(clips.create('ch1', B, { start: 0, end: 10 })).rejects.toMatchObject({
      status: 409,
    });
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it('하루 개수를 넘으면 429', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { recording: uploaded } });
    ddbMock.on(UpdateCommand).callsFake(() => {
      const e = new Error('cond');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    });
    await expect(clips.create('ch1', B, { start: 0, end: 10 })).rejects.toMatchObject({
      status: 429,
    });
  });
});
