/**
 * 배경 채우기에서 사진과 배경을 자연스럽게 잇기 위한 계산 (순수 함수).
 * 그리기는 render.ts가 하고, 여기서는 "어디를 얼마나 섞을지"만 정한다.
 */
import type { Layout, Size } from './layout';

export type Axis = 'x' | 'y';

/** 사진이 놓인 축과, 사진 앞(위·왼쪽)과 뒤(아래·오른쪽)에 채울 길이 */
export type FillExtent = {
  axis: Axis;
  /** 사진 시작 위치 */
  start: number;
  /** 사진 길이 */
  length: number;
  /** 캔버스 전체 길이 */
  total: number;
  before: number;
  after: number;
};

/** [위치(0~1), 불투명도(0~1)] */
export type Stop = [number, number];

export function fillExtent(layout: Layout, target: Size): FillExtent {
  const { image } = layout;
  // 사진을 키우면 반대 축은 잘려서(음수) 남는 곳이 없다. 남는 곳이 있는 축이 채우는 축이다.
  const axis: Axis = target.width - image.width > target.height - image.height ? 'x' : 'y';
  const start = axis === 'y' ? image.y : image.x;
  const length = axis === 'y' ? image.height : image.width;
  const total = axis === 'y' ? target.height : target.width;
  return { axis, start, length, total, before: start, after: total - start - length };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function normalize(stops: Stop[], total: number): Stop[] {
  const out = stops.map(([at, alpha]): Stop => [clamp01(at / total), alpha]);
  // addColorStop은 위치가 줄어들면 안 된다
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev && cur && cur[0] < prev[0]) cur[0] = prev[0];
  }
  return out;
}

/**
 * 사진 레이어의 알파. 배경이 있는 쪽 가장자리만 feather 길이만큼 투명 → 불투명으로 서서히 바뀐다.
 * 배경이 없는 쪽(사진이 화면 끝에 닿은 쪽)은 그대로 둔다.
 */
export function featherStops(ext: FillExtent, feather: number): Stop[] {
  const f = Math.max(0, Math.min(feather, ext.length / 2));
  const end = ext.start + ext.length;
  const stops: Stop[] = [];
  if (ext.before > 0 && f > 0) stops.push([ext.start, 0], [ext.start + f, 1]);
  else stops.push([ext.start, 1]);
  if (ext.after > 0 && f > 0) stops.push([end - f, 1], [end, 0]);
  else stops.push([end, 1]);
  return normalize(stops, ext.total);
}

/**
 * 덜 흐린 배경 층의 알파. 사진 가까이는 선명하게(1), fade 길이만큼 멀어지면 0이 되어
 * 아래의 많이 흐린 층이 드러난다. 먼 곳일수록 흐려지는 효과.
 */
export function fadeStops(ext: FillExtent, fade: number): Stop[] {
  const end = ext.start + ext.length;
  return normalize(
    [
      [ext.start - fade, 0],
      [ext.start, 1],
      [end, 1],
      [end + fade, 0],
    ],
    ext.total,
  );
}
