/**
 * 타임라인 썸네일 스트립. 보이지 않는 video를 따로 만들어 시각마다 찾아가며 그린다 (FEATURES F4).
 * 실패해도 도구는 쓸 수 있어야 하므로 그리지 못한 칸은 비워 둔다.
 */

function once(target: EventTarget, type: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      target.removeEventListener(type, done);
      target.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      target.removeEventListener(type, done);
      reject(new Error('video error'));
    };
    target.addEventListener(type, done, { once: true });
    target.addEventListener('error', fail, { once: true });
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

/** 썸네일을 놓을 시각: 칸마다 가운데 */
export function thumbnailTimes(duration: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => ((i + 0.5) * duration) / count);
}

export async function extractThumbnails(
  src: string,
  duration: number,
  count: number,
  height: number,
  signal: AbortSignal,
  onThumb: (index: number, url: string) => void,
): Promise<void> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = src;
  try {
    await once(video, 'loadeddata', signal);
    // iOS Safari는 한 번 재생하기 전에는 찾아간 장면을 그리지 않을 때가 있다
    await video
      .play()
      .then(() => video.pause())
      .catch(() => undefined);
    const width = Math.max(1, Math.round((video.videoWidth / video.videoHeight) * height));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const times = thumbnailTimes(duration, count);
    for (const [index, t] of times.entries()) {
      if (signal.aborted) return;
      video.currentTime = t;
      await once(video, 'seeked', signal);
      ctx.drawImage(video, 0, 0, width, height);
      onThumb(index, canvas.toDataURL('image/jpeg', 0.7));
    }
  } catch {
    // 썸네일은 꾸밈이다. 못 그려도 구간은 고를 수 있다
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
