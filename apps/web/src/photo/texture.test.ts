import { describe, expect, it } from 'vitest';
import { placeFill, stripFrom, textureFill, type Rgba } from './texture';

/** paint(x, y) → [r, g, b] 로 띠를 만든다 */
function strip(width: number, height: number, paint: (x: number, y: number) => number[]): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r = 0, g = 0, b = 0] = paint(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

function pixel(img: Rgba, x: number, y: number): number[] {
  const i = (y * img.width + x) * 4;
  return [...img.data.slice(i, i + 3)];
}

/** 한 줄에서 이웃 픽셀 밝기(빨강 채널) 차이의 최댓값. 세로 줄무늬가 날카로울수록 크다 */
function rowEdge(img: Rgba, y: number): number {
  let max = 0;
  for (let x = 1; x < img.width; x++) {
    const a = img.data[(y * img.width + x) * 4] ?? 0;
    const b = img.data[(y * img.width + x - 1) * 4] ?? 0;
    max = Math.max(max, Math.abs(a - b));
  }
  return max;
}

/** 한 줄의 밝기(빨강 채널) 표준편차 */
function rowStd(img: Rgba, y: number): number {
  const v: number[] = [];
  for (let x = 0; x < img.width; x++) v.push(img.data[(y * img.width + x) * 4] ?? 0);
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}

describe('textureFill', () => {
  it('크기는 가로 x (채울 줄 + 겹칠 줄)', () => {
    const out = textureFill(
      strip(360, 120, () => [200, 190, 170]),
      80,
      10,
    );
    expect([out.width, out.height]).toEqual([360, 90]);
  });

  it('민무늬 사진이면 같은 색으로 채운다 (결이 없음)', () => {
    const out = textureFill(
      strip(360, 120, () => [200, 190, 170]),
      80,
      10,
    );
    expect(pixel(out, 0, 0)).toEqual([200, 190, 170]);
    expect(pixel(out, 359, 89)).toEqual([200, 190, 170]);
  });

  it('경계 쪽은 가장자리 색, 멀어질수록 가로로 고르게 퍼진다 (세로 줄무늬 방지)', () => {
    // 왼쪽 절반은 어둡고 오른쪽 절반은 밝은 벽
    const out = textureFill(
      strip(720, 200, (x) => (x < 360 ? [60, 60, 60] : [220, 220, 220])),
      400,
      0,
    );
    const nearSeam = rowEdge(out, 399);
    const far = rowEdge(out, 0);
    expect(nearSeam).toBeGreaterThan(3);
    expect(far).toBeLessThan(nearSeam / 5);
  });

  it('같은 seed면 결과가 같다 (미리보기와 저장의 무늬가 같게)', () => {
    let n = 1;
    const noisy = strip(480, 200, () => {
      n = (n * 48271) % 2147483647;
      const v = 150 + (n % 40);
      return [v, v, v];
    });
    const a = textureFill(noisy, 120, 8, 3);
    const b = textureFill(noisy, 120, 8, 3);
    expect(a.data).toEqual(b.data);
    // 결이 실제로 들어간다
    expect(rowStd(a, 10)).toBeGreaterThan(2);
  });
});

describe('stripFrom · placeFill (채우는 방향 4가지)', () => {
  // 6x6 캔버스, 사진은 가운데 2줄(2·3번 줄). 위아래를 채운다
  const canvas = () => strip(6, 6, (x, y) => [x, y, 0]);
  const edgeY = { axis: 'y' as const, start: 2, length: 2 };

  it('위쪽 채우기: 띠의 0번 줄은 사진의 첫 줄', () => {
    const s = stripFrom(canvas(), edgeY, 'before', 2);
    expect([s.width, s.height]).toEqual([6, 2]);
    expect(pixel(s, 4, 0)).toEqual([4, 2, 0]);
    expect(pixel(s, 4, 1)).toEqual([4, 3, 0]);
  });

  it('아래쪽 채우기: 띠의 0번 줄은 사진의 마지막 줄', () => {
    const s = stripFrom(canvas(), edgeY, 'after', 2);
    expect(pixel(s, 1, 0)).toEqual([1, 3, 0]);
  });

  it('양옆 채우기는 가로세로를 바꿔서 읽는다', () => {
    const s = stripFrom(canvas(), { axis: 'x', start: 2, length: 2 }, 'after', 1);
    expect([s.width, s.height]).toEqual([6, 1]);
    expect(pixel(s, 5, 0)).toEqual([3, 5, 0]);
  });

  it('채운 결과를 바깥부터 제자리에 쓴다 (아래쪽: 결과 0번 줄 = 맨 아래 줄)', () => {
    const c = canvas();
    const fill = strip(6, 3, (_x, y) => [100 + y, 0, 0]); // 2줄 채우기 + 1줄 겹침
    placeFill(c, fill, edgeY, 'after', 2);
    expect(pixel(c, 0, 5)[0]).toBe(100);
    expect(pixel(c, 0, 4)[0]).toBe(101);
    expect(pixel(c, 0, 3)[0]).toBe(102); // 사진 마지막 줄 위에 겹침
    expect(pixel(c, 0, 2)).toEqual([0, 2, 0]); // 그 위는 그대로
  });
});
