import styles from './Koi.module.css';

/** 잉어 표정: 평소, 완료(웃음), 오류(놀람), 빈 화면(졸음) (docs/UI.md "잉어"). */
export type KoiMood = 'calm' | 'happy' | 'surprised' | 'sleepy';

/** 위에서 내려다본 잉어 몸통. 머리가 위(y=5), 꼬리가 아래다. */
function KoiBody({ mood }: { mood: KoiMood }) {
  return (
    <>
      <path d="M21 30 Q11 31 13 39 Q18 35 22 35 Z" className={styles.red} />
      <path d="M43 30 Q53 31 51 39 Q46 35 42 35 Z" className={styles.red} />
      <path
        d="M32 5 C42 5 46 17 44 29 C43 37 39 43 35 47 L41 58 L32 53 L23 58 L29 47 C25 43 21 37 20 29 C18 17 22 5 32 5 Z"
        className={styles.body}
      />
      <circle cx="32" cy="25" r="7" className={styles.red} />
      {mood === 'calm' && (
        <>
          <circle cx="26.5" cy="13" r="2.5" className={styles.eye} />
          <circle cx="37.5" cy="13" r="2.5" className={styles.eye} />
        </>
      )}
      {mood === 'happy' && (
        <>
          <path d="M24 14 Q26.5 10.5 29 14" className={styles.line} />
          <path d="M35 14 Q37.5 10.5 40 14" className={styles.line} />
        </>
      )}
      {mood === 'surprised' && (
        <>
          <circle cx="26" cy="13" r="3.4" className={styles.eye} />
          <circle cx="38" cy="13" r="3.4" className={styles.eye} />
          <circle cx="27" cy="12" r="1.1" className={styles.shine} />
          <circle cx="39" cy="12" r="1.1" className={styles.shine} />
        </>
      )}
      {mood === 'sleepy' && (
        <>
          <path d="M24 13.5 H29" className={styles.line} />
          <path d="M35 13.5 H40" className={styles.line} />
        </>
      )}
    </>
  );
}

type KoiProps = {
  mood?: KoiMood;
  size?: number;
  className?: string | undefined;
  label?: string;
};

/** KoiCut 잉어 마크. 이름(label)이 없으면 장식으로 보고 읽지 않게 한다. */
export function Koi({ mood = 'calm', size = 28, className, label }: KoiProps) {
  return (
    <svg
      className={[styles.koi, className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      data-mood={mood}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      focusable="false"
    >
      <KoiBody mood={mood} />
    </svg>
  );
}

/** 변환·처리 중 표시: 연못을 빙글 도는 잉어. 움직임 줄이기 설정이면 멈춰 있다. */
export function KoiPond({
  size = 40,
  className,
}: {
  size?: number;
  className?: string | undefined;
}) {
  return (
    <svg
      className={[styles.pond, className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="32" cy="32" r="31" className={styles.water} />
      <circle cx="32" cy="32" r="6" className={styles.ripple} />
      <g className={styles.orbit}>
        {/* 머리가 도는 방향(시계 방향)을 보게 눕혀서 연못 위쪽에 둔다 */}
        <g transform="translate(32 15) rotate(90) scale(0.5) translate(-32 -32)">
          <KoiBody mood="calm" />
        </g>
      </g>
    </svg>
  );
}
