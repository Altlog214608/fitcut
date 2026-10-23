import { searchPresets, VISIBLE_PRESETS, type DevicePreset } from '@koicut/presets';
import { Search, Star, X } from 'lucide-react';
import { useId, useState } from 'react';
import { track } from '../lib/analytics';
import styles from './DevicePicker.module.css';
import { useT } from '../i18n/context';
import type { Dict } from '../i18n/ko';
import { PURPOSES, purposeOf, purposeTargets, type Purpose } from './purpose';
import { MAX_CUSTOM_SIDE, monitorName, resolveTarget, sameTarget, type Target } from './target';

type Props = {
  value: Target | null;
  recent: readonly Target[];
  mine: readonly Target[];
  onChange: (target: Target) => void;
  onToggleMine: (target: Target) => void;
};

function targetName(target: Target, t: Dict['picker']): string {
  if (target.kind === 'custom') {
    const monitor = monitorName(target.width, target.height);
    return monitor ? t.monitor(monitor) : `${target.width} × ${target.height}`;
  }
  const preset = VISIBLE_PRESETS.find((p) => p.id === target.presetId);
  if (!preset) return target.presetId;
  return preset.screens.length > 1 ? `${preset.name} ${t.roles[target.role]}` : preset.name;
}

function presetTarget(preset: DevicePreset): Target {
  return { kind: 'preset', presetId: preset.id, role: preset.screens[0]?.role ?? 'main' };
}

/** 고른 대상의 쓰임새 (폰 배경화면, 워치 페이스 …). 직접 입력한 크기는 모니터 해상도일 때만 */
function purposeOfTarget(target: Target | null): Purpose | null {
  if (!target) return null;
  if (target.kind === 'custom') return monitorName(target.width, target.height) ? 'pc' : null;
  const preset = VISIBLE_PRESETS.find((p) => p.id === target.presetId);
  return preset ? purposeOf(preset.category) : null;
}

function sizeText(preset: DevicePreset): string {
  return preset.screens.map((s) => `${s.widthPx} × ${s.heightPx}`).join(' · ');
}

