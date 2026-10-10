import {
  renderPhotoWith,
  type CanvasFactory,
  type RenderOptions,
  type RenderResult,
} from './render';
import { picaResampler } from './resample';
import { decodeHeic, isHeic } from './heic';
import type { WorkerRequest, WorkerResponse } from './render.worker';

/**
 * 사진 파일을 디코딩한다. EXIF 방향을 반영해서 세로로 찍은 사진이 눕지 않게 한다.
 * TODO(verify): imageOrientation 'from-image'의 브라우저별 동작을 E2E로 확인한다.
 */
export async function decodePhoto(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // 브라우저가 HEIC를 못 풀면(사파리 외 대부분) libheif로 푼다 (F10)
    if (isHeic(file)) {
      try {
        return await decodeHeic(file);
      } catch {
        throw new Error('HEIC 사진을 열지 못했어요. 사진 앱에서 JPG로 내보낸 뒤 골라 주세요.');
      }
    }
    throw new Error('사진을 열지 못했어요. JPG · PNG · WebP · HEIC 파일인지 확인해 주세요.');
  }
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (r: RenderResult) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  if (!worker) {
    worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.ok) job.resolve(event.data.result);
      else job.reject(new Error(event.data.message));
    };
  }
  return worker;
}

/**
 * 사진을 결과 파일로 만든다. 가능하면 Web Worker에서 처리해 화면이 멈추지 않게 하고,
 * OffscreenCanvas가 없는 브라우저에서는 메인 스레드에서 처리한다.
 */
export async function renderPhoto(
  bitmap: ImageBitmap,
  options: RenderOptions,
): Promise<RenderResult> {
  const w = getWorker();
  if (!w) {
    const make: CanvasFactory = (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };
    return renderPhotoWith(bitmap, options, make, picaResampler(make));
  }
  // 원본 비트맵은 미리보기에 계속 쓰므로 복사본을 Worker로 넘긴다
  const copy = await createImageBitmap(bitmap);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: WorkerRequest = { id, bitmap: copy, options };
    w.postMessage(request, [copy]);
  });
}
