import { describe, expect, it } from 'vitest';
import { estimateBytes, formatBytes, outputSize } from './estimate';

describe('outputSize', () => {
  it('가로를 맞추고 세로는 비율대로 짝수 (ffmpeg -2)', () => {
    expect(outputSize(480, { width: 1280, height: 720 })).toEqual({ width: 480, height: 270 });
    expect(outputSize(480, { width: 1080, height: 1920 })).toEqual({ width: 480, height: 854 });
    expect(outputSize(720, { width: 1280, height: 720 })).toEqual({ width: 720, height: 406 });
  });

  it('원본보다 키우지 않는다', () => {
    expect(outputSize(640, { width: 320, height: 240 })).toEqual({ width: 320, height: 240 });
  });
});

describe('estimateBytes', () => {
  it('실제로 만든 결과와 크게 다르지 않다 (2026-10-10 측정)', () => {
    // 1080×1920 원본 → GIF 5초 480×854 15fps = 2.6MB
    const gif = estimateBytes('gif', { width: 480, height: 854 }, 15, 5);
    expect(gif / 2_640_630).toBeGreaterThan(0.7);
    expect(gif / 2_640_630).toBeLessThan(1.3);
    // 1280×720 원본 → WebP 3초 480×270 15fps = 264KB
    const webp = estimateBytes('webp', { width: 480, height: 270 }, 15, 3);
    expect(webp / 263_980).toBeGreaterThan(0.7);
    expect(webp / 263_980).toBeLessThan(1.3);
  });

  it('형식별로 GIF > WebP > MP4', () => {
    const size = { width: 480, height: 270 };
    const gif = estimateBytes('gif', size, 15, 3);
    const webp = estimateBytes('webp', size, 15, 3);
    const mp4 = estimateBytes('mp4', size, 15, 3);
    expect(gif).toBeGreaterThan(webp);
    expect(webp).toBeGreaterThan(mp4);
  });
});

describe('formatBytes', () => {
  it.each([
    [500, '1KB'],
    [263_980, '258KB'],
    [2_640_630, '2.5MB'],
  ])('%s → %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
