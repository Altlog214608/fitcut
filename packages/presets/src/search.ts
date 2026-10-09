import type { DevicePreset } from './schema';

/** 공백·하이픈·괄호를 지우고 소문자로 맞춘다. "아이폰 17 프로" = "아이폰17프로" */
export function normalizeQuery(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_()·.]/g, '');
}

function scoreOf(preset: DevicePreset, query: string, tokens: string[]): number {
  const haystacks = [preset.name, ...preset.aliases].map(normalizeQuery);
  if (haystacks.some((h) => h === query)) return 3;
  if (haystacks.some((h) => h.startsWith(query))) return 2;
  if (haystacks.some((h) => h.includes(query))) return 1;
  if (tokens.length > 1 && haystacks.some((h) => tokens.every((t) => h.includes(t)))) return 0.5;
  return 0;
}

/**
 * 기기 이름·별칭으로 프리셋을 찾는다. "16 프로", "플립8", "워치9" 같은 입력을 받는다.
 * 정확히 같은 별칭 > 앞부분 일치 > 포함 > 낱말 모두 포함 순서이고, 같으면 최신 기기가 먼저다.
 */
export function searchPresets(
  presets: readonly DevicePreset[],
  query: string,
  limit = 20,
): DevicePreset[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];
  const tokens = query.split(/\s+/).map(normalizeQuery).filter(Boolean);

  return presets
    .map((preset) => ({ preset, score: scoreOf(preset, normalized, tokens) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.preset.releaseYear - a.preset.releaseYear ||
        a.preset.name.localeCompare(b.preset.name),
    )
    .slice(0, limit)
    .map(({ preset }) => preset);
}
