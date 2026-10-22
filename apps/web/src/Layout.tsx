import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { InAppNotice } from './components/InAppNotice';
import { Koi } from './components/Koi';
import { startSession, toolOf, track } from './lib/analytics';
import { IN_APP } from './lib/inApp';
import { currentTheme, setTheme, type Theme } from './lib/theme';
import { applyHead } from './seo/pages';
import { useLang, useT } from './i18n/context';
import styles from './Layout.module.css';

export function Layout() {
  const { pathname } = useLocation();
  const t = useT();
  const { lang, setLang } = useLang();
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };
  useEffect(() => startSession(IN_APP !== null), []);
  useEffect(() => applyHead(document, pathname), [pathname]);
  useEffect(() => {
    const tool = toolOf(pathname);
    if (tool) track('tool_open', { tool });
  }, [pathname]);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <Link to="/" className={styles.wordmark} aria-label={t.layout.home}>
          <Koi size={28} />
          <span>
            Koi<span>Cut</span>
          </span>
        </Link>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
            aria-label={t.layout.toOtherLang}
            title={t.layout.toOtherLang}
            lang={lang === 'ko' ? 'en' : 'ko'}
          >
            {t.layout.langButton}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t.layout.toLight : t.layout.toDark}
            title={theme === 'dark' ? t.layout.toLight : t.layout.toDark}
          >
            {theme === 'dark' ? <Sun size={20} aria-hidden /> : <Moon size={20} aria-hidden />}
          </button>
        </div>
      </header>
      <InAppNotice inApp={IN_APP} />
      <main className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <Link to="/my-jobs">{t.layout.myJobs}</Link>
        <Link to="/privacy">{t.layout.privacy}</Link>
      </footer>
    </div>
  );
}
