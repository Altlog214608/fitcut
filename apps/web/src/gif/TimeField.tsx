import { Minus, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { formatTime, parseTime } from './time';
import styles from './GifTool.module.css';

type Props = {
  label: string;
  value: number;
  /** 한 프레임 길이(초). −·+ 버튼이 이만큼 옮긴다 */
  step: number;
  onChange: (t: number) => void;
};

/** 시각 직접 입력(분:초.백분의일초)과 한 프레임씩 옮기는 버튼 */
export function TimeField({ label, value, step, onChange }: Props) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseTime(draft) === null;

  function commit() {
    if (draft === null) return;
    const t = parseTime(draft);
    if (t !== null) onChange(t);
    setDraft(null);
  }

  return (
    <div className={styles.timeField}>
      <label htmlFor={id} className={styles.timeLabel}>
        {label}
      </label>
      <div className={styles.timeRow}>
        <button
          type="button"
          className={styles.stepButton}
          aria-label={`${label} 1프레임 앞으로`}
          onClick={() => onChange(value - step)}
        >
          <Minus size={18} strokeWidth={1.75} />
        </button>
        <input
          id={id}
          className={styles.timeInput}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={invalid || undefined}
          value={draft ?? formatTime(value)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(null);
          }}
        />
        <button
          type="button"
          className={styles.stepButton}
          aria-label={`${label} 1프레임 뒤로`}
          onClick={() => onChange(value + step)}
        >
          <Plus size={18} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
