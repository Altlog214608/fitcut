/**
 * 작업 파일 30일 보관 동의 (F16, ADR-009). 기본 꺼짐, 목적과 기간을 함께 보여준다.
 * 동의하지 않으면 올린 파일과 결과는 1~2일 안에 지워진다.
 */
import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import styles from './RetainConsent.module.css';

type Props = { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean };

export function RetainConsent({ checked, onChange, disabled = false }: Props) {
  return (
    <div className={styles.box}>
      <p className={styles.trust}>
        <ShieldCheck size={18} strokeWidth={1.75} />
        {checked
          ? '원본과 결과를 30일 동안 보관해요'
          : '올린 파일은 보통 1~2일 안에 자동으로 삭제돼요'}
      </p>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
        작업 파일을 30일 동안 보관하기 (선택)
      </label>
      {checked && (
        <p className={styles.note}>
          원본 파일과 만든 결과를 30일 동안 보관하고, 서비스 품질을 살피는 데만 써요. 관리자가 볼 수
          있고, 볼 때마다 기록이 남아요. <Link to="/my-jobs">내 작업 기록</Link>에서 언제든 지울 수
          있어요.
        </p>
      )}
    </div>
  );
}
