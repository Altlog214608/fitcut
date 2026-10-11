/**
 * AI 업스케일 모델 (FEATURES F20, ADR-023): Real-ESRGAN realesr-general-x4v3 (SRVGGNetCompact, BSD-3-Clause).
 * 합성곱 34층 + PReLU + 픽셀 재배치뿐이라 TF.js 연산으로 직접 돌린다 (런타임이 작다).
 * 가중치는 처음 쓸 때만 /models에서 받는다 (fp16, 약 2.4MB). 사진은 기기를 떠나지 않는다.
 */
import * as tf from '@tensorflow/tfjs-core';

export type Manifest = {
  name: string;
  scale: number;
  dtype: 'float16';
  layers: (
    { type: 'conv'; filter: number[]; bias: number[] } | { type: 'prelu'; alpha: number[] }
  )[];
};

type Layer =
  { type: 'conv'; filter: tf.Tensor4D; bias: tf.Tensor1D } | { type: 'prelu'; alpha: tf.Tensor1D };

export type Model = { scale: number; layers: Layer[] };

/** IEEE 754 반정밀도(16비트) → 32비트 (순수 함수) */
export function float16ToFloat32(bits: Uint16Array): Float32Array {
  const out = new Float32Array(bits.length);
  for (let i = 0; i < bits.length; i++) {
    const h = bits[i] ?? 0;
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const frac = h & 0x3ff;
    out[i] =
      exp === 0
        ? sign * 2 ** -14 * (frac / 1024)
        : exp === 31
          ? frac
            ? NaN
            : sign * Infinity
          : sign * 2 ** (exp - 15) * (1 + frac / 1024);
  }
  return out;
}

const count = (shape: number[]) => shape.reduce((a, b) => a * b, 1);

/** 목록과 바이너리로 텐서를 만든다 */
export function buildModel(manifest: Manifest, data: ArrayBuffer): Model {
  const values = float16ToFloat32(new Uint16Array(data));
  let at = 0;
  const take = (shape: number[]) => {
    const n = count(shape);
    const slice = values.subarray(at, at + n);
    at += n;
    return slice;
  };
  const layers: Layer[] = manifest.layers.map((l) => {
    if (l.type === 'conv') {
      const filter = tf.tensor4d(take(l.filter), l.filter as [number, number, number, number]);
      const bias = tf.tensor1d(take(l.bias));
      return { type: 'conv', filter, bias };
    }
    return { type: 'prelu', alpha: tf.tensor1d(take(l.alpha)) };
  });
  if (at !== values.length) throw new Error('모델 파일 크기가 맞지 않아요.');
  return { scale: manifest.scale, layers };
}

export async function loadModel(base = '/models/realesr-general-x4v3'): Promise<Model> {
  const [manifest, data] = await Promise.all([
    fetch(`${base}.json`).then((r) => r.json() as Promise<Manifest>),
    fetch(`${base}.bin`).then((r) => {
      if (!r.ok) throw new Error('모델을 받지 못했어요. 인터넷 연결을 확인해 주세요.');
      return r.arrayBuffer();
    }),
  ]);
  return buildModel(manifest, data);
}

/**
 * 한 조각을 키운다. 입력 NHWC [1,h,w,3] (0~1) → [1, h·s, w·s, 3].
 * 원래 구조: 몸통 출력을 PixelShuffle 하고 입력을 최근접 확대한 것에 더한다.
 */
export function forward(model: Model, x: tf.Tensor4D): tf.Tensor4D {
  return tf.tidy(() => {
    let out: tf.Tensor4D = x;
    for (const layer of model.layers) {
      out =
        layer.type === 'conv'
          ? tf.add<tf.Tensor4D>(tf.conv2d(out, layer.filter, 1, 'same'), layer.bias)
          : // TF.js 타입은 alpha를 같은 차수로 적지만 채널별 1차원도 브로드캐스트된다
            tf.prelu<tf.Tensor4D>(out, layer.alpha as unknown as tf.Tensor4D);
    }
    const [, h = 0, w = 0] = x.shape;
    const up = tf.depthToSpace(out, model.scale, 'NHWC');
    const base = tf.image.resizeNearestNeighbor(x, [h * model.scale, w * model.scale]);
    return tf.add<tf.Tensor4D>(up, base);
  });
}
