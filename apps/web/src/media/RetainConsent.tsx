/**
 * 작업 파일 30일 보관 동의 (F16, ADR-009). 기본 꺼짐, 목적과 기간을 함께 보여준다.
 * 동의하지 않으면 올린 파일과 결과는 1~2일 안에 지워진다.
 */
import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { useT } from '../i18n/context';
import styles from './RetainConsent.module.css';

type Props = { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean };

export function RetainConsent({ checked, onChange, disabled = false }: Props) {
  const t = useT().retain;
  return (
    <div className={styles.box}>
      <p className={styles.trust}>
        <ShieldCheck size={18} strokeWidth={1.75} />
        {checked ? t.on : t.off}
      </p>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
        {t.label}
      </label>
      {checked && (
        <p className={styles.note}>
          {t.note} {t.myJobsBefore}
          <Link to="/my-jobs">{t.myJobsLink}</Link>
          {t.myJobsAfter}
        </p>
      )}
    </div>
  );
}
