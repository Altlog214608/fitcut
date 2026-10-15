import { Link } from 'react-router';
import { useT } from '../i18n/context';
import styles from '../components/ToolPlaceholder.module.css';

export function NotFoundPage() {
  const t = useT().notFound;
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t.title}</h1>
      <p className={styles.note}>
        {t.body} <Link to="/">{t.home}</Link>
      </p>
    </div>
  );
}
