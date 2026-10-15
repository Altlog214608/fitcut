/**
 * 화면 테마. 처음에는 기기 설정(prefers-color-scheme)을 따르고, 사용자가 바꾸면 이 브라우저에 기억한다.
 * 그리기 전에 적용하는 코드는 index.html에 있다 (같은 키).
 */
import { readJson, writeJson } from './storage';

export type Theme = 'light' | 'dark';

const KEY = 'fitcut.theme';
const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark';

/** 저장한 테마, 없으면 기기 설정 */
export function currentTheme(): Theme {
  const saved = readJson<Theme | null>(
    KEY,
    null,
    (v): v is Theme | null => v === null || isTheme(v),
  );
  if (saved) return saved;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  writeJson(KEY, theme);
}
