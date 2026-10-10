/**
 * 배경 채우기 "자연스럽게 잇기" (AI 없음). 순수 계산이고, 픽셀 읽고 쓰기는 render.ts가 한다.
 *
 * 가장자리 줄을 그대로 늘이면 세로 줄무늬가 생기고 사진의 결(대리석 무늬·노이즈)이 사라져서
 * 붙여 넣은 티가 난다. 그래서 두 층으로 나눠 만든다.
 * 1) 밝기·색: 경계 근처는 사진 가장자리 색, 멀어질수록 가로로 넓게 뭉갠 색으로 바뀐다
 * 2) 결: 경계 쪽 사진 띠의 잔무늬를 무작위 조각으로 이어 붙여 더한다. 가는 선(타일 줄눈)과
 *    빛 반사처럼 튀는 조각, 가로로 길게 뻗은 밝기 변화는 빼서 반복 무늬가 드러나지 않게 한다
 *    결은 밝기로만 더한다. 색까지 옮기면 띠 안의 다른 물건 테두리나 어두운 사진의 색 잡음이
 *    베이지 벽 위에 초록·파랑 얼룩으로 번진다 (2026-10-10 사용자 제보)
 * 크기 관련 값은 가로 1440px 기준이고 실제 가로에 비례해서 쓴다.
 */
export type Rgba = { data: Uint8ClampedArray; width: number; height: number };

type Planes = [Float32Array, Float32Array, Float32Array];

const BASE_WIDTH = 1440;

/** 같은 seed면 같은 결과 (미리보기와 저장이 같은 무늬가 되게) */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 한 방향 상자 흐림 (가장자리는 끝 값을 이어 쓴다). 세 번 하면 가우시안에 가깝다 */
function boxPass(
  src: Float32Array,
  n: number,
  count: number,
  stride: number,
  step: number,
  r: number,
) {
  const out = new Float32Array(src.length);
  const line = new Float32Array(n);
  const size = 2 * r + 1;
  for (let k = 0; k < count; k++) {
    const base = k * stride;
    for (let i = 0; i < n; i++) line[i] = src[base + i * step] ?? 0;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += line[Math.min(n - 1, Math.max(0, i))] ?? 0;
    for (let i = 0; i < n; i++) {
      out[base + i * step] = sum / size;
      sum += (line[Math.min(n - 1, i + r + 1)] ?? 0) - (line[Math.max(0, i - r)] ?? 0);
    }
  }
  return out;
}

function blurX(p: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return p;
  let out = p;
  for (let i = 0; i < 3; i++) out = boxPass(out, w, h, w, 1, r);
  return out;
}

function blurY(p: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return p;
  let out = p;
  for (let i = 0; i < 3; i++) out = boxPass(out, h, w, 1, w, r);
  return out;
}

function planesOf(img: Rgba, rowStart: number, rows: number): Planes {
  const { width: w, data } = img;
  const planes: Planes = [
    new Float32Array(w * rows),
    new Float32Array(w * rows),
    new Float32Array(w * rows),
  ];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((rowStart + y) * w + x) * 4;
      const j = y * w + x;
      planes[0][j] = data[i] ?? 0;
      planes[1][j] = data[i + 1] ?? 0;
      planes[2][j] = data[i + 2] ?? 0;
    }
  }
  return planes;
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))] ?? Infinity;
}

function std(values: Float32Array[]): number {
  let n = 0;
  let sum = 0;
  let sq = 0;
  for (const v of values) {
    for (const x of v) {
      n++;
      sum += x;
      sq += x * x;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean));
}

type Candidate = { y: number; x: number; energy: number; line: number };

/** 밝기 (BT.601) */
function lumaOf(img: Rgba, rowStart: number, rows: number): Float32Array {
  const [r, g, b] = planesOf(img, rowStart, rows);
  return r.map((v, i) => 0.299 * v + 0.587 * (g[i] ?? 0) + 0.114 * (b[i] ?? 0));
}

/** 겹쳐 평균 내서 줄어든 대비를 되돌릴 때 이보다 키우지 않는다 (잡음이 커지지 않게) */
const MAX_GAIN = 1.5;

