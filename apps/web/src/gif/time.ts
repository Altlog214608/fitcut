/** 구간 시각 표시·입력과 구간 규칙 (순수 함수). 화면은 분:초.백분의일초(00:12.34)로 보여준다. */
import { JOB_LIMITS, type JobKind } from '@fitcut/shared';

export type Range = { start: number; end: number };

/** 밀리초 단위로 맞춘다. 서버(ffmpeg)도 밀리초까지 쓴다 */
export const roundMs = (t: number) => Math.round(t * 1000) / 1000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** 12.345 → "00:12.35", 3723.5 → "1:02:03.50" */
export function formatTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const frac = pad(cs % 100);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}.${frac}` : `${pad(m)}:${pad(s)}.${frac}`;
}

/**
 * 직접 입력한 시각을 초로. "1:02.5", "01:02.345", "62.5", "1:02:03" 모두 받는다.
 * 읽을 수 없으면 null.
 */
export function parseTime(text: string): number | null {
  const parts = text.trim().replace(/\s+/g, '').split(':');
  if (parts.length === 0 || parts.length > 3) return null;
  const last = parts.at(-1) ?? '';
  if (!/^\d+(\.\d+)?$/.test(last) && !/^\d*\.\d+$/.test(last)) return null;
  const units = parts.slice(0, -1);
  if (units.some((p) => !/^\d+$/.test(p))) return null;
  // 분·초 자리는 60을 넘지 않는다 (맨 앞 자리는 예외: "75.5"는 75.5초)
  if (parts.length > 1 && Number(last) >= 60) return null;
  if (parts.length === 3 && Number(units[1]) >= 60) return null;
  const seconds = parts.reduce((total, p) => total * 60 + Number(p), 0);
  return Number.isFinite(seconds) ? roundMs(seconds) : null;
}

/** 시각을 가장 가까운 프레임 경계로 */
export function snapToFrame(t: number, fps: number): number {
  return roundMs(Math.round(t * fps) / fps);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 시작을 옮긴다. 끝보다 한 프레임 앞까지만 */
export function moveStart(range: Range, t: number, minGap: number): Range {
  return { ...range, start: roundMs(clamp(t, 0, range.end - minGap)) };
}

/** 끝을 옮긴다. 시작보다 한 프레임 뒤부터 영상 끝까지 */
export function moveEnd(range: Range, t: number, minGap: number, duration: number): Range {
  return { ...range, end: roundMs(clamp(t, range.start + minGap, duration)) };
}

/** 처음 열었을 때의 구간: 앞에서부터 5초 (영상이 짧으면 전체) */
export function initialRange(duration: number): Range {
  return { start: 0, end: roundMs(Math.min(duration, 5)) };
}

/** 이 형식으로 만들 수 없는 구간이면 고치는 방법을 담은 문구 (서버 검사와 같은 기준) */
export function rangeProblem(range: Range, kind: JobKind): string | null {
  const max = JOB_LIMITS.maxSeconds[kind];
  if (range.end - range.start > max + 1e-6) {
    return kind === 'm4r'
      ? `아이폰 벨소리는 ${max}초까지예요. 구간을 ${max}초 이하로 골라 주세요.`
      : `구간이 너무 길어요. ${max}초 이하로 골라 주세요.`;
  }
  return null;
}
