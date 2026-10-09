export type FileKind =
  { kind: 'image' | 'video' | 'audio' } | { kind: 'unsupported'; reason: 'heic' | 'unknown' };

type FileLike = Pick<File, 'name' | 'type'>;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
]);
const HEIC_TYPES = new Set(['image/heic', 'image/heif']);

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm']);
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'wav']);
const HEIC_EXTS = new Set(['heic', 'heif']);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * 드롭하거나 고른 파일을 어느 도구로 열지 정한다.
 * 브라우저·OS에 따라 MIME 타입이 비어 있을 수 있어(예: Windows의 .mov) 확장자로 한 번 더 본다.
 * 실제 형식 검증은 처리 단계에서 한다 (사진은 디코딩, 영상은 서버의 ffprobe).
 */
export function detectKind(file: FileLike): FileKind {
  const type = file.type.toLowerCase();
  const ext = extensionOf(file.name);

  if (HEIC_TYPES.has(type) || HEIC_EXTS.has(ext)) return { kind: 'unsupported', reason: 'heic' };
  if (IMAGE_TYPES.has(type) || (type === '' && IMAGE_EXTS.has(ext))) return { kind: 'image' };
  if (VIDEO_TYPES.has(type) || VIDEO_EXTS.has(ext)) return { kind: 'video' };
  if (AUDIO_TYPES.has(type) || AUDIO_EXTS.has(ext)) return { kind: 'audio' };
  if (IMAGE_EXTS.has(ext)) return { kind: 'image' };
  return { kind: 'unsupported', reason: 'unknown' };
}
