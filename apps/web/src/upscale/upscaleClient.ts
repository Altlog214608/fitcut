/** AI 업스케일 Worker를 부르는 쪽 (F20). 진행률과 취소(AbortSignal)를 받는다 */
import type { UpscaleRequest, UpscaleResponse } from './upscale.worker';

let worker: Worker | null = null;
let nextId = 1;
type Pending = {
  resolve: (r: { bitmap: ImageBitmap; ms: number; backend: string }) => void;
  reject: (e: Error & { cancelled?: boolean }) => void;
  onProgress: (done: number, total: number, backend: string) => void;
};
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./upscale.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<UpscaleResponse>) => {
      const msg = event.data;
      const job = pending.get(msg.id);
      if (!job) return;
      if (msg.type === 'progress') {
        job.onProgress(msg.done, msg.total, msg.backend);
        return;
      }
      pending.delete(msg.id);
      if (msg.type === 'done')
        job.resolve({ bitmap: msg.bitmap, ms: msg.ms, backend: msg.backend });
      else job.reject(Object.assign(new Error(msg.message), { cancelled: msg.cancelled === true }));
    };
  }
  return worker;
}

/** 이 브라우저에서 쓸 수 있는지 (Worker 안에서 그림을 다루려면 OffscreenCanvas가 필요하다) */
export const canUpscale = () =>
  typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';

export async function upscale(
  bitmap: ImageBitmap,
  factor: 2 | 4,
  onProgress: Pending['onProgress'],
  signal: AbortSignal,
): Promise<{ bitmap: ImageBitmap; ms: number; backend: string }> {
  const w = getWorker();
  // 원본 비트맵은 화면에 계속 쓰므로 복사본을 넘긴다
  const copy = await createImageBitmap(bitmap);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    signal.addEventListener(
      'abort',
      () => w.postMessage({ type: 'cancel', id } satisfies UpscaleRequest),
      {
        once: true,
      },
    );
    w.postMessage({ type: 'run', id, bitmap: copy, factor } satisfies UpscaleRequest, [copy]);
  });
}
