import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { InAppNotice } from './components/InAppNotice';
import { startSession, toolOf, track } from './lib/analytics';
import { IN_APP } from './lib/inApp';
import styles from './Layout.module.css';

export function Layout() {
  const { pathname } = useLocation();
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
      </header>
      <InAppNotice inApp={IN_APP} />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