/** 결 층: 사진 띠 밝기의 잔무늬를 조각으로 이어 붙인 rows x w (부호 있는 값) */
function quiltDetail(strip: Rgba, rows: number, s: number, seed: number): Float32Array | null {
  const w = strip.width;
  const bandTop = Math.round(24 * s);
  const bandH = Math.min(Math.round(260 * s), strip.height - bandTop);
  const P = Math.max(16, Math.round(128 * s));
  const O = Math.round(P * 0.375);
  const step = P - O;
  if (bandH < P + 2 || w < P + 2) return null;

  // 잔무늬 = 띠 - 흐린 띠, 그다음 가로로 길게 뻗은 밝기 변화(빛 띠 경계 등)를 뺀다
  const band = lumaOf(strip, bandTop, bandH);
  // 상자 흐림 세 번은 반지름 r이 표준편차 약 r인 가우시안과 비슷하다 (시험값: 18, 64)
  const r = Math.max(1, Math.round(18 * s));
  const rx = Math.max(1, Math.round(64 * s));
  const blurred = blurY(blurX(band, w, bandH, r), w, bandH, r);
  const high = band.map((v, i) => v - (blurred[i] ?? 0));
  const wide = blurX(high, w, bandH, rx);
  const detail = high.map((v, i) => v - (wide[i] ?? 0));

  // 조각 고르기: 에너지(평균 세기)와 선 점수(한 줄 평균이 튀는 정도)로 거른다
  const mag = detail.map(Math.abs);
  const rowPrefix = new Float32Array((w + 1) * bandH);
  const colPrefix = new Float32Array(w * (bandH + 1));
  for (let y = 0; y < bandH; y++) {
    for (let x = 0; x < w; x++) {
      const m = mag[y * w + x] ?? 0;
      rowPrefix[y * (w + 1) + x + 1] = (rowPrefix[y * (w + 1) + x] ?? 0) + m;
      colPrefix[(y + 1) * w + x] = (colPrefix[y * w + x] ?? 0) + m;
    }
  }
  const grid = Math.max(2, Math.round(8 * s));
  const candidates: Candidate[] = [];
  for (let y0 = 0; y0 + P <= bandH; y0 += grid) {
    for (let x0 = 0; x0 + P <= w; x0 += grid) {
      let total = 0;
      let maxRow = 0;
      for (let y = y0; y < y0 + P; y++) {
        const row = (rowPrefix[y * (w + 1) + x0 + P] ?? 0) - (rowPrefix[y * (w + 1) + x0] ?? 0);
        total += row;
        maxRow = Math.max(maxRow, row / P);
      }
      let maxCol = 0;
      for (let x = x0; x < x0 + P; x++) {
        const col = (colPrefix[(y0 + P) * w + x] ?? 0) - (colPrefix[y0 * w + x] ?? 0);
        maxCol = Math.max(maxCol, col / P);
      }
      const energy = total / (P * P);
      candidates.push({ y: y0, x: x0, energy, line: Math.max(maxRow, maxCol) / (energy + 1e-6) });
    }
  }
  const eLimit = percentile(
    candidates.map((c) => c.energy),
    0.65,
  );
  const lLimit = percentile(
    candidates.map((c) => c.line),
    0.4,
  );
  const picked = candidates.filter((c) => c.energy <= eLimit && c.line <= lLimit);
  const pool = picked.length > 0 ? picked : candidates;
  if (pool.length === 0) return null;

  // 겹치는 가장자리를 서서히 섞는 가중치
  const ramp = new Float32Array(P).fill(1);
  for (let i = 0; i < O; i++) {
    const v = (i + 0.5) / O;
    ramp[i] = v;
    ramp[P - 1 - i] = v;
  }
  const out = new Float32Array(w * rows);
  const weight = new Float32Array(w * rows);
  const rand = random(seed);
  for (let y = 0; y < rows; y += step) {
    const shift = Math.floor(rand() * step); // 줄마다 조각 위치를 엇갈리게
    for (let x = -O - shift; x < w; x += step) {
      const c = pool[Math.floor(rand() * pool.length)] ?? pool[0];
      if (!c) continue;
      for (let dy = 0; dy < P; dy++) {
        const ty = y + dy;
        if (ty >= rows) break;
        const wy = ramp[dy] ?? 1;
        for (let dx = 0; dx < P; dx++) {
          const tx = x + dx;
          if (tx < 0 || tx >= w) continue;
          const k = wy * (ramp[dx] ?? 1);
          const si = (c.y + dy) * w + c.x + dx;
          const ti = ty * w + tx;
          out[ti] = (out[ti] ?? 0) + (detail[si] ?? 0) * k;
          weight[ti] = (weight[ti] ?? 0) + k;
        }
      }
    }
  }
  for (let i = 0; i < weight.length; i++) out[i] = (out[i] ?? 0) / Math.max(1e-6, weight[i] ?? 0);
  // 겹쳐서 평균 내면 대비가 줄어든다. 사진 띠의 대비에 맞추되 너무 키우지 않는다
  const target = std([detail]);
  const got = std([out]);
  if (got > 1e-6) {
    const gain = Math.min(MAX_GAIN, target / got);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * gain;
  }
  return out;
}

/**
 * 사진 위쪽에 채울 픽셀을 만든다 (채우는 쪽이 위가 되도록 돌려서 넘긴다).
 * @param strip 사진의 경계 줄부터 사진 안쪽으로 이어지는 띠. 0번 줄이 경계 줄이다
 * @param fill 채울 줄 수 (사진 바깥)
 * @param overlap 사진 안쪽으로 겹쳐 그릴 줄 수 (사진 경계를 섞을 때 아래에 깔린다)
 * @returns 높이 fill + overlap. 0번 줄이 가장 먼 곳, fill번 줄이 사진 경계 줄
 */
