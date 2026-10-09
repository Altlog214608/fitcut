import { Link, Outlet } from 'react-router';
import styles from './Layout.module.css';

export function Layout() {
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <Link to="/" className={styles.wordmark} aria-label="FitCut 처음으로">
          Fit<span>Cut</span>
        </Link>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
