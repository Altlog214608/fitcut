import { Segmented } from '../components/Segmented';
import { useT } from '../i18n/context';
import type { OutputFormat } from './fileName';
import type { FitMode } from './layout';
import styles from './Options.module.css';
import { TARGET_SIZES_KB, targetLabel } from './targetSize';
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
  /** 목표 용량(KB), 0 = 끄기 (F9) */
  targetKb: number;
  onTargetKb: (kb: number) => void;
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

const MODES = ['cover', 'contain', 'stretch'] as const;
const BACKGROUNDS = ['extend', 'blur', 'mirror', 'edge', 'solid'] as const;

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
  { color: '#000000', key: 'black' },
  { color: '#ffffff', key: 'white' },
] as const;

export function Options(props: Props) {
  const { mode, background, format, quality, isCircle, circleOutside } = props;
  const t = useT().options;
  const targets = TARGET_SIZES_KB.map((kb) => ({
    value: String(kb),
    label: kb === 0 ? t.off : targetLabel(kb * 1000),
  }));

  function setKind(kind: Background['kind']) {
    if (kind === background.kind) return;
    if (kind === 'blur' || kind === 'extend' || kind === 'mirror') {
      props.onBackground({ kind, ...PHOTO_DEFAULTS[kind] });
    } else if (kind === 'edge') props.onBackground({ kind: 'edge' });
    else props.onBackground({ kind: 'solid', color: '#000000' });
  }

  return (
    <div className={styles.options}>
      <Segmented
        label={t.mode}
        value={mode}
        options={MODES.map((value) => ({ value, label: t.modes[value] }))}
        onChange={props.onMode}
      />

      {mode === 'contain' && (
        <div className={styles.sub}>
          {props.zoomMax > 1.01 && (
            <label className={styles.slider}>
              <span>
                {t.zoom} <b className={styles.num}>{Math.round(props.zoom * 100)}%</b>
              </span>
              <input
                type="range"
                min={1}
                max={props.zoomMax}
                step={0.01}
                value={props.zoom}
                onChange={(e) => props.onZoom(Number(e.currentTarget.value))}
              />
              <small className={styles.help}>{t.zoomHelp}</small>
            </label>
          )}
          <Segmented
            label={t.background}
            value={background.kind}
            options={BACKGROUNDS.map((value) => ({ value, label: t.backgrounds[value] }))}
            onChange={setKind}
            wrap
          />
          {(background.kind === 'blur' ||
            background.kind === 'extend' ||
            background.kind === 'mirror') && (
            <>
              <label className={styles.slider}>
                <span>{t.blur}</span>
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
                <span>{t.dim}</span>
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
            <div className={styles.swatches} role="group" aria-label={t.colorGroup}>
              {SWATCHES.map((s) => (
                <button
                  key={s.color}
                  type="button"
                  aria-pressed={background.color === s.color}
                  onClick={() => props.onBackground({ kind: 'solid', color: s.color })}
                >
                  <span className={styles.swatch} style={{ background: s.color }} />
                  {t[s.key]}
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
                {t.pickColor}
              </label>
            </div>
          )}
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={props.soft}
              onChange={(e) => props.onSoft(e.currentTarget.checked)}
            />
            <span>{t.soft}</span>
          </label>
        </div>
      )}

      {isCircle && (
        <Segmented
          label={t.circleOutside}
          value={circleOutside}
          options={[
            { value: 'black', label: t.black },
            { value: 'transparent', label: t.transparentPng },
          ]}
          onChange={props.onCircleOutside}
        />
      )}

      <Segmented label={t.format} value={format} options={FORMATS} onChange={props.onFormat} />
      {format !== 'png' && (
        <label className={styles.slider}>
          <span>
            {t.quality} <b className={styles.num}>{Math.round(quality * 100)}</b>
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
      {format !== 'png' && (
        <Segmented
          label={t.target}
          value={String(props.targetKb)}
          options={targets}
          onChange={(v) => props.onTargetKb(Number(v))}
          wrap
        />
      )}
    </div>
  );
}
