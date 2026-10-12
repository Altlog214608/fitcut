import { describe, expect, it } from 'vitest';
import { liveJobs, type MyJob } from './myJobs';

const job = (id: string, createdAt: string, retainUntil: string): MyJob => ({
  id,
  kind: 'gif',
  createdAt,
  retainUntil,
  token: 't',
});

describe('내 작업 기록', () => {
  it('기간이 끝났거나 모양이 틀린 항목은 빼고 최신순으로', () => {
    const now = new Date('2026-10-12T00:00:00Z');
    const list = [
      job('a', '2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z'),
      job('old', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z'),
      job('b', '2026-10-05T00:00:00Z', '2026-11-04T00:00:00Z'),
      { id: 'broken' },
      null,
    ];
    expect(liveJobs(list, now).map((j) => j.id)).toEqual(['b', 'a']);
  });
});
