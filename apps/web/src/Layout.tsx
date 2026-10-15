import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { InAppNotice } from './components/InAppNotice';
import { startSession, toolOf, track } from './lib/analytics';
import { IN_APP } from './lib/inApp';
import { currentTheme, setTheme, type Theme } from './lib/theme';
import styles from './Layout.module.css';

export function Layout() {
  const { pathname } = useLocation();
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };
  useEffect(() => startSession(IN_APP !== null), []);
  useEffect(() => {
    const tool = toolOf(pathname);
    if (tool) track('tool_open', { tool });
  }, [pathname]);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <Link to="/" className={styles.wordmark} aria-label="FitCut 처음으로">
          Fit<span>Cut</span>
        </Link>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}
            title={theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}
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
        <Link to="/my-jobs">내 작업 기록</Link>
        <Link to="/privacy">개인정보 처리방침</Link>
      </footer>
    </div>
  );
}
