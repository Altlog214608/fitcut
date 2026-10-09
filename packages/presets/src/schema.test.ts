import { describe, expect, it } from 'vitest';
import { validatePreset, validatePresets } from './schema';

const valid = {
  id: 'test-phone',
  brand: 'Test',
  category: 'phone',
  name: 'Test Phone',
  aliases: ['테스트 폰'],
  releaseYear: 2026,
  screens: [{ role: 'main', widthPx: 1080, heightPx: 2340, shape: 'rect' }],
  source: 'https://example.com/specs',
  verified: true,
  verifiedAt: '2026-10-09',
};

describe('validatePreset', () => {
  it('올바른 프리셋은 통과한다', () => {
    expect(validatePreset(valid)).toEqual([]);
  });

  it('해상도는 양의 정수여야 한다', () => {
    const errors = validatePreset({
      ...valid,
      screens: [{ role: 'main', widthPx: 1080.5, heightPx: 0, shape: 'rect' }],
    });
    expect(errors).toHaveLength(2);
  });

  it('verified면 출처와 확인 날짜가 있어야 한다', () => {
    expect(validatePreset({ ...valid, source: '' })).toContain(
      'test-phone.source: verified면 출처가 있어야 한다',
    );
    expect(validatePreset({ ...valid, verifiedAt: undefined }).length).toBe(1);
  });

  it('확인 전 프리셋은 출처 없이도 넣을 수 있다', () => {
    expect(
      validatePreset({ ...valid, verified: false, source: '', verifiedAt: undefined }),
    ).toEqual([]);
  });

  it('잘못된 모양·역할·겹치는 화면을 잡는다', () => {
    const errors = validatePreset({
      ...valid,
      screens: [
        { role: 'main', widthPx: 1, heightPx: 1, shape: 'hexagon' },
        { role: 'main', widthPx: 1, heightPx: 1, shape: 'rect' },
      ],
    });
    expect(errors.some((e) => e.includes('shape'))).toBe(true);
    expect(errors.some((e) => e.includes('role이 겹친다'))).toBe(true);
  });

  it('오버레이 좌표는 0~1 비율이어야 한다', () => {
    const errors = validatePreset({
      ...valid,
      screens: [
        {
          role: 'main',
          widthPx: 1080,
          heightPx: 2340,
          shape: 'rect',
          overlays: [{ kind: 'clock', x: 0.1, y: 0.1, w: 1.5, h: 0.1 }],
        },
      ],
    });
    expect(errors).toEqual(['test-phone.screens[0].overlays[0].w: 0~1이 아니다']);
  });
});

describe('validatePresets', () => {
  it('id 중복을 잡는다', () => {
    expect(validatePresets([valid, valid])).toEqual(['test-phone: id가 중복된다']);
  });
});
