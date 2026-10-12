/**
 * 하이라이트 점수 계산 (순수 함수, docs/HIGHLIGHT.md 분석 1·3단계, ADR-041).
 * 1) 1초 단위로 채팅 수, 반응 채팅 수, 후원(금액 로그), 구독 수를 센다
 * 2) W초 이동 합 → 지난 B초를 기준으로 z-score (기록이 짧으면 방송 전체 기준)
 * 3) 가중 합 → 큰 순서로 피크를 고른다 (최소 간격) → 채팅 지연을 빼고 앞뒤 여유를 붙인 구간
 * 4) 겹치는 구간은 합치고 점수 순으로 상위 N개
 */
import type { ChatEvent } from '@fitcut/chzzk';
import { isReaction, KEYWORDS_VERSION } from './keywords';

export type ScoreConfig = {
  /** 이동 합 창 (초) */
  windowSec: number;
  /** 정규화 기준이 되는 지난 구간 (초) */
  baselineSec: number;
  /** 기준 구간이 이보다 짧으면 방송 전체 통계를 쓴다 (초) */
  minBaselineSec: number;
  /** 채팅은 장면보다 늦게 반응한다. 피크에서 뺀다 (초) */
  lagSec: number;
  /** 피크 앞뒤 여유 (초) */
  beforeSec: number;
  afterSec: number;
  weights: { chat: number; reaction: number; donation: number; subscription: number };
  /** 이 점수 이상인 피크만 후보로 */
  threshold: number;
  /** 피크 사이 최소 간격 (초) */
  minGapSec: number;
  topN: number;
};

/** 초안 값 (docs/HIGHLIGHT.md). 튜닝 결과는 docs/DECISIONS.md ADR-041에 남긴다 */
export const DEFAULT_CONFIG: ScoreConfig = {
  windowSec: 10,
  baselineSec: 300,
  minBaselineSec: 60,
  lagSec: 5,
  beforeSec: 15,
  afterSec: 10,
  weights: { chat: 1, reaction: 1, donation: 0.5, subscription: 0.3 },
  threshold: 2,
  minGapSec: 30,
  topN: 10,
};

export type Signals = { chat: number; reaction: number; donation: number; subscription: number };

export type Candidate = {
  rank: number;
  /** 수집 시작 기준 초 */
  start: number;
  end: number;
  peak: number;
  score: number;
  /** 피크 창(W초) 안의 실제 개수 */
  counts: { chat: number; reaction: number; donation: number; subscription: number };
};

export type Analysis = {
  version: string;
  durationSec: number;
  totals: { chat: number; reaction: number; donation: number; subscription: number };
  candidates: Candidate[];
  /** 그래프용: 10초마다 채팅 수 */
  chatPer10s: number[];
};

type Series = Float64Array;

export function perSecond(events: readonly ChatEvent[], durationSec: number) {
  const n = Math.max(1, Math.ceil(durationSec) + 1);
  const chat = new Float64Array(n);
  const reaction = new Float64Array(n);
  const donation = new Float64Array(n);
  const subscription = new Float64Array(n);
  const amount = new Float64Array(n);
  for (const e of events) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(e.t)));
    if (e.type === 'chat') {
      chat[i] = (chat[i] ?? 0) + 1;
      if (isReaction(e.text)) reaction[i] = (reaction[i] ?? 0) + 1;
    } else if (e.type === 'donation') {
      // 금액 차이가 너무 크게 반영되지 않게 로그로 (1천 원 = 1)
      donation[i] = (donation[i] ?? 0) + Math.log1p((e.amount ?? 0) / 1000);
      amount[i] = (amount[i] ?? 0) + 1;
    } else {
      subscription[i] = (subscription[i] ?? 0) + 1;
    }
  }
  return { chat, reaction, donation, subscription, donationCount: amount };
}

/** [i, i+w) 합 */
export function windowSum(x: Series, w: number): Series {
  const out = new Float64Array(x.length);
  let s = 0;
  for (let i = x.length - 1; i >= 0; i--) {
    s += x[i] ?? 0;
    if (i + w < x.length) s -= x[i + w] ?? 0;
    out[i] = s;
  }
  return out;
}

