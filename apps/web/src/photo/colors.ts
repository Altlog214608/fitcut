export type Rgb = { r: number; g: number; b: number };

type Pixels = { data: Uint8ClampedArray; width: number; height: number };

function averageBand(pixels: Pixels, y0: number, y1: number, x0: number, x1: number): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * pixels.width + x) * 4;
      // 투명한 픽셀은 색 평균에서 뺀다
      const alpha = (pixels.data[i + 3] ?? 0) / 255;
      r += (pixels.data[i] ?? 0) * alpha;
      g += (pixels.data[i + 1] ?? 0) * alpha;
      b += (pixels.data[i + 2] ?? 0) * alpha;
      n += alpha;
    }
  }
  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/**
 * "비슷한 색" 배경: 사진 가장자리 띠의 평균 색 두 개.
 * axis가 'y'면 [위쪽 띠, 아래쪽 띠], 'x'면 [왼쪽 띠, 오른쪽 띠]. 띠 두께는 bandRatio(기본 3%).
 */
export function edgeColors(pixels: Pixels, axis: 'x' | 'y', bandRatio = 0.03): [Rgb, Rgb] {
  const { width, height } = pixels;
  if (axis === 'y') {
    const band = Math.max(1, Math.round(height * bandRatio));
    return [
      averageBand(pixels, 0, band, 0, width),
      averageBand(pixels, height - band, height, 0, width),
    ];
  }
  const band = Math.max(1, Math.round(width * bandRatio));
  return [
    averageBand(pixels, 0, height, 0, band),
    averageBand(pixels, 0, height, width - band, width),
  ];
}

export function toCss({ r, g, b }: Rgb): string {
  return `rgb(${r} ${g} ${b})`;
}
