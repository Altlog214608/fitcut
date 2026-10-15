import { JOB_LIMITS, sizeBucket, type JobKind } from '@fitcut/shared';
import { Film, Pause, Play, Repeat, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { DropZone } from '../components/DropZone';
import { useT } from '../i18n/context';
import { Segmented } from '../components/Segmented';
import { detectKind } from '../lib/detectKind';
import { track } from '../lib/analytics';
import { SAVE_METHOD } from '../lib/inApp';
import { openShare } from '../lib/save';
import { contentTypeOf } from './api';
import { useMediaJob } from '../media/useMediaJob';
import { RetainConsent } from '../media/RetainConsent';
import { UploadStatus } from '../media/UploadStatus';
import { estimateBytes, formatBytes, outputSize, type Size } from './estimate';
import { DEFAULT_FPS, fpsFromFrameTimes } from './frameRate';
import styles from './GifTool.module.css';
import { extractThumbnails } from './thumbnails';
import { TimeField } from './TimeField';
import { Timeline } from './Timeline';
import { formatTime, initialRange, moveEnd, moveStart, rangeTooLong, type Range } from './time';
import { centerCrop, WATCHES } from './watch';

const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';
const THUMB_COUNT = 12;
const THUMB_HEIGHT = 96;
const KIND_LABEL: Partial<Record<JobKind, string>> = { gif: 'GIF', webp: 'WebP', mp4: 'MP4' };
const CLIP_KINDS = ['gif', 'webp', 'mp4'] as const;
type ClipKind = (typeof CLIP_KINDS)[number];
const KINDS = CLIP_KINDS.map((value) => ({ value, label: KIND_LABEL[value] ?? value }));

type WidthChoice = '320' | '480' | '640' | 'source';
const WIDTHS: readonly { value: WidthChoice; label: string }[] = [
  { value: '320', label: '320' },
  { value: '480', label: '480' },
  { value: '640', label: '640' },
  { value: 'source', label: 'source' },
];

type FpsChoice = '10' | '15' | '20' | '24' | '30';
const FPS_OPTIONS: readonly { value: FpsChoice; label: string }[] = (
  ['10', '15', '20', '24', '30'] as const
).map((value) => ({ value, label: value }));

type Picked = { file: File; url: string };
type Meta = { file: File; duration: number; size: Size };

type Request = {
  kind: JobKind;
  start: number;
  end: number;
  fps: number;
  width: number;
  height?: number;
};

type Purpose = 'clip' | 'watch';
const PURPOSES: readonly Purpose[] = ['clip', 'watch'];
/** 요청할 가로 폭. 서버는 원본보다 키우지 않으므로(ffmpeg min(W,iw)) 실제로 나올 폭을 보낸다 */
function widthOf(choice: WidthChoice, video: Size | null): number {
  const { min, max } = JOB_LIMITS.width;
  const wanted = choice === 'source' ? max : Number(choice);
  return Math.min(max, Math.max(min, Math.min(wanted, video?.width ?? wanted)));
}

export function GifTool({ initialFile }: { initialFile: File | null }) {
  const replaceId = useId();
  const all = useT();
  const t = all.gif;
  const m = all.media;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [picked, setPicked] = useState<Picked | null>(() =>
    initialFile ? { file: initialFile, url: URL.createObjectURL(initialFile) } : null,
  );
  const [pickError, setPickError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [videoError, setVideoError] = useState<File | null>(null);
  const [range, setRange] = useState<Range>({ start: 0, end: 0 });
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [measured, setMeasured] = useState<{ file: File; fps: number } | null>(null);
  const [thumbs, setThumbs] = useState<{ url: string; list: (string | undefined)[] }>({
    url: '',
    list: [],
  });

  const [purpose, setPurpose] = useState<Purpose>('clip');
  const [watchId, setWatchId] = useState(WATCHES[0]?.id ?? '');
  const [clipKind, setKind] = useState<ClipKind>('gif');
  const [widthChoice, setWidthChoice] = useState<WidthChoice>('480');
  const [fpsChoice, setFpsChoice] = useState<FpsChoice>(
    String(JOB_LIMITS.fps.default) as FpsChoice,
  );

  const file = picked?.file ?? null;
  const videoUrl = picked?.url ?? null;
  const info = meta && meta.file === file ? meta : null;
  const duration = info?.duration ?? 0;
  const fps = measured && measured.file === file ? measured.fps : DEFAULT_FPS;
  const frame = 1 / fps;
  const thumbList = thumbs.url === videoUrl ? thumbs.list : [];

  // 워치 화면이면 크기와 형식은 기기가 정한다 (갤럭시 GIF, 애플워치 MP4)
  const watch =
    purpose === 'watch' ? (WATCHES.find((w) => w.id === watchId) ?? WATCHES[0] ?? null) : null;
  const kind: JobKind = watch ? watch.kind : clipKind;
  const width = watch ? watch.width : widthOf(widthChoice, info?.size ?? null);
  const request: Request = {
    kind,
    start: range.start,
    end: range.end,
    fps: Number(fpsChoice),
    width,
    ...(watch ? { height: watch.height } : {}),
  };
  const crop = watch && info ? centerCrop(info.size, watch) : null;
  const key = JSON.stringify(request);
  const over = info ? rangeTooLong(range, kind) : null;
  const problem = over === null ? null : m.tooLong(over);
  const size = watch
    ? { width: watch.width, height: watch.height }
    : info
      ? outputSize(width, info.size)
      : null;
  const estimate =
    size && !problem ? estimateBytes(kind, size, request.fps, range.end - range.start) : null;
  const media = useMediaJob(file, 'gif', key);
  const { up, making, now, busy, elapsed, shareFile, saveError } = media;

  // ---------- 썸네일 ----------
  useEffect(() => {
    if (!videoUrl || !duration) return;
    const controller = new AbortController();
    void extractThumbnails(
      videoUrl,
      duration,
      THUMB_COUNT,
      THUMB_HEIGHT,
      controller.signal,
      (index, url) =>
        setThumbs((prev) => {
          const list = prev.url === videoUrl ? [...prev.list] : [];
          list[index] = url;
          return { url: videoUrl, list };
        }),
    );
    return () => controller.abort();
  }, [videoUrl, duration]);

  // ---------- 재생 위치와 구간 반복 ----------
  useEffect(() => {
    const video = videoRef.current;
    if (!playing || !video) return;
    let raf = 0;
    const tick = () => {
      if (loop && video.currentTime >= range.end) video.currentTime = range.start;
      setCurrent(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, range.start, range.end]);

  // ---------- 프레임 간격 재기 (재생하는 동안, ADR-034) ----------
  const fpsKnown = measured !== null && measured.file === file;
  useEffect(() => {
    const video = videoRef.current;
    if (!playing || !video || !file || fpsKnown) return;
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    const times: number[] = [];
    let handle = 0;
    const onFrame = (_now: number, frameInfo: VideoFrameCallbackMetadata) => {
      times.push(frameInfo.mediaTime);
      const found = times.length >= 15 ? fpsFromFrameTimes(times) : null;
      if (found) setMeasured({ file, fps: found });
      else handle = video.requestVideoFrameCallback(onFrame);
    };
    handle = video.requestVideoFrameCallback(onFrame);
    return () => video.cancelVideoFrameCallback(handle);
  }, [playing, file, fpsKnown]);

  // ---------- 키보드 (FEATURES F4) ----------
  useEffect(() => {
    if (!info) return;
    const total = info.duration;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      // 한글 자판에서도 같은 키가 되도록 e.code를 본다
      switch (e.code) {
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          const step = e.shiftKey ? 1 : frame;
          seek(current + (e.code === 'ArrowLeft' ? -step : step));
          break;
        }
        case 'KeyI':
          setRange((r) => moveStart(r, current, frame));
          break;
        case 'KeyO':
          setRange((r) => moveEnd(r, current, frame, total));
          break;
        case 'Space':
          if (el?.closest('button, summary, a')) return; // 버튼 누르기와 겹치지 않게
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
    if (detectKind(next).kind !== 'video' || !contentTypeOf(next)) {
      setPickError(t.notVideo);
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
    const video = videoRef.current;
    if (!video || !info) return;
    const next = Math.min(info.duration, Math.max(0, t));
    video.currentTime = next;
    setCurrent(next);
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (loop && (video.currentTime < range.start || video.currentTime >= range.end - 0.01)) {
      video.currentTime = range.start;
    }
    void video.play().catch(() => undefined);
  }

  function changeRange(next: Range) {
    setRange(next);
    // 핸들을 옮기면 그 장면을 보여준다
    if (next.start !== range.start) seek(next.start);
    else if (next.end !== range.end) seek(next.end);
  }

  function make() {
    if (!info || problem) return;
    media.make(request);
  }

  if (!file || !videoUrl) {
    return (
      <div className={styles.empty}>
        <h1 className={styles.title}>{t.title}</h1>
        <p className={styles.lead}>{t.lead}</p>
        <DropZone title={t.dropTitle} accept={VIDEO_ACCEPT} onFile={pickFile} />
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

  const kindName = (k: JobKind) => KIND_LABEL[k] ?? (k === 'm4r' ? t.ringtone : t.video);
  const primaryLabel =
    now?.phase === 'done'
      ? t.save(kindName(now.job.kind as JobKind))
      : making?.phase === 'pending'
        ? m.afterUpload
        : busy
          ? m.busy
          : t.make(kindName(kind));
  const resultParams = now?.phase === 'done' ? now.job.params : null;
  const resultSize = resultParams?.height
    ? { width: resultParams.width, height: resultParams.height }
    : resultParams && info
      ? outputSize(resultParams.width, info.size)
      : null;

  return (
    <div className={styles.tool}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>{t.title}</h1>
          <p className={styles.fileInfo}>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.num}>{formatBytes(file.size)}</span>
            {info && (
              <span className={styles.num}>
                {info.size.width} × {info.size.height} · {formatTime(info.duration)}
              </span>
            )}
          </p>
        </div>
        <label htmlFor={replaceId} className={styles.replace}>
          <Film size={18} strokeWidth={1.75} />
          {t.replace}
        </label>
        <input
          id={replaceId}
          type="file"
          accept={VIDEO_ACCEPT}
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
        <div className={styles.previewCol}>
          <div
            className={styles.player}
            style={
              info
                ? ({ '--aspect': `${info.size.width} / ${info.size.height}` } as CSSProperties)
                : undefined
            }
          >
            <div className={styles.frame}>
              <video
                ref={videoRef}
                className={styles.video}
                src={videoUrl}
                playsInline
                muted
                preload="auto"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (!Number.isFinite(v.duration) || v.videoWidth === 0) return;
                  setMeta({
                    file,
                    duration: v.duration,
                    size: { width: v.videoWidth, height: v.videoHeight },
                  });
                  setRange(initialRange(v.duration));
                  track('file_selected', {
                    tool: 'gif',
                    kind: 'video',
                    mime: contentTypeOf(file) ?? file.type,
                    sizeBucket: sizeBucket(file.size),
                    width: v.videoWidth,
                    height: v.videoHeight,
                    durationSec: Math.round(v.duration),
                  });
                  setCurrent(0);
                }}
                onError={() => setVideoError(file)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onSeeked={(e) => setCurrent(e.currentTarget.currentTime)}
              />
              {crop && watch && (
                // 워치 화면에 들어갈 부분 (가운데를 자른다). 바깥은 어둡게
                <div
                  className={styles.crop}
                  data-shape={watch.shape}
                  aria-hidden="true"
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.width * 100}%`,
                    height: `${crop.height * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        </div>

        <div className={styles.editCol}>
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
                frame={frame}
                thumbnails={thumbList}
                onRange={changeRange}
                onSeek={seek}
              />

              <div className={styles.times}>
                <TimeField
                  label={m.start}
                  value={range.start}
                  step={frame}
                  onChange={(t) => changeRange(moveStart(range, t, frame))}
                />
                <TimeField
                  label={m.end}
                  value={range.end}
                  step={frame}
                  onChange={(t) => changeRange(moveEnd(range, t, frame, info.duration))}
                />
                <p className={styles.length}>
                  {m.length}{' '}
                  <b className={styles.num}>{m.seconds((range.end - range.start).toFixed(2))}</b>
                </p>
              </div>

              <div className={styles.marks}>
                <button
                  type="button"
                  className={styles.chip}
                  onClick={() => changeRange(moveStart(range, current, frame))}
                >
                  {m.startHere}
                </button>
                <button
                  type="button"
                  className={styles.chip}
                  onClick={() => changeRange(moveEnd(range, current, frame, info.duration))}
                >
                  {m.endHere}
                </button>
              </div>
              <p className={styles.keys}>{t.keys}</p>
            </>
          ) : videoError === file ? (
            <p className={styles.error} role="alert">
              {t.cantPreview}
            </p>
          ) : (
            <p className={styles.hint}>{t.opening}</p>
          )}
        </div>

        <div className={styles.panel}>
          {WATCHES.length > 0 && (
            <Segmented
              label={m.purpose}
              value={purpose}
              options={PURPOSES.map((value) => ({ value, label: t.purposes[value] }))}
              onChange={setPurpose}
            />
          )}
          {watch ? (
            <>
              <label className={styles.select}>
                <span>{t.watch}</span>
                <select value={watch.id} onChange={(e) => setWatchId(e.currentTarget.value)}>
                  {WATCHES.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.width} × {w.height})
                    </option>
                  ))}
                </select>
              </label>
              <p className={styles.hint}>
                {watch.livePhoto ? t.livePhoto : t.watchKind(kindName(watch.kind))}{' '}
                {watch.shape === 'circle' ? t.roundScreen : ''}
                {t.centerCrop}
              </p>
            </>
          ) : (
            <>
              <Segmented label={t.format} value={clipKind} options={KINDS} onChange={setKind} />
              <p className={styles.hint}>{t.kindHint[clipKind]}</p>
              <Segmented
                label={t.width}
                value={widthChoice}
                options={WIDTHS.map((w) =>
                  w.value === 'source' ? { ...w, label: t.original } : w,
                )}
                onChange={setWidthChoice}
              />
            </>
          )}
          <details className={styles.advanced}>
            <summary>{m.advanced}</summary>
            <Segmented
              label={t.fps}
              value={fpsChoice}
              options={FPS_OPTIONS}
              onChange={setFpsChoice}
            />
          </details>

          {problem ? (
            <p className={styles.error} role="alert">
              {problem}
            </p>
          ) : (
            size && (
              <p className={styles.estimate}>
                <span className={styles.num}>
                  {size.width} × {size.height}
                </span>{' '}
                · {m.estimate} <b className={styles.num}>{formatBytes(estimate ?? 0)}</b>
              </p>
            )
          )}

          {making?.phase === 'running' && (
            <p className={styles.status} role="status">
              {making.job.status === 'queued' ? m.queued : m.working(elapsed)}
              <span className={styles.hint}>{t.usually}</span>
            </p>
          )}
          {/* 미리 받기(fetch)와 같은 CORS 요청으로 불러야 캐시된 응답을 같이 쓸 수 있다 */}
          {now?.phase === 'done' && now.job.downloadUrl && (
            <figure className={styles.result}>
              {now.job.kind === 'mp4' ? (
                <video
                  src={now.job.downloadUrl}
                  crossOrigin="anonymous"
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img src={now.job.downloadUrl} crossOrigin="anonymous" alt={t.resultAlt} />
              )}
              <figcaption className={styles.num} role="status">
                {m.made} · {resultSize ? `${resultSize.width} × ${resultSize.height} · ` : ''}
                {formatBytes(now.job.outputBytes ?? 0)}
              </figcaption>
            </figure>
          )}
          {making?.phase === 'failed' && making.key === key && (
            <p className={styles.error} role="alert">
              {making.message}
            </p>
          )}
          {/* 고정 막대에는 버튼만 둔다. 폰에서 옵션을 가리지 않게 */}
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
                {m.saveToPhotos}
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
