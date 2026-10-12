/**
 * 수집 종료 규칙 (docs/HIGHLIGHT.md 수집기 설계): 먼저 오는 것으로 끝낸다.
 * - 스트리머가 "수집 종료"를 눌렀다 (requested)
 * - 일정 시간 채팅·후원·구독이 하나도 없다 (idle) — 방송이 끝났거나 연결이 죽었다고 본다
 * - 최대 실행 시간을 넘었다 (max_duration) — 상시 실행 리소스를 만들지 않기 위한 안전장치
 */
export type StopReason =
  | 'requested'
  | 'idle'
  | 'max_duration'
  | 'revoked'
  | 'disconnected'
  | 'token'
  | 'gone'
  | 'terminated';

export type Limits = {
  /** 최대 실행 시간 (ms). 초안 8시간 */
  maxMs: number;
  /** 이벤트 없음 허용 시간 (ms). 초안 30분 */
  idleMs: number;
};

export const DEFAULT_LIMITS: Limits = { maxMs: 8 * 60 * 60 * 1000, idleMs: 30 * 60 * 1000 };

export function stopReason(
  s: { now: number; startedAt: number; lastEventAt: number | null; stopRequested: boolean },
  limits: Limits,
): StopReason | null {
  if (s.stopRequested) return 'requested';
  if (s.now - s.startedAt >= limits.maxMs) return 'max_duration';
  if (s.now - (s.lastEventAt ?? s.startedAt) >= limits.idleMs) return 'idle';
  return null;
}

/** 정상 종료로 볼 이유. 나머지는 실패로 남겨 화면에서 이유를 보여준다 */
export const isCleanStop = (r: StopReason) =>
  r === 'requested' || r === 'idle' || r === 'max_duration' || r === 'terminated';

/** 재연결 대기: 1, 2, 4, 8, 16초 */
export const backoffMs = (attempt: number) => Math.min(16, 2 ** Math.max(0, attempt - 1)) * 1000;
export const MAX_RECONNECTS = 5;
