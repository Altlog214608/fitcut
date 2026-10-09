/** 사진을 목표 크기에 어떻게 놓을지 계산하는 순수 함수 (F1). 그리기는 render.ts가 한다. */

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * cover = 꽉 채우기 (잘라서 화면을 채움)
 * contain = 배경 채우기 (사진 전체를 넣고 남는 곳을 배경으로)
 * stretch = 늘이기 (비율 무시)
 */
export type FitMode = 'cover' | 'contain' | 'stretch';

/** -1(왼쪽·위) ~ 0(가운데) ~ 1(오른쪽·아래). 움직일 여유가 있는 방향에만 쓰인다. */
export type Position = { x: number; y: number };

export type Layout = {
  /** 목표 캔버스 위에 사진을 그릴 영역. cover에서는 캔버스 밖으로 나간다. */
  image: Rect;
  /** 배경 채우기에서 배경을 그릴 영역 (같은 사진을 화면에 꽉 차게). 다른 모드는 null */
  background: Rect | null;
  /** 원본 대비 그려지는 배율. 1보다 크면 확대 */
  scale: number;
  /** 사진을 움직일 수 있는 방향 (cover는 잘리는 방향, contain은 남는 방향) */
  movable: { x: boolean; y: boolean };
};

const CENTER: Position = { x: 0, y: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 남는 길이(free)를 position(-1~1)에 따라 나눈 시작 위치 */
function place(free: number, position: number): number {
  return Math.round((free * (clamp(position, -1, 1) + 1)) / 2);
}

/**
 * 사진 시작 위치. 사진이 화면보다 작으면 남는 곳에, 크면 잘리는 만큼 밖으로 놓는다.
 * 어느 쪽이든 -1은 왼쪽·위 끝에, 1은 오른쪽·아래 끝에 붙인다.
 */
function offset(canvas: number, length: number, position: number): number {
  // 0 - n으로 써서 -0이 생기지 않게 한다
  return length <= canvas ? place(canvas - length, position) : 0 - place(length - canvas, position);
}

function assertSize(size: Size, label: string): void {
  if (!(size.width > 0 && size.height > 0)) {
    throw new RangeError(`${label} 크기가 0보다 커야 한다: ${size.width}x${size.height}`);
  }
}

/** 사진 비율을 유지하면서 target을 꽉 채우는 크기와 위치 (가운데 정렬) */
function coverRect(source: Size, target: Size, position: Position): Rect {
  const scale = Math.max(target.width / source.width, target.height / source.height);
  const widthLimited = target.width / source.width >= target.height / source.height;
  const width = widthLimited ? target.width : Math.round(source.width * scale);
  const height = widthLimited ? Math.round(source.height * scale) : target.height;
  return {
    x: offset(target.width, width, position.x),
    y: offset(target.height, height, position.y),
    width,
    height,
  };
}

/** 배경 채우기에서 배경이 생기는 축. 사진이 화면보다 납작하면 위아래(y), 길쭉하면 양옆(x) */
export function fillAxis(source: Size, target: Size): 'x' | 'y' {
  return target.width / source.width <= target.height / source.height ? 'y' : 'x';
}

/**
 * 배경 채우기에서 사진을 키울 수 있는 최대 배율. 이만큼 키우면 꽉 채우기와 같아진다.
 * 1이면 사진 비율이 화면과 같아서 채울 곳이 없다.
 */
export function maxZoom(source: Size, target: Size): number {
  const sx = target.width / source.width;
  const sy = target.height / source.height;
  return Math.max(sx, sy) / Math.min(sx, sy);
}

/**
 * zoom은 배경 채우기에서만 쓴다. 1이면 사진 전체가 들어가고, 키우면 반대쪽(가로로 채울 땐 위아래,
 * 세로로 채울 땐 양옆)이 조금씩 잘리는 대신 채울 곳이 줄어든다.
 */
export function computeLayout(
  source: Size,
  target: Size,
  mode: FitMode,
  position: Position = CENTER,
  zoom = 1,
): Layout {
  assertSize(source, '원본');
  assertSize(target, '목표');

  if (mode === 'stretch') {
    return {
      image: { x: 0, y: 0, width: target.width, height: target.height },
      background: null,
      scale: Math.max(target.width / source.width, target.height / source.height),
      movable: { x: false, y: false },
    };
  }

  if (mode === 'cover') {
    const image = coverRect(source, target, position);
    return {
      image,
      background: null,
      scale: image.width / source.width,
      movable: { x: image.width > target.width, y: image.height > target.height },
    };
  }

  // contain: 한쪽 길이를 목표에 딱 맞추고, 다른 쪽에 남는 공간을 배경으로 채운다
  const widthLimited = fillAxis(source, target) === 'y';
  const k = clamp(zoom, 1, maxZoom(source, target));
  const fit = widthLimited ? target.width / source.width : target.height / source.height;
  const scale = fit * k;
  // 키우지 않았을 때는 맞춘 쪽 길이를 목표와 정확히 같게 둔다 (반올림 오차 방지)
  const width = widthLimited && k === 1 ? target.width : Math.round(source.width * scale);
  const height = !widthLimited && k === 1 ? target.height : Math.round(source.height * scale);
  return {
    image: {
      x: offset(target.width, width, position.x),
      y: offset(target.height, height, position.y),
      width,
      height,
    },
    background: coverRect(source, target, CENTER),
    scale,
    movable: { x: width !== target.width, y: height !== target.height },
  };
}

/** 레이아웃 전체를 k배로 줄이거나 키운다 (미리보기 캔버스용) */
export function scaleLayout(layout: Layout, k: number): Layout {
  const scale = (r: Rect): Rect => ({
    x: r.x * k,
    y: r.y * k,
    width: r.width * k,
    height: r.height * k,
  });
  return {
    ...layout,
    image: scale(layout.image),
    background: layout.background ? scale(layout.background) : null,
  };
}

export type RatioFit = 'match' | 'sides-cropped' | 'top-bottom-cropped';

/**
 * 꽉 채우기를 하면 어디가 잘리는지. 비율 차이가 tolerance(기본 2%) 안이면 match.
 * "이 사진은 화면보다 가로가 넓어서 양옆이 잘려요" 안내에 쓴다.
 */
export function ratioFit(source: Size, target: Size, tolerance = 0.02): RatioFit {
  assertSize(source, '원본');
  assertSize(target, '목표');
  const diff = source.width / source.height / (target.width / target.height) - 1;
  if (Math.abs(diff) <= tolerance) return 'match';
  return diff > 0 ? 'sides-cropped' : 'top-bottom-cropped';
}
