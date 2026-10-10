import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { SQSEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { objectKey, partition, seoulDate } from './batch';
import { makeHandler } from './handler';

const s3 = new S3Client({ region: 'ap-northeast-2' });
const s3Mock = mockClient(s3);
const DAY1 = Date.UTC(2026, 9, 10, 3); // 서울 10월 10일 낮
const DAY2 = Date.UTC(2026, 9, 10, 16); // 서울 10월 11일 새벽

const msg = (id: string, events: unknown[]) => ({ id, body: JSON.stringify({ events }) });
const sqs = (...ms: { id: string; body: string }[]): SQSEvent => ({
  Records: ms.map((m) => ({ messageId: m.id, body: m.body }) as SQSEvent['Records'][number]),
});

beforeEach(() => {
  s3Mock.reset();
});

describe('partition', () => {
  it('서울 날짜별로 나누고, 모양이 이상한 메시지는 건너뛴다', () => {
    const { partitions, skipped } = partition(
      [
        msg('a', [{ name: 'tool_open', receivedAt: DAY1 }]),
        msg('b', [
          { name: 'tool_open', receivedAt: DAY1 },
          { name: 'tool_open', receivedAt: DAY2 },
        ]),
        { id: 'c', body: 'nope' },
      ],
      DAY1,
    );
    expect(skipped).toEqual(['c']);
    expect(partitions.map((p) => [p.dt, p.lines.length, p.messageIds])).toEqual([
      ['2026-10-10', 2, ['a', 'b']],
      ['2026-10-11', 1, ['b']],
    ]);
  });

  it('키는 Athena 파티션 모양', () => {
    expect(seoulDate(DAY2)).toBe('2026-10-11');
    expect(objectKey('2026-10-11', 1, 'x')).toBe('events/dt=2026-10-11/1-x.json.gz');
  });
});

describe('배치 Lambda', () => {
  const handler = makeHandler({ bucket: 'analytics', s3, now: () => 1, newId: () => 'id' });

  it('날짜마다 gzip JSON Lines 객체 하나', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const res = await handler(
      sqs(
        msg('a', [{ name: 'tool_open', tool: 'gif', receivedAt: DAY1 }]),
        msg('b', [{ name: 'tool_open', receivedAt: DAY2 }]),
      ),
    );
    expect(res.batchItemFailures).toEqual([]);
    const puts = s3Mock.commandCalls(PutObjectCommand).map((c) => c.args[0].input);
    expect(puts.map((p) => p.Key)).toEqual([
      'events/dt=2026-10-10/1-id.json.gz',
      'events/dt=2026-10-11/1-id.json.gz',
    ]);
    const lines = gunzipSync(puts[0]?.Body as Buffer)
      .toString()
      .trim()
      .split('\n');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ name: 'tool_open', tool: 'gif' });
  });

  it('쓰지 못한 날짜의 메시지만 다시 보내게 한다', async () => {
    s3Mock.on(PutObjectCommand).rejectsOnce(new Error('slow down')).resolves({});
    const res = await handler(
      sqs(msg('a', [{ receivedAt: DAY1 }]), msg('b', [{ receivedAt: DAY2 }])),
    );
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'a' }]);
  });
});
