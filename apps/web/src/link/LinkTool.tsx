import { Copy, ExternalLink, Pause, Play, Repeat, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { ApiError } from '../gif/api';
import { useT } from '../i18n/context';
import styles from '../gif/GifTool.module.css';
import { TimeField } from '../gif/TimeField';
import { Timeline } from '../gif/Timeline';
import { formatTime, moveEnd, moveStart, roundMs, type Range } from '../gif/time';
import { track } from '../lib/analytics';
import { parseYouTubeId } from '../lib/youtube';
import own from './LinkTool.module.css';
import { addMine, readMine, removeMine, repeatUrl, saveLink, type Link } from './links';
import { useYouTube } from './useYouTube';
import { youtubeAt } from './youtube';

const STEP = 0.1;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 링크 구간 (FEATURES F15): 유튜브 공식 플레이어로 재생하며 구간을 골라 링크·구간만 저장한다 */
export function LinkTool() {
  const inputId = useId();
  const all = useT();
  const t = all.link;
  const m = all.media;
  const [params, setParams] = useSearchParams();
  const videoId = params.get('v');
  const fromS = Number(params.get('s'));
  const fromE = Number(params.get('e'));

  const [text, setText] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [range, setRange] = useState<Range | null>(null);
  const [loop, setLoop] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Link | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [mine, setMine] = useState<Link[]>(() => readMine());

  const { attach, ...yt } = useYouTube(videoId, range, loop);
  const duration = yt.duration;
  // 처음 구간: 주소에 있으면 그대로(구간 고치기), 없으면 앞 15초
  const active: Range | null = range ?? (yt.ready ? initial() : null);

  function initial(): Range {
    if (Number.isFinite(fromS) && Number.isFinite(fromE) && fromE > fromS && fromE <= duration) {
      return { start: roundMs(fromS), end: roundMs(fromE) };
    }
    return { start: 0, end: roundMs(Math.min(duration, 15)) };
  }

  useEffect(() => {
    if (yt.error?.blocked && videoId) {
      track('link_embed_blocked', { platform: 'youtube', videoId });
    }
  }, [yt.error, videoId]);

  function open(e: FormEvent) {
    e.preventDefault();
    const id = parseYouTubeId(text);
    if (!id) {
      setInputError(t.notYoutube);
      return;
    }
    setInputError(null);
    setRange(null);
    setSaved(null);
    setParams({ v: id });
  }

  function changeRange(next: Range) {
    setRange(next);
    setSaved(null);
    if (!active || next.start !== active.start) yt.seek(next.start);
    else if (next.end !== active.end) yt.seek(next.end);
  }

  function togglePlay() {
    if (!active) return;
    if (yt.playing) yt.pause();
    else yt.play(yt.current < active.start || yt.current >= active.end ? active.start : undefined);
  }

  async function save() {
    if (!videoId || !active) return;
    setSaving(true);
    setSaveError(null);
    try {
      const link = await saveLink(videoId, active.start, active.end);
      setSaved(link);
      setMine((list) => addMine(list, link));
    } catch (error) {
      setSaveError(
        error instanceof ApiError ? all.apiError(error.code, error.message) : t.saveFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  async function copyText(label: string, value: string) {
    setCopied((await copy(value)) ? label : null);
  }

  const origin = window.location.origin;

  return (
    <div className={styles.tool}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>{t.title}</h1>
          <p className={styles.fileInfo}>{t.lead}</p>
        </div>
      </header>

      <form className={own.open} onSubmit={open}>
        <label htmlFor={inputId} className="visually-hidden">
          {all.home.linkLabel}
        </label>
        <input
          id={inputId}
          className={own.input}
          type="url"
          inputMode="url"
          placeholder={all.home.linkPlaceholder}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <button type="submit" className={own.openButton}>
          {t.open}
        </button>
      </form>
      {inputError && (
        <p className={styles.error} role="alert">
          {inputError}
        </p>
      )}

      {videoId && (
        <div className={styles.main}>
          <div className={styles.editCol}>
            {/* 플레이어 위에는 아무것도 겹치지 않는다 (YouTube API 정책) */}
            <div className={own.player} ref={attach} data-testid="yt-host" />
            {yt.error ? (
              <p className={styles.error} role="alert">
                {t.playerErrors[yt.error.kind]}{' '}
                {yt.error.blocked && (
                  <a
                    href={`https://www.youtube.com/watch?v=${videoId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t.openOnYoutube}
                  </a>
                )}
              </p>
            ) : !yt.ready ? (
              <p className={styles.hint}>{t.loading}</p>
            ) : (
              active && (
                <>
                  <div className={styles.controls}>
                    <button
                      type="button"
                      className={styles.playButton}
                      aria-label={yt.playing ? m.pause : m.play}
                      onClick={togglePlay}
                    >
                      {yt.playing ? (
                        <Pause size={20} strokeWidth={1.75} />
                      ) : (
                        <Play size={20} strokeWidth={1.75} />
                      )}
                    </button>
                    <button
                      type="button"
                      className={styles.toggle}
                      aria-pressed={loop}
                      onClick={() => setLoop((on) => !on)}
                    >
                      <Repeat size={18} strokeWidth={1.75} />
                      {m.loop}
                    </button>
                    <span className={`${styles.clock} ${styles.num}`}>
                      {formatTime(yt.current)}
                    </span>
                  </div>
                  <Timeline
                    duration={duration}
                    range={active}
                    current={yt.current}
                    frame={STEP}
                    thumbnails={[]}
                    onRange={changeRange}
                    onSeek={yt.seek}
                  />
                  <div className={styles.times}>
                    <TimeField
                      label={m.start}
                      value={active.start}
                      step={STEP}
                      onChange={(t) => changeRange(moveStart(active, t, STEP))}
                    />
                    <TimeField
                      label={m.end}
                      value={active.end}
                      step={STEP}
                      onChange={(t) => changeRange(moveEnd(active, t, STEP, duration))}
                    />
                    <p className={styles.length}>
                      {m.length}{' '}
                      <b className={styles.num}>
                        {m.seconds((active.end - active.start).toFixed(1))}
                      </b>
                    </p>
                  </div>
                  <div className={styles.marks}>
                    <button
                      type="button"
                      className={styles.chip}
                      onClick={() => changeRange(moveStart(active, yt.current, STEP))}
                    >
                      {m.startHere}
                    </button>
                    <button
                      type="button"
                      className={styles.chip}
                      onClick={() => changeRange(moveEnd(active, yt.current, STEP, duration))}
                    >
                      {m.endHere}
                    </button>
                  </div>
                </>
              )
            )}
          </div>

          <div className={styles.panel}>
            {saved && (
              <div className={own.saved} role="status">
                <p className={own.savedTitle}>{t.savedTitle}</p>
                <p className={own.url}>{repeatUrl(origin, saved.id)}</p>
                <div className={styles.marks}>
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={() => void copyText('repeat', repeatUrl(origin, saved.id))}
                  >
                    <Copy size={16} strokeWidth={1.75} /> {t.copyRepeat}
                  </button>
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={() => void copyText('youtube', youtubeAt(saved.videoId, saved.start))}
                  >
                    <Copy size={16} strokeWidth={1.75} /> {t.copyYoutube}
                  </button>
                </div>
                {copied && <p className={styles.hint}>{t.copied}</p>}
              </div>
            )}
            {saveError && (
              <p className={styles.error} role="alert">
                {saveError}
              </p>
            )}
            <div className={styles.saveBar}>
              <button
                type="button"
                className={styles.primary}
                disabled={!yt.ready || !active || saving}
                onClick={() => void save()}
              >
                {saving ? t.saving : t.save}
              </button>
            </div>
            <p className={styles.trust}>
              <ShieldCheck size={18} strokeWidth={1.75} />
              {t.trust}
            </p>
          </div>
        </div>
      )}

      {mine.length > 0 && (
        <section className={own.mine} aria-labelledby="mine-title">
          <h2 id="mine-title" className={own.mineTitle}>
            {t.mine}
          </h2>
          <ul className={own.list}>
            {mine.map((l) => (
              <li key={l.id} className={own.item}>
                <RouterLink to={`/r/${l.id}`} className={own.itemLink}>
                  <ExternalLink size={16} strokeWidth={1.75} />
                  <span className={styles.num}>
                    {l.videoId} · {formatTime(l.start)} ~ {formatTime(l.end)}
                  </span>
                </RouterLink>
                <button
                  type="button"
                  className={own.remove}
                  aria-label={t.removeMine}
                  onClick={() => setMine((list) => removeMine(list, l.id))}
                >
                  <Trash2 size={16} strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
          <p className={styles.hint}>{t.mineHint}</p>
        </section>
      )}
    </div>
  );
}
