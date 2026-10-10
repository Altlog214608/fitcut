/**
 * 영상 프레임 간격 (프레임 단위 이동용). 브라우저에서 잰다 (ADR-034):
 * 재생하는 동안 requestVideoFrameCallback이 알려주는 각 프레임의 영상 시각(mediaTime) 차이의 중앙값.
 * 재기 전이나 지원하지 않는 브라우저에서는 30fps로 본다.
 */
export const DEFAULT_FPS = 30;

/** 연속한 프레임 시각들에서 fps를 구한다. 건너뛴 프레임이 있어도 중앙값이라 흔들리지 않는다 */
export function fpsFromFrameTimes(times: readonly number[]): number | null {
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const d = (times[i] ?? 0) - (times[i - 1] ?? 0);
    if (d > 0.001 && d < 0.5) deltas.push(d);
  }
  if (deltas.length < 5) return null;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)] ?? 0;
  const fps = 1 / median;
  // 29.97처럼 흔한 값은 소수 둘째 자리까지만
  return Math.round(Math.min(120, Math.max(1, fps)) * 100) / 100;
}
