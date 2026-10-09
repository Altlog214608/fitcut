import { describe, expect, it } from 'vitest';
import { computeLayout, fillAxis, maxZoom, ratioFit } from './layout';

const PHONE = { width: 1170, height: 2532 };

describe('꽉 채우기 (cover)', () => {
  it('4000x3000을 1170x2532에 맞추면 세로가 꽉 차고 양옆이 잘린다 (F1 수용 기준)', () => {
    const { image, movable, background } = computeLayout(
      { width: 4000, height: 3000 },
      PHONE,
      'cover',
    );
    expect(image.height).toBe(2532);
    expect(image.width).toBe(3376);
    expect(image.x).toBe(-(3376 - 1170) / 2);
    expect(image.y).toBe(0);
    expect(movable).toEqual({ x: true, y: false });
    expect(background).toBeNull();
  });

  it('위치를 왼쪽 끝(-1)·오른쪽 끝(1)으로 옮길 수 있다', () => {
    const src = { width: 4000, height: 3000 };
    expect(computeLayout(src, PHONE, 'cover', { x: -1, y: 0 }).image.x).toBe(0);
    expect(computeLayout(src, PHONE, 'cover', { x: 1, y: 0 }).image.x).toBe(-(3376 - 1170));
  });

  it('범위를 넘는 위치 값은 끝에서 멈춘다', () => {
    const src = { width: 4000, height: 3000 };
    expect(computeLayout(src, PHONE, 'cover', { x: -5, y: 0 }).image.x).toBe(0);
  });
});

describe('배경 채우기 (contain)', () => {
  it('900x1200 → 1170x2532: 사진은 1170x1560, 위아래 486px씩 채운다 (F1 수용 기준)', () => {
    const { image, background, scale, movable } = computeLayout(
      { width: 900, height: 1200 },
      PHONE,
      'contain',
    );
    expect(image).toEqual({ x: 0, y: 486, width: 1170, height: 1560 });
    expect(scale).toBeCloseTo(1.3);
    expect(movable).toEqual({ x: false, y: true });
    // 배경은 같은 사진을 화면에 꽉 차게
    expect(background?.height).toBe(2532);
    expect(background && background.width >= 1170).toBe(true);
  });

  it('1440x1440 → 1170x2532: 사진은 1170x1170, 위아래 681px씩 (F1 수용 기준)', () => {
    const { image } = computeLayout({ width: 1440, height: 1440 }, PHONE, 'contain');
    expect(image).toEqual({ x: 0, y: 681, width: 1170, height: 1170 });
  });

  it('사진 비율이 바뀌지 않는다', () => {
    const src = { width: 850, height: 1134 };
    const { image } = computeLayout(src, PHONE, 'contain');
    expect(image.width / image.height).toBeCloseTo(src.width / src.height, 2);
  });

  it('사진을 위로 올리거나 아래로 내릴 수 있다', () => {
    const src = { width: 1440, height: 1440 };
    expect(computeLayout(src, PHONE, 'contain', { x: 0, y: -1 }).image.y).toBe(0);
    expect(computeLayout(src, PHONE, 'contain', { x: 0, y: 1 }).image.y).toBe(2532 - 1170);
  });

  it('세로로 아주 긴 사진은 양옆을 채운다', () => {
    const { image, movable } = computeLayout({ width: 500, height: 3000 }, PHONE, 'contain');
    expect(image.height).toBe(2532);
    expect(image.width).toBe(422);
    expect(movable).toEqual({ x: true, y: false });
  });

  it('사진을 키우면 양옆이 잘리고 위아래 채울 곳이 줄어든다', () => {
    // 3024x4032 → 1440x3200: 그대로면 1440x1920, 1.3배면 1872x2496
    const src = { width: 3024, height: 4032 };
    const target = { width: 1440, height: 3200 };
    const { image, movable } = computeLayout(src, target, 'contain', { x: 0, y: 1 }, 1.3);
    expect(image).toEqual({ x: -216, y: 3200 - 2496, width: 1872, height: 2496 });
    expect(movable).toEqual({ x: true, y: true });
  });

  it('키운 쪽 위치도 -1(왼쪽 끝)~1(오른쪽 끝)로 옮긴다', () => {
    const src = { width: 3024, height: 4032 };
    const target = { width: 1440, height: 3200 };
    expect(computeLayout(src, target, 'contain', { x: -1, y: 0 }, 1.3).image.x).toBe(0);
    expect(computeLayout(src, target, 'contain', { x: 1, y: 0 }, 1.3).image.x).toBe(-432);
  });

  it('최대로 키우면 꽉 채우기와 같고, 그 이상은 멈춘다', () => {
    const src = { width: 3024, height: 4032 };
    const target = { width: 1440, height: 3200 };
    expect(maxZoom(src, target)).toBeCloseTo(1.667, 3);
    const max = computeLayout(src, target, 'contain', { x: 0, y: 0 }, 99);
    expect(max.image).toEqual(computeLayout(src, target, 'cover').image);
    expect(max.movable).toEqual({ x: true, y: false });
  });

  it('1보다 작게는 줄이지 않는다', () => {
    const src = { width: 900, height: 1200 };
    expect(computeLayout(src, PHONE, 'contain', { x: 0, y: 0 }, 0.5).image).toEqual(
      computeLayout(src, PHONE, 'contain').image,
    );
  });

  it('채우는 축: 납작한 사진은 위아래(y), 길쭉한 사진은 양옆(x)', () => {
    expect(fillAxis({ width: 4000, height: 3000 }, PHONE)).toBe('y');
    expect(fillAxis({ width: 500, height: 3000 }, PHONE)).toBe('x');
  });

  it('원본보다 크게 그리면 scale이 1보다 크다 (확대 안내용)', () => {
    expect(computeLayout({ width: 850, height: 1134 }, PHONE, 'contain').scale).toBeGreaterThan(1);
    expect(computeLayout({ width: 4000, height: 3000 }, PHONE, 'contain').scale).toBeLessThan(1);
  });
});

