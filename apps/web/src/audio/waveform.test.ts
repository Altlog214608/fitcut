import { describe, expect, it } from 'vitest';
import { peaks } from './waveform';

describe('peaks', () => {
  it('구간마다 가장 큰 세기를 0~1로 (가장 큰 값이 1)', () => {
    const ch = new Float32Array([0.1, -0.2, 0.05, 0.5, -0.25, 0]);
    const got = peaks([ch], 3);
    [0.4, 1, 0.5].forEach((v, i) => expect(got[i]).toBeCloseTo(v, 5));
  });

  it('채널을 합쳐 큰 쪽을 쓴다', () => {
    const left = new Float32Array([0.1, 0.1]);
    const right = new Float32Array([0.4, 0.2]);
    const got = peaks([left, right], 2);
    [1, 0.5].forEach((v, i) => expect(got[i]).toBeCloseTo(v, 5));
  });

  it('조용한 파일은 0, 빈 파일은 빈 배열', () => {
    expect(peaks([new Float32Array(4)], 2)).toEqual([0, 0]);
    expect(peaks([new Float32Array(0)], 2)).toEqual([]);
  });
});
