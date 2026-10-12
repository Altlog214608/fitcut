import { describe, expect, it } from 'vitest';
import { isReaction } from './keywords';
import { analyze, DEFAULT_CONFIG, rollingZ, windowSum, type ScoreEvent } from './score';

const chat = (t: number, text = '안녕'): ScoreEvent => ({
  t,
  type: 'chat',
  text,
});

/** 매초 rate개 채팅 (결정적: 소수 부분은 주기로 나눈다) */
function steady(from: number, to: number, rate: number, text = '안녕'): ScoreEvent[] {
  const out: ScoreEvent[] = [];
  for (let t = from; t < to; t++) {
    const k = Math.floor((t + 1) * rate) - Math.floor(t * rate);
    for (let j = 0; j < k; j++) out.push(chat(t + j / (k + 1), text));
  }
  return out;
}

describe('keywords', () => {
  it('반응 채팅을 알아본다', () => {
    for (const t of [
      'ㅋㅋㅋㅋ',
      'ㄷㄷ',
      'ㅠㅠ',
      '와!!',
      '와아아',
      '미쳤다',
      '클립각',
      'LOL',
      'www',
      '???',
    ]) {
      expect(isReaction(t), t).toBe(true);
    }
    for (const t of ['안녕하세요', 'ㅋ', '와인', '헬로', 'w', '?']) {
      expect(isReaction(t), t).toBe(false);
    }
  });
});

describe('windowSum·rollingZ', () => {
  it('창 합', () => {
    expect(Array.from(windowSum(Float64Array.from([1, 2, 3, 4]), 2))).toEqual([3, 5, 7, 4]);
  });

  it('평소와 같으면 0 근처, 튀면 크게', () => {
    const x = new Float64Array(400).fill(10);
    x[350] = 40;
    const z = rollingZ(x, DEFAULT_CONFIG);
    expect(Math.abs(z[200] ?? 99)).toBeLessThan(0.01);
    expect(z[350]).toBeGreaterThan(5);
  });
});

describe('analyze', () => {
  it('평소 1초에 1개, 5분째에 ㅋㅋ가 몰리면 그 장면을 첫 후보로 (지연·여유 반영)', () => {
    const events = [...steady(0, 600, 1), ...steady(300, 310, 12, 'ㅋㅋㅋㅋ')];
    const r = analyze(events, 600);
    expect(r.candidates.length).toBeGreaterThanOrEqual(1);
    const top = r.candidates[0];
    // 몰린 구간 300~310초, 창 가운데 - 지연 5초 → 장면은 300초 안팎
    expect(top?.peak).toBeGreaterThanOrEqual(290);
    expect(top?.peak).toBeLessThanOrEqual(310);
    expect(top?.start).toBeCloseTo((top?.peak ?? 0) - 15, 1);
    expect(top?.end).toBeCloseTo((top?.peak ?? 0) + 10, 1);
    expect(top?.counts.reaction).toBeGreaterThan(20);
    expect(r.totals.chat).toBe(events.length);
  });

  it('평탄한 방송에서는 후보가 없다', () => {
    const r = analyze(steady(0, 900, 2), 900);
    expect(r.candidates).toEqual([]);
  });

  it('조용한 방송의 채팅 한두 줄은 후보가 아니다', () => {
    const r = analyze([chat(100), chat(400, 'ㅋㅋ')], 600);
    expect(r.candidates).toEqual([]);
  });

  it('여러 번 몰리면 점수 순으로, 가까운 피크는 하나로', () => {
    const events = [
      ...steady(0, 1200, 1),
      ...steady(300, 310, 6, 'ㅋㅋ'),
      ...steady(800, 812, 15, 'ㄷㄷ'),
      ...steady(815, 820, 10, 'ㄷㄷ'),
    ];
    const r = analyze(events, 1200);
    expect(r.candidates.map((c) => c.rank)).toEqual(r.candidates.map((_, i) => i + 1));
    expect(r.candidates[0]?.peak).toBeGreaterThan(790);
    expect(r.candidates[0]?.peak).toBeLessThan(825);
    expect(r.candidates.some((c) => c.peak > 290 && c.peak < 310)).toBe(true);
    // 800대 몰림은 후보 하나로
    expect(r.candidates.filter((c) => c.peak > 780 && c.peak < 840)).toHaveLength(1);
    for (let i = 1; i < r.candidates.length; i++) {
      expect(r.candidates[i - 1]?.score ?? 0).toBeGreaterThanOrEqual(r.candidates[i]?.score ?? 0);
    }
  });

  it('후원이 몰려도 후보가 된다', () => {
    const donations: ScoreEvent[] = Array.from({ length: 6 }, (_, k) => ({
      t: 500 + k,
      type: 'donation',
      amount: 10000,
    }));
    const r = analyze([...steady(0, 900, 1), ...steady(500, 506, 4), ...donations], 900);
    const c = r.candidates.find((x) => x.peak > 485 && x.peak < 510);
    expect(c?.counts.donation).toBe(6);
  });

  it('앞뒤 여유는 방송 범위를 넘지 않는다', () => {
    const r = analyze([...steady(0, 120, 1), ...steady(2, 8, 20, 'ㅋㅋ')], 120);
    for (const c of r.candidates) {
      expect(c.start).toBeGreaterThanOrEqual(0);
      expect(c.end).toBeLessThanOrEqual(120);
    }
  });

  it('그래프용 10초 묶음과 버전', () => {
    const r = analyze(steady(0, 35, 1), 35);
    expect(r.chatPer10s).toEqual([10, 10, 10, 5]);
    expect(r.version).toBe('score-v1/kw-v1');
  });
});

