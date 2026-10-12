import { describe, expect, it } from 'vitest';
import { clock, parseClock, timelineText, type Candidate } from './timeline';

const c = (rank: number, start: number): Candidate => ({
  rank,
  start,
  end: start + 25,
  peak: start + 15,
  score: 5 - rank,
  counts: { chat: 10, reaction: 5, donation: 0, subscription: 0 },
});

describe('clock', () => {
  it('1시간 전후 모양', () => {
    expect(clock(307)).toBe('05:07');
    expect(clock(3723)).toBe('1:02:03');
    expect(clock(65, true)).toBe('0:01:05');
    expect(clock(-3)).toBe('00:00');
  });
});

describe('parseClock', () => {
  it('분:초, 시:분:초, 초를 읽는다', () => {
    expect(parseClock('1:02')).toBe(62);
    expect(parseClock('1:02:03')).toBe(3723);
    expect(parseClock('90')).toBe(90);
    expect(parseClock('')).toBe(0);
    expect(parseClock('abc')).toBeNull();
    expect(parseClock('1::2')).toBeNull();
  });
});

describe('timelineText', () => {
  it('시간 순서로, offset을 더해서', () => {
    expect(timelineText([c(1, 900), c(2, 120)], 60)).toBe('03:00 하이라이트 1\n16:00 하이라이트 2');
  });

  it('한 줄이라도 1시간을 넘으면 모두 시:분:초', () => {
    expect(timelineText([c(1, 3500), c(2, 100)], 200)).toBe(
      '0:05:00 하이라이트 1\n1:01:40 하이라이트 2',
    );
  });
});
