/** 기기 프리셋 스키마. 규칙은 docs/PRESETS.md를 따른다. */

export type Category = 'phone' | 'foldable' | 'flip' | 'tablet' | 'watch';
export type ScreenRole = 'main' | 'cover' | 'inner';
export type ScreenShape = 'rect' | 'rounded-rect' | 'circle';
export type AnimatedFormat = 'gif' | 'live-photo' | 'none' | 'unknown';

export type Overlay = {
  kind: 'clock' | 'camera' | 'widgets';
  /** 화면 대비 비율 (0~1) */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Screen = {
  role: ScreenRole;
  widthPx: number;
  heightPx: number;
  shape: ScreenShape;
  /** rounded-rect 가이드용 대략값 */
  cornerRadiusRatio?: number;
  /** 잠금화면 시계·카메라 등 대략적인 가이드 (F7) */
  overlays?: Overlay[];
  /** 움짤 배경 형식 */
  animated?: AnimatedFormat;
  notes?: string;
};

export type DevicePreset = {
  id: string;
  brand: string;
  category: Category;
  /** 화면에 보이는 이름 */
  name: string;
  /** 검색어 */
  aliases: string[];
  releaseYear: number;
  /** 폴드·플립은 화면이 여러 개 */
  screens: Screen[];
  /** 제조사 공식 스펙 페이지 URL */
  source: string;
  verified: boolean;
  /** YYYY-MM-DD */
  verifiedAt?: string;
  notes?: string;
};

const CATEGORIES: readonly Category[] = ['phone', 'foldable', 'flip', 'tablet', 'watch'];
const ROLES: readonly ScreenRole[] = ['main', 'cover', 'inner'];
const SHAPES: readonly ScreenShape[] = ['rect', 'rounded-rect', 'circle'];
const ANIMATED: readonly AnimatedFormat[] = ['gif', 'live-photo', 'none', 'unknown'];
const OVERLAY_KINDS: readonly Overlay['kind'][] = ['clock', 'camera', 'widgets'];

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isRatio(value: unknown): boolean {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

function isOneOf<T>(list: readonly T[], value: unknown): value is T {
  return list.includes(value as T);
}

function validateScreen(screen: unknown, path: string): string[] {
  if (!isObj(screen)) return [`${path}: 객체가 아니다`];
  const errors: string[] = [];
  if (!isOneOf(ROLES, screen.role)) errors.push(`${path}.role: ${String(screen.role)}`);
  if (!isPositiveInt(screen.widthPx)) errors.push(`${path}.widthPx: 양의 정수가 아니다`);
  if (!isPositiveInt(screen.heightPx)) errors.push(`${path}.heightPx: 양의 정수가 아니다`);
  if (!isOneOf(SHAPES, screen.shape)) errors.push(`${path}.shape: ${String(screen.shape)}`);
  if (screen.cornerRadiusRatio !== undefined && !isRatio(screen.cornerRadiusRatio)) {
    errors.push(`${path}.cornerRadiusRatio: 0~1이 아니다`);
  }
  if (screen.animated !== undefined && !isOneOf(ANIMATED, screen.animated)) {
    errors.push(`${path}.animated: ${String(screen.animated)}`);
  }
  if (screen.notes !== undefined && typeof screen.notes !== 'string') {
    errors.push(`${path}.notes: 문자열이 아니다`);
  }
  if (screen.overlays !== undefined) {
    if (!Array.isArray(screen.overlays)) {
      errors.push(`${path}.overlays: 배열이 아니다`);
    } else {
      screen.overlays.forEach((overlay: unknown, i) => {
        const p = `${path}.overlays[${i}]`;
        if (!isObj(overlay)) {
          errors.push(`${p}: 객체가 아니다`);
          return;
        }
        if (!isOneOf(OVERLAY_KINDS, overlay.kind))
          errors.push(`${p}.kind: ${String(overlay.kind)}`);
        for (const key of ['x', 'y', 'w', 'h'] as const) {
          if (!isRatio(overlay[key])) errors.push(`${p}.${key}: 0~1이 아니다`);
        }
      });
    }
  }
  return errors;
}

/** 프리셋 하나를 검사해 문제 목록을 돌려준다. 빈 배열이면 통과. */
export function validatePreset(preset: unknown): string[] {
  if (!isObj(preset)) return ['프리셋이 객체가 아니다'];
  const id = typeof preset.id === 'string' ? preset.id : '(id 없음)';
  const errors: string[] = [];
  const at = (field: string) => `${id}.${field}`;

  if (typeof preset.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(preset.id)) {
    errors.push(`${at('id')}: 소문자·숫자·하이픈 형식이 아니다`);
  }
  if (typeof preset.brand !== 'string' || !preset.brand) errors.push(`${at('brand')}: 비어 있다`);
  if (!isOneOf(CATEGORIES, preset.category))
    errors.push(`${at('category')}: ${String(preset.category)}`);
  if (typeof preset.name !== 'string' || !preset.name) errors.push(`${at('name')}: 비어 있다`);
  if (!Array.isArray(preset.aliases) || !preset.aliases.every((a) => typeof a === 'string')) {
    errors.push(`${at('aliases')}: 문자열 배열이 아니다`);
  }
  if (!isPositiveInt(preset.releaseYear) || (preset.releaseYear as number) < 2000) {
    errors.push(`${at('releaseYear')}: 연도가 아니다`);
  }
  if (!Array.isArray(preset.screens) || preset.screens.length === 0) {
    errors.push(`${at('screens')}: 화면이 하나 이상 있어야 한다`);
  } else {
    preset.screens.forEach((screen: unknown, i) => {
      errors.push(...validateScreen(screen, at(`screens[${i}]`)));
    });
    const roles = preset.screens.map((s: unknown) => (isObj(s) ? s.role : undefined));
    if (new Set(roles).size !== roles.length) errors.push(`${at('screens')}: role이 겹친다`);
  }
  if (typeof preset.verified !== 'boolean') errors.push(`${at('verified')}: boolean이 아니다`);
  if (typeof preset.source !== 'string' || (preset.source && !/^https:\/\//.test(preset.source))) {
    errors.push(`${at('source')}: https URL이 아니다`);
  }
  if (preset.verified === true && !preset.source) {
    errors.push(`${at('source')}: verified면 출처가 있어야 한다`);
  }
  if (preset.verified === true && !/^\d{4}-\d{2}-\d{2}$/.test(String(preset.verifiedAt))) {
    errors.push(`${at('verifiedAt')}: verified면 YYYY-MM-DD 확인 날짜가 있어야 한다`);
  }
  return errors;
}

/** 여러 프리셋을 함께 검사한다 (id 중복 포함). */
export function validatePresets(presets: unknown[]): string[] {
  const errors = presets.flatMap((p) => validatePreset(p));
  const seen = new Set<string>();
  for (const p of presets) {
    if (!isObj(p) || typeof p.id !== 'string') continue;
    if (seen.has(p.id)) errors.push(`${p.id}: id가 중복된다`);
    seen.add(p.id);
  }
  return errors;
}
