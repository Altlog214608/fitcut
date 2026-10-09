/**
 * 사진을 목표 크기로 그려서 파일로 만든다 (F1). 브라우저 안에서만 동작하고 서버로 보내지 않는다.
 * 캔버스로 다시 인코딩하므로 EXIF·위치정보 같은 메타데이터는 결과에 남지 않는다.
 * Web Worker(OffscreenCanvas)와 메인 스레드(HTMLCanvasElement) 양쪽에서 같은 코드를 쓴다.
 */
import { edgeColors, toCss } from './colors';
import type { OutputFormat } from './fileName';
import type { Layout, Rect, Size } from './layout';

export type Background =
  /** 같은 사진을 흐리게. strength 0~1, dim 0~0.6 (어둡게) */
  | { kind: 'blur'; strength: number; dim: number }
  /** 가장자리 평균 색 */
  | { kind: 'edge' }
  | { kind: 'solid'; color: string };

export type RenderOptions = {
  target: Size;
  layout: Layout;
  background: Background;
  format: OutputFormat;
  /** JPEG·WebP 화질 0~1 */
  quality: number;
};

export type RenderResult = {
  blob: Blob;
  /** 브라우저가 요청한 형식을 못 만들면 PNG 등으로 대신 만든다 (예: 일부 브라우저의 WebP) */
  format: OutputFormat;
};

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type Source = CanvasImageSource & { width: number; height: number };

export type CanvasFactory = (width: number, height: number) => AnyCanvas;

const MIME: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function context(canvas: AnyCanvas): Ctx {
  const ctx = canvas.getContext('2d') as Ctx | null;
  if (!ctx) throw new Error('캔버스를 만들 수 없어요.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/**
 * 큰 사진을 한 번에 많이 줄이면 계단 현상이 생긴다. 절반씩 줄여서 목표의 2배 이내로 만든다.
 */
function stepDown(image: Source, width: number, height: number, make: CanvasFactory): Source {
  let current: Source = image;
  while (current.width / 2 >= width && current.height / 2 >= height) {
    const next = make(Math.round(current.width / 2), Math.round(current.height / 2));
    context(next).drawImage(current, 0, 0, next.width, next.height);
    current = next;
  }
  return current;
}

function drawRect(ctx: Ctx, image: Source, rect: Rect, make: CanvasFactory): void {
  const source = stepDown(image, Math.abs(rect.width), Math.abs(rect.height), make);
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
}

function drawBlur(
  ctx: Ctx,
  image: Source,
  rect: Rect,
  target: Size,
  strength: number,
  dim: number,
  make: CanvasFactory,
): void {
  // 작게 줄였다가 다시 키우면 흐려진다. ctx.filter는 브라우저마다 지원이 달라 쓰지 않는다.
  const factor = 6 + Math.round(Math.min(1, Math.max(0, strength)) * 42);
  const small = make(
    Math.max(1, Math.round(target.width / factor)),
    Math.max(1, Math.round(target.height / factor)),
  );
  const s = context(small);
  const k = small.width / target.width;
  drawRect(
    s,
    image,
    { x: rect.x * k, y: rect.y * k, width: rect.width * k, height: rect.height * k },
    make,
  );
  ctx.drawImage(small, 0, 0, target.width, target.height);
  if (dim > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.6, dim)})`;
    ctx.fillRect(0, 0, target.width, target.height);
  }
}

function drawEdge(
  ctx: Ctx,
  image: Source,
  layout: Layout,
  target: Size,
  make: CanvasFactory,
): void {
  const sampleWidth = Math.min(128, image.width);
  const sampleHeight = Math.max(1, Math.round((image.height * sampleWidth) / image.width));
  const sample = make(sampleWidth, sampleHeight);
  const sctx = context(sample);
  sctx.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const pixels = sctx.getImageData(0, 0, sampleWidth, sampleHeight);
  const { image: r } = layout;
  if (layout.movable.y) {
    const [top, bottom] = edgeColors(pixels, 'y');
    ctx.fillStyle = toCss(top);
    ctx.fillRect(0, 0, target.width, r.y);
    ctx.fillStyle = toCss(bottom);
    ctx.fillRect(0, r.y + r.height, target.width, target.height - r.y - r.height);
  } else {
    const [left, right] = edgeColors(pixels, 'x');
    ctx.fillStyle = toCss(left);
    ctx.fillRect(0, 0, r.x, target.height);
    ctx.fillStyle = toCss(right);
    ctx.fillRect(r.x + r.width, 0, target.width - r.x - r.width, target.height);
  }
}

export function drawPhoto(
  ctx: Ctx,
  image: Source,
  options: RenderOptions,
  make: CanvasFactory,
): void {
  const { target, layout, background, format } = options;

  if (layout.background) {
    if (background.kind === 'blur') {
      drawBlur(ctx, image, layout.background, target, background.strength, background.dim, make);
    } else if (background.kind === 'edge') {
      drawEdge(ctx, image, layout, target, make);
    } else {
      ctx.fillStyle = background.color;
      ctx.fillRect(0, 0, target.width, target.height);
    }
  } else if (format === 'jpeg') {
    // JPEG는 투명을 못 담는다. 투명 PNG를 넣으면 검정이 아니라 흰색이 되도록 깐다.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, target.width, target.height);
  }

  drawRect(ctx, image, layout.image, make);
}

async function encode(canvas: AnyCanvas, format: OutputFormat, quality: number): Promise<Blob> {
  const type = MIME[format];
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('이미지를 만들지 못했어요.'))),
      type,
      quality,
    );
  });
}

function formatOf(mime: string): OutputFormat {
  const found = (Object.keys(MIME) as OutputFormat[]).find((f) => MIME[f] === mime);
  return found ?? 'png';
}

export async function renderPhotoWith(
  image: Source,
  options: RenderOptions,
  make: CanvasFactory,
): Promise<RenderResult> {
  const canvas = make(options.target.width, options.target.height);
  drawPhoto(context(canvas), image, options, make);
  const blob = await encode(canvas, options.format, options.quality);
  return { blob, format: formatOf(blob.type) };
}