/** 지난 baseline 구간 대비 z-score. 표준편차는 너무 작아지지 않게 바닥을 둔다 (조용한 방송에서 채팅 1개로 튀지 않게) */
export function rollingZ(
  x: Series,
  cfg: Pick<ScoreConfig, 'baselineSec' | 'minBaselineSec'>,
): Series {
  const n = x.length;
  const p1 = new Float64Array(n + 1);
  const p2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = x[i] ?? 0;
    p1[i + 1] = (p1[i] ?? 0) + v;
    p2[i + 1] = (p2[i] ?? 0) + v * v;
  }
  const stats = (a: number, b: number) => {
    const m = b - a;
    const mean = ((p1[b] ?? 0) - (p1[a] ?? 0)) / m;
    const variance = Math.max(0, ((p2[b] ?? 0) - (p2[a] ?? 0)) / m - mean * mean);
    return { mean, std: Math.max(Math.sqrt(variance), Math.sqrt(Math.max(mean, 0)), 1) };
  };
  const global = stats(0, n);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - cfg.baselineSec);
    const { mean, std } = i - a >= cfg.minBaselineSec ? stats(a, i) : global;
    out[i] = ((x[i] ?? 0) - mean) / std;
  }
  return out;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function analyze(
  events: readonly ChatEvent[],
  durationSec: number,
  cfg: ScoreConfig = DEFAULT_CONFIG,
): Analysis {
  const duration = Math.max(durationSec, ...events.map((e) => e.t), 0);
  const ps = perSecond(events, duration);
  const w = cfg.windowSec;
  const sums = {
    chat: windowSum(ps.chat, w),
    reaction: windowSum(ps.reaction, w),
    donation: windowSum(ps.donation, w),
    subscription: windowSum(ps.subscription, w),
    donationCount: windowSum(ps.donationCount, w),
  };
  const z = {
    chat: rollingZ(sums.chat, cfg),
    reaction: rollingZ(sums.reaction, cfg),
    donation: rollingZ(sums.donation, cfg),
    subscription: rollingZ(sums.subscription, cfg),
  };
  const n = ps.chat.length;
  const score = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    score[i] =
      cfg.weights.chat * (z.chat[i] ?? 0) +
      cfg.weights.reaction * (z.reaction[i] ?? 0) +
      cfg.weights.donation * (z.donation[i] ?? 0) +
      cfg.weights.subscription * (z.subscription[i] ?? 0);
  }

  // 큰 점수부터 고르고, 이미 고른 피크와 가까우면 건너뛴다
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (score[b] ?? 0) - (score[a] ?? 0),
  );
  const peaks: number[] = [];
  for (const i of order) {
    if ((score[i] ?? 0) < cfg.threshold || peaks.length >= cfg.topN) break;
    // 창 안에 채팅이 거의 없으면(조용한 방송의 한두 줄) 후보로 보지 않는다
    if ((sums.chat[i] ?? 0) + (sums.donationCount[i] ?? 0) + (sums.subscription[i] ?? 0) < 3)
      continue;
    if (peaks.every((p) => Math.abs(p - i) >= cfg.minGapSec)) peaks.push(i);
  }

  type Seg = Omit<Candidate, 'rank'>;
  const segs: Seg[] = peaks.map((i) => {
    // 창 가운데에서 채팅 지연만큼 앞으로 (장면이 일어난 때)
    const peak = Math.max(0, Math.min(duration, i + w / 2 - cfg.lagSec));
    return {
      start: Math.max(0, peak - cfg.beforeSec),
      end: Math.min(duration, peak + cfg.afterSec),
      peak,
      score: round(score[i] ?? 0),
      counts: {
        chat: sums.chat[i] ?? 0,
        reaction: sums.reaction[i] ?? 0,
        donation: sums.donationCount[i] ?? 0,
        subscription: sums.subscription[i] ?? 0,
      },
    };
  });

  // 겹치는 구간은 합친다 (점수·개수는 높은 쪽)
  segs.sort((a, b) => a.start - b.start);
  const merged: Seg[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      const top = s.score > last.score ? s : last;
      merged[merged.length - 1] = { ...top, start: last.start, end: Math.max(last.end, s.end) };
    } else {
      merged.push(s);
    }
  }
  const candidates = merged
    .sort((a, b) => b.score - a.score)
    .map((s, k) => ({
      ...s,
      rank: k + 1,
      start: round(s.start, 1),
      end: round(s.end, 1),
      peak: round(s.peak, 1),
    }));

  const chatPer10s: number[] = [];
  for (let i = 0; i < n; i += 10) {
    let s = 0;
    for (let j = i; j < Math.min(n, i + 10); j++) s += ps.chat[j] ?? 0;
    chatPer10s.push(s);
  }
  const total = (x: Series) => x.reduce((a, b) => a + b, 0);
  return {
    version: `score-v1/kw-v${KEYWORDS_VERSION}`,
    durationSec: round(duration, 1),
    totals: {
      chat: total(ps.chat),
      reaction: total(ps.reaction),
      donation: total(ps.donationCount),
      subscription: total(ps.subscription),
    },
    candidates,
    chatPer10s,
  };
}
