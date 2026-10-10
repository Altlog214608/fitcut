import { describe, expect, it } from 'vitest';
import { VISIBLE_PRESETS } from './index';
import { overlaysFor } from './overlays';

const byId = (id: string) => {
  const p = VISIBLE_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p;
};

describe('잠금화면 가이드', () => {
  it('아이폰·갤럭시 S·픽셀 본 화면은 OS별 대략적인 틀', () => {
    expect(overlaysFor(byId('apple-iphone-17-pro'), 'main')?.source).toBe('template');
    expect(overlaysFor(byId('samsung-galaxy-s26'), 'main')?.overlays.map((o) => o.kind)).toEqual([
      'camera',
      'clock',
      'widgets',
    ]);
  });

  it('워치·태블릿·플립 커버 화면은 가이드가 없다 (버튼을 보이지 않는다)', () => {
    expect(overlaysFor(byId('samsung-galaxy-watch9-44mm'), 'main')).toBeNull();
    expect(overlaysFor(byId('samsung-galaxy-z-flip8'), 'cover')).toBeNull();
    const tablet = VISIBLE_PRESETS.find((p) => p.category === 'tablet');
    expect(tablet && overlaysFor(tablet, 'main')).toBeNull();
  });

  it('모든 틀은 화면 안 (0~1)', () => {
    for (const p of VISIBLE_PRESETS) {
      for (const s of p.screens) {
        for (const o of overlaysFor(p, s.role)?.overlays ?? []) {
          expect(o.x + o.w).toBeLessThanOrEqual(1);
          expect(o.y + o.h).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
