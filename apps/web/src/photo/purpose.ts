/**
 * 사진을 어디에 쓸지 (폰 배경화면, 태블릿, 워치 페이스, PC 바탕화면). 기기 고르기를 용도별로 나눠 보여준다
 * (2026-10-15 사용자 요청: 배경화면·워치·데스크톱 구분을 쉽게).
 */
import type { Category, DevicePreset } from '@fitcut/presets';
import { MONITORS, QUICK_PICK_IDS, type Target } from './target';

export { monitorLabel } from './target';

export type Purpose = 'phone' | 'tablet' | 'watch' | 'pc';

export const PURPOSES: readonly { value: Purpose; label: string }[] = [
  { value: 'phone', label: '폰' },
  { value: 'tablet', label: '태블릿' },
  { value: 'watch', label: '워치' },
  { value: 'pc', label: 'PC' },
];

/** 고른 기기 옆에 보여주는 쓰임새 */
export const PURPOSE_USE: Record<Purpose, string> = {
  phone: '폰 배경화면',
  tablet: '태블릿 배경화면',
  watch: '워치 페이스',
  pc: 'PC 바탕화면',
};

const CATEGORY_PURPOSE: Record<Category, Purpose> = {
  phone: 'phone',
  foldable: 'phone',
  flip: 'phone',
  tablet: 'tablet',
  watch: 'watch',
  laptop: 'pc',
  desktop: 'pc',
};

export const purposeOf = (category: Category): Purpose => CATEGORY_PURPOSE[category];

const LIMIT = 8;

const presetTarget = (p: DevicePreset): Target => ({
  kind: 'preset',
  presetId: p.id,
  role: p.screens[0]?.role ?? 'main',
});

/** 용도 탭에 보여줄 빠른 선택. 폰은 대표 기기 먼저, 나머지는 최신순 */
export function purposeTargets(presets: readonly DevicePreset[], purpose: Purpose): Target[] {
  const mine = presets.filter((p) => purposeOf(p.category) === purpose);
  const newest = [...mine].sort(
    (a, b) => b.releaseYear - a.releaseYear || a.name.localeCompare(b.name),
  );
  const quick = QUICK_PICK_IDS.flatMap((id) => mine.find((p) => p.id === id) ?? []);
  const picked = [...quick, ...newest.filter((p) => !quick.includes(p))].slice(0, LIMIT);
  const targets = picked.map(presetTarget);
  if (purpose !== 'pc') return targets;
  const monitors: Target[] = MONITORS.map(({ width, height }) => ({
    kind: 'custom',
    width,
    height,
  }));
  return [...monitors, ...targets].slice(0, LIMIT);
}
