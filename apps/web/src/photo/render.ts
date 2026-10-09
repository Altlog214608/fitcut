/**
 * 사진을 목표 크기로 그려서 파일로 만든다 (F1). 브라우저 안에서만 동작하고 서버로 보내지 않는다.
 * 캔버스로 다시 인코딩하므로 EXIF·위치정보 같은 메타데이터는 결과에 남지 않는다.
 * Web Worker(OffscreenCanvas)와 메인 스레드(HTMLCanvasElement) 양쪽에서 같은 코드를 쓴다.
 */
import { fadeStops, featherStops, fillExtent, type FillExtent, type Stop } from './blend';
import { edgeColors, toCss } from './colors';
import type { OutputFormat } from './fileName';
import type { Layout, Rect, Size } from './layout';
import { lastRows, placeFill, stripFrom, textureFill, type Rgba } from './texture';

/**
 * 배경 채우기의 배경. strength는 흐림 0~1, dim은 어둡게 0~0.6.
 * - extend: 사진 가장자리 줄을 바깥으로 늘여서 이어 붙임 (기본값. 벽·하늘·바닥에 자연스러움)
 * - blur: 같은 사진을 화면에 꽉 차게 키워 흐리게 (인물 사진은 큰 흐린 얼굴이 뒤에 비친다)
 * - mirror: 사진을 가장자리에서 거울처럼 뒤집어 이어 붙임
 * extend·mirror는 사진 가까이는 덜 흐리고 멀수록 많이 흐리게 해서 경계가 이어져 보이게 한다.
 */
type PhotoFill = { strength: number; dim: number };

export type Background =
  /** 자연스럽게 잇기: 밝기·색을 이어 가고 사진 경계 쪽 벽의 결을 이어 붙인다 (기본값, texture.ts) */
  | { kind: 'texture' }
  | ({ kind: 'blur' } & PhotoFill)
  | ({ kind: 'extend' } & PhotoFill)
  | ({ kind: 'mirror' } & PhotoFill)
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
  /** 원형 워치: 원 바깥을 검정으로 칠하거나 투명하게 (투명은 PNG·WebP만) (F2) */
  circleOutside?: 'black' | 'transparent';
  /** 배경 채우기에서 사진 경계를 섞는 길이. 사진 길이 대비 비율 (0 = 섞지 않음) */
  feather?: number;
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

/** 사진을 정확히 width x height로 바꾼 새 이미지를 돌려준다 (저장용 고품질 축소) */
export type Resampler = (image: Source, width: number, height: number) => Promise<Source>;

/**
 * 저장할 때 미리 줄여 둘 크기. 사진을 줄여서 그릴 때만 크기를 돌려주고, 키우거나 그대로면 null.
 * 확대는 캔버스 보간과 Lanczos의 차이가 작아서(ADR-026) 따로 하지 않는다.
 */
export function resampleSize(image: Size, layout: Layout): Size | null {
  const width = Math.round(Math.abs(layout.image.width));
  const height = Math.round(Math.abs(layout.image.height));
  if (width >= image.width && height >= image.height) return null;
  if (width < 1 || height < 1) return null;
  return { width, height };
}

