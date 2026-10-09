/**
 * localStorage 읽기·쓰기. 사생활 보호 모드나 저장 공간이 막힌 브라우저에서는 조용히 기본값을 쓴다.
 * 로그인 없이 이 브라우저에만 저장한다 (F2 "최근 기기", "내 기기").
 */
export function readJson<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장할 수 없으면 이번 방문 동안만 쓴다
  }
}
