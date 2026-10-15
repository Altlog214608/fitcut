/**
 * 화면 언어 (한국어·영어). 처음에는 한국어, 머리말의 버튼으로 바꾸면 이 브라우저에 기억한다.
 * 문구는 ko.ts에 모으고 en.ts가 같은 모양을 채운다 (빠진 문구는 타입 검사에서 걸린다).
 */
import { createContext, useContext } from 'react';
import { readJson, writeJson } from '../lib/storage';
import { en } from './en';
import { ko, type Dict } from './ko';

export type Lang = 'ko' | 'en';

const KEY = 'fitcut.lang';
const DICTS: Record<Lang, Dict> = { ko, en };
const isLang = (v: unknown): v is Lang => v === 'ko' || v === 'en';

export function initialLang(): Lang {
  const saved = readJson<Lang | null>(KEY, null, (v): v is Lang | null => v === null || isLang(v));
  // 한국어 서비스라 처음에는 한국어. 영어는 머리말 버튼으로 고르면 기억한다
  return saved ?? 'ko';
}

export function saveLang(lang: Lang) {
  writeJson(KEY, lang);
  document.documentElement.lang = lang;
}

export const LangContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void }>({
  lang: 'ko',
  setLang: () => undefined,
});

export const useLang = () => useContext(LangContext);

/** 지금 언어의 문구 */
export function useT(): Dict {
  return DICTS[useContext(LangContext).lang];
}
