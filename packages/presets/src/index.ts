import type { DevicePreset } from './schema';

export type {
  AnimatedFormat,
  Category,
  DevicePreset,
  Overlay,
  Screen,
  ScreenRole,
  ScreenShape,
} from './schema';
export { validatePreset, validatePresets } from './schema';
export { normalizeQuery, searchPresets } from './search';
export { overlaysFor, type OverlayGuide } from './overlays';

// 프리셋은 코드가 아니라 데이터다. data/에 JSON을 추가하면 자동으로 들어온다 (docs/PRESETS.md).
// 스키마 검사는 테스트에서 한다 (presets.test.ts).
const modules = import.meta.glob<DevicePreset>('../data/*.json', {
  eager: true,
  import: 'default',
});

/** 확인되지 않은 것까지 포함한 전체 프리셋 */
export const ALL_PRESETS: readonly DevicePreset[] = Object.values(modules);

/** 사용자에게 보여주는 프리셋 (verified만) */
export const VISIBLE_PRESETS: readonly DevicePreset[] = ALL_PRESETS.filter((p) => p.verified);
