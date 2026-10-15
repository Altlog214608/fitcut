import { JOB_LIMITS, sizeBucket, type JobKind } from '@fitcut/shared';
import { AudioLines, Pause, Play, Repeat, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { DropZone } from '../components/DropZone';
import { useT } from '../i18n/context';
import { Segmented } from '../components/Segmented';
import { contentTypeOf } from '../gif/api';
import { estimateAudioBytes, formatBytes } from '../gif/estimate';
import styles from '../gif/GifTool.module.css';
import { TimeField } from '../gif/TimeField';
import { Timeline } from '../gif/Timeline';
import { formatTime, moveEnd, moveStart, rangeTooLong, roundMs, type Range } from '../gif/time';
import { track } from '../lib/analytics';
import { detectKind } from '../lib/detectKind';
import { SAVE_METHOD } from '../lib/inApp';
import { openShare } from '../lib/save';
import { useMediaJob, type MediaRequest } from '../media/useMediaJob';
import { RetainConsent } from '../media/RetainConsent';
import { UploadStatus } from '../media/UploadStatus';
import { waveformOf } from './waveform';

const ACCEPT =
  'video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,.mp4,.mov,.webm,.mp3,.m4a,.wav';
/** 한 번에 움직이는 시간 (음성은 프레임이 없어 0.01초 단위) */
const STEP = 0.01;
const WAVE_BUCKETS = 600;

type Purpose = 'file' | 'iphone' | 'galaxy';
const PURPOSES: readonly Purpose[] = ['file', 'iphone', 'galaxy'];

type FileFormat = 'mp3' | 'm4a' | 'wav';
const FORMATS: readonly { value: FileFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'm4a', label: 'M4A' },
  { value: 'wav', label: 'WAV' },
];

const BITRATES = ['128', '192', '256', '320'] as const;
type Bitrate = (typeof BITRATES)[number];
const FADES = ['0', '0.5', '1', '2', '3'] as const;
type Fade = (typeof FADES)[number];

type Picked = { file: File; url: string };
type Meta = { file: File; duration: number };

