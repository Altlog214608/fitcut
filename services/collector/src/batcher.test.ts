import type { ChatEvent } from '@koicut/chzzk';
import { describe, expect, it, vi } from 'vitest';
import { Batcher, MAX_PENDING, packBodies } from './batcher';
import { backoffMs, stopReason, DEFAULT_LIMITS } from './rules';

const head = { broadcastId: 'b1', channelId: 'ch1' };
const ev = (i: number, text = 'ㅋㅋ'): ChatEvent => ({
  broadcastId: 'b1',
  t: i,
  at: i,
  type: 'chat',
  text,
});

describe('packBodies', () => {
  it('한 메시지에 여러 이벤트를 넣고, 크기를 넘으면 나눈다', () => {
    const events = Array.from({ length: 100 }, (_, i) => ev(i, 'x'.repeat(50)));
    const bodies = packBodies(events, head, 2000);
    expect(bodies.length).toBeGreaterThan(1);
    for (const b of bodies) expect(Buffer.byteLength(b.body)).toBeLessThanOrEqual(2000);
    const all = bodies.flatMap((b) => (JSON.parse(b.body) as { events: ChatEvent[] }).events);
    expect(all.map((e) => e.t)).toEqual(events.map((e) => e.t));
    expect(JSON.parse(bodies[0]?.body ?? '{}')).toMatchObject({
      v: 1,
      broadcastId: 'b1',
      channelId: 'ch1',
    });
  });
});

describe('Batcher', () => {
  it('보내지 못한 것은 다음 flush에 다시 보낸다', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('sqs down')).mockResolvedValue(undefined);
    const b = new Batcher(head, send);
    b.add(ev(1));
    b.add(ev(2));
    await expect(b.flush()).rejects.toThrow('sqs down');
    expect(b.size).toBe(2);
    expect(await b.flush()).toBe(2);
    expect(b.size).toBe(0);
  });

  it('너무 많이 쌓이면 버리고 센다', () => {
    const b = new Batcher(head, vi.fn());
    for (let i = 0; i < MAX_PENDING + 3; i++) b.add(ev(i));
    expect(b.size).toBe(MAX_PENDING);
    expect(b.dropped).toBe(3);
  });
});

describe('rules', () => {
  const base = { now: 0, startedAt: 0, lastEventAt: null, stopRequested: false };
  it('종료 요청이 가장 먼저', () => {
    expect(stopReason({ ...base, stopRequested: true, now: 9e9 }, DEFAULT_LIMITS)).toBe(
      'requested',
    );
  });
  it('마지막 이벤트 뒤 30분이면 idle', () => {
    expect(
      stopReason({ ...base, now: 40 * 60_000, lastEventAt: 11 * 60_000 }, DEFAULT_LIMITS),
    ).toBeNull();
    expect(
      stopReason({ ...base, now: 41 * 60_000, lastEventAt: 11 * 60_000 }, DEFAULT_LIMITS),
    ).toBe('idle');
  });
  it('8시간이면 max_duration', () => {
    expect(
      stopReason({ ...base, now: 8 * 3600_000, lastEventAt: 8 * 3600_000 - 1 }, DEFAULT_LIMITS),
    ).toBe('max_duration');
  });
  it('재연결 대기는 1초부터 두 배, 16초까지', () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 16000]);
  });
});
