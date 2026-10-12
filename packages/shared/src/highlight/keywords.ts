/**
 * 반응 키워드 사전 (docs/HIGHLIGHT.md 분석 1단계). 채팅 한 줄에 하나라도 맞으면 "반응 채팅"으로 센다.
 * 바꾸면 KEYWORDS_VERSION을 올린다 (분석 결과에 버전이 남아 튜닝 기록과 맞춰 본다).
 */
export const KEYWORDS_VERSION = 1;

export const KEYWORDS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'ㅋㅋ', pattern: /ㅋ{2,}/ },
  { name: 'ㅎㅎ', pattern: /ㅎ{3,}/ },
  { name: 'ㄷㄷ', pattern: /ㄷ{2,}/ },
  { name: 'ㅠㅠ', pattern: /[ㅠㅜ]{2,}/ },
  { name: '와', pattern: /와{2,}|^와[와아]*[!~?]*$/ },
  { name: '미쳤', pattern: /미쳤|미친/ },
  { name: '대박', pattern: /대박/ },
  { name: '헐', pattern: /^헐|헐{2,}/ },
  { name: '클립', pattern: /클립|clip/i },
  { name: 'lol', pattern: /\blo+l\b|\blmao\b/i },
  { name: 'www', pattern: /^w{3,}$|ｗ{3,}/i },
  { name: '??', pattern: /\?{3,}/ },
  { name: '!!', pattern: /!{3,}/ },
];

export function isReaction(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  return KEYWORDS.some((k) => k.pattern.test(t));
}
