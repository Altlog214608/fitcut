import { describe, expect, it } from 'vitest';
import { fpsFromFrameTimes } from './frameRate';

const frames = (fps: number, count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => from + i / fps);

describe('fpsFromFrameTimes', () => {
  it.each([24, 30, 60])('%sfps', (fps) => {
    expect(fpsFromFrameTimes(frames(fps, 20))).toBeCloseTo(fps, 1);
  });

  it('29.97fps', () => {
    expect(fpsFromFrameTimes(frames(30000 / 1001, 20))).toBe(29.97);
  });

  it('중간에 프레임을 건너뛰어도 중앙값이라 그대로', () => {
    const t = frames(30, 20).filter((_, i) => i % 7 !== 3);
    expect(fpsFromFrameTimes(t)).toBeCloseTo(30, 1);
  });

  it('구간 반복으로 시각이 되돌아간 값은 뺀다', () => {
    const t = [...frames(30, 10, 5), ...frames(30, 10, 1)];
    expect(fpsFromFrameTimes(t)).toBeCloseTo(30, 1);
  });

  it('잴 프레임이 모자라면 null', () => {
    expect(fpsFromFrameTimes(frames(30, 4))).toBeNull();
  });
});
