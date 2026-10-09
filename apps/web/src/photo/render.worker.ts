import { renderPhotoWith, type RenderOptions, type RenderResult } from './render';

export type WorkerRequest = { id: number; bitmap: ImageBitmap; options: RenderOptions };
export type WorkerResponse =
  { id: number; ok: true; result: RenderResult } | { id: number; ok: false; message: string };

// 이 파일은 Worker 안에서만 실행된다. tsconfig가 DOM 타입을 쓰므로 필요한 것만 좁혀서 쓴다.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

scope.onmessage = async (event) => {
  const { id, bitmap, options } = event.data;
  try {
    const result = await renderPhotoWith(bitmap, options, (w, h) => new OffscreenCanvas(w, h));
    scope.postMessage({ id, ok: true, result });
  } catch (error) {
    scope.postMessage({
      id,
      ok: false,
      message: error instanceof Error ? error.message : '이미지를 만들지 못했어요.',
    });
  } finally {
    bitmap.close();
  }
};
