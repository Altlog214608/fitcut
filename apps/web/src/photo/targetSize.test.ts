import { describe, expect, it } from 'vitest';
import { fitToSize, MIN_QUALITY } from './targetSize';

/** 화질에 비례해 커지는 가짜 인코더: q=1이면 1000바이트 + base */
const fake = (base: number) => {
  const calls: number[] = [];
  const encode = async (q: number) => {
    calls.push(q);
    return new Blob([new Uint8Array(Math.round(base + 1000 * q))]);
  };
  return { encode, calls };
};

describe('fitToSize', () => {
  it('이미 목표 이하면 고른 화질 그대로 한 번만 만든다', async () => {
    const { encode, calls } = fake(0);
    const r = await fitToSize(encode, 2000, 0.92);
    expect(r).toMatchObject({ quality: 0.92, fits: true });
    expect(calls).toEqual([0.92]);
  });

  it('목표 이하인 가장 높은 화질을 찾는다 (결과는 목표 이하)', async () => {
    const { encode } = fake(100);
    const r = await fitToSize(encode, 600, 0.92);
    expect(r.fits).toBe(true);
    expect(r.blob.size).toBeLessThanOrEqual(600);
    expect(r.quality).toBeGreaterThan(0.45); // 정답 0.5 근처
    expect(r.quality).toBeLessThanOrEqual(0.5);
  });

  it('가장 낮은 화질로도 넘으면 그 결과와 함께 맞출 수 없다고 알린다', async () => {
    const { encode } = fake(500);
    const r = await fitToSize(encode, 300, 0.92);
    expect(r).toMatchObject({ quality: MIN_QUALITY, fits: false });
    expect(r.blob.size).toBe(600);
  });
});
