import { describe, expect, it } from 'vitest';
import { summarize, usd, type DayStats } from './summary';

const day = (d: string, over: Partial<DayStats> = {}): DayStats => ({
  day: d,
  sessions: 0,
  tools: {},
  devices: [],
  presets: [],
  misses: [],
  jobs: [],
  errors: [],
  links: { saved: 0, blocked: 0 },
  cost: null,
  ...over,
});

describe('관리자 개요 합계', () => {
  it('세션·도구·잡 성공률·비용·인기 프리셋을 기간으로 합친다', () => {
    const s = summarize([
      day('2026-10-11', {
        sessions: 5,
        tools: { photo: { open: 5, selected: 3, exported: 3, errors: 0 } },
        presets: [{ id: 'samsung-galaxy-s26:main', n: 2 }],
        jobs: [{ type: 'gif', ok: 3, failed: 1, p50Ms: 5000, p95Ms: 9000, costUsd: 0.0006 }],
        cost: { totalUsd: 0.01, services: [{ service: 'AWS Lambda', usd: 0.01 }] },
      }),
      day('2026-10-10', {
        sessions: 4,
        tools: { photo: { open: 1, selected: 1, exported: 0, errors: 0 } },
        presets: [{ id: 'samsung-galaxy-s26:main', n: 1 }],
        jobs: [{ type: 'gif', ok: 1, failed: 0, p50Ms: 4000, p95Ms: 12000, costUsd: 0.0002 }],
        links: { saved: 2, blocked: 1 },
      }),
    ]);
    expect(s.sessions).toBe(9);
    expect(s.tools).toEqual([['photo', { open: 6, selected: 4, exported: 3, errors: 0 }]]);
    expect(s.jobs.successRate).toBeCloseTo(0.8);
    expect(s.jobs.list[0]).toMatchObject({ type: 'gif', ok: 4, failed: 1, p95Ms: 12000 });
    expect(s.costUsd).toBeCloseTo(0.01);
    expect(s.presets).toEqual([['samsung-galaxy-s26:main', 3]]);
    expect(s.links).toEqual({ saved: 2, blocked: 1 });
    expect(s.daily.map((d) => d.day)).toEqual(['2026-10-10', '2026-10-11']);
  });

  it('잡이 없으면 성공률 없음, 금액 표시', () => {
    expect(summarize([day('2026-10-11')]).jobs.successRate).toBeNull();
    expect(usd(0.0021)).toBe('$0.0021');
    expect(usd(1.5)).toBe('$1.50');
  });
});