describe('analyze: 소리 크기 (모드 C, ADR-044)', () => {
  /** 초마다 dB: 평소 base, [from, to) 구간만 loud */
  const db = (n: number, base: number, from: number, to: number, loud: number) =>
    Array.from({ length: n }, (_, i) => (i >= from && i < to ? loud : base + ((i * 7) % 3) * 0.3));

  it('채팅 없이 소리만: 크게 튄 순간을 후보로, 지연 보정 없이', () => {
    const r = analyze([], 0, DEFAULT_CONFIG, db(900, -30, 400, 406, -8));
    expect(r.durationSec).toBe(900);
    expect(r.candidates.length).toBeGreaterThanOrEqual(1);
    const top = r.candidates[0];
    expect(top?.peak).toBeGreaterThanOrEqual(395);
    expect(top?.peak).toBeLessThanOrEqual(410);
    expect(top?.counts.loudness).toBeGreaterThan(-25);
    expect(r.version).toBe('score-v1/kw-v1/loud-v1');
    // 0~900초 → 채팅 그래프와 같이 91칸
    expect(r.loudPer10s).toHaveLength(91);
  });

  it('소리가 평탄하면 후보가 없다', () => {
    const r = analyze([], 0, DEFAULT_CONFIG, db(900, -30, 0, 0, 0));
    expect(r.candidates).toEqual([]);
  });

  it('무음(-inf → -120) 구간 뒤에 말소리가 시작돼도 그것만으로 크게 튀지 않는다', () => {
    const quietThenTalk = Array.from({ length: 900 }, (_, i) => (i < 300 ? -120 : -32));
    const r = analyze([], 0, DEFAULT_CONFIG, quietThenTalk);
    expect(r.candidates.length).toBeLessThanOrEqual(1);
  });

  it('채팅과 소리가 같은 장면을 가리키면 그 장면이 1위', () => {
    const events = [...steady(0, 900, 1), ...steady(605, 615, 10, 'ㅋㅋㅋ')];
    const r = analyze(events, 900, DEFAULT_CONFIG, db(900, -30, 600, 606, -10));
    const top = r.candidates[0];
    expect(top?.peak).toBeGreaterThanOrEqual(595);
    expect(top?.peak).toBeLessThanOrEqual(612);
    expect(top?.counts.reaction).toBeGreaterThan(20);
  });
});
