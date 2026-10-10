import { describe, expect, it } from 'vitest';
import { canEncode, previewTransform, turnedSize } from './rotate';

describe('세로로 돌리기', () => {
  it('90°·270°는 가로·세로가 바뀌고 180°는 그대로', () => {
    expect(turnedSize({ width: 1920, height: 1080 }, 90)).toEqual({ width: 1080, height: 1920 });
    expect(turnedSize({ width: 1920, height: 1080 }, 180)).toEqual({ width: 1920, height: 1080 });
  });

  it('미리보기 CSS', () => {
    expect(previewTransform(90, false)).toBe('rotate(90deg)');
    expect(previewTransform(270, true)).toBe('rotate(270deg) scaleX(-1)');
  });

  it('다시 압축: 1080p 30fps 3분까지, 4K 60fps는 짧아도 안 된다', () => {
    expect(canEncode({ width: 1920, height: 1080 }, 180)).toBe(true);
    expect(canEncode({ width: 1920, height: 1080 }, 200)).toBe(false);
    expect(canEncode({ width: 3840, height: 2160 }, 15, 60)).toBe(true);
    expect(canEncode({ width: 3840, height: 2160 }, 30, 60)).toBe(false);
  });
});
