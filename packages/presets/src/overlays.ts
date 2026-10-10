/**
 * 잠금화면 가이드 (FEATURES F7). 시계·카메라·위젯이 놓이는 대략적인 자리.
 * 기기 프리셋에 `overlays`가 있으면 그것을, 없으면 OS별 공통 틀을 쓴다.
 *
 * TODO(verify): 아래 공통 틀은 공식 수치가 없어 잠금화면 모양을 보고 잡은 대략값이다.
 * 실제 기기 잠금화면 캡처로 맞춰야 한다 (docs/PRESETS.md). 화면에는 항상 "대략적인 위치"라고 쓴다.
 * OS 버전·시계 스타일·사용자 설정에 따라 달라진다.
 */
import type { DevicePreset, Overlay, ScreenRole } from './schema';

type Template = 'ios' | 'one-ui' | 'pixel';

const TEMPLATES: Record<Template, Overlay[]> = {
  // iPhone: 위 가운데 카메라(다이내믹 아일랜드), 날짜와 큰 시계, 그 아래 위젯 줄
  ios: [
    { kind: 'camera', x: 0.34, y: 0.012, w: 0.32, h: 0.042 },
    { kind: 'clock', x: 0.1, y: 0.085, w: 0.8, h: 0.17 },
    { kind: 'widgets', x: 0.1, y: 0.265, w: 0.8, h: 0.075 },
  ],
  // 갤럭시(One UI): 위 가운데 펀치홀 카메라, 시계, 그 아래 위젯·알림 자리
  'one-ui': [
    { kind: 'camera', x: 0.455, y: 0.012, w: 0.09, h: 0.04 },
    { kind: 'clock', x: 0.1, y: 0.1, w: 0.8, h: 0.16 },
    { kind: 'widgets', x: 0.1, y: 0.27, w: 0.8, h: 0.07 },
  ],
  // 픽셀: 위 가운데 펀치홀 카메라, 큰 시계
  pixel: [
    { kind: 'camera', x: 0.455, y: 0.012, w: 0.09, h: 0.04 },
    { kind: 'clock', x: 0.08, y: 0.1, w: 0.84, h: 0.2 },
  ],
};

function templateFor(preset: DevicePreset, role: ScreenRole): Template | null {
  // 폴더블·플립·태블릿·워치는 화면마다 카메라·시계 자리가 달라 공통 틀을 쓰지 않는다
  if (preset.category !== 'phone' || role !== 'main') return null;
  if (preset.brand === 'Apple') return 'ios';
  if (preset.brand === 'Samsung') return 'one-ui';
  if (preset.brand === 'Google') return 'pixel';
  return null;
}

export type OverlayGuide = { overlays: Overlay[]; source: 'device' | 'template' };

/** 이 화면의 잠금화면 가이드. 없으면 null (가이드 버튼을 보이지 않는다) */
export function overlaysFor(preset: DevicePreset, role: ScreenRole): OverlayGuide | null {
  const screen = preset.screens.find((s) => s.role === role) ?? preset.screens[0];
  if (screen?.overlays && screen.overlays.length > 0) {
    return { overlays: screen.overlays, source: 'device' };
  }
  const template = screen ? templateFor(preset, screen.role) : null;
  return template ? { overlays: TEMPLATES[template], source: 'template' } : null;
}
