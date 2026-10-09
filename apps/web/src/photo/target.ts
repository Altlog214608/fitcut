import type { DevicePreset, ScreenRole, ScreenShape } from '@fitcut/presets';
import type { Size } from './layout';

/** 사진을 맞출 대상: 기기 프리셋의 화면 하나, 또는 직접 입력한 크기 */
export type Target =
  | { kind: 'preset'; presetId: string; role: ScreenRole }
  | { kind: 'custom'; width: number; height: number };

export type ResolvedTarget = {
  size: Size;
  shape: ScreenShape;
  cornerRadiusRatio: number | null;
  /** 파일 이름·화면에 쓰는 이름 */
  label: string | null;
  preset: DevicePreset | null;
};

export const MAX_CUSTOM_SIDE = 8000;

export const ROLE_LABELS: Record<ScreenRole, string> = {
  main: '메인 화면',
  cover: '커버 화면',
  inner: '안쪽 화면',
};

export function resolveTarget(
  target: Target,
  presets: readonly DevicePreset[],
): ResolvedTarget | null {
  if (target.kind === 'custom') {
    const ok = (n: number) => Number.isInteger(n) && n > 0 && n <= MAX_CUSTOM_SIDE;
    if (!ok(target.width) || !ok(target.height)) return null;
    return {
      size: { width: target.width, height: target.height },
      shape: 'rect',
      cornerRadiusRatio: null,
      label: null,
      preset: null,
    };
  }
  const preset = presets.find((p) => p.id === target.presetId);
  const screen = preset?.screens.find((s) => s.role === target.role) ?? preset?.screens[0];
  if (!preset || !screen) return null;
  const roleSuffix = preset.screens.length > 1 ? ` ${ROLE_LABELS[screen.role]}` : '';
  return {
    size: { width: screen.widthPx, height: screen.heightPx },
    shape: screen.shape,
    cornerRadiusRatio: screen.cornerRadiusRatio ?? null,
    label: `${preset.name}${roleSuffix}`,
    preset,
  };
}

export function sameTarget(a: Target, b: Target): boolean {
  if (a.kind === 'preset' && b.kind === 'preset') {
    return a.presetId === b.presetId && a.role === b.role;
  }
  if (a.kind === 'custom' && b.kind === 'custom') {
    return a.width === b.width && a.height === b.height;
  }
  return false;
}

/** 최근 사용한 대상을 맨 앞에 넣고, 같은 것은 빼고, 최대 limit개만 남긴다 */
export function pushRecent(list: readonly Target[], target: Target, limit = 6): Target[] {
  return [target, ...list.filter((t) => !sameTarget(t, target))].slice(0, limit);
}

export function isTarget(value: unknown): value is Target {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'preset') return typeof v.presetId === 'string' && typeof v.role === 'string';
  if (v.kind === 'custom') return typeof v.width === 'number' && typeof v.height === 'number';
  return false;
}

export function isTargetList(value: unknown): value is Target[] {
  return Array.isArray(value) && value.every(isTarget);
}

/**
 * 처음 쓰는 사람에게 보여줄 빠른 선택. 이름순으로 고르면 대표 기기가 아닌 것이 뽑혀서 직접 정한다.
 * 프리셋 데이터가 바뀌어 없는 id는 건너뛴다.
 */
export const QUICK_PICK_IDS = [
  'apple-iphone-17-pro',
  'apple-iphone-17',
  'samsung-galaxy-s26-ultra',
  'samsung-galaxy-s26',
  'samsung-galaxy-z-flip8',
  'apple-watch-series-11-46mm',
  'samsung-galaxy-watch9-44mm',
];

export function quickPicks(presets: readonly DevicePreset[]): DevicePreset[] {
  return QUICK_PICK_IDS.flatMap((id) => presets.find((p) => p.id === id) ?? []);
}
