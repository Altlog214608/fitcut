import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { SQSEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeHandler, parseLines } from './analyzeHandler';

const s3 = new S3Client({ region: 'ap-northeast-2' });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2' }));
const s3Mock = mockClient(s3);
const ddbMock = mockClient(ddb);
const B = '20261012090000-abcdef';
const handler = makeHandler({
  bucket: 'chat',
  outputsBucket: 'outputs',
  table: 't',
  s3,
  ddb,
  now: () => new Date('2026-10-12T10:00:00Z'),
});

/** S3 본문은 transformToByteArray만 쓴다 */
const gz = (lines: object[]) => {
  const bytes = gzipSync(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { transformToByteArray: async () => new Uint8Array(bytes) };
};
const sqs = (bodies: object[]): SQSEvent =>
  ({
    Records: bodies.map((b, i) => ({ messageId: `m${i}`, body: JSON.stringify(b) })),
  }) as unknown as SQSEvent;

beforeEach(() => {
  s3Mock.reset();
  ddbMock.reset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('parseLines', () => {
  it('깨진 줄은 건너뛴다', () => {
    expect(parseLines('{"t":1,"type":"chat"}\nnope\n\n{"x":1}\n')).toEqual([
      { t: 1, type: 'chat' },
    ]);
  });
});

describe('analyze handler', () => {
  it('방송 경로의 채팅을 모두 읽어 후보를 방송 기록에 남긴다', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { startedAt: '2026-10-12T09:00:00Z', endedAt: '2026-10-12T09:10:00Z' },
    });
    ddbMock.on(UpdateCommand).resolves({});
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [{ Key: 'a' }], IsTruncated: true, NextContinuationToken: 'n' })
      .resolvesOnce({ Contents: [{ Key: 'b' }], IsTruncated: false });
    const base = Array.from({ length: 600 }, (_, t) => ({ t, type: 'chat', text: '안녕' }));
    const burst = Array.from({ length: 120 }, (_, k) => ({
      t: 300 + k / 12,
      type: 'chat',
      text: 'ㅋㅋㅋ',
    }));
    s3Mock.on(GetObjectCommand, { Key: 'a' }).callsFake(() => ({ Body: gz(base) }));
    s3Mock.on(GetObjectCommand, { Key: 'b' }).callsFake(() => ({ Body: gz(burst) }));

    const r = await handler(sqs([{ channelId: 'ch1', broadcastId: B }]));
    expect(r.batchItemFailures).toEqual([]);
    expect(s3Mock.commandCalls(ListObjectsV2Command)[0]?.args[0].input.Prefix).toBe(
      `chat/chzzk/ch1/${B}/`,
    );
    const u = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(u?.Key).toEqual({ PK: 'CONN#chzzk#ch1', SK: `BCAST#${B}` });
    const v = u?.ExpressionAttributeValues ?? {};
    expect(v[':s']).toBe('done');
    expect(v[':d']).toBe(600);
    expect((v[':c'] as { peak: number }[])[0]?.peak).toBeGreaterThan(290);
    expect((v[':g'] as number[]).length).toBe(61);
  });

  it('잘못된 메시지는 버리고, 실패한 것만 다시 받는다', async () => {
    ddbMock.on(GetCommand).rejects(new Error('ddb down'));
    const r = await handler(
      sqs([
        { channelId: '../x', broadcastId: B },
        { channelId: 'ch1', broadcastId: B },
      ]),
    );
    expect(r.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }]);
  });

  it('방송 기록이 없으면(연결 해제) 아무것도 하지 않는다', async () => {
    ddbMock.on(GetCommand).resolves({});
    const r = await handler(sqs([{ channelId: 'ch1', broadcastId: B }]));
    expect(r.batchItemFailures).toEqual([]);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
  });

  it('소리 크기가 있으면 함께 쓰고 그래프도 남긴다 (모드 C: 채팅 없음)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { source: 'file' } });
    ddbMock.on(UpdateCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    const rmsDb = Array.from({ length: 600 }, (_, i) => (i >= 300 && i < 306 ? -8 : -30));
    const key = 'out/0b8f4c56-1d7e-4c3b-9a55-2f0d6c1e9a10.json';
    s3Mock.on(GetObjectCommand, { Bucket: 'outputs', Key: key }).resolves({
      Body: { transformToString: async () => JSON.stringify({ v: 1, rmsDb }) } as never,
    });
    const r = await handler(sqs([{ channelId: 'ch1', broadcastId: B, loudnessKey: key }]));
    expect(r.batchItemFailures).toEqual([]);
    const v = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.ExpressionAttributeValues ?? {};
    expect(v[':v']).toBe('score-v1/kw-v1/loud-v1');
    expect((v[':c'] as { peak: number }[])[0]?.peak).toBeGreaterThan(295);
    expect((v[':l'] as number[]).length).toBe(61);
  });

  it('소리 크기 키가 우리가 만든 모양이 아니면 무시한다', async () => {
    ddbMock.on(GetCommand).resolves({ Item: {} });
    ddbMock.on(UpdateCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    await handler(sqs([{ channelId: 'ch1', broadcastId: B, loudnessKey: '../secret' }]));
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it('채팅이 있는 방송: 녹화 파일이 먼저 시작한 만큼(offset) 소리를 당겨 채팅과 맞춘다', async () => {
    ddbMock.on(GetCommand).resolves({ Item: {} });
    ddbMock.on(UpdateCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    // 녹화 파일 기준 400초에 큰 소리, 녹화가 수집보다 100초 먼저 시작 → 채팅 기준 300초
    const rmsDb = Array.from({ length: 900 }, (_, i) => (i >= 400 && i < 406 ? -8 : -30));
    const key = 'out/0b8f4c56-1d7e-4c3b-9a55-2f0d6c1e9a10.json';
    s3Mock.on(GetObjectCommand, { Bucket: 'outputs', Key: key }).resolves({
      Body: { transformToString: async () => JSON.stringify({ v: 1, rmsDb }) } as never,
    });
    await handler(sqs([{ channelId: 'ch1', broadcastId: B, loudnessKey: key, offsetSec: 100 }]));
    const v = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.ExpressionAttributeValues ?? {};
    const peak = (v[':c'] as { peak: number }[])[0]?.peak ?? 0;
    expect(peak).toBeGreaterThan(295);
    expect(peak).toBeLessThan(312);
  });
});
