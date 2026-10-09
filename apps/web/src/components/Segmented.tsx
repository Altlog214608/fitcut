import { useId } from 'react';
import styles from './Segmented.module.css';

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  /** 선택지가 많을 때 여러 줄로 감싼다 */
  wrap?: boolean;
};

/** 몇 가지 중 하나를 고르는 버튼 묶음 (맞춤 방식, 형식 등) */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  wrap = false,
}: Props<T>) {
  const id = useId();
  return (
    <div className={styles.group}>
      <span id={id} className={styles.label}>
        {label}
      </span>
      <div
        className={wrap ? `${styles.seg} ${styles.wrap}` : styles.seg}
        role="radiogroup"
        aria-labelledby={id}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            className={option.value === value ? styles.on : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
