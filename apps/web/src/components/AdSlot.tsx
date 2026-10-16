import { useEffect } from 'react';
import { useT } from '../i18n/context';
import { AD_CLIENT, AD_SLOTS, requestAd, type AdPlace } from '../lib/ads';
import styles from './AdSlot.module.css';

type Props = { place: AdPlace; slots?: Record<AdPlace, string> };

/** 광고 자리 (ADR-052). 높이를 미리 잡아 광고가 늦게 떠도 화면이 밀리지 않게 한다 */
export function AdSlot({ place, slots = AD_SLOTS }: Props) {
  const t = useT().layout;
  const slot = slots[place];
  useEffect(() => {
    if (slot) requestAd();
  }, [slot]);
  if (!slot) return null;
  return (
    <aside className={styles.ad} aria-label={t.ad}>
      <span className={styles.label}>{t.ad}</span>
      <ins
        className={`adsbygoogle ${styles.unit}`}
        data-ad-client={AD_CLIENT}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
