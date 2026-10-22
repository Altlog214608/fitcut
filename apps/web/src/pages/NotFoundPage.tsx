import { useEffect } from 'react';
import { Link } from 'react-router';
import { Koi } from '../components/Koi';
import { useT } from '../i18n/context';
import { setNoIndex } from '../seo/pages';
import styles from '../components/ToolPlaceholder.module.css';

export function NotFoundPage() {
  const t = useT().notFound;
  useEffect(() => {
    setNoIndex(document, true);
    return () => setNoIndex(document, false);
  }, []);
  return (
    <div className={styles.page}>
      <Koi mood="surprised" size={72} />
      <h1 className={styles.title}>{t.title}</h1>
      <p className={styles.note}>
        {t.body} <Link to="/">{t.home}</Link>
      </p>
    </div>
  );
}
