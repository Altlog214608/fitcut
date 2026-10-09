export type OutputFormat = 'jpeg' | 'png' | 'webp';

export const EXTENSIONS: Record<OutputFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

/**
 * 저장 파일 이름: 원본이름_기기또는크기_가로x세로.확장자 (F1).
 * 파일 이름은 이 기기 안에서만 쓰고 서버로 보내지 않는다.
 */
export function outputFileName(
  originalName: string,
  label: string | null,
  size: { width: number; height: number },
  format: OutputFormat,
): string {
  const dot = originalName.lastIndexOf('.');
  const base = (dot >= 0 ? originalName.slice(0, dot) : originalName).trim() || 'photo';
  const safe = (text: string) =>
    text
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60);
  const parts = [safe(base), label ? safe(label) : null, `${size.width}x${size.height}`];
  return `${parts.filter(Boolean).join('_')}.${EXTENSIONS[format]}`;
}
