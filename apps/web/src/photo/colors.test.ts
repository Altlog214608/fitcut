import { describe, expect, it } from 'vitest';
import { edgeColors, toCss } from './colors';

/** 위쪽 절반은 하늘색, 아래쪽 절반은 초록색인 4x10 이미지 */
function twoTone(): { data: Uint8ClampedArray; width: number; height: number } {
  const width = 4;
  const height = 10;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = y < 5 ? [120, 180, 240] : [40, 120, 60];
      data.set([r, g, b, 255], i);
    }
  }
  return { data, width, height };
}

describe('edgeColors', () => {
  it('위·아래 가장자리 색을 따로 구한다', () => {
    const [top, bottom] = edgeColors(twoTone(), 'y');
    expect(top).toEqual({ r: 120, g: 180, b: 240 });
    expect(bottom).toEqual({ r: 40, g: 120, b: 60 });
  });

  it('왼쪽·오른쪽 띠는 위아래 색이 섞인 평균', () => {
    const [left, right] = edgeColors(twoTone(), 'x');
    expect(left).toEqual({ r: 80, g: 150, b: 150 });
    expect(right).toEqual(left);
  });

  it('완전히 투명한 영역은 검정으로 본다', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    expect(edgeColors({ data, width: 4, height: 4 }, 'y')[0]).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('toCss', () => {
  it('CSS 색 문자열', () => {
    expect(toCss({ r: 1, g: 2, b: 3 })).toBe('rgb(1 2 3)');
  });
});
