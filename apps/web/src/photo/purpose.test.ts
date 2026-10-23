import { VISIBLE_PRESETS } from '@koicut/presets';
import { describe, expect, it } from 'vitest';
import { monitorLabel, purposeOf, purposeTargets } from './purpose';
import { resolveTarget } from './target';

describe('purposeTargets', () => {
  it('폰은 대표 기기가 먼저, 워치·태블릿에는 그 용도 기기만', () => {
    const phones = purposeTargets(VISIBLE_PRESETS, 'phone');
    expect(phones[0]).toEqual({ kind: 'preset', presetId: 'apple-iphone-17-pro', role: 'main' });
    for (const purpose of ['phone', 'tablet', 'watch'] as const) {
      const targets = purposeTargets(VISIBLE_PRESETS, purpose);
      expect(targets.length).toBeGreaterThan(0);
      expect(targets.length).toBeLessThanOrEqual(8);
      for (const t of targets) {
        const r = resolveTarget(t, VISIBLE_PRESETS);
        expect(r?.preset && purposeOf(r.preset.category)).toBe(purpose);
      }
    }
  });

  it('PC는 모니터 해상도 다음에 맥북·아이맥', () => {
    const pc = purposeTargets(VISIBLE_PRESETS, 'pc');
    expect(pc.slice(0, 3)).toEqual([
      { kind: 'custom', width: 1920, height: 1080 },
      { kind: 'custom', width: 2560, height: 1440 },
      { kind: 'custom', width: 3840, height: 2160 },
    ]);
    const names = pc.slice(3).map((t) => resolveTarget(t, VISIBLE_PRESETS)?.label);
    expect(names).toContain('MacBook Air 13 (M5)');
    expect(names).toContain('iMac 24 (M4)');
  });

  it('모니터 크기를 직접 넣어도 이름이 붙는다', () => {
    expect(monitorLabel(2560, 1440)).toBe('Monitor QHD');
    expect(monitorLabel(1080, 1920)).toBeNull();
    expect(resolveTarget({ kind: 'custom', width: 3840, height: 2160 }, [])?.label).toBe(
      'Monitor 4K',
    );
  });
});
