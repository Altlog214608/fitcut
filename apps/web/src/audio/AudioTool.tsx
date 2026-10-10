import { JOB_LIMITS, sizeBucket, type JobKind } from '@fitcut/shared';
import { AudioLines, CircleCheck, Pause, Play, Repeat, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { DropZone } from '../components/DropZone';
import { Segmented } from '../components/Segmented';
import { contentTypeOf } from '../gif/api';
import { estimateAudioBytes, formatBytes } from '../gif/estimate';
import styles from '../gif/GifTool.module.css';
import { TimeField } from '../gif/TimeField';
import { Timeline } from '../gif/Timeline';
import { formatTime, moveEnd, moveStart, rangeProblem, roundMs, type Range } from '../gif/time';
import { track } from '../lib/analytics';
import { detectKind } from '../lib/detectKind';
import { SAVE_METHOD } from '../lib/inApp';
import { openShare } from '../lib/save';
import { useMediaJob, type MediaRequest } from '../media/useMediaJob';
import { waveformOf } from './waveform';

const ACCEPT =
  'video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,.mp4,.mov,.webm,.mp3,.m4a,.wav';
/** 한 번에 움직이는 시간 (음성은 프레임이 없어 0.01초 단위) */
const STEP = 0.01;
const WAVE_BUCKETS = 600;

type Purpose = 'file' | 'iphone' | 'galaxy';
const PURPOSES: readonly { value: Purpose; label: string }[] = [
  { value: 'file', label: '음성 파일' },
  { value: 'iphone', label: '아이폰 벨소리' },
  { value: 'galaxy', label: '갤럭시 벨소리' },
];

type FileFormat = 'mp3' | 'm4a' | 'wav';
const FORMATS: readonly { value: FileFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'm4a', label: 'M4A' },
  { value: 'wav', label: 'WAV' },
];
const FORMAT_HINT: Record<FileFormat, string> = {
  mp3: '어디서나 열려요.',
  m4a: '같은 음질에 MP3보다 조금 작아요 (AAC).',
  wav: '압축하지 않아 용량이 커요. 편집용으로 좋아요.',
};

const BITRATES = ['128', '192', '256', '320'] as const;
type Bitrate = (typeof BITRATES)[number];
const FADES = ['0', '0.5', '1', '2', '3'] as const;
type Fade = (typeof FADES)[number];
const fadeOptions = FADES.map((v) => ({ value: v, label: v === '0' ? '없음' : `${v}초` }));

const LABEL: Record<Purpose, string> = {
  file: '',
  iphone: '아이폰 벨소리',
  galaxy: '갤럭시 벨소리',
};

type Picked = { file: File; url: string };
type Meta = { file: File; duration: number };

