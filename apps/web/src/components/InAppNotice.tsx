import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { inAppLabel, kakaoOpenExternal, type InApp } from '../lib/inApp';
import styles from './InAppNotice.module.css';

/**
 * 인앱 브라우저(카카오톡 등)에서 열렸을 때 맨 위에 띄우는 안내.
 * 사진을 고르기 전에 다른 브라우저로 옮기게 해서, 다 만든 뒤 저장이 안 되는 일을 막는다.
 */
export function InAppNotice({ inApp }: { inApp: InApp | null }) {
  const location = useLocation();
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');
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
    <aside className={styles.notice} aria-label="다른 브라우저로 열기 안내">
      <p className={styles.text}>
        <b>{inAppLabel(inApp.app)} 안에서는 사진 저장이 안 될 수 있어요.</b> 크롬이나 사파리에서
        열면 저장할 수 있어요.
      </p>
      <div className={styles.actions}>
        {kakao && (
          <a className={styles.primary} href={kakaoOpenExternal(url)}>
            <ExternalLink size={16} strokeWidth={2} />
            다른 브라우저로 열기
          </a>
        )}
        <button type="button" className={styles.secondary} onClick={() => void copyLink()}>
          {copy === 'done' ? '링크를 복사했어요' : '링크 복사'}
        </button>
      </div>
      {copy === 'failed' && (
        <input
          className={styles.url}
          readOnly
          value={url}
          aria-label="이 페이지 주소"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      {kakao && (
        <p className={styles.help}>
          버튼이 안 되면 카카오톡 화면의 메뉴에서 &lsquo;다른 브라우저로 열기&rsquo;를 눌러 주세요.
        </p>
      )}
    </aside>
  );
}
