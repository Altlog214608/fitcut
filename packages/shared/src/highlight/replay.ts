/**
 * 리플레이 데모 (docs/HIGHLIGHT.md 데모와 비용, ADR-045).
 * 방송 채팅을 초마다 개수로만 담아 두고(본문·닉네임 없음), 브라우저에서 실제 시간 흐름대로 재생하며
 * 서버와 같은 analyze()로 그때까지의 채팅만 보고 후보를 찾는다.
 */
import { isReaction } from './keywords';
import { analyze, type Candidate, type ScoreEvent } from './score';

export type ReplayData = {
  v: 1;
  /** sample: 예시로 만든 채팅 흐름, recorded: 수집기로 모은 실제 방송 */
  kind: 'sample' | 'recorded';
  durationSec: number;
  /** 초마다 채팅 수 */
  chat: number[];
  /** 초마다 반응 채팅 수 (chat에 포함) */
  reaction: number[];
  /** 초마다 구독 수 */
  subscription: number[];
  /** [초, 금액(원)] */
  donations: [number, number][];
  /** 예시에 넣은 장면 (sample만). 끝나고 몇 개를 찾았는지 보여준다 */
  scenes?: { t: number; label: string }[];
};

/** 반응 채팅 자리에 넣는 글자 (키워드 사전에 맞는 것) */
const REACTION_TEXT = 'ㅋㅋㅋ';

/** 초마다 개수 → 점수 계산용 이벤트. 같은 초 안에서는 고르게 나눈다 */
export function replayEvents(data: ReplayData): ScoreEvent[] {
  const out: ScoreEvent[] = [];
  data.chat.forEach((n, s) => {
    const r = data.reaction[s] ?? 0;
    for (let j = 0; j < n; j++)
      out.push({ t: s + j / n, type: 'chat', text: j < r ? REACTION_TEXT : '' });
  });
  data.subscription.forEach((n, s) => {
    for (let j = 0; j < n; j++) out.push({ t: s + j / n, type: 'subscription' });
  });
  for (const [t, amount] of data.donations) out.push({ t, type: 'donation', amount });
  return out.sort((a, b) => a.t - b.t);
}

/** 수집한 이벤트 → 리플레이 데이터. 채팅 본문은 반응 여부만 남기고 버린다 */
export function toReplay(events: readonly ScoreEvent[], durationSec: number): ReplayData {
  const n = Math.max(1, Math.ceil(durationSec));
  const chat = new Array<number>(n).fill(0);
  const reaction = new Array<number>(n).fill(0);
  const subscription = new Array<number>(n).fill(0);
  const donations: [number, number][] = [];
  for (const e of events) {
    const s = Math.min(n - 1, Math.max(0, Math.floor(e.t)));
    if (e.type === 'chat') {
      chat[s] = (chat[s] ?? 0) + 1;
      if (isReaction(e.text)) reaction[s] = (reaction[s] ?? 0) + 1;
    } else if (e.type === 'subscription') subscription[s] = (subscription[s] ?? 0) + 1;
    else donations.push([s, e.amount ?? 0]);
  }
  return { v: 1, kind: 'recorded', durationSec: n, chat, reaction, subscription, donations };
}

/** 재현되는 난수 (mulberry32) */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(rand: () => number, lambda: number) {
  if (lambda <= 0) return 0;
  const l = Math.exp(-lambda);
  let k = 0;
  let p = rand();
  while (p > l) {
    k++;
    p *= rand();
  }
  return k;
}

type Scene = {
  t: number;
  label: string;
  /** 채팅이 가장 많을 때 초당 늘어나는 수 */
  rate: number;
  /** 몰림이 이어지는 시간 (초) */
  len: number;
  subs?: number;
  donations?: number[];
};