export function AudioTool({ initialFile }: { initialFile: File | null }) {
  const replaceId = useId();
  const all = useT();
  const t = all.audio;
  const m = all.media;
  const fadeOptions = FADES.map((v) => ({ value: v, label: v === '0' ? t.none : m.seconds(v) }));
  const mediaRef = useRef<HTMLAudioElement>(null);
  const [picked, setPicked] = useState<Picked | null>(() =>
    initialFile ? { file: initialFile, url: URL.createObjectURL(initialFile) } : null,
  );
  const [pickError, setPickError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [mediaError, setMediaError] = useState<File | null>(null);
  const [wave, setWave] = useState<{ file: File; peaks: number[] | null } | null>(null);
  const [range, setRange] = useState<Range>({ start: 0, end: 0 });
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);

  const [purpose, setPurpose] = useState<Purpose>('file');
  const [fileFormat, setFileFormat] = useState<FileFormat>('mp3');
  const [bitrate, setBitrate] = useState<Bitrate>('192');
  const [mono, setMono] = useState(false);
  const [fadeIn, setFadeIn] = useState<Fade>('0');
  const [fadeOut, setFadeOut] = useState<Fade>('0');
  const [normalize, setNormalize] = useState(false);

  const file = picked?.file ?? null;
  const url = picked?.url ?? null;
  const info = meta && meta.file === file ? meta : null;
  const peaks = wave && wave.file === file ? wave.peaks : null;

  const kind: JobKind = purpose === 'iphone' ? 'm4r' : purpose === 'galaxy' ? 'mp3' : fileFormat;
  const seconds = range.end - range.start;
  const fades = { in: Number(fadeIn), out: Number(fadeOut) };
  const request: MediaRequest = {
    kind,
    start: range.start,
    end: range.end,
    fps: JOB_LIMITS.fps.default,
    width: JOB_LIMITS.width.default,
    audio: {
      fadeIn: fades.in,
      fadeOut: fades.out,
      normalize,
      channels: mono ? 1 : 2,
      bitrate: Number(bitrate),
    },
  };
  const key = JSON.stringify(request);
  const over = info ? rangeTooLong(range, kind) : null;
  const problem = !info
    ? null
    : over !== null
      ? kind === 'm4r'
        ? m.ringtoneTooLong(over)
        : m.tooLong(over)
      : fades.in + fades.out > seconds
        ? t.fadeTooLong
        : null;
  const estimate =
    info && !problem ? estimateAudioBytes(kind, seconds, Number(bitrate), mono ? 1 : 2) : null;

  const media = useMediaJob(file, 'audio', key);
  const { up, making, now, busy, elapsed, shareFile, saveError } = media;

  // ---------- 파형 ----------
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    void waveformOf(file, WAVE_BUCKETS).then((p) => {
      if (!cancelled) setWave({ file, peaks: p });
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  // ---------- 재생 위치와 구간 반복 ----------
  useEffect(() => {
    const el = mediaRef.current;
    if (!playing || !el) return;
    let raf = 0;
    const tick = () => {
      if (loop && el.currentTime >= range.end) el.currentTime = range.start;
      setCurrent(el.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, range.start, range.end]);

  // ---------- 키보드: ←/→ 0.1초(Shift 1초), I/O, Space, L ----------
  useEffect(() => {
    if (!info) return;
    const total = info.duration;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      switch (e.code) {
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          const step = e.shiftKey ? 1 : 0.1;
          seek(current + (e.code === 'ArrowLeft' ? -step : step));
          break;
        }
        case 'KeyI':
          setRange((r) => moveStart(r, current, STEP));
          break;
        case 'KeyO':
          setRange((r) => moveEnd(r, current, STEP, total));
          break;
        case 'Space':
          if (el?.closest('button, summary, a')) return;
          e.preventDefault();
          togglePlay();
          break;
        case 'KeyL':
          setLoop((on) => !on);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function pickFile(next: File) {
    const k = detectKind(next).kind;
    if ((k !== 'video' && k !== 'audio') || !contentTypeOf(next)) {
      setPickError(t.notMedia);
      return;
    }
    if (next.size > JOB_LIMITS.maxUploadBytes) {
      setPickError(m.tooBig(JOB_LIMITS.maxUploadBytes / 1024 / 1024));
      return;
    }
    if (picked) URL.revokeObjectURL(picked.url);
    media.reset();
    setPickError(null);
    setPicked({ file: next, url: URL.createObjectURL(next) });
    setPlaying(false);
    setCurrent(0);
  }

  function seek(t: number) {
    const el = mediaRef.current;
    if (!el || !info) return;
    const next = Math.min(info.duration, Math.max(0, t));
    el.currentTime = next;
    setCurrent(next);
  }

  function togglePlay() {
    const el = mediaRef.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    if (loop && (el.currentTime < range.start || el.currentTime >= range.end - 0.01)) {
      el.currentTime = range.start;
    }
    void el.play().catch(() => undefined);
  }

  function changeRange(next: Range) {
    setRange(next);
    if (next.start !== range.start) seek(next.start);
    else if (next.end !== range.end) seek(next.end);
  }

  function make() {
    if (!info || problem) return;
    media.make(request);
  }

  if (!file || !url) {
    return (
      <div className={styles.empty}>
        <h1 className={styles.title}>{t.title}</h1>
        <p className={styles.lead}>{t.lead}</p>
        <DropZone title={t.dropTitle} accept={ACCEPT} onFile={pickFile} />
        {pickError && (
          <p className={styles.error} role="alert">
            {pickError}
          </p>
        )}
        <p className={styles.trust}>
          <ShieldCheck size={18} strokeWidth={1.75} />
          {m.uploadTrust}
        </p>
      </div>
    );
  }

  const name = purpose === 'file' ? kind.toUpperCase() : t.purposes[purpose];
  const primaryLabel =
    now?.phase === 'done'
      ? all.gif.save(name)
      : making?.phase === 'pending'
        ? m.afterUpload
        : busy
          ? m.busy
          : all.gif.make(name);

  return (
    <div className={styles.tool}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>{t.title}</h1>
          <p className={styles.fileInfo}>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.num}>{formatBytes(file.size)}</span>
            {info && <span className={styles.num}>{formatTime(info.duration)}</span>}
          </p>
        </div>
        <label htmlFor={replaceId} className={styles.replace}>
          <AudioLines size={18} strokeWidth={1.75} />
          {t.replace}
        </label>
        <input
          id={replaceId}
          type="file"
          accept={ACCEPT}
          className="visually-hidden"
          onChange={(e) => {
            const next = e.currentTarget.files?.[0];
            if (next) pickFile(next);
            e.currentTarget.value = '';
          }}
        />
      </header>
      {pickError && (
        <p className={styles.error} role="alert">
          {pickError}
        </p>
      )}

      <UploadStatus up={up} onCancel={media.cancelUpload} onRetry={media.retryUpload} />

      <div className={styles.main}>
        <div className={styles.editCol}>
          <audio
            ref={mediaRef}
            src={url}
            preload="auto"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              if (!Number.isFinite(el.duration) || el.duration <= 0) return;
              setMeta({ file, duration: el.duration });
              // 처음 구간: 앞에서부터 30초 (짧으면 전체)
              setRange({ start: 0, end: roundMs(Math.min(el.duration, 30)) });
              setCurrent(0);
              track('file_selected', {
                tool: 'audio',
                kind: detectKind(file).kind === 'video' ? 'video' : 'audio',
                mime: contentTypeOf(file) ?? file.type,
                sizeBucket: sizeBucket(file.size),
                durationSec: Math.round(el.duration),
              });
            }}
            onError={() => setMediaError(file)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onSeeked={(e) => setCurrent(e.currentTarget.currentTime)}
          />

          {info ? (
            <>
              <div className={styles.controls}>
                <button
                  type="button"
                  className={styles.playButton}
                  aria-label={playing ? m.pause : m.play}
                  onClick={togglePlay}
                >
                  {playing ? (
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
                <span className={`${styles.clock} ${styles.num}`}>{formatTime(current)}</span>
              </div>

              <Timeline
                duration={info.duration}
                range={range}
                current={current}
                frame={STEP}
                thumbnails={[]}
                waveform={peaks}
                onRange={changeRange}
                onSeek={seek}
              />
              {wave?.file === file && !peaks && <p className={styles.hint}>{t.noWave}</p>}

              <div className={styles.times}>
                <TimeField
                  label={m.start}
                  value={range.start}
                  step={STEP}
                  onChange={(t) => changeRange(moveStart(range, t, STEP))}
                />
                <TimeField
                  label={m.end}
                  value={range.end}
                  step={STEP}
                  onChange={(t) => changeRange(moveEnd(range, t, STEP, info.duration))}
                />
                <p className={styles.length}>
                  {m.length} <b className={styles.num}>{m.seconds(seconds.toFixed(2))}</b>
                </p>
              </div>

              <div className={styles.marks}>
                <button
                  type="button"
                  className={styles.chip}
                  onClick={() => changeRange(moveStart(range, current, STEP))}
                >
                  {m.startHere}
                </button>
                <button
                  type="button"
                  className={styles.chip}
                  onClick={() => changeRange(moveEnd(range, current, STEP, info.duration))}
                >
                  {m.endHere}
                </button>
              </div>
              <p className={styles.keys}>{t.keys}</p>
            </>
          ) : mediaError === file ? (
            <p className={styles.error} role="alert">
              {t.cantPlay}
            </p>
          ) : (
            <p className={styles.hint}>{t.opening}</p>
          )}
        </div>

        <div className={styles.panel}>
          <Segmented
            label={m.purpose}
            value={purpose}
            options={PURPOSES.map((value) => ({ value, label: t.purposes[value] }))}
            onChange={setPurpose}
          />
          {purpose === 'file' && (
            <>
              <Segmented
                label={t.format}
                value={fileFormat}
                options={FORMATS}
                onChange={setFileFormat}
              />
              <p className={styles.hint}>{t.formatHint[fileFormat]}</p>
            </>
          )}
          <div className={styles.spec}>
            {purpose === 'file' && <p>{t.fileSpec(JOB_LIMITS.maxSeconds.mp3 / 60)}</p>}
            {purpose === 'iphone' && <p>{t.iphoneSpec(JOB_LIMITS.maxSeconds.m4r)}</p>}
            {purpose === 'galaxy' && <p>{t.galaxySpec}</p>}
            {purpose !== 'file' && <p className={styles.hint}>{t.colorRing}</p>}
          </div>
          <Segmented label={t.fadeIn} value={fadeIn} options={fadeOptions} onChange={setFadeIn} />
          <Segmented
            label={t.fadeOut}
            value={fadeOut}
            options={fadeOptions}
            onChange={setFadeOut}
          />
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={normalize}
              onChange={(e) => setNormalize(e.currentTarget.checked)}
            />
            {t.normalize}
          </label>
          <details className={styles.advanced}>
            <summary>{m.advanced}</summary>
            {kind !== 'wav' && (
              <Segmented
                label={t.bitrate}
                value={bitrate}
                options={BITRATES.map((v) => ({ value: v, label: v }))}
                onChange={setBitrate}
              />
            )}
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={mono}
                onChange={(e) => setMono(e.currentTarget.checked)}
              />
              {t.mono}
            </label>
          </details>

          {problem ? (
            <p className={styles.error} role="alert">
              {problem}
            </p>
          ) : (
            estimate !== null && (
              <p className={styles.estimate}>
                {kind.toUpperCase()} · {m.estimate}{' '}
                <b className={styles.num}>{formatBytes(estimate)}</b>
              </p>
            )
          )}

          {making?.phase === 'running' && (
            <p className={styles.status} role="status">
              {making.job.status === 'queued' ? m.queued : m.working(elapsed)}
              <span className={styles.hint}>{t.usually}</span>
            </p>
          )}
          {now?.phase === 'done' && now.job.downloadUrl && (
            <figure className={styles.result}>
              <audio src={now.job.downloadUrl} crossOrigin="anonymous" controls />
              <figcaption className={styles.num} role="status">
                {m.made} · {formatBytes(now.job.outputBytes ?? 0)}
              </figcaption>
            </figure>
          )}
          {making?.phase === 'failed' && making.key === key && (
            <p className={styles.error} role="alert">
              {making.message}
            </p>
          )}
          <div className={styles.saveBar}>
            <button
              type="button"
              className={styles.primary}
              disabled={!info || !!problem || busy}
              onClick={() => (now?.phase === 'done' ? void media.save() : make())}
            >
              {primaryLabel}
            </button>
            {now?.phase === 'done' && shareFile && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => openShare(shareFile, () => undefined)}
              >
                {m.saveToFiles}
              </button>
            )}
          </div>
          {now?.phase === 'done' && (
            <button type="button" className={styles.secondary} onClick={media.clearResult}>
              {m.again}
            </button>
          )}
          {now?.phase === 'done' && SAVE_METHOD === 'share' && (
            <p className={styles.hint}>{t.shareHint}</p>
          )}
          {saveError && (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          )}
          <RetainConsent checked={media.retain} onChange={media.setRetain} disabled={busy} />
        </div>
      </div>
    </div>
  );
}