const MIME: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function context(canvas: AnyCanvas): Ctx {
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

/** 흐림 강도(0~1) → 줄이는 배율. 작게 줄였다가 다시 키우면 흐려진다. */
function blurFactor(strength: number): number {
  return 6 + Math.round(Math.min(1, Math.max(0, strength)) * 42);
}

function dimAll(ctx: Ctx, target: Size, dim: number): void {
  if (dim <= 0) return;
  ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.6, dim)})`;
  ctx.fillRect(0, 0, target.width, target.height);
}

/** source 전체를 size 크기로 흐리게 만든 새 캔버스 */
function blurred(source: Source, size: Size, factor: number, make: CanvasFactory): AnyCanvas {
  const small = make(
    Math.max(1, Math.round(size.width / factor)),
    Math.max(1, Math.round(size.height / factor)),
  );
  drawRect(context(small), source, { x: 0, y: 0, width: small.width, height: small.height }, make);
  const out = make(size.width, size.height);
  context(out).drawImage(small, 0, 0, size.width, size.height);
  return out;
}

/** 축을 따라가는 알파 그라데이션으로 캔버스를 깎는다 (destination-in) */
function maskAlong(canvas: AnyCanvas, ext: FillExtent, stops: Stop[]): void {
  const ctx = context(canvas);
  const g =
    ext.axis === 'y'
      ? ctx.createLinearGradient(0, 0, 0, canvas.height)
      : ctx.createLinearGradient(0, 0, canvas.width, 0);
  for (const [at, alpha] of stops) g.addColorStop(at, `rgba(0, 0, 0, ${alpha})`);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
}

/** 가장자리 띠 두께 (사진 길이 대비) */
const EDGE_BAND = 0.012;
/** 가장자리 줄을 가로(세로)로 이만큼 줄여 뭉갠다 (사진 길이 대비 칸 수) */
const EDGE_SMEAR = 1 / 32;

/**
 * 가장자리 띠를 한 줄로 평균 내고, 띠 방향으로도 크게 뭉갠 작은 캔버스.
 * 띠를 그대로 늘이면 대리석 무늬·옷 주름이 커튼 같은 줄무늬가 된다. 뭉개면 벽처럼 매끈하게 이어진다.
 */
function edgeLine(image: Source, side: 'top' | 'bottom' | 'left' | 'right', make: CanvasFactory) {
  const y = side === 'top' || side === 'bottom';
  const band = Math.max(1, Math.round((y ? image.height : image.width) * EDGE_BAND));
  const crop = y ? make(image.width, band) : make(band, image.height);
  const sx = side === 'right' ? image.width - band : 0;
  const sy = side === 'bottom' ? image.height - band : 0;
  context(crop).drawImage(image, sx, sy, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const cells = (length: number) => Math.max(2, Math.round(length * EDGE_SMEAR));
  const line = y ? make(cells(image.width), 1) : make(1, cells(image.height));
  drawRect(context(line), crop, { x: 0, y: 0, width: line.width, height: line.height }, make);
  return line;
}

/** 사진 바깥(위아래 또는 양옆)을 가장자리 늘이기 또는 거울 반사로 칠한다 */
function paintOutside(
  ctx: Ctx,
  image: Source,
  r: Rect,
  ext: FillExtent,
  kind: 'extend' | 'mirror',
  make: CanvasFactory,
): void {
  const y = ext.axis === 'y';
  const end = ext.start + ext.length;
  if (kind === 'extend') {
    // 가장자리 1% 띠를 바깥 끝까지 늘인다
    if (y) {
      if (ext.before > 0) ctx.drawImage(edgeLine(image, 'top', make), r.x, 0, r.width, ext.start);
      if (ext.after > 0)
        ctx.drawImage(edgeLine(image, 'bottom', make), r.x, end, r.width, ext.after);
    } else {
      if (ext.before > 0) ctx.drawImage(edgeLine(image, 'left', make), 0, r.y, ext.start, r.height);
      if (ext.after > 0)
        ctx.drawImage(edgeLine(image, 'right', make), end, r.y, ext.after, r.height);
    }
    return;
  }
  // mirror: 경계에서 뒤집어 그린다. 채울 곳이 사진보다 길면 뒤집은 사진을 늘여서 덮는다.
  const sides: { at: number; before: boolean; len: number }[] = [];
  if (ext.before > 0)
    sides.push({ at: ext.start, before: true, len: Math.max(ext.length, ext.before) });
  if (ext.after > 0) sides.push({ at: end, before: false, len: Math.max(ext.length, ext.after) });
  for (const side of sides) {
    ctx.save();
    if (y) {
      ctx.translate(0, side.at);
      ctx.scale(1, -1);
      const rect = { x: r.x, y: side.before ? 0 : -side.len, width: r.width, height: side.len };
      drawRect(ctx, image, rect, make);
    } else {
      ctx.translate(side.at, 0);
      ctx.scale(-1, 1);
      const rect = { x: side.before ? 0 : -side.len, y: r.y, width: side.len, height: r.height };
      drawRect(ctx, image, rect, make);
    }
    ctx.restore();
  }
}

function drawContinuation(
  ctx: Ctx,
  image: Source,
  layout: Layout,
  target: Size,
  background: { kind: 'extend' | 'mirror'; strength: number; dim: number },
  make: CanvasFactory,
): void {
  const ext = fillExtent(layout, target);
  const base = make(target.width, target.height);
  const b = context(base);
  drawRect(b, image, layout.image, make);
  paintOutside(b, image, layout.image, ext, background.kind, make);

  const factor = blurFactor(background.strength);
  // 먼 곳: 많이 흐린 층, 가까운 곳: 덜 흐린 층. 덜 흐린 층을 사진 가까이에만 남긴다.
  ctx.drawImage(blurred(base, target, factor, make), 0, 0);
  const near = blurred(base, target, Math.max(2, Math.round(factor / 4)), make);
  maskAlong(near, ext, fadeStops(ext, Math.max(ext.before, ext.after) * 0.6));
  ctx.drawImage(near, 0, 0);
  dimAll(ctx, target, background.dim);
}

/** 사진 띠에서 결을 가져오는 깊이 (가로 1440 기준 줄 수). texture.ts가 쓰는 띠보다 조금 넉넉하게 */
const TEXTURE_DEPTH = 320;

/**
 * 미리보기는 사진을 끌 때마다 다시 그린다. 사진을 채우는 축으로 옮겨도 경계에 닿는 사진 줄은
 * 그대로이므로, 남는 길이 전체만큼 한 번 만들어 두고 위치에 맞게 잘라 쓴다 (끄는 동안 무늬도 그대로).
 */
const textureCache = new WeakMap<object, Map<string, Rgba>>();

function cachedTexture(image: Source, key: string, build: () => Rgba): Rgba {
  let byKey = textureCache.get(image);
  if (!byKey) {
    byKey = new Map();
    textureCache.set(image, byKey);
  }
  let found = byKey.get(key);
  if (!found) {
    // 사진 크기·화면을 바꾸면 키가 늘어난다. 최근 몇 개만 남긴다
    if (byKey.size >= 8) byKey.clear();
    found = build();
    byKey.set(key, found);
  }
  return found;
}

function drawTexture(
  ctx: Ctx,
  image: Source,
  layout: Layout,
  target: Size,
  make: CanvasFactory,
): void {
  const ext = fillExtent(layout, target);
  const layer = make(target.width, target.height);
  const lctx = context(layer);
  drawRect(lctx, image, layout.image, make);
  const photo = lctx.getImageData(0, 0, target.width, target.height);
  const canvas = { data: photo.data, width: photo.width, height: photo.height };
  const cross = ext.axis === 'y' ? target.width : target.height;
  // 사진 경계를 섞을 때(drawPhoto의 feather) 사진 아래에 깔릴 만큼 사진 안쪽으로도 채운다
  const overlap = Math.min(ext.length, Math.round(ext.length * 0.08) + 2);
  const depth = Math.ceil((TEXTURE_DEPTH * cross) / 1440) + overlap;
  const gap = ext.before + ext.after;
  // 잘리는 축의 위치(사진을 키웠을 때)가 바뀌면 경계에 닿는 사진 부분도 바뀐다
  const crossOffset = ext.axis === 'y' ? layout.image.x : layout.image.y;
  for (const side of ['before', 'after'] as const) {
    const size = side === 'before' ? ext.before : ext.after;
    if (size <= 0) continue;
    const key = [
      side,
      layout.image.width,
      layout.image.height,
      crossOffset,
      target.width,
      target.height,
    ].join(':');
    const full = cachedTexture(image, key, () =>
      textureFill(stripFrom(canvas, ext, side, depth), gap, overlap),
    );
    placeFill(canvas, lastRows(full, size + overlap), ext, side, size);
  }
  ctx.putImageData(photo, 0, 0);
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
  // ctx.filter는 브라우저마다 지원이 달라 쓰지 않는다
  const factor = blurFactor(strength);
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
  dimAll(ctx, target, dim);
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
  // 사진 가운데까지 칠해 둔다. 경계를 섞을 때 사진 가장자리 아래가 비어 검게 보이지 않게 한다.
  if (fillExtent(layout, target).axis === 'y') {
    const [top, bottom] = edgeColors(pixels, 'y');
    const middle = Math.round(r.y + r.height / 2);
    ctx.fillStyle = toCss(top);
    ctx.fillRect(0, 0, target.width, middle);
    ctx.fillStyle = toCss(bottom);
    ctx.fillRect(0, middle, target.width, target.height - middle);
  } else {
    const [left, right] = edgeColors(pixels, 'x');
    const middle = Math.round(r.x + r.width / 2);
    ctx.fillStyle = toCss(left);
    ctx.fillRect(0, 0, middle, target.height);
    ctx.fillStyle = toCss(right);
    ctx.fillRect(middle, 0, target.width - middle, target.height);
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
    if (background.kind === 'texture') {
      drawTexture(ctx, image, layout, target, make);
    } else if (background.kind === 'blur') {
      drawBlur(ctx, image, layout.background, target, background.strength, background.dim, make);
    } else if (background.kind === 'extend' || background.kind === 'mirror') {
      drawContinuation(ctx, image, layout, target, background, make);
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

  const feather = options.feather ?? 0;
  if (layout.background && feather > 0) {
    // 사진 경계를 배경 쪽으로 서서히 투명하게 해서 이어지게 한다
    const ext = fillExtent(layout, target);
    const layer = make(target.width, target.height);
    drawRect(context(layer), image, layout.image, make);
    maskAlong(layer, ext, featherStops(ext, Math.round(feather * ext.length)));
    ctx.drawImage(layer, 0, 0);
  } else {
    drawRect(ctx, image, layout.image, make);
  }

  if (options.circleOutside) maskCircle(ctx, target, options.circleOutside);
}

/** 큰 사진을 미리보기용으로 줄인 사본 (긴 변 maxSide 이하) */
export function downscaled(image: Source, maxSide: number, make: CanvasFactory): Source {
  const k = Math.min(1, maxSide / Math.max(image.width, image.height));
  if (k === 1) return image;
  const width = Math.max(1, Math.round(image.width * k));
  const height = Math.max(1, Math.round(image.height * k));
  const out = make(width, height);
  drawRect(context(out), image, { x: 0, y: 0, width, height }, make);
  return out;
}

function maskCircle(ctx: Ctx, target: Size, outside: 'black' | 'transparent'): void {
  const r = Math.min(target.width, target.height) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(target.width / 2, target.height / 2, r, 0, Math.PI * 2);
  if (outside === 'transparent') {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fill();
  } else {
    // 원 바깥만 칠한다: 화면 전체 사각형에서 원을 빼는 even-odd 채우기
    ctx.rect(0, 0, target.width, target.height);
    ctx.fillStyle = '#000000';
    ctx.fill('evenodd');
  }
  ctx.restore();
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
  resample?: Resampler,
): Promise<RenderResult> {
  const canvas = make(options.target.width, options.target.height);
  // 줄여서 그릴 때는 먼저 사진 자리 크기로 정확히 줄여 둔다. 그러면 drawPhoto는 1:1로 그린다.
  const size = resample ? resampleSize(image, options.layout) : null;
  const source = resample && size ? await resample(image, size.width, size.height) : image;
  drawPhoto(context(canvas), source, options, make);
  const blob = await encode(canvas, options.format, options.quality);
  return { blob, format: formatOf(blob.type) };
}
