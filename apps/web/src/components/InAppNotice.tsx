import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { useT } from '../i18n/context';
import { kakaoOpenExternal, type InApp } from '../lib/inApp';
import styles from './InAppNotice.module.css';

/**
 * 인앱 브라우저(카카오톡 등)에서 열렸을 때 맨 위에 띄우는 안내.
 * 사진을 고르기 전에 다른 브라우저로 옮기게 해서, 다 만든 뒤 저장이 안 되는 일을 막는다.
 */
export function InAppNotice({ inApp }: { inApp: InApp | null }) {
  const location = useLocation();
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');
  const t = useT().inApp;
  if (!inApp) return null;

  const url = `${window.location.origin}${location.pathname}${location.search}`;
  const kakao = inApp.app === 'kakaotalk';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopy('done');
    } catch {
      setCopy('failed');
    }
  }

  return (
    <aside className={styles.notice} aria-label={t.region}>
      <p className={styles.text}>
        <b>{t.lead(t.app(inApp.app === 'kakaotalk' ? 'kakaotalk' : 'other'))}</b> {t.rest}
      </p>
      <div className={styles.actions}>
        {kakao && (
          <a className={styles.primary} href={kakaoOpenExternal(url)}>
            <ExternalLink size={16} strokeWidth={2} />
            {t.openExternal}
          </a>
        )}
        <button type="button" className={styles.secondary} onClick={() => void copyLink()}>
          {copy === 'done' ? t.copied : t.copy}
        </button>
      </div>
      {copy === 'failed' && (
        <input
          className={styles.url}
          readOnly
          value={url}
          aria-label={t.urlLabel}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      {kakao && <p className={styles.help}>{t.kakaoHelp}</p>}
    </aside>
  );
}
