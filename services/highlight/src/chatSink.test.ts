import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { SQSEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { groupByBroadcast } from './chatBatch';
import { makeHandler } from './chatSink';

const s3 = new S3Client({ region: 'ap-northeast-2' });
const s3Mock = mockClient(s3);
const B1 = '20261012100000-a1b2c3';
const B2 = '20261012110000-d4e5f6';

const body = (broadcastId: string, events: unknown[], channelId = 'ch1') =>
  JSON.stringify({ v: 1, broadcastId, channelId, events });
const sqsEvent = (bodies: string[]): SQSEvent =>
  ({ Records: bodies.map((b, i) => ({ messageId: `m${i}`, body: b })) }) as unknown as SQSEvent;

beforeEach(() => {
  s3Mock.reset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('groupByBroadcast', () => {
  it('방송별로 묶고, 모양이 다르거나 경로에 쓸 수 없는 값은 버린다', () => {
    const { groups, skipped } = groupByBroadcast([
      { id: 'a', body: body(B1, [{ t: 1 }]) },
      { id: 'b', body: body(B1, [{ t: 2 }, { t: 3 }]) },
      { id: 'c', body: body(B2, [{ t: 9 }]) },
      { id: 'd', body: body('../etc', [{ t: 1 }]) },
      { id: 'e', body: body(B1, [{ t: 1 }], 'ch/../x') },
      { id: 'f', body: 'nope' },
    ]);
    expect(groups.map((g) => [g.broadcastId, g.lines.length, g.messageIds])).toEqual([
      [B1, 3, ['a', 'b']],
      [B2, 1, ['c']],
    ]);
    expect(skipped).toEqual(['d', 'e', 'f']);
  });
});

describe('chat sink', () => {
  const handler = makeHandler({ bucket: 'chat', s3, now: () => 1760263200000, newId: () => 'id' });

  it('방송마다 gzip JSON Lines 하나를 쓴다', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const r = await handler(sqsEvent([body(B1, [{ t: 1, text: 'ㅋㅋ' }]), body(B2, [{ t: 2 }])]));
    expect(r.batchItemFailures).toEqual([]);
    const puts = s3Mock.commandCalls(PutObjectCommand).map((c) => c.args[0].input);
    expect(puts.map((p) => p.Key)).toEqual([
      `chat/chzzk/ch1/${B1}/1760263200000-id.jsonl.gz`,
      `chat/chzzk/ch1/${B2}/1760263200000-id.jsonl.gz`,
    ]);
    expect(gunzipSync(puts[0]?.Body as Buffer).toString()).toBe('{"t":1,"text":"ㅋㅋ"}\n');
  });

  it('쓰지 못한 방송의 메시지만 실패로 돌린다', async () => {
    s3Mock.on(PutObjectCommand).callsFake((input: { Key: string }) => {
      if (input.Key.includes(B2)) throw new Error('s3 down');
      return {};
    });
    const r = await handler(sqsEvent([body(B1, [{ t: 1 }]), body(B2, [{ t: 2 }])]));
    expect(r.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }]);
  });
});
