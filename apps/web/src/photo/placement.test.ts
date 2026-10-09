import { describe, expect, it } from 'vitest';
import { edgeBusyness, measureEdges, suggestPosition, type Pixels } from './placement';

/** paint(x, y)가 돌려주는 밝기(0~255)로 회색 사진을 만든다 */
function gray(width: number, height: number, paint: (x: number, y: number) => number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = paint(x, y);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

// 위는 민무늬 벽, 아래쪽 30%는 줄무늬(옷·팔다리처럼 복잡한 것)
const PORTRAIT = gray(96, 128, (x, y) => (y > 90 ? (x % 4 < 2 ? 40 : 200) : 180));

describe('edgeBusyness', () => {
  it('민무늬 가장자리는 0', () => {
    expect(edgeBusyness(PORTRAIT, 'top')).toBe(0);
  });

  it('줄무늬 가장자리는 이웃 밝기 차이만큼 크다', () => {
    // 40과 200이 두 칸씩 번갈아 → 차이가 160인 곳이 절반쯤
    expect(edgeBusyness(PORTRAIT, 'bottom')).toBeGreaterThan(70);
  });

  it('왼쪽·오른쪽은 세로 방향 이웃을 본다', () => {
    const striped = gray(10, 40, (_x, y) => (y % 2 ? 0 : 100));
    expect(edgeBusyness(striped, 'left')).toBe(100);
    expect(edgeBusyness(striped, 'top')).toBe(0);
  });
});

describe('suggestPosition', () => {
  it('아래가 복잡한 인물 사진은 아래에 붙인다 (위만 채움)', () => {
    expect(suggestPosition(measureEdges(PORTRAIT), 'y')).toEqual({ x: 0, y: 1 });
  });

  it('위가 복잡하면 위에 붙인다', () => {
    expect(suggestPosition({ top: 12, bottom: 3, left: 0, right: 0 }, 'y')).toEqual({
      x: 0,
      y: -1,
    });
  });

  it('비슷하면 가운데', () => {
    expect(suggestPosition({ top: 10, bottom: 14, left: 0, right: 0 }, 'y')).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('둘 다 단순하면 차이가 커도 가운데 (잡음 수준의 차이)', () => {
    expect(suggestPosition({ top: 0.3, bottom: 1.5, left: 0, right: 0 }, 'y')).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('양옆을 채울 때는 왼쪽·오른쪽을 본다', () => {
    expect(suggestPosition({ top: 0, bottom: 0, left: 1, right: 9 }, 'x')).toEqual({
      x: 1,
      y: 0,
    });
  });
});
