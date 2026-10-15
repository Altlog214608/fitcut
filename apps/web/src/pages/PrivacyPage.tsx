/**
 * 개인정보 처리방침 (docs/ADMIN.md 개인정보). 수집 항목·목적·보관 기간·파기 방법·문의처.
 * 값을 바꾸면 인프라(수명 주기·TTL)와 docs/ADMIN.md "무엇을 저장하나" 표도 같이 맞춘다.
 * 문구는 i18n 사전 privacy (영어는 번역본이고 한국어가 우선한다).
 */
import { Link } from 'react-router';
import { useT } from '../i18n/context';
import styles from './PrivacyPage.module.css';

const REPO_ISSUES = 'https://github.com/Altlog214608/fitcut/issues';

export function PrivacyPage() {
  const t = useT().privacy;
  return (
    <article className={styles.page}>
      <h1 className={styles.title}>{t.title}</h1>
      <p className={styles.summary}>{t.summary}</p>

      <section className={styles.section}>
        <h2>{t.notSentTitle}</h2>
        <ul>
          {t.notSent.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2>{t.storedTitle}</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {t.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.stored.map(([item, purpose, period]) => (
                <tr key={item}>
                  <td>{item}</td>
                  <td>{purpose}</td>
                  <td className={styles.period}>{period}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>{t.storedNote}</p>
      </section>

      <section className={styles.section}>
        <h2>{t.deleteTitle}</h2>
        <ul>
          <li>{t.deleteAuto}</li>
          <li>
            {t.deleteRetainedBefore}
            <Link to="/my-jobs">{t.deleteRetainedLink}</Link>
            {t.deleteRetainedAfter}
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>{t.localTitle}</h2>
        <p>{t.local}</p>
      </section>

      <section className={styles.section}>
        <h2>{t.externalTitle}</h2>
        <ul>
          {t.external.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2>{t.contactTitle}</h2>
        <p>
          {t.contactBefore}
          <a href={REPO_ISSUES} target="_blank" rel="noreferrer">
            {t.contactLink}
          </a>
          {t.contactAfter}
        </p>
      </section>

      <p className={styles.note}>{t.effective}</p>
      {t.translationNote && <p className={styles.note}>{t.translationNote}</p>}
    </article>
  );
}
