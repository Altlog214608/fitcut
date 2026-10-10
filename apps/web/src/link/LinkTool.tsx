import { Copy, ExternalLink, Pause, Play, Repeat, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { ApiError } from '../gif/api';
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
      setInputError('유튜브 링크가 아니에요. 유튜브 앱이나 사이트의 공유 링크를 붙여 넣어 주세요.');
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
        error instanceof ApiError ? error.message : '저장하지 못했어요. 다시 시도해 주세요.',
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
          <h1 className={styles.title}>링크 구간</h1>
          <p className={styles.fileInfo}>영상은 유튜브에서 재생되고, 링크와 구간만 저장돼요.</p>
        </div>
      </header>

      <form className={own.open} onSubmit={open}>
        <label htmlFor={inputId} className="visually-hidden">
          유튜브 링크
        </label>
        <input
          id={inputId}
          className={own.input}
          type="url"
          inputMode="url"
          placeholder="유튜브 링크 붙여넣기"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <button type="submit" className={own.openButton}>
          열기
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
                {yt.error.message}{' '}
                {yt.error.blocked && (
                  <a
                    href={`https://www.youtube.com/watch?v=${videoId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    유튜브에서 열기
                  </a>
                )}
              </p>
            ) : !yt.ready ? (
              <p className={styles.hint}>플레이어를 불러오는 중이에요…</p>
            ) : (
              active && (
                <>
                  <div className={styles.controls}>
                    <button
                      type="button"
                      className={styles.playButton}
                      aria-label={yt.playing ? '일시 정지' : '재생'}
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
                      구간 반복
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
                      label="시작"
                      value={active.start}
                      step={STEP}
                      onChange={(t) => changeRange(moveStart(active, t, STEP))}
                    />
                    <TimeField
                      label="끝"
                      value={active.end}
                      step={STEP}
                      onChange={(t) => changeRange(moveEnd(active, t, STEP, duration))}
                    />
                    <p className={styles.length}>
                      길이 <b className={styles.num}>{(active.end - active.start).toFixed(1)}초</b>
                    </p>
                  </div>
                  <div className={styles.marks}>
                    <button
                      type="button"
                      className={styles.chip}
                      onClick={() => changeRange(moveStart(active, yt.current, STEP))}
                    >
                      지금 위치를 시작으로
                    </button>
                    <button
                      type="button"
                      className={styles.chip}
                      onClick={() => changeRange(moveEnd(active, yt.current, STEP, duration))}
                    >
                      지금 위치를 끝으로
                    </button>
                  </div>
                </>
              )
            )}
          </div>

          <div className={styles.panel}>
            {saved && (
              <div className={own.saved} role="status">
                <p className={own.savedTitle}>구간을 저장했어요</p>
                <p className={own.url}>{repeatUrl(origin, saved.id)}</p>
                <div className={styles.marks}>
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={() => void copyText('repeat', repeatUrl(origin, saved.id))}
                  >
                    <Copy size={16} strokeWidth={1.75} /> 반복 링크 복사
                  </button>
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={() => void copyText('youtube', youtubeAt(saved.videoId, saved.start))}
                  >
                    <Copy size={16} strokeWidth={1.75} /> 유튜브 시작 시점 링크
                  </button>
                </div>
                {copied && <p className={styles.hint}>복사했어요</p>}
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
                {saving ? '저장하는 중…' : '구간 저장'}
              </button>
            </div>
            <p className={styles.trust}>
              <ShieldCheck size={18} strokeWidth={1.75} />
              영상은 유튜브에서 재생되고, 링크와 구간만 저장돼요
            </p>
          </div>
        </div>
      )}

      {mine.length > 0 && (
        <section className={own.mine} aria-labelledby="mine-title">
          <h2 id="mine-title" className={own.mineTitle}>
            내 구간
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
                  aria-label="이 구간을 목록에서 지우기"
                  onClick={() => setMine((list) => removeMine(list, l.id))}
                >
                  <Trash2 size={16} strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
          <p className={styles.hint}>이 목록은 이 브라우저에만 저장돼요.</p>
        </section>
      )}
    </div>
  );
}