export function DevicePicker({ value, recent, mine, onChange, onToggleMine }: Props) {
  const t = useT().picker;
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customW, setCustomW] = useState('1080');
  const [customH, setCustomH] = useState('1920');
  const [purpose, setPurpose] = useState<Purpose>(() => purposeOfTarget(value) ?? 'phone');
  const use = purposeOfTarget(value);

  const results = query.trim() ? searchPresets(VISIBLE_PRESETS, query, 8) : [];
  const resolved = value ? resolveTarget(value, VISIBLE_PRESETS) : null;
  const isMine = value ? mine.some((t) => sameTarget(t, value)) : false;
  const shortcuts = [...mine, ...recent.filter((r) => !mine.some((m) => sameTarget(m, r)))];

  function chip(target: Target) {
    return (
      <button
        key={JSON.stringify(target)}
        type="button"
        className={
          value && sameTarget(value, target) ? `${styles.chip} ${styles.chipOn}` : styles.chip
        }
        onClick={() => choose(target)}
      >
        {mine.some((m) => sameTarget(m, target)) && (
          <Star size={14} strokeWidth={2} fill="currentColor" aria-label={t.myDevice} />
        )}
        {targetName(target, t)}
      </button>
    );
  }

  function choose(target: Target) {
    onChange(target);
    setQuery('');
  }

  const customWidth = Number(customW);
  const customHeight = Number(customH);
  const customValid =
    resolveTarget({ kind: 'custom', width: customWidth, height: customHeight }, []) !== null;

  return (
    <section className={styles.picker} aria-labelledby={`${searchId}-title`}>
      <h2 id={`${searchId}-title`} className={styles.title}>
        {t.heading}
      </h2>

      {value && resolved && (
        <div className={styles.selected}>
          <div className={styles.selectedText}>
            <span className={styles.selectedName}>
              {value.kind === 'custom' && !use ? t.customSize : targetName(value, t)}
            </span>
            <span className={styles.size}>
              {use && <span className={styles.use}>{t.uses[use]}</span>}
              {resolved.size.width} × {resolved.size.height} px
            </span>
          </div>
          <button
            type="button"
            className={styles.star}
            aria-pressed={isMine}
            onClick={() => onToggleMine(value)}
          >
            <Star size={18} strokeWidth={1.75} fill={isMine ? 'currentColor' : 'none'} />
            {isMine ? t.myDevice : t.saveMine}
          </button>
        </div>
      )}

      {resolved?.preset && resolved.preset.screens.length > 1 && value?.kind === 'preset' && (
        <div className={styles.seg} role="radiogroup" aria-label={t.screen}>
          {resolved.preset.screens.map((s) => (
            <button
              key={s.role}
              type="button"
              role="radio"
              aria-checked={value.role === s.role}
              className={value.role === s.role ? styles.on : undefined}
              onClick={() => onChange({ ...value, role: s.role })}
            >
              {t.roles[s.role]}
            </button>
          ))}
        </div>
      )}

      <div className={styles.search}>
        <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        <label htmlFor={searchId} className="visually-hidden">
          {t.searchLabel}
        </label>
        <input
          id={searchId}
          type="search"
          placeholder={t.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onBlur={() => {
            // 찾았는데 없던 기기 → 프리셋 추가 우선순위 (docs/ADMIN.md)
            if (query.trim().length >= 2 && results.length === 0) {
              track('preset_search_miss', { query: query.trim() });
            }
          }}
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className={styles.clear}
            aria-label={t.clearSearch}
            onClick={() => setQuery('')}
          >
            <X size={16} strokeWidth={2} />
          </button>
        )}
      </div>

      {query.trim() ? (
        results.length > 0 ? (
          <ul className={styles.results} aria-label={t.results}>
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => choose(presetTarget(p))}>
                  <span className={styles.resultName}>{p.name}</span>
                  <span className={styles.size}>{sizeText(p)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>{t.noResult}</p>
        )
      ) : (
        <>
          {shortcuts.length > 0 && (
            <div className={styles.chips} role="group" aria-label={t.shortcuts}>
              {shortcuts.map(chip)}
            </div>
          )}
          <div className={styles.seg} role="radiogroup" aria-label={t.purposeGroup}>
            {PURPOSES.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={purpose === p}
                className={purpose === p ? styles.on : undefined}
                onClick={() => setPurpose(p)}
              >
                {t.purposes[p]}
              </button>
            ))}
          </div>
          <div className={styles.chips} role="group" aria-label={t.purposeDevices(t.uses[purpose])}>
            {purposeTargets(VISIBLE_PRESETS, purpose).map(chip)}
          </div>
        </>
      )}

      <button
        type="button"
        className={styles.link}
        aria-expanded={customOpen}
        onClick={() => setCustomOpen((open) => !open)}
      >
        {t.customToggle}
      </button>
      {customOpen && (
        <form
          className={styles.custom}
          onSubmit={(e) => {
            e.preventDefault();
            if (customValid) choose({ kind: 'custom', width: customWidth, height: customHeight });
          }}
        >
          <label>
            <span>{t.width}</span>
            <input
              inputMode="numeric"
              value={customW}
              onChange={(e) => setCustomW(e.currentTarget.value)}
            />
          </label>
          <span aria-hidden="true">×</span>
          <label>
            <span>{t.height}</span>
            <input
              inputMode="numeric"
              value={customH}
              onChange={(e) => setCustomH(e.currentTarget.value)}
            />
          </label>
          <button type="submit" disabled={!customValid}>
            {t.useSize}
          </button>
          {!customValid && (
            <p className={styles.error} role="alert">
              {t.sizeError(MAX_CUSTOM_SIDE)}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
