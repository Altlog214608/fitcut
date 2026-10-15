/** 올리기 진행 표시 (움짤·음성·회전 도구가 같이 쓴다) */
import { CircleCheck } from 'lucide-react';
import { formatBytes } from '../gif/estimate';
import styles from '../gif/GifTool.module.css';
import { useT } from '../i18n/context';
import type { UploadView } from './useMediaJob';

type Props = { up: UploadView; onCancel: () => void; onRetry: () => void };

export function UploadStatus({ up, onCancel, onRetry }: Props) {
  const t = useT().media;
  const percent =
    up.state === 'sending' && up.total > 0 ? Math.round((up.sent / up.total) * 100) : 0;
  return (
    <div className={styles.upload} aria-live="polite">
      {up.state === 'starting' && <p className={styles.uploadText}>{t.preparing}</p>}
      {up.state === 'sending' && (
        <>
          <p className={styles.uploadText}>
            {t.uploading} <b className={styles.num}>{percent}%</b>
            <span className={styles.num}>
              {formatBytes(up.sent)} / {formatBytes(up.total)}
            </span>
          </p>
          <button type="button" className={styles.textButton} onClick={onCancel}>
            {t.cancelUpload}
          </button>
          <div
            className={styles.bar}
            role="progressbar"
            aria-label={t.uploadBar}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
        </>
      )}
      {up.state === 'done' && (
        <p className={styles.uploadText}>
          <CircleCheck size={18} strokeWidth={1.75} className={styles.ok} />
          {t.uploaded}
        </p>
      )}
      {up.state === 'failed' && (
        <>
          <p className={styles.uploadError} role="alert">
            {up.message}
          </p>
          <button type="button" className={styles.textButton} onClick={onRetry}>
            {t.retryUpload}
          </button>
        </>
      )}
    </div>
  );
}
