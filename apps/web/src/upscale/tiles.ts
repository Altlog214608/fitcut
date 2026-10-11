/**
 * 조각으로 나눠 키우기 (순수 함수). 큰 사진을 한 번에 넣으면 메모리가 모자라서
 * 겹침(pad)을 둔 조각으로 나눠 키우고, 가장자리 겹침을 버린 가운데만 붙인다 (경계 자국 방지).
 */
export type Tile = {
  /** 원본에서 이 조각이 맡는 칸 (결과에 쓰는 부분) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 모델에 넣을 칸 (겹침 포함, 사진 밖으로 나가지 않게 자름) */
  px: number;
  py: number;
  pw: number;
  ph: number;
};

export function tiles(width: number, height: number, size = 128, pad = 12): Tile[] {
  const out: Tile[] = [];
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      const w = Math.min(size, width - x);
      const h = Math.min(size, height - y);
      const px = Math.max(0, x - pad);
      const py = Math.max(0, y - pad);
      const pw = Math.min(width, x + w + pad) - px;
      const ph = Math.min(height, y + h + pad) - py;
      out.push({ x, y, w, h, px, py, pw, ph });
    }
  }
  return out;
}

/** 결과 크기: 긴 변 상한(4096px, F20)을 넘으면 null */
export const MAX_RESULT_SIDE = 4096;
export function resultSize(width: number, height: number, factor: 2 | 4) {
  const w = width * factor;
  const h = height * factor;
  return Math.max(w, h) > MAX_RESULT_SIDE ? null : { width: w, height: h };
}

/** 필요한 배율에 맞는 가장 작은 AI 배율 (상한을 넘으면 가능한 것 중 큰 쪽, 둘 다 안 되면 null) */
export function pickFactor(width: number, height: number, needed: number): 2 | 4 | null {
  const ok = ([2, 4] as const).filter((f) => resultSize(width, height, f));
  if (ok.length === 0) return null;
  return ok.find((f) => f >= needed) ?? ok[ok.length - 1] ?? null;
}
