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

/** 편집용 마커 파일 (모드 A). 시각은 offset을 더한 다시보기 기준 */
export type MarkerFormat = 'csv' | 'srt' | 'audacity';

const byTime = (candidates: readonly Candidate[]) =>
  [...candidates].sort((a, b) => a.start - b.start);

/** SRT 시각: 00:01:02,500 */
export function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function markerFile(
  candidates: readonly Candidate[],
  offsetSec: number,
  format: MarkerFormat,
): { text: string; ext: string; type: string } {
  const list = byTime(candidates).map((c, i) => ({
    n: i + 1,
    start: c.start + offsetSec,
    end: c.end + offsetSec,
    peak: c.peak + offsetSec,
    c,
  }));
  if (format === 'srt') {
    // 자막 파일 형식(SubRip): 번호, 시작 --> 끝, 내용, 빈 줄. 편집 프로그램에서 자막 트랙으로 불러와 마커처럼 쓴다
    const text = list
      .map(
        (m) =>
          `${m.n}\n${srtTime(m.start)} --> ${srtTime(m.end)}\n하이라이트 ${m.n} (점수 ${m.c.score})\n`,
      )
      .join('\n');
    return { text, ext: 'srt', type: 'application/x-subrip' };
  }
  if (format === 'audacity') {
    // Audacity 라벨: 시작(초)<탭>끝(초)<탭>이름
    const text = list
      .map((m) => `${m.start.toFixed(3)}\t${m.end.toFixed(3)}\t하이라이트 ${m.n}`)
      .join('\n');
    return { text: `${text}\n`, ext: 'txt', type: 'text/plain' };
  }
  // 엑셀이 한글을 깨뜨리지 않게 BOM을 붙인다
  const rows = [
    '순서,시작,끝,장면,시작(초),끝(초),점수,채팅,반응,후원,구독',
    ...list.map((m) =>
      [
        m.n,
        clock(m.start, true),
        clock(m.end, true),
        clock(m.peak, true),
        m.start.toFixed(1),
        m.end.toFixed(1),
        m.c.score,
        m.c.counts.chat,
        m.c.counts.reaction,
        m.c.counts.donation,
        m.c.counts.subscription,
      ].join(','),
    ),
  ];
  return { text: `﻿${rows.join('\r\n')}\r\n`, ext: 'csv', type: 'text/csv' };
}
