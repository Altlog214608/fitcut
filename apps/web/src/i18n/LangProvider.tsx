import { useEffect, useState, type ReactNode } from 'react';
import { initialLang, LangContext, saveLang, type Lang } from './context';

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = (next: Lang) => {
    saveLang(next);
    setLangState(next);
  };
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}
