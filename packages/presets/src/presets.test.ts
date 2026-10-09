import { describe, expect, it } from 'vitest';
import { ALL_PRESETS, VISIBLE_PRESETS } from './index';
import { validatePresets } from './schema';

describe('기기 프리셋 데이터', () => {
  it('데이터 파일이 있다', () => {
    expect(ALL_PRESETS.length).toBeGreaterThan(0);
  });

  it('모든 프리셋이 스키마를 통과한다 (id 중복, 해상도, verified 출처 포함)', () => {
    expect(validatePresets([...ALL_PRESETS])).toEqual([]);
  });

  it('사용자에게는 verified 프리셋만 보인다', () => {
    expect(VISIBLE_PRESETS.every((p) => p.verified)).toBe(true);
    expect(VISIBLE_PRESETS.length).toBeLessThanOrEqual(ALL_PRESETS.length);
  });

  it('폰·플립의 메인 화면은 세로가 더 길다 (가로·세로를 뒤바꿔 넣는 실수 방지)', () => {
    const portrait = ALL_PRESETS.filter((p) => p.category === 'phone' || p.category === 'flip');
    for (const preset of portrait) {
      const main = preset.screens.find((s) => s.role === 'main');
      expect(main?.heightPx ?? 0, preset.id).toBeGreaterThan(main?.widthPx ?? Infinity);
    }
  });

  it('원형 화면은 가로와 세로가 같다', () => {
    for (const preset of ALL_PRESETS) {
      for (const screen of preset.screens.filter((s) => s.shape === 'circle')) {
        expect(screen.widthPx, preset.id).toBe(screen.heightPx);
      }
    }
  });

  it('파일 이름과 id가 같다', () => {
    const files = Object.keys(import.meta.glob('../data/*.json'));
    const ids = files.map((f) => f.replace('../data/', '').replace('.json', '')).sort();
    expect(ids).toEqual(ALL_PRESETS.map((p) => p.id).sort());
  });
});
