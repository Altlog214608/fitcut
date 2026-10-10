import { describe, expect, it } from 'vitest';
import {
  formatTime,
  initialRange,
  moveEnd,
  moveStart,
  parseTime,
  rangeProblem,
  snapToFrame,
} from './time';

describe('formatTime', () => {
  it.each([
    [0, '00:00.00'],
    [12.345, '00:12.35'],
    [59.999, '01:00.00'],
    [75.5, '01:15.50'],
    [3723.5, '1:02:03.50'],
  ])('%s초 → %s', (t, text) => {
    expect(formatTime(t)).toBe(text);
  });
});

describe('parseTime', () => {
  it.each([
    ['1:02.5', 62.5],
    ['01:02.345', 62.345],
    ['62.5', 62.5],
    ['75', 75],
    ['.5', 0.5],
    ['1:02:03', 3723],
    [' 0:05.10 ', 5.1],
  ])('%s → %s초', (text, t) => {
    expect(parseTime(text)).toBe(t);
  });

  it.each(['', 'abc', '1:75', '1:-2', '1::2', '1:2:3:4', '1:60:00', '-3'])('%s → null', (text) => {
    expect(parseTime(text)).toBeNull();
  });

  it('표시한 값을 다시 읽으면 같은 시각', () => {
    for (const t of [0, 1.23, 59.5, 61.07, 3600.25]) {
      expect(parseTime(formatTime(t))).toBe(t);
    }
  });
});

describe('구간 규칙', () => {
  const frame = 1 / 30;

  it('시각을 프레임 경계로 맞춘다', () => {
    expect(snapToFrame(1.01, 30)).toBe(1);
    expect(snapToFrame(1.02, 30)).toBe(1.033);
  });

  it('시작은 끝보다 한 프레임 앞까지, 0보다 앞으로 가지 않는다', () => {
    const r = { start: 1, end: 3 };
    expect(moveStart(r, 5, frame).start).toBe(2.967);
    expect(moveStart(r, -2, frame).start).toBe(0);
  });

  it('끝은 시작보다 한 프레임 뒤부터 영상 끝까지', () => {
    const r = { start: 1, end: 3 };
    expect(moveEnd(r, 0.5, frame, 10).end).toBe(1.033);
    expect(moveEnd(r, 12, frame, 10).end).toBe(10);
  });

  it('처음 구간은 앞 5초, 짧은 영상은 전체', () => {
    expect(initialRange(60)).toEqual({ start: 0, end: 5 });
    expect(initialRange(2.4)).toEqual({ start: 0, end: 2.4 });
  });

  it('형식별 최대 길이를 넘으면 고치는 방법을 알려준다 (서버와 같은 기준)', () => {
    expect(rangeProblem({ start: 0, end: 30 }, 'gif')).toBeNull();
    expect(rangeProblem({ start: 0, end: 31 }, 'gif')).toBe(
      '구간이 너무 길어요. 30초 이하로 골라 주세요.',
    );
    expect(rangeProblem({ start: 0, end: 120 }, 'mp4')).toBeNull();
  });
});
