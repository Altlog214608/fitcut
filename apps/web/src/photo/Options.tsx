import { Segmented } from '../components/Segmented';
import type { OutputFormat } from './fileName';
import type { FitMode } from './layout';
import styles from './Options.module.css';
import type { Background } from './render';

type Props = {
  mode: FitMode;
  onMode: (mode: FitMode) => void;
  background: Background;
  onBackground: (background: Background) => void;
  format: OutputFormat;
  onFormat: (format: OutputFormat) => void;
  quality: number;
  onQuality: (quality: number) => void;
  isCircle: boolean;
  circleOutside: 'black' | 'transparent';
  onCircleOutside: (value: 'black' | 'transparent') => void;
  soft: boolean;
  onSoft: (soft: boolean) => void;
  /** 배경 채우기에서 사진을 키운 배율 (1 = 사진 전체) */
  zoom: number;
  zoomMax: number;
  onZoom: (zoom: number) => void;
};

const MODES = [
  { value: 'cover', label: '꽉 채우기' },
  { value: 'contain', label: '배경 채우기' },
  { value: 'stretch', label: '늘이기' },
] as const;

const BACKGROUNDS = [
  { value: 'texture', label: '자연스럽게' },
  { value: 'extend', label: '가장자리 늘이기' },
  { value: 'blur', label: '흐린 사진' },
  { value: 'mirror', label: '거울 반사' },
  { value: 'edge', label: '비슷한 색' },
  { value: 'solid', label: '단색' },
] as const;

/** 배경 종류를 바꿀 때의 기본값. 이어 붙이는 방식은 덜 흐리게 시작한다. */
const PHOTO_DEFAULTS = {
  blur: { strength: 0.5, dim: 0.15 },
  extend: { strength: 0.4, dim: 0 },
  mirror: { strength: 0.45, dim: 0.05 },
} as const;

const FORMATS = [
  { value: 'jpeg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
] as const;

const SWATCHES = [
  { color: '#000000', label: '검정' },
  { color: '#ffffff', label: '흰색' },
];

export function Options(props: Props) {
  const { mode, background, format, quality, isCircle, circleOutside } = props;

  function setKind(kind: Background['kind']) {
    if (kind === background.kind) return;
    if (kind === 'blur' || kind === 'extend' || kind === 'mirror') {
      props.onBackground({ kind, ...PHOTO_DEFAULTS[kind] });
    } else if (kind === 'texture') props.onBackground({ kind: 'texture' });
    else if (kind === 'edge') props.onBackground({ kind: 'edge' });
    else props.onBackground({ kind: 'solid', color: '#000000' });
  }

  return (
    <div className={styles.options}>
      <Segmented label="맞춤 방식" value={mode} options={MODES} onChange={props.onMode} />

      {mode === 'contain' && (
        <div className={styles.sub}>
          {props.zoomMax > 1.01 && (
            <label className={styles.slider}>
              <span>
                사진 크기 <b className={styles.num}>{Math.round(props.zoom * 100)}%</b>
              </span>
              <input
                type="range"
                min={1}
                max={props.zoomMax}
                step={0.01}
                value={props.zoom}
                onChange={(e) => props.onZoom(Number(e.currentTarget.value))}
              />
              <small className={styles.help}>
                키우면 양옆이나 위아래가 조금 잘리고 채울 곳이 줄어요
              </small>
            </label>
          )}
          <Segmented
            label="배경"
            value={background.kind}
            options={BACKGROUNDS}
            onChange={setKind}
            wrap
          />
          {(background.kind === 'blur' ||
            background.kind === 'extend' ||
            background.kind === 'mirror') && (
            <>
              <label className={styles.slider}>
                <span>흐림</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={background.strength}
                  onChange={(e) =>
                    props.onBackground({ ...background, strength: Number(e.currentTarget.value) })
                  }
                />
              </label>
              <label className={styles.slider}>
                <span>어둡게</span>
                <input
                  type="range"
                  min={0}
                  max={0.6}
                  step={0.05}
                  value={background.dim}
                  onChange={(e) =>
                    props.onBackground({ ...background, dim: Number(e.currentTarget.value) })
                  }
                />
              </label>
            </>
          )}
          {background.kind === 'solid' && (
            <div className={styles.swatches} role="group" aria-label="배경 색">
              {SWATCHES.map((s) => (
                <button
                  key={s.color}
                  type="button"
                  aria-pressed={background.color === s.color}
                  onClick={() => props.onBackground({ kind: 'solid', color: s.color })}
                >
                  <span className={styles.swatch} style={{ background: s.color }} />
                  {s.label}
                </button>
              ))}
              <label className={styles.picker}>
                <input
                  type="color"
                  value={background.color}
                  onChange={(e) =>
                    props.onBackground({ kind: 'solid', color: e.currentTarget.value })
                  }
                />
                직접 고르기
              </label>
            </div>
          )}
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={props.soft}
              onChange={(e) => props.onSoft(e.currentTarget.checked)}
            />
            <span>사진 경계를 부드럽게 섞기</span>
          </label>
        </div>
      )}

      {isCircle && (
        <Segmented
          label="원 바깥"
          value={circleOutside}
          options={[
            { value: 'black', label: '검정' },
            { value: 'transparent', label: '투명 (PNG)' },
          ]}
          onChange={props.onCircleOutside}
        />
      )}

      <Segmented label="형식" value={format} options={FORMATS} onChange={props.onFormat} />
      {format !== 'png' && (
        <label className={styles.slider}>
          <span>
            화질 <b className={styles.num}>{Math.round(quality * 100)}</b>
          </span>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.01}
            value={quality}
            onChange={(e) => props.onQuality(Number(e.currentTarget.value))}
          />
        </label>
      )}
    </div>
  );
}