export function textureFill(strip: Rgba, fill: number, overlap: number, seed = 7): Rgba {
  const w = strip.width;
  const rows = fill + overlap;
  const s = w / BASE_WIDTH;
  const out = new Uint8ClampedArray(w * rows * 4);
  if (w === 0 || rows === 0 || strip.height === 0) return { data: out, width: w, height: rows };

  // 1) 밝기·색 모델
  const edgeRows = Math.min(strip.height, Math.max(1, Math.round(16 * s)));
  const edge = planesOf(strip, 0, edgeRows).map((p) => {
    const mean = new Float32Array(w);
    for (let y = 0; y < edgeRows; y++) {
      for (let x = 0; x < w; x++) mean[x] = (mean[x] ?? 0) + (p[y * w + x] ?? 0) / edgeRows;
    }
    return mean;
  });
  const near = edge.map((e) => blurX(e, w, 1, Math.max(1, Math.round(20 * s))));
  const far = edge.map((e) => blurX(e, w, 1, Math.max(1, Math.round(400 * s))));
  const decay = Math.max(1, 0.22 * fill);

  // 2) 결
  const detail = quiltDetail(strip, rows, s, seed);

  const base = [0, 0, 0];
  for (let y = 0; y < rows; y++) {
    const d = Math.max(0, fill - y);
    const k = Math.exp(-d / decay);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const f = far[c]?.[x] ?? 0;
        base[c] = f + ((near[c]?.[x] ?? 0) - f) * k;
      }
      // 밝기 결을 색 비율대로 나눠 더한다: 색(색상·채도)은 바탕색 그대로 두고 밝기만 흔든다
      const luma = 0.299 * (base[0] ?? 0) + 0.587 * (base[1] ?? 0) + 0.114 * (base[2] ?? 0);
      const grain = detail ? (detail[y * w + x] ?? 0) / Math.max(16, luma) : 0;
      for (let c = 0; c < 3; c++) out[o + c] = (base[c] ?? 0) * (1 + grain);
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: rows };
}

/** 맨 아래 n줄만 남긴다. 채울 수 있는 최대 길이로 한 번 만들고 실제 길이만큼 잘라 쓸 때 쓴다 */
export function lastRows(img: Rgba, n: number): Rgba {
  const rows = Math.max(0, Math.min(n, img.height));
  const from = (img.height - rows) * img.width * 4;
  return { data: img.data.subarray(from), width: img.width, height: rows };
}

/** 사진 경계에서 바깥으로 채우는 한쪽 (위·왼쪽은 before, 아래·오른쪽은 after) */
export type FillSide = 'before' | 'after';

type Edge = { axis: 'x' | 'y'; start: number; length: number };

/** 캔버스 좌표: k = 경계에서 사진 안쪽으로 몇 번째 줄, j = 경계를 따라가는 위치 */
function inward(edge: Edge, side: FillSide, k: number): number {
  return side === 'before' ? edge.start + k : edge.start + edge.length - 1 - k;
}

/**
 * 캔버스에서 경계 줄부터 사진 안쪽으로 depth줄을 떼어, 채우는 쪽이 위가 되게 돌린 띠.
 * textureFill에 그대로 넘긴다.
 */
export function stripFrom(canvas: Rgba, edge: Edge, side: FillSide, depth: number): Rgba {
  const cross = edge.axis === 'y' ? canvas.width : canvas.height;
  const rows = Math.max(0, Math.min(depth, edge.length));
  const data = new Uint8ClampedArray(cross * rows * 4);
  for (let k = 0; k < rows; k++) {
    const line = inward(edge, side, k);
    for (let j = 0; j < cross; j++) {
      const [x, y] = edge.axis === 'y' ? [j, line] : [line, j];
      const from = (y * canvas.width + x) * 4;
      data.set(canvas.data.subarray(from, from + 4), (k * cross + j) * 4);
    }
  }
  return { data, width: cross, height: rows };
}

/**
 * textureFill 결과를 캔버스 제자리에 쓴다 (캔버스 픽셀을 직접 바꾼다).
 * fill 결과의 size번 줄이 경계 줄이고, 그 위(0번 쪽)가 바깥, 아래가 사진 안쪽이다.
 */
export function placeFill(canvas: Rgba, fill: Rgba, edge: Edge, side: FillSide, size: number) {
  for (let i = 0; i < fill.height; i++) {
    const line = inward(edge, side, i - size);
    const limit = edge.axis === 'y' ? canvas.height : canvas.width;
    if (line < 0 || line >= limit) continue;
    for (let j = 0; j < fill.width; j++) {
      const [x, y] = edge.axis === 'y' ? [j, line] : [line, j];
      const from = (i * fill.width + j) * 4;
      canvas.data.set(fill.data.subarray(from, from + 4), (y * canvas.width + x) * 4);
    }
  }
}
