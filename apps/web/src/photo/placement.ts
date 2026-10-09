/**
 * 배경 채우기에서 사진을 어디에 붙일지 고르는 계산 (순수 함수).
 * 사람이나 물건이 걸쳐 잘린 가장자리를 늘이면 팔다리가 늘어난 것처럼 보인다.
 * 그래서 복잡한 가장자리는 화면 끝에 붙이고, 벽·하늘처럼 단순한 쪽에만 배경을 채운다.
 */
import type { Position } from './layout';

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type EdgeBusyness = Record<Side, number>;

/** RGBA 픽셀 (ImageData와 같은 모양) */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/** 가장자리 띠의 두께 (사진 길이 대비) */
const BAND = 0.04;
/** 한쪽이 다른 쪽보다 이만큼 배 이상 복잡해야 끝에 붙인다 */
const RATIO = 2;
/** 둘 다 단순하면(이웃 픽셀 밝기 차이 평균이 이보다 작으면) 가운데에 둔다 */
const FLOOR = 2;

function luma(data: Uint8ClampedArray, i: number): number {
  return 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
}

/**
 * 가장자리 띠에서 가장자리 방향으로 이웃한 픽셀끼리의 밝기 차이 평균 (0~255).
 * 이 띠를 바깥으로 늘이면 차이가 그대로 줄무늬가 되므로, 늘였을 때 얼마나 티가 나는지의 대리값이다.
 * 작게 줄인 사진(가로 100px 안팎)에 쓴다. 원본 크기에서는 잡음까지 세게 된다.
 */
export function edgeBusyness({ data, width, height }: Pixels, side: Side): number {
  const horizontal = side === 'top' || side === 'bottom';
  const along = horizontal ? width : height;
  const depth = horizontal ? height : width;
  const band = Math.max(1, Math.round(depth * BAND));
  if (along < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let d = 0; d < band; d++) {
    const line = side === 'top' || side === 'left' ? d : depth - 1 - d;
    let prev = -1;
    for (let a = 0; a < along; a++) {
      const x = horizontal ? a : line;
      const y = horizontal ? line : a;
      const value = luma(data, (y * width + x) * 4);
      if (prev >= 0) {
        sum += Math.abs(value - prev);
        count++;
      }
      prev = value;
    }
  }
  return count ? sum / count : 0;
}

export function measureEdges(pixels: Pixels): EdgeBusyness {
  return {
    top: edgeBusyness(pixels, 'top'),
    bottom: edgeBusyness(pixels, 'bottom'),
    left: edgeBusyness(pixels, 'left'),
    right: edgeBusyness(pixels, 'right'),
  };
}

/** -1이면 앞(위·왼쪽) 끝에, 1이면 뒤(아래·오른쪽) 끝에 붙인다 */
function lean(before: number, after: number): number {
  if (Math.max(before, after) < FLOOR) return 0;
  if (after >= before * RATIO) return 1;
  if (before >= after * RATIO) return -1;
  return 0;
}

/**
 * 채우는 축에서 사진을 둘 위치. 예: 아래쪽에 다리가 잘린 인물 사진 → 아래에 붙이고 위만 채운다.
 * 반대 축(사진을 키웠을 때 잘리는 쪽)은 가운데에 둔다.
 */
export function suggestPosition(edges: EdgeBusyness, axis: 'x' | 'y'): Position {
  return axis === 'y'
    ? { x: 0, y: lean(edges.top, edges.bottom) }
    : { x: lean(edges.left, edges.right), y: 0 };
}
