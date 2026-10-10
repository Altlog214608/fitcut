/**
 * 결과 크기와 예상 용량 (순수 함수).
 * 크기는 워커(services/worker/src/ffmpeg.ts)와 같게 계산한다: 원본보다 키우지 않고, 세로는 비율대로 짝수.
 */
import type { JobKind } from '@fitcut/shared';

export type Size = { width: number; height: number };

/** ffmpeg scale='min(W,iw)':-2 와 같은 결과 */
export function outputSize(requestedWidth: number, video: Size): Size {
  const width = Math.min(requestedWidth, video.width);
  const height = Math.max(2, Math.round((video.height * width) / video.width / 2) * 2);
  return { width, height };
}

/**
 * 픽셀 하나·장면 하나에 드는 바이트. 2026-10-10 실제 워커로 만든 결과에서 잡았다 (ADR-032 결과):
 * GIF 0.085~0.112, WebP 0.045, MP4 0.007~0.010.
 * 시험 영상(testsrc2)이라 실제 영상과 다를 수 있다. TODO(verify): 실제 사용 결과로 다시 맞춘다 (F3 수용 기준 ±30%)
 */
const BYTES_PER_PIXEL_FRAME: Partial<Record<JobKind, number>> = {
  gif: 0.1,
  webp: 0.045,
  mp4: 0.009,
};

export function estimateBytes(kind: JobKind, size: Size, fps: number, seconds: number): number {
  const frames = Math.max(1, Math.round(fps * seconds));
  return Math.round(size.width * size.height * frames * (BYTES_PER_PIXEL_FRAME[kind] ?? 0));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 음성 예상 용량: 비트레이트 × 길이 (WAV는 44.1kHz 16비트 PCM) */
export function estimateAudioBytes(
  kind: JobKind,
  seconds: number,
  kbps: number,
  channels: number,
): number {
  if (kind === 'wav') return Math.round(seconds * 44100 * 2 * channels) + 44;
  return Math.round((seconds * kbps * 1000) / 8);
}
