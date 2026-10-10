/**
 * 목표 용량 맞추기 (FEATURES F9). 같은 그림을 화질만 바꿔 다시 인코딩하며 이진 탐색한다.
 * 크기(가로×세로)는 기기 화면에 맞춘 값이라 바꾸지 않는다. 가장 낮은 화질로도 넘으면 그 결과와 함께 알린다.
 */
export const MIN_QUALITY = 0.1;
const STEPS = 7;

export type Fitted = { blob: Blob; quality: number; fits: boolean };

/**
 * @param encodeAt 화질 q로 인코딩한 결과
 * @param maxBytes 목표 용량(바이트)
 * @param highest 사용자가 고른 화질 (이보다 높이지 않는다)
 */
export async function fitToSize(
  encodeAt: (quality: number) => Promise<Blob>,
  maxBytes: number,
  highest: number,
): Promise<Fitted> {
  const top = await encodeAt(highest);
  if (top.size <= maxBytes) return { blob: top, quality: highest, fits: true };
  const bottom = await encodeAt(MIN_QUALITY);
  if (bottom.size > maxBytes) return { blob: bottom, quality: MIN_QUALITY, fits: false };
  // 목표 이하인 가장 높은 화질을 찾는다
  let lo = MIN_QUALITY;
  let hi = highest;
  let best: Fitted = { blob: bottom, quality: MIN_QUALITY, fits: true };
  for (let i = 0; i < STEPS; i++) {
    const mid = (lo + hi) / 2;
    const blob = await encodeAt(mid);
    if (blob.size <= maxBytes) {
      best = { blob, quality: mid, fits: true };
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

/** 목표 용량 선택지 (KB). 0은 끄기 */
export const TARGET_SIZES_KB = [0, 200, 500, 1000, 2000] as const;

/** 목표 용량 표시 (선택지와 같은 1000 단위): 200KB, 1MB */
export function targetLabel(bytes: number): string {
  const kb = Math.round(bytes / 1000);
  return kb >= 1000 ? `${kb / 1000}MB` : `${kb}KB`;
}