const SCENES: Scene[] = [
  { t: 220, label: '첫 보스 처치', rate: 9, len: 18 },
  { t: 495, label: '어이없는 실수', rate: 6, len: 14 },
  { t: 810, label: '구독 축하', rate: 4, len: 12, subs: 7 },
  { t: 1145, label: '큰 후원 읽기', rate: 4, len: 14, donations: [50_000, 10_000, 5_000] },
  { t: 1460, label: '역전승', rate: 11, len: 22 },
  { t: 1690, label: '마지막 인사', rate: 5, len: 16 },
];

/**
 * 예시 방송 30분. 평소 채팅은 초당 1~2개로 천천히 오르내리고, 15~18분에는 시청자가 늘어 채팅이 많아진다
 * (몰림이 아니라 기준이 바뀌는 구간). 장면이 일어나면 3초쯤 뒤부터 반응 채팅이 몰린다.
 */
export function sampleReplay(seed = 20261012): ReplayData {
  const rand = random(seed);
  const durationSec = 1800;
  const chat = new Array<number>(durationSec).fill(0);
  const reaction = new Array<number>(durationSec).fill(0);
  const subscription = new Array<number>(durationSec).fill(0);
  const donations: [number, number][] = [];
  for (let s = 0; s < durationSec; s++) {
    const crowd = s >= 900 && s < 1080 ? 1 + Math.min(1, (s - 900) / 120) : 1;
    const base = (1.3 + 0.4 * Math.sin((2 * Math.PI * s) / 420)) * crowd;
    let extra = 0;
    for (const sc of SCENES) {
      const d = s - sc.t - 3;
      // 빠르게 올라갔다가 천천히 식는다
      if (d >= 0 && d < sc.len) extra += sc.rate * Math.min(1, (d + 1) / 3) * (1 - d / sc.len);
    }
    const quiet = poisson(rand, base);
    const burst = poisson(rand, extra);
    chat[s] = quiet + burst;
    let r = burst > 0 ? Math.round(burst * 0.75) : 0;
    for (let j = 0; j < quiet; j++) if (rand() < 0.1) r++;
    reaction[s] = Math.min(chat[s] ?? 0, r);
    if (rand() < 1 / 400) subscription[s] = 1;
    if (rand() < 1 / 300) donations.push([s, 1000 * (1 + Math.floor(rand() * 5))]);
  }
  for (const sc of SCENES) {
    for (let k = 0; k < (sc.subs ?? 0); k++) {
      const s = sc.t + 2 + k * 2;
      subscription[s] = (subscription[s] ?? 0) + 1;
    }
    sc.donations?.forEach((amount, k) => donations.push([sc.t + 1 + k * 3, amount]));
  }
  donations.sort((a, b) => a[0] - b[0]);
  return {
    v: 1,
    kind: 'sample',
    durationSec,
    chat,
    reaction,
    subscription,
    donations,
    scenes: SCENES.map(({ t, label }) => ({ t, label })),
  };
}

/** 지금까지(t초) 들어온 채팅만 보고 찾은 후보. events는 시각 순이어야 한다 */
export function candidatesAt(events: readonly ScoreEvent[], t: number): Candidate[] {
  let end = 0;
  while (end < events.length && (events[end]?.t ?? Infinity) <= t) end++;
  return analyze(events.slice(0, end), t).candidates;
}

export type Detection = { peak: number; at: number };

/** 처음 감지한 때를 기억한다. 피크가 조금 움직여도(30초 안) 같은 후보로 본다 */
export function trackDetections(
  prev: readonly Detection[],
  candidates: readonly Candidate[],
  t: number,
): Detection[] {
  const next = [...prev];
  for (const c of candidates)
    if (!next.some((d) => Math.abs(d.peak - c.peak) < 30)) next.push({ peak: c.peak, at: t });
  return next;
}

/** 장면 중 후보 구간(앞뒤 10초 여유)에 들어간 것 */
export function foundScenes(
  scenes: readonly { t: number; label: string }[],
  candidates: readonly Candidate[],
) {
  return scenes.filter((s) => candidates.some((c) => s.t >= c.start - 10 && s.t <= c.end + 10));
}