export function AudioTool({ initialFile }: { initialFile: File | null }) {
  const replaceId = useId();
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
  const problem = !info
    ? null
    : (rangeProblem(range, kind) ??
      (fades.in + fades.out > seconds ? '페이드가 구간보다 길어요. 페이드를 줄여 주세요.' : null));
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
      setPickError(
        '영상이나 음성 파일이 아니에요. MP4 · MOV · WebM · MP3 · M4A · WAV를 골라 주세요.',
      );
      return;
    }
    if (next.size > JOB_LIMITS.maxUploadBytes) {
      setPickError(
        `파일이 너무 커요. ${JOB_LIMITS.maxUploadBytes / 1024 / 1024}MB 이하로 골라 주세요.`,
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
        <h1 className={styles.title}>음성</h1>
        <p className={styles.lead}>
          영상이나 음성 파일에서 원하는 구간만 MP3 · M4A · WAV, 벨소리로 만들어요.
        </p>
        <DropZone title="영상이나 음성 파일을 끌어오세요" accept={ACCEPT} onFile={pickFile} />
        {pickError && (
          <p className={styles.error} role="alert">
            {pickError}
          </p>
        )}
        <p className={styles.trust}>
          <ShieldCheck size={18} strokeWidth={1.75} />
          파일을 고르면 바로 올라가기 시작해요. 올린 파일은 보통 1~2일 안에 자동으로 삭제돼요
        </p>
      </div>
    );
  }

  const name = purpose === 'file' ? kind.toUpperCase() : LABEL[purpose];
  const primaryLabel =
    now?.phase === 'done'
      ? `${name} 저장`
      : making?.phase === 'pending'
        ? '올리기가 끝나면 바로 만들어요'
        : busy
          ? '만드는 중…'
          : `${name} 만들기`;
  const percent =
    up.state === 'sending' && up.total > 0 ? Math.round((up.sent / up.total) * 100) : 0;

  return (
    <div className={styles.tool}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>음성</h1>
          <p className={styles.fileInfo}>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.num}>{formatBytes(file.size)}</span>
            {info && <span className={styles.num}>{formatTime(info.duration)}</span>}
          </p>
        </div>
        <label htmlFor={replaceId} className={styles.replace}>
          <AudioLines size={18} strokeWidth={1.75} />
          다른 파일
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
                frame={STEP}
                thumbnails={[]}
                waveform={peaks}
                onRange={changeRange}
                onSeek={seek}
              />
              {wave?.file === file && !peaks && (
                <p className={styles.hint}>파형은 그릴 수 없지만 구간은 고를 수 있어요.</p>
              )}

              <div className={styles.times}>
                <TimeField
                  label="시작"
                  value={range.start}
                  step={STEP}
                  onChange={(t) => changeRange(moveStart(range, t, STEP))}
                />
                <TimeField
                  label="끝"
                  value={range.end}
                  step={STEP}
                  onChange={(t) => changeRange(moveEnd(range, t, STEP, info.duration))}
                />
                <p className={styles.length}>
                  길이 <b className={styles.num}>{seconds.toFixed(2)}초</b>
                </p>
              </div>

              <div className={styles.marks}>
                <button
                  type="button"
                  className={styles.chip}
                  onClick={() => changeRange(moveStart(range, current, STEP))}
                >
                  지금 위치를 시작으로
                </button>
                <button
                  type="button"
                  className={styles.chip}
                  onClick={() => changeRange(moveEnd(range, current, STEP, info.duration))}
                >
                  지금 위치를 끝으로
                </button>
              </div>
              <p className={styles.keys}>
                키보드: ←/→ 0.1초 · Shift+←/→ 1초 · I/O 시작·끝 지정 · Space 재생 · L 구간 반복
              </p>
            </>
          ) : mediaError === file ? (
            <p className={styles.error} role="alert">
              이 브라우저에서는 이 파일을 재생할 수 없어요. 크롬이나 사파리 최신 버전에서 열어
              주세요.
            </p>
          ) : (
            <p className={styles.hint}>파일을 여는 중이에요…</p>
          )}
        </div>

        <div className={styles.panel}>
          <Segmented label="용도" value={purpose} options={PURPOSES} onChange={setPurpose} />
          {purpose === 'file' && (
            <>
              <Segmented
                label="형식"
                value={fileFormat}
                options={FORMATS}
                onChange={setFileFormat}
              />
              <p className={styles.hint}>{FORMAT_HINT[fileFormat]}</p>
            </>
          )}
          {purpose === 'iphone' && (
            <p className={styles.hint}>
              아이폰 벨소리(M4R)는 {JOB_LIMITS.maxSeconds.m4r}초까지예요 (Apple 안내).
            </p>
          )}
          {purpose === 'galaxy' && (
            <p className={styles.hint}>갤럭시는 기기에 저장한 MP3를 벨소리로 고를 수 있어요.</p>
          )}
          <Segmented label="페이드 인" value={fadeIn} options={fadeOptions} onChange={setFadeIn} />
          <Segmented
            label="페이드 아웃"
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
            음량 맞추기 (너무 작거나 큰 소리를 고르게)
          </label>
          <details className={styles.advanced}>
            <summary>고급</summary>
            {kind !== 'wav' && (
              <Segmented
                label="음질 (kbps)"
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
              모노로 (용량 절반, 통화 녹음 등)
            </label>
          </details>

          {problem ? (
            <p className={styles.error} role="alert">
              {problem}
            </p>
          ) : (
            estimate !== null && (
              <p className={styles.estimate}>
                {kind.toUpperCase()} · 예상 용량 약{' '}
                <b className={styles.num}>{formatBytes(estimate)}</b>
              </p>
            )
          )}

          {making?.phase === 'running' && (
            <p className={styles.status} role="status">
              {making.job.status === 'queued'
                ? '차례를 기다리고 있어요'
                : `만드는 중이에요 · ${elapsed}초`}
              <span className={styles.hint}>보통 몇 초면 끝나요.</span>
            </p>
          )}
          {now?.phase === 'done' && now.job.downloadUrl && (
            <figure className={styles.result}>
              <audio src={now.job.downloadUrl} crossOrigin="anonymous" controls />
              <figcaption className={styles.num} role="status">
                만들었어요 · {formatBytes(now.job.outputBytes ?? 0)}
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
                파일 앱에 저장
              </button>
            )}
          </div>
          {now?.phase === 'done' && (
            <button type="button" className={styles.secondary} onClick={media.clearResult}>
              다른 설정으로 또 만들기
            </button>
          )}
          {now?.phase === 'done' && SAVE_METHOD === 'share' && (
            <p className={styles.hint}>공유 화면에서 &lsquo;파일에 저장&rsquo;을 눌러 주세요.</p>
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
