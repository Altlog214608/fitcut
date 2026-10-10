/**
 * HEIC·HEIF 사진 열기 (FEATURES F10). 사진은 서버로 보내지 않으므로 브라우저에서 푼다.
 * 사파리처럼 브라우저가 직접 풀 수 있으면 그것을 쓰고, 못 풀면 libheif(wasm, LGPL-3.0)를 그때만 불러온다 (ADR-037).
 * libheif는 HEIF의 회전(irot)·자르기 정보를 반영해서 풀어 준다.
 */

type HeifImage = {
  get_width(): number;
  get_height(): number;
  display(target: ImageData, done: (result: ImageData | null) => void): void;
  free?(): void;
};
type LibHeif = { HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] } };

const HEIC_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

export function isHeic(file: Pick<File, 'name' | 'type'>): boolean {
  const ext = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  return HEIC_TYPES.has(file.type.toLowerCase()) || ext === 'heic' || ext === 'heif';
}

let lib: Promise<LibHeif> | null = null;

function loadLibHeif(): Promise<LibHeif> {
  lib ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs')
    .then((m) => m.default() as LibHeif)
    .catch((error: unknown) => {
      lib = null;
      throw error;
    });
  return lib;
}

export async function decodeHeic(file: Blob): Promise<ImageBitmap> {
  const libheif = await loadLibHeif();
  const images = new libheif.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()));
  // 여러 장이 든 파일(연속 촬영 등)은 대표 사진(첫 장)을 쓴다
  const image = images[0];
  if (!image) throw new Error('HEIC 사진을 읽지 못했어요.');
  try {
    const data = new ImageData(image.get_width(), image.get_height());
    await new Promise<void>((resolve, reject) => {
      image.display(data, (result) =>
        result ? resolve() : reject(new Error('HEIC 사진을 읽지 못했어요.')),
      );
    });
    return await createImageBitmap(data);
  } finally {
    for (const img of images) img.free?.();
  }
}
