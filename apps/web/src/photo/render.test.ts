import { describe, expect, it } from 'vitest';
import { computeLayout } from './layout';
import { resampleSize } from './render';

const PHONE = { width: 1206, height: 2622 };

describe('resampleSize (저장할 때 미리 줄일 크기)', () => {
  it('큰 사진을 줄여서 넣으면 사진 자리 크기', () => {
    const src = { width: 4032, height: 3024 };
    expect(resampleSize(src, computeLayout(src, PHONE, 'contain'))).toEqual({
      width: 1206,
      height: 905,
    });
  });

  it('꽉 채우기에서 잘려 나가는 부분까지 포함한 크기', () => {
    const src = { width: 4032, height: 3024 };
    const layout = computeLayout(src, PHONE, 'cover');
    expect(resampleSize(src, layout)).toEqual({
      width: layout.image.width,
      height: layout.image.height,
    });
  });

  it('키우거나 그대로면 null (확대는 캔버스 보간으로 충분하다)', () => {
    const small = { width: 850, height: 1134 };
    expect(resampleSize(small, computeLayout(small, PHONE, 'contain'))).toBeNull();
    expect(resampleSize(PHONE, computeLayout(PHONE, PHONE, 'cover'))).toBeNull();
  });
});
