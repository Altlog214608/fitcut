/**
 * 여러 기기 한 번에 저장 (FEATURES F8). 순수 함수: 기기별 위치를 기억할 키, 파일 이름 겹침 정리, ZIP 묶기.
 */
import { zipSync } from 'fflate';
import type { Target } from './target';

/** 기기(또는 직접 입력한 크기)마다 사진 위치·크기를 따로 기억할 때 쓰는 키 */
export function targetKey(t: Target): string {
  return t.kind === 'preset' ? `p:${t.presetId}:${t.role}` : `c:${t.width}x${t.height}`;
}

/** 같은 이름이 있으면 뒤에 -2, -3을 붙인다 (ZIP 안에서 덮어쓰지 않게) */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)}-${count}${name.slice(dot)}` : `${name}-${count}`;
  });
}

/**
 * 파일들을 ZIP 하나로. 사진은 이미 압축되어 있어 다시 압축하지 않는다 (level 0, 빠르다).
 */
export function zipFiles(files: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) entries[f.name] = [f.data, { level: 0 }];
  return zipSync(entries);
}

/** ZIP 파일 이름: 원본이름_기기3개.zip */
export function zipName(originalName: string, count: number): string {
  const dot = originalName.lastIndexOf('.');
  const base = (dot >= 0 ? originalName.slice(0, dot) : originalName)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${base || 'photo'}_기기${count}개.zip`;
}
