import '@tensorflow/tfjs-backend-cpu';
import * as tf from '@tensorflow/tfjs-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel, float16ToFloat32, forward, type Manifest } from './model';
import reference from './reference.test-data.json';
import { pickFactor, resultSize, tiles } from './tiles';

describe('float16ToFloat32', () => {
  it.each([
    [0x3c00, 1],
    [0xc000, -2],
    [0x3555, 0.333251953125],
    [0x0001, 2 ** -24],
    [0x0000, 0],
  ])('%s → %s', (bits, value) => {
    expect(float16ToFloat32(new Uint16Array([bits]))[0]).toBeCloseTo(value, 10);
  });
});

describe('조각 나누기', () => {
  it('모든 칸을 한 번씩 덮고, 겹침은 사진 안에서만', () => {
    const list = tiles(300, 200, 128, 12);
    const covered = list.reduce((sum, t) => sum + t.w * t.h, 0);
    expect(covered).toBe(300 * 200);
    for (const t of list) {
      expect(t.px).toBeGreaterThanOrEqual(0);
      expect(t.px + t.pw).toBeLessThanOrEqual(300);
      expect(t.x - t.px).toBeLessThanOrEqual(12);
    }
  });

  it('결과 긴 변 4096px까지, 필요한 배율에 맞춰 2배·4배', () => {
    expect(resultSize(500, 500, 2)).toEqual({ width: 1000, height: 1000 });
    expect(resultSize(1500, 1000, 4)).toBeNull();
    expect(pickFactor(500, 500, 1.6)).toBe(2);
    expect(pickFactor(500, 500, 3)).toBe(4);
    expect(pickFactor(1500, 1000, 3)).toBe(2);
    expect(pickFactor(3000, 2000, 2)).toBeNull();
  });
});

describe('모델 (PyTorch 원본과 같은 결과)', () => {
  let manifest: Manifest;
  let data: ArrayBuffer;

  beforeAll(async () => {
    await tf.setBackend('cpu');
    // vitest는 apps/web에서 돈다 (jsdom이라 import.meta.url이 file:이 아니다)
    const dir = `${resolve('public/models')}/`;
    manifest = JSON.parse(readFileSync(`${dir}realesr-general-x4v3.json`, 'utf8')) as Manifest;
    const bin = readFileSync(`${dir}realesr-general-x4v3.bin`);
    data = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  });

  it('12x10 입력을 4배로 키운 값이 PyTorch(fp16 가중치)와 거의 같다', async () => {
    const model = buildModel(manifest, data);
    // 기준값은 NCHW. TF.js는 NHWC
    const nchw = tf.tensor4d(reference.input as number[][][][]);
    const x = tf.transpose(nchw, [0, 2, 3, 1]) as tf.Tensor4D;
    const y = forward(model, x);
    expect(y.shape).toEqual([1, 40, 48, 3]);
    const want = tf.transpose(tf.tensor4d(reference.output as number[][][][]), [0, 2, 3, 1]);
    const diff = (await tf.max(tf.abs(tf.sub(y, want))).data())[0] ?? 1;
    expect(diff).toBeLessThan(2e-3);
  });
});
