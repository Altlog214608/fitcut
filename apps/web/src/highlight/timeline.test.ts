import { describe, expect, it } from 'vitest';
import { clock, markerFile, parseClock, srtTime, timelineText, type Candidate } from './timeline';

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

describe('markerFile', () => {
  const list = [c(1, 900.5), c(2, 120)];

  it('SRT: 번호·쉼표 밀리초·빈 줄, 시간 순서', () => {
    const { text, ext } = markerFile(list, 60, 'srt');
    expect(ext).toBe('srt');
    expect(text).toBe(
      '1\n00:03:00,000 --> 00:03:25,000\n하이라이트 1 (점수 3)\n\n' +
        '2\n00:16:00,500 --> 00:16:25,500\n하이라이트 2 (점수 4)\n',
    );
  });

  it('Audacity 라벨: 초 단위, 탭으로', () => {
    expect(markerFile(list, 0, 'audacity').text).toBe(
      '120.000\t145.000\t하이라이트 1\n900.500\t925.500\t하이라이트 2\n',
    );
  });

  it('CSV: BOM, 머리줄, 시:분:초와 초', () => {
    const { text, type } = markerFile(list, 0, 'csv');
    expect(type).toBe('text/csv');
    const lines = text.replace('﻿', '').trim().split('\r\n');
    expect(text.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('순서,시작,끝,장면,시작(초),끝(초),점수,채팅,반응,후원,구독');
    expect(lines[1]).toBe('1,0:02:00,0:02:25,0:02:15,120.0,145.0,3,10,5,0,0');
    expect(lines).toHaveLength(3);
  });

  it('srtTime', () => {
    expect(srtTime(3723.0456)).toBe('01:02:03,046');
  });
});
