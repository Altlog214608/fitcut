import { describe, expect, it } from 'vitest';
import { fadeStops, featherStops, fillExtent } from './blend';
import { computeLayout } from './layout';

const PHONE = { width: 1170, height: 2532 };

describe('fillExtent', () => {
  it('세로로 채울 때: 사진 위 486px, 아래 486px', () => {
    const layout = computeLayout({ width: 900, height: 1200 }, PHONE, 'contain');
    expect(fillExtent(layout, PHONE)).toEqual({
      axis: 'y',
      start: 486,
      length: 1560,
      total: 2532,
      before: 486,
      after: 486,
    });
  });

  it('가로로 채울 때는 x축', () => {
    const layout = computeLayout({ width: 500, height: 3000 }, PHONE, 'contain');
    const ext = fillExtent(layout, PHONE);
    expect(ext.axis).toBe('x');
    expect(ext.before + ext.length + ext.after).toBe(1170);
  });
});

describe('featherStops', () => {
  const ext = {
    axis: 'y' as const,
    start: 500,
    length: 1000,
    total: 2000,
    before: 500,
    after: 500,
  };

  it('양쪽 가장자리를 feather만큼 서서히 보이게', () => {
    expect(featherStops(ext, 100)).toEqual([
      [0.25, 0],
      [0.3, 1],
      [0.7, 1],
      [0.75, 0],
    ]);
  });

  it('사진이 화면 끝에 닿은 쪽은 섞지 않는다', () => {
    const top = { ...ext, start: 0, before: 0, after: 1000 };
    expect(featherStops(top, 100)).toEqual([
      [0, 1],
      [0.45, 1],
      [0.5, 0],
    ]);
  });

  it('feather는 사진 길이의 절반을 넘지 않는다', () => {
    const stops = featherStops(ext, 5000);
    expect(stops[1]).toEqual([0.5, 1]);
    expect(stops[2]).toEqual([0.5, 1]);
  });

  it('feather가 0이면 그대로', () => {
    expect(featherStops(ext, 0)).toEqual([
      [0.25, 1],
      [0.75, 1],
    ]);
  });
});

describe('fadeStops', () => {
  it('사진 가까이는 1, fade만큼 멀어지면 0', () => {
    const ext = {
      axis: 'y' as const,
      start: 500,
      length: 1000,
      total: 2000,
      before: 500,
      after: 500,
    };
    expect(fadeStops(ext, 300)).toEqual([
      [0.1, 0],
      [0.25, 1],
      [0.75, 1],
      [0.9, 0],
    ]);
  });

  it('캔버스 밖으로 나가는 위치는 0~1로 자른다', () => {
    const ext = {
      axis: 'y' as const,
      start: 100,
      length: 1800,
      total: 2000,
      before: 100,
      after: 100,
    };
    const stops = fadeStops(ext, 500);
    expect(stops[0]).toEqual([0, 0]);
    expect(stops[3]).toEqual([1, 0]);
  });
});