describe('늘이기 (stretch)', () => {
  it('목표 크기 그대로 채운다', () => {
    const { image, movable } = computeLayout({ width: 1000, height: 750 }, PHONE, 'stretch');
    expect(image).toEqual({ x: 0, y: 0, width: 1170, height: 2532 });
    expect(movable).toEqual({ x: false, y: false });
  });

  it('1000x750 → 2000x1500 확대: 결과 크기와 배율 (F1 수용 기준)', () => {
    const { image, scale } = computeLayout(
      { width: 1000, height: 750 },
      { width: 2000, height: 1500 },
      'stretch',
    );
    expect(image).toEqual({ x: 0, y: 0, width: 2000, height: 1500 });
    expect(scale).toBe(2);
  });
});

describe('잘못된 크기', () => {
  it('0이나 음수 크기는 오류', () => {
    expect(() => computeLayout({ width: 0, height: 10 }, PHONE, 'cover')).toThrow(RangeError);
    expect(() =>
      computeLayout({ width: 10, height: 10 }, { width: -1, height: 1 }, 'cover'),
    ).toThrow(RangeError);
  });
});

describe('ratioFit', () => {
  it('세로 사진이어도 화면보다 가로가 넓으면 양옆이 잘린다', () => {
    expect(ratioFit({ width: 850, height: 1134 }, PHONE)).toBe('sides-cropped');
    expect(ratioFit({ width: 1440, height: 1440 }, PHONE)).toBe('sides-cropped');
  });

  it('화면보다 세로로 긴 사진은 위아래가 잘린다', () => {
    expect(ratioFit({ width: 500, height: 3000 }, PHONE)).toBe('top-bottom-cropped');
  });

  it('비율이 거의 같으면 match', () => {
    expect(ratioFit({ width: 1179, height: 2556 }, PHONE)).toBe('match');
  });
});
