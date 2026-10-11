/**
 * AI 업스케일 Worker (F20). 화면이 멈추지 않게 따로 돌고, 조각마다 진행률을 알리며 취소를 받는다.
 * GPU(WebGL)를 먼저 쓰고, 안 되면 CPU로 돈다 (느리다).
 */
import '@tensorflow/tfjs-backend-cpu';
import '@tensorflow/tfjs-backend-webgl';
import * as tf from '@tensorflow/tfjs-core';
import { forward, loadModel, type Model } from './model';
import { tiles } from './tiles';

export type UpscaleRequest =
  { type: 'run'; id: number; bitmap: ImageBitmap; factor: 2 | 4 } | { type: 'cancel'; id: number };

export type UpscaleResponse =
  | { type: 'progress'; id: number; done: number; total: number; backend: string }
  | { type: 'done'; id: number; bitmap: ImageBitmap; ms: number; backend: string }
  | { type: 'error'; id: number; message: string; cancelled?: boolean };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<UpscaleRequest>) => void) | null;
  postMessage: (message: UpscaleResponse, transfer?: Transferable[]) => void;
};

let model: Promise<Model> | null = null;
let backend: Promise<string> | null = null;
const cancelled = new Set<number>();

function ready(): Promise<string> {
  backend ??= tf
    .setBackend('webgl')
    .catch(() => false)
    .then(async (ok) => {
      if (!ok) await tf.setBackend('cpu');
      await tf.ready();
      return tf.getBackend();
    });
  return backend;
}

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

async function run(id: number, bitmap: ImageBitmap, factor: 2 | 4) {
  const started = performance.now();
  const name = await ready();
  model ??= loadModel().catch((e: unknown) => {
    model = null;
    throw e;
  });
  const m = await model;

  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('사진을 읽지 못했어요.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const src = ctx.getImageData(0, 0, width, height).data;

  const outW = width * factor;
  const outH = height * factor;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const list = tiles(width, height);
  for (const [i, t] of list.entries()) {
    await nextTurn(); // 취소 메시지를 받을 틈
    if (cancelled.has(id)) throw Object.assign(new Error('취소했어요.'), { cancelled: true });

    const rgb = new Float32Array(t.pw * t.ph * 3);
    for (let y = 0; y < t.ph; y++) {
      for (let x = 0; x < t.pw; x++) {
        const s = ((t.py + y) * width + (t.px + x)) * 4;
        const d = (y * t.pw + x) * 3;
        rgb[d] = (src[s] ?? 0) / 255;
        rgb[d + 1] = (src[s + 1] ?? 0) / 255;
        rgb[d + 2] = (src[s + 2] ?? 0) / 255;
      }
    }
    const result = tf.tidy(() => {
      const x = tf.tensor4d(rgb, [1, t.ph, t.pw, 3]);
      let y: tf.Tensor4D = forward(m, x);
      // 2배는 4배로 키운 뒤 절반으로 (반 픽셀 중심이면 2×2 평균과 같다)
      if (factor === 2) y = tf.image.resizeBilinear(y, [t.ph * 2, t.pw * 2], false, true);
      return tf.clipByValue(y, 0, 1);
    });
    const values = await result.data();
    result.dispose();

    // 겹침을 버리고 이 조각이 맡은 칸만 결과에 쓴다
    const rw = t.pw * factor;
    const ox = (t.x - t.px) * factor;
    const oy = (t.y - t.py) * factor;
    for (let y = 0; y < t.h * factor; y++) {
      for (let x = 0; x < t.w * factor; x++) {
        const s = ((oy + y) * rw + (ox + x)) * 3;
        const d = ((t.y * factor + y) * outW + (t.x * factor + x)) * 4;
        out[d] = (values[s] ?? 0) * 255 + 0.5;
        out[d + 1] = (values[s + 1] ?? 0) * 255 + 0.5;
        out[d + 2] = (values[s + 2] ?? 0) * 255 + 0.5;
        out[d + 3] = 255;
      }
    }
    scope.postMessage({ type: 'progress', id, done: i + 1, total: list.length, backend: name });
  }
  const result = await createImageBitmap(new ImageData(out, outW, outH));
  scope.postMessage(
    {
      type: 'done',
      id,
      bitmap: result,
      ms: Math.round(performance.now() - started),
      backend: name,
    },
    [result],
  );
}

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }
  run(msg.id, msg.bitmap, msg.factor)
    .catch((error: unknown) => {
      const c = (error as { cancelled?: boolean }).cancelled === true;
      scope.postMessage({
        type: 'error',
        id: msg.id,
        message: error instanceof Error ? error.message : 'AI로 키우지 못했어요.',
        ...(c ? { cancelled: true } : {}),
      });
    })
    .finally(() => cancelled.delete(msg.id));
};
