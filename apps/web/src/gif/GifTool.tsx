import { JOB_LIMITS, sizeBucket, type JobKind } from '@fitcut/shared';
import { CircleCheck, Film, Pause, Play, Repeat, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { DropZone } from '../components/DropZone';
import { Segmented } from '../components/Segmented';
import { detectKind } from '../lib/detectKind';
import { track } from '../lib/analytics';
import { SAVE_METHOD } from '../lib/inApp';
import { openShare } from '../lib/save';
import { contentTypeOf } from './api';
import { useMediaJob } from '../media/useMediaJob';
import { estimateBytes, formatBytes, outputSize, type Size } from './estimate';
import { DEFAULT_FPS, fpsFromFrameTimes } from './frameRate';
import styles from './GifTool.module.css';
import { extractThumbnails } from './thumbnails';
import { TimeField } from './TimeField';
import { Timeline } from './Timeline';
import { formatTime, initialRange, moveEnd, moveStart, rangeProblem, type Range } from './time';
import { centerCrop, WATCHES } from './watch';

const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';
const THUMB_COUNT = 12;
const THUMB_HEIGHT = 96;
const KIND_LABEL: Record<JobKind, string> = {
  gif: 'GIF',
  webp: 'WebP',
  mp4: 'MP4',
  mp3: 'MP3',
  m4a: 'M4A',
  wav: 'WAV',
  m4r: '벨소리',
};
const KIND_HINT: Partial<Record<JobKind, string>> = {
  gif: '어디서나 열리지만 용량이 커요.',
  webp: 'GIF보다 작아요. 일부 앱에서는 열리지 않을 수 있어요.',
  mp4: '가장 작아요. 소리는 담지 않아요.',
};
const KINDS = (['gif', 'webp', 'mp4'] as const).map((value) => ({
  value,
  label: KIND_LABEL[value],
}));

type WidthChoice = '320' | '480' | '640' | 'source';
const WIDTHS: readonly { value: WidthChoice; label: string }[] = [
  { value: '320', label: '320' },
  { value: '480', label: '480' },
  { value: '640', label: '640' },
  { value: 'source', label: '원본' },
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
const PURPOSES: readonly { value: Purpose; label: string }[] = [
  { value: 'clip', label: '움짤' },
  { value: 'watch', label: '워치 화면' },
];
/** 요청할 가로 폭. 서버는 원본보다 키우지 않으므로(ffmpeg min(W,iw)) 실제로 나올 폭을 보낸다 */
function widthOf(choice: WidthChoice, video: Size | null): number {
  const { min, max } = JOB_LIMITS.width;
  const wanted = choice === 'source' ? max : Number(choice);
  return Math.min(max, Math.max(min, Math.min(wanted, video?.width ?? wanted)));
}

export function GifTool({ initialFile }: { initialFile: File | null }) {
  const replaceId = useId();
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
  const [clipKind, setKind] = useState<JobKind>('gif');
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
  const problem = info ? rangeProblem(range, kind) : null;
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
      setPickError('영상 파일이 아니에요. MP4 · MOV · WebM 영상을 골라 주세요.');
      return;
    }
    if (next.size > JOB_LIMITS.maxUploadBytes) {
      setPickError(
        `영상이 너무 커요. ${JOB_LIMITS.maxUploadBytes / 1024 / 1024}MB 이하로 골라 주세요.`,
      );
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
        <h1 className={styles.title}>움짤</h1>
        <p className={styles.lead}>영상에서 구간을 골라 GIF · WebP · MP4로 만들어요.</p>
        <DropZone title="영상을 끌어오세요" accept={VIDEO_ACCEPT} onFile={pickFile} />
        {pickError && (
          <p className={styles.error} role="alert">
            {pickError}
          </p>
        )}
        <p className={styles.trust}>
          <ShieldCheck size={18} strokeWidth={1.75} />
          영상을 고르면 바로 올라가기 시작해요. 올린 파일은 보통 1~2일 안에 자동으로 삭제돼요
        </p>
      </div>
    );
  }

  const primaryLabel =
    now?.phase === 'done'
      ? `${KIND_LABEL[now.job.kind]} 저장`
      : making?.phase === 'pending'
        ? '올리기가 끝나면 바로 만들어요'
        : busy
          ? '만드는 중…'
          : `${KIND_LABEL[kind]} 만들기`;
  const resultParams = now?.phase === 'done' ? now.job.params : null;
  const resultSize = resultParams?.height
    ? { width: resultParams.width, height: resultParams.height }
    : resultParams && info
      ? outputSize(resultParams.width, info.size)
      : null;
  const percent =
    up.state === 'sending' && up.total > 0 ? Math.round((up.sent / up.total) * 100) : 0;

  return (
    <div className={styles.tool}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>움짤</h1>
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
          다른 영상
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

      <div className={styles.upload} aria-live="polite">
        {up.state === 'starting' && <p className={styles.uploadText}>올릴 준비를 하고 있어요…</p>}
        {up.state === 'sending' && (
          <>
            <p className={styles.uploadText}>
              올리는 중 <b className={styles.num}>{percent}%</b>
              <span className={styles.num}>
                {formatBytes(up.sent)} / {formatBytes(up.total)}
              </span>
            </p>
            <button type="button" className={styles.textButton} onClick={media.cancelUpload}>
              업로드 취소
            </button>
            <div
              className={styles.bar}
              role="progressbar"
              aria-label="업로드"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
          </>
        )}
        {up.state === 'done' && (
          <p className={styles.uploadText}>
            <CircleCheck size={18} strokeWidth={1.75} className={styles.ok} />
            올리기 완료
          </p>
        )}
        {up.state === 'failed' && (
          <>
            <p className={styles.uploadError} role="alert">
              {up.message}
            </p>
            <button type="button" className={styles.textButton} onClick={media.retryUpload}>
              다시 올리기
            </button>
          </>
        )}
      </div>

      <div className={styles.main}>
        <div className={styles.editCol}>
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

          {info ? (
            <>
              <div className={styles.controls}>
                <button
                  type="button"
                  className={styles.playButton}
                  aria-label={playing ? '일시 정지' : '재생'}
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
                  구간 반복
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
                  label="시작"
                  value={range.start}
                  step={frame}
                  onChange={(t) => changeRange(moveStart(range, t, frame))}
                />
                <TimeField
                  label="끝"
                  value={range.end}
                  step={frame}
                  onChange={(t) => changeRange(moveEnd(range, t, frame, info.duration))}
                />
                <p className={styles.length}>
                  길이 <b className={styles.num}>{(range.end - range.start).toFixed(2)}초</b>
                </p>
              </div>

              <div className={styles.marks}>
                <button
                  type="button"
                  className={styles.chip}
                  onClick={() => changeRange(moveStart(range, current, frame))}
                >
                  지금 위치를 시작으로
                </button>
                <button
                  type="button"
                  className={styles.chip}
                  onClick={() => changeRange(moveEnd(range, current, frame, info.duration))}
                >
                  지금 위치를 끝으로
                </button>
              </div>
              <p className={styles.keys}>
                키보드: ←/→ 1프레임 · Shift+←/→ 1초 · I/O 시작·끝 지정 · Space 재생 · L 구간 반복
              </p>
            </>
          ) : videoError === file ? (
            <p className={styles.error} role="alert">
              이 브라우저에서는 이 영상을 미리 볼 수 없어요. 크롬이나 사파리 최신 버전에서 열어
              주세요.
            </p>
          ) : (
            <p className={styles.hint}>영상을 여는 중이에요…</p>
          )}
        </div>

        <div className={styles.panel}>
          {WATCHES.length > 0 && (
            <Segmented label="용도" value={purpose} options={PURPOSES} onChange={setPurpose} />
          )}
          {watch ? (
            <>
              <label className={styles.select}>
                <span>워치</span>
                <select value={watch.id} onChange={(e) => setWatchId(e.currentTarget.value)}>
                  {WATCHES.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.width} × {w.height})
                    </option>
                  ))}
                </select>
              </label>
              <p className={styles.hint}>
                {watch.livePhoto
                  ? '애플워치 사진 페이스는 Live Photo만 움직여요. 워치 화면 크기의 짧은 MP4로 만들어요.'
                  : `워치 화면 크기의 ${KIND_LABEL[watch.kind]}로 만들어요.`}{' '}
                {watch.shape === 'circle' ? '둥근 화면이라 네 모서리는 보이지 않아요. ' : ''}
                영상 가운데를 잘라 맞춰요.
              </p>
            </>
          ) : (
            <>
              <Segmented label="형식" value={clipKind} options={KINDS} onChange={setKind} />
              <p className={styles.hint}>{KIND_HINT[clipKind]}</p>
              <Segmented
                label="가로 크기"
                value={widthChoice}
                options={WIDTHS}
                onChange={setWidthChoice}
              />
            </>
          )}
          <details className={styles.advanced}>
            <summary>고급</summary>
            <Segmented
              label="초당 장면 수"
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
                · 예상 용량 약 <b className={styles.num}>{formatBytes(estimate ?? 0)}</b>
              </p>
            )
          )}

          {making?.phase === 'running' && (
            <p className={styles.status} role="status">
              {making.job.status === 'queued'
                ? '차례를 기다리고 있어요'
                : `만드는 중이에요 · ${elapsed}초`}
              <span className={styles.hint}>보통 10~30초 걸려요.</span>
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
                <img src={now.job.downloadUrl} crossOrigin="anonymous" alt="만든 결과" />
              )}
              <figcaption className={styles.num} role="status">
                만들었어요 · {resultSize ? `${resultSize.width} × ${resultSize.height} · ` : ''}
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
                사진 앱에 저장
              </button>
            )}
          </div>
          {now?.phase === 'done' && (
            <button type="button" className={styles.secondary} onClick={media.clearResult}>
              다른 설정으로 또 만들기
            </button>
          )}
          {now?.phase === 'done' && SAVE_METHOD === 'share' && (
            <p className={styles.hint}>
              공유 화면에서 &lsquo;이미지 저장&rsquo; 또는 &lsquo;비디오 저장&rsquo;을 누르면 사진
              앱에 들어가요.
            </p>
          )}
          {saveError && (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          )}
          <p className={styles.trust}>
            <ShieldCheck size={18} strokeWidth={1.75} />
            올린 파일은 보통 1~2일 안에 자동으로 삭제돼요
          </p>
        </div>
      </div>
    </div>
  );
}
