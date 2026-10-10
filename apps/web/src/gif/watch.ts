/**
 * 워치용 출력 (FEATURES F3 "워치용 움짤"). 기기 프리셋에서 워치 화면 크기와 움직이는 형식을 가져온다.
 * - 갤럭시 워치: 화면 크기의 GIF (animated: gif)
 * - 애플워치: 사진 페이스는 Live Photo만 움직인다 (animated: live-photo). 1차로 화면 크기의 짧은 MP4를 만든다
 */
import type { JobKind } from '@fitcut/shared';
import { VISIBLE_PRESETS, type DevicePreset, type ScreenShape } from '@fitcut/presets';
import type { Size } from './estimate';

export type WatchTarget = {
  id: string;
  name: string;
  width: number;
  height: number;
  shape: ScreenShape;
  kind: JobKind;
  /** 애플워치처럼 Live Photo로 바꿔야 움직이는 기기 */
  livePhoto: boolean;
};

export function watchTargets(presets: readonly DevicePreset[]): WatchTarget[] {
  const out: WatchTarget[] = [];
  for (const p of presets) {
    if (p.category !== 'watch') continue;
    const screen = p.screens.find((s) => s.role === 'main') ?? p.screens[0];
    if (!screen || (screen.animated !== 'gif' && screen.animated !== 'live-photo')) continue;
    out.push({
      id: p.id,
      name: p.name,
      width: screen.widthPx,
      height: screen.heightPx,
      shape: screen.shape,
      kind: screen.animated === 'gif' ? 'gif' : 'mp4',
      livePhoto: screen.animated === 'live-photo',
    });
  }
  // 브랜드끼리, 최신 기기가 위로
  const year = new Map(presets.map((p) => [p.id, p.releaseYear]));
  const brand = new Map(presets.map((p) => [p.id, p.brand]));
  return out.sort(
    (a, b) =>
      (brand.get(b.id) ?? '').localeCompare(brand.get(a.id) ?? '') ||
      (year.get(b.id) ?? 0) - (year.get(a.id) ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

export const WATCHES = watchTargets(VISIBLE_PRESETS);

/**
 * 결과 크기에 꽉 차게 맞추고 가운데를 자를 때 원본에서 남는 영역 (0~1 비율).
 * 워커의 scale=W:H:force_original_aspect_ratio=increase,crop=W:H 와 같다.
 */
export function centerCrop(video: Size, out: Size) {
  const scale = Math.max(out.width / video.width, out.height / video.height);
  const width = out.width / scale / video.width;
  const height = out.height / scale / video.height;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}
