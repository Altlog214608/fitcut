import { searchPresets, VISIBLE_PRESETS, type DevicePreset } from '@fitcut/presets';
import { Search, Star, X } from 'lucide-react';
import { useId, useState } from 'react';
import { track } from '../lib/analytics';
import styles from './DevicePicker.module.css';
import {
  MAX_CUSTOM_SIDE,
  quickPicks,
  resolveTarget,
  ROLE_LABELS,
  sameTarget,
  type Target,
} from './target';

type Props = {
  value: Target | null;
  recent: readonly Target[];
  mine: readonly Target[];
  onChange: (target: Target) => void;
  onToggleMine: (target: Target) => void;
};

function targetName(target: Target): string {
  if (target.kind === 'custom') return `${target.width} × ${target.height}`;
  return resolveTarget(target, VISIBLE_PRESETS)?.label ?? target.presetId;
}

function presetTarget(preset: DevicePreset): Target {
  return { kind: 'preset', presetId: preset.id, role: preset.screens[0]?.role ?? 'main' };
}

function sizeText(preset: DevicePreset): string {
  return preset.screens.map((s) => `${s.widthPx} × ${s.heightPx}`).join(' · ');
}

export function DevicePicker({ value, recent, mine, onChange, onToggleMine }: Props) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customW, setCustomW] = useState('1080');
  const [customH, setCustomH] = useState('1920');

  const results = query.trim() ? searchPresets(VISIBLE_PRESETS, query, 8) : [];
  const resolved = value ? resolveTarget(value, VISIBLE_PRESETS) : null;
  const isMine = value ? mine.some((t) => sameTarget(t, value)) : false;
  const shortcuts = [...mine, ...recent.filter((r) => !mine.some((m) => sameTarget(m, r)))];

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
        기기
      </h2>

      {value && resolved && (
        <div className={styles.selected}>
          <div className={styles.selectedText}>
            <span className={styles.selectedName}>{resolved.label ?? '직접 입력한 크기'}</span>
            <span className={styles.size}>
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
            {isMine ? '내 기기' : '내 기기로 저장'}
          </button>
        </div>
      )}

      {resolved?.preset && resolved.preset.screens.length > 1 && value?.kind === 'preset' && (
        <div className={styles.seg} role="radiogroup" aria-label="화면">
          {resolved.preset.screens.map((s) => (
            <button
              key={s.role}
              type="button"
              role="radio"
              aria-checked={value.role === s.role}
              className={value.role === s.role ? styles.on : undefined}
              onClick={() => onChange({ ...value, role: s.role })}
            >
              {ROLE_LABELS[s.role]}
            </button>
          ))}
        </div>
      )}

      <div className={styles.search}>
        <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        <label htmlFor={searchId} className="visually-hidden">
          기기 이름으로 찾기
        </label>
        <input
          id={searchId}
          type="search"
          placeholder="기기 이름으로 찾기 (예: 17 프로, 플립8, 워치9)"
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
            aria-label="검색어 지우기"
            onClick={() => setQuery('')}
          >
            <X size={16} strokeWidth={2} />
          </button>
        )}
      </div>

      {query.trim() ? (
        results.length > 0 ? (
          <ul className={styles.results} aria-label="검색 결과">
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
          <p className={styles.empty}>찾는 기기가 없어요. 아래에서 크기를 직접 입력해 보세요.</p>
        )
      ) : (
        <div
          className={styles.chips}
          aria-label={shortcuts.length ? '내 기기와 최근 기기' : '빠른 선택'}
          role="group"
        >
          {(shortcuts.length ? shortcuts : quickPicks(VISIBLE_PRESETS).map(presetTarget)).map(
            (t) => (
              <button
                key={JSON.stringify(t)}
                type="button"
                className={
                  value && sameTarget(value, t) ? `${styles.chip} ${styles.chipOn}` : styles.chip
                }
                onClick={() => choose(t)}
              >
                {mine.some((m) => sameTarget(m, t)) && (
                  <Star size={14} strokeWidth={2} fill="currentColor" aria-label="내 기기" />
                )}
                {targetName(t)}
              </button>
            ),
          )}
        </div>
      )}

      <button
        type="button"
        className={styles.link}
        aria-expanded={customOpen}
        onClick={() => setCustomOpen((open) => !open)}
      >
        크기 직접 입력
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
            <span>가로</span>
            <input
              inputMode="numeric"
              value={customW}
              onChange={(e) => setCustomW(e.currentTarget.value)}
            />
          </label>
          <span aria-hidden="true">×</span>
          <label>
            <span>세로</span>
            <input
              inputMode="numeric"
              value={customH}
              onChange={(e) => setCustomH(e.currentTarget.value)}
            />
          </label>
          <button type="submit" disabled={!customValid}>
            이 크기로
          </button>
          {!customValid && (
            <p className={styles.error} role="alert">
              1부터 {MAX_CUSTOM_SIDE} 사이의 숫자를 넣어 주세요.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
