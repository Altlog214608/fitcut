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
  weights: {
    chat: number;
    reaction: number;
    donation: number;
    subscription: number;
    /** 소리 크기 (모드 B·C, 녹화 파일이 있을 때) */
    loudness: number;
  };
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
  weights: { chat: 1, reaction: 1, donation: 0.5, subscription: 0.3, loudness: 1 },
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
  counts: {
    chat: number;
    reaction: number;
    donation: number;
    subscription: number;
    /** 피크 창의 평균 소리 크기 (dB, 녹화 파일이 있을 때) */
    loudness?: number;
  };
};

export type Analysis = {
  version: string;
  durationSec: number;
  totals: { chat: number; reaction: number; donation: number; subscription: number };
  candidates: Candidate[];
  /** 그래프용: 10초마다 채팅 수 */
  chatPer10s: number[];
  /** 그래프용: 10초마다 평균 소리 크기 (dB). 녹화 파일을 분석했을 때만 */
  loudPer10s?: number[];
};

/** 소리가 없는 구간(-inf, -120)은 이 값으로 둔다. 조용한 구간끼리의 차이로 튀지 않게 */
const QUIET_DB = -70;

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
  centered = false,
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
    if (centered) {
      // 앞뒤를 함께 기준으로: 소리 크기가 바뀐 지점(무음 → 말소리)은 피크가 아니다
      const half = Math.floor(cfg.baselineSec / 2);
      const a = Math.max(0, i - half);
      const b = Math.min(n, i + half);
      const { mean, std } = b - a >= cfg.minBaselineSec ? stats(a, b) : global;
      out[i] = ((x[i] ?? 0) - mean) / std;
      continue;
    }
    const a = Math.max(0, i - cfg.baselineSec);
    const { mean, std } = i - a >= cfg.minBaselineSec ? stats(a, i) : global;
    out[i] = ((x[i] ?? 0) - mean) / std;
  }
  return out;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * @param loudness 초마다 소리 크기 (RMS dB, 0번째 = 수집 시작). 녹화 파일을 분석했을 때만 (ADR-044)
 */
export function analyze(
  events: readonly ChatEvent[],
  durationSec: number,
  cfg: ScoreConfig = DEFAULT_CONFIG,
  loudness?: readonly number[],
): Analysis {
  const duration = Math.max(durationSec, ...events.map((e) => e.t), loudness?.length ?? 0, 0);
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
  // 소리 크기: 10초 평균 dB → 지난 5분 기준 z-score. 소리는 장면과 같은 때라 지연 보정을 하지 않는다
  const loud = loudness?.length
    ? (() => {
        const db = new Float64Array(n);
        for (let i = 0; i < n; i++) db[i] = Math.max(QUIET_DB, loudness[i] ?? QUIET_DB);
        const mean = windowSum(db, w).map((v, i) => v / Math.min(w, n - i));
        return { mean, z: rollingZ(mean, cfg, true) };
      })()
    : null;
  // 채팅은 장면보다 lagSec 늦게 반응한다. 채팅 신호를 그만큼 앞으로 당겨 소리와 같은 시각에 맞춘다
  const lag = Math.round(cfg.lagSec);
  const at = (x: Series, i: number) => x[i + lag] ?? 0;
  const score = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    score[i] =
      cfg.weights.chat * at(z.chat, i) +
      cfg.weights.reaction * at(z.reaction, i) +
      cfg.weights.donation * at(z.donation, i) +
      cfg.weights.subscription * at(z.subscription, i) +
      (loud ? cfg.weights.loudness * (loud.z[i] ?? 0) : 0);
  }

  // 큰 점수부터 고르고, 이미 고른 피크와 가까우면 건너뛴다
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (score[b] ?? 0) - (score[a] ?? 0),
  );
  const peaks: number[] = [];
  for (const i of order) {
    if ((score[i] ?? 0) < cfg.threshold || peaks.length >= cfg.topN) break;
    // 소리 없이 채팅만 볼 때: 창 안에 채팅이 거의 없으면(조용한 방송의 한두 줄) 후보로 보지 않는다
    const events3 = at(sums.chat, i) + at(sums.donationCount, i) + at(sums.subscription, i) >= 3;
    if (!loud && !events3) continue;
    if (peaks.every((p) => Math.abs(p - i) >= cfg.minGapSec)) peaks.push(i);
  }

  type Seg = Omit<Candidate, 'rank'>;
  const segs: Seg[] = peaks.map((i) => {
    // 창 가운데가 장면이 일어난 때 (채팅 신호는 이미 지연만큼 당겼다)
    const peak = Math.max(0, Math.min(duration, i + w / 2));
    return {
      start: Math.max(0, peak - cfg.beforeSec),
      end: Math.min(duration, peak + cfg.afterSec),
      peak,
      score: round(score[i] ?? 0),
      counts: {
        chat: at(sums.chat, i),
        reaction: at(sums.reaction, i),
        donation: at(sums.donationCount, i),
        subscription: at(sums.subscription, i),
        ...(loud ? { loudness: round(loud.mean[i] ?? QUIET_DB, 1) } : {}),
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
  const loudPer10s = loud
    ? Array.from({ length: Math.ceil(n / 10) }, (_, k) => {
        const part = Array.from({ length: Math.min(10, n - k * 10) }, (_, j) =>
          Math.max(QUIET_DB, loudness?.[k * 10 + j] ?? QUIET_DB),
        );
        return round(part.reduce((a, b) => a + b, 0) / part.length, 1);
      })
    : undefined;
  const total = (x: Series) => x.reduce((a, b) => a + b, 0);
  return {
    version: `score-v1/kw-v${KEYWORDS_VERSION}${loud ? '/loud-v1' : ''}`,
    durationSec: round(duration, 1),
    totals: {
      chat: total(ps.chat),
      reaction: total(ps.reaction),
      donation: total(ps.donationCount),
      subscription: total(ps.subscription),
    },
    candidates,
    chatPer10s,
    ...(loudPer10s ? { loudPer10s } : {}),
  };
}
