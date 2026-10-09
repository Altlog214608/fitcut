const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
]);

/**
 * 유튜브 링크에서 영상 ID를 꺼낸다. 영상은 내려받지 않고 ID로 공식 플레이어만 띄운다 (ADR-007).
 * 지원: watch?v=, youtu.be/, shorts/, embed/, live/. 유튜브 링크가 아니거나 ID가 없으면 null.
 */
export function parseYouTubeId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  let candidate: string | null | undefined;

  if (url.hostname === 'youtu.be') {
    candidate = segments[0];
  } else if (segments[0] === 'watch') {
    candidate = url.searchParams.get('v');
  } else if (segments[0] === 'shorts' || segments[0] === 'embed' || segments[0] === 'live') {
    candidate = segments[1];
  }

  return candidate && ID_PATTERN.test(candidate) ? candidate : null;
}
