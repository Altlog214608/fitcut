/**
 * 하이라이트 후보를 사람이 쓰는 시각으로 (모드 A 결과, docs/HIGHLIGHT.md).
 * 후보 시각은 "수집 시작" 기준이다. 치지직 Open API로는 방송 시작 시각을 알 수 없어서,
 * 방송을 켠 뒤 수집을 누르기까지 걸린 시간(offset)을 더해 다시보기 시각에 맞춘다.
 */
export type Candidate = {
  rank: number;
  start: number;
  end: number;
  peak: number;
  score: number;
  counts: { chat: number; reaction: number; donation: number; subscription: number };
};

/** 초 → 0:05:07 (1시간 미만이면 05:07). 유튜브 댓글 시각 링크가 이 모양을 알아본다 */
export function clock(sec: number, forceHours = false): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h > 0 || forceHours ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "1:02" "62" "1:02:03" → 초. 못 읽으면 null */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return null;
  return t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

/** 유튜브 댓글용 타임라인: 시간 순서로, 장면(피크) 앞 여유를 조금 두고 */
export function timelineText(candidates: readonly Candidate[], offsetSec: number): string {
  const hours = candidates.some((c) => c.start + offsetSec >= 3600);
  return [...candidates]
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${clock(c.start + offsetSec, hours)} 하이라이트 ${i + 1}`)
    .join('\n');
}
