import styles from './FitIllustration.module.css';

/** 드롭 영역의 그림: 사진 한 장이 원형 워치와 폰 모양으로 맞춰지는 장면 (docs/UI.md). */
export function FitIllustration() {
  return (
    <svg className={styles.art} viewBox="0 0 240 120" aria-hidden="true" focusable="false">
      <rect x="24" y="24" width="16" height="14" rx="4" className={styles.band} />
      <rect x="24" y="82" width="16" height="14" rx="4" className={styles.band} />
      <circle cx="32" cy="60" r="22" className={styles.device} />
      <path d="M16 70 L26 58 L33 65 L40 56 L48 70 Z" className={styles.mountain} />
      <path d="M60 60 H72" className={styles.dots} />
      <rect x="78" y="20" width="96" height="72" rx="10" className={styles.photo} />
      <path d="M90 92 L110 62 L124 74 L140 56 L162 92 Z" className={styles.mountain} />
      <circle cx="152" cy="38" r="7" className={styles.sun} />
      <path
        d="M104 20 V10 H114 M138 10 H148 V20 M104 92 V102 H114 M138 102 H148 V92"
        className={styles.crop}
      />
      <path d="M180 60 H192" className={styles.dots} />
      <rect x="198" y="24" width="34" height="72" rx="8" className={styles.device} />
      <path d="M202 88 L210 74 L216 81 L222 72 L228 88 Z" className={styles.mountain} />
      <rect x="210" y="29" width="10" height="3" rx="1.5" className={styles.camera} />
    </svg>
  );
}
