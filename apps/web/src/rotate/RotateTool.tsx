import { JOB_LIMITS, sizeBucket, type JobKind } from '@fitcut/shared';
import { CircleCheck, Film, ShieldCheck } from 'lucide-react';
import { useId, useState, type CSSProperties } from 'react';
import { DropZone } from '../components/DropZone';
import { Segmented } from '../components/Segmented';
import { contentTypeOf } from '../gif/api';
import { formatBytes } from '../gif/estimate';
import styles from '../gif/GifTool.module.css';
import { formatTime } from '../gif/time';
import { track } from '../lib/analytics';
import { detectKind } from '../lib/detectKind';
import { SAVE_METHOD } from '../lib/inApp';
import { openShare } from '../lib/save';
import { useMediaJob, type MediaRequest } from '../media/useMediaJob';
import { canEncode, previewTransform, turnedSize, type Size, type Turn } from './rotate';
import own from './RotateTool.module.css';

const ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';

const TURNS: readonly { value: '90' | '270' | '180'; label: string }[] = [
  { value: '90', label: '오른쪽으로 90°' },
  { value: '270', label: '왼쪽으로 90°' },
  { value: '180', label: '180°' },
];

type Method = 'rotate' | 'rotate-fast';
const METHODS: readonly { value: Method; label: string }[] = [
  { value: 'rotate', label: '어디서나 세로로' },
  { value: 'rotate-fast', label: '빠르게' },
];
const METHOD_HINT: Record<Method, string> = {
  rotate:
    '실제 화면을 돌려 다시 압축해요. 어떤 앱에서도 돌린 방향으로 보여요. 화질은 거의 그대로이고 시간이 조금 걸려요.',
  'rotate-fast':
    '다시 압축하지 않고 회전 정보만 바꿔서 몇 초면 끝나고 화질도 그대로예요. 회전 정보를 무시하는 일부 앱·편집기에서는 원래 방향으로 보일 수 있어요.',
};

type Picked = { file: File; url: string };
type Meta = { file: File; duration: number; size: Size };

/** 영상 세로로 돌리기 (FEATURES F21): 해상도·프레임은 그대로, 가로·세로만 바꾼다 */
export function RotateTool({ initialFile }: { initialFile: File | null }) {
  const replaceId = useId();
  const [picked, setPicked] = useState<Picked | null>(() =>
    initialFile ? { file: initialFile, url: URL.createObjectURL(initialFile) } : null,
  );
  const [pickError, setPickError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [videoError, setVideoError] = useState<File | null>(null);
  const [turnChoice, setTurn] = useState<'90' | '270' | '180'>('90');
  const [flip, setFlip] = useState(false);
  const [methodChoice, setMethod] = useState<Method>('rotate');

  const file = picked?.file ?? null;
  const url = picked?.url ?? null;
  const info = meta && meta.file === file ? meta : null;
  const turn = Number(turnChoice) as Turn;
  const encodeOk = info ? canEncode(info.size, info.duration) : true;
  // 다시 압축할 수 없는 영상은 '빠르게'로
  const method: Method = encodeOk ? methodChoice : 'rotate-fast';
  const kind: JobKind = method;
  const useFlip = method === 'rotate' && flip;
  const request: MediaRequest = {
    kind,
    start: 0,
    end: info ? Math.round(info.duration * 1000) / 1000 : 0,
    fps: JOB_LIMITS.fps.default,
    width: JOB_LIMITS.width.default,
    rotate: turn,
    flip: useFlip,
  };
  const key = JSON.stringify(request);
  const tooLong = info ? info.duration > JOB_LIMITS.maxSeconds['rotate-fast'] + 1 : false;

  const media = useMediaJob(file, 'rotate', key);
  const { up, making, now, busy, elapsed, shareFile, saveError } = media;

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
  }

  if (!file || !url) {
    return (
      <div className={styles.empty}>
        <h1 className={styles.title}>영상 세로로 돌리기</h1>
        <p className={styles.lead}>
          누워 있는 영상을 해상도와 프레임 그대로 돌려요. 예: 1920×1080 → 1080×1920
        </p>
        <DropZone title="영상을 끌어오세요" accept={ACCEPT} onFile={pickFile} />
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

  const after = info ? turnedSize(info.size, turn) : null;
  // 돌린 모습을 미리 보여줄 상자: 돌린 뒤 비율로 잡고 안에서 영상을 돌린다
  const frameStyle =
    after && info
      ? ({
          '--aspect': `${after.width} / ${after.height}`,
          '--inner-w': turn === 180 ? '100%' : `${(info.size.width / info.size.height) * 100}%`,
          '--inner-h': turn === 180 ? '100%' : `${(info.size.height / info.size.width) * 100}%`,
        } as CSSProperties)
      : undefined;
  const primaryLabel =
    now?.phase === 'done'
      ? '돌린 영상 저장'
      : making?.phase === 'pending'
        ? '올리기가 끝나면 바로 돌려요'
        : busy
          ? '돌리는 중…'
          : '세로로 돌리기';
  const percent =
    up.state === 'sending' && up.total > 0 ? Math.round((up.sent / up.total) * 100) : 0;

  return (
    <div className={styles.tool}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>영상 세로로 돌리기</h1>
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
          accept={ACCEPT}
          className="visually-hidden"
          onChange={(e) => {
            const next = e.currentTarget.files?.[0];
            if (next) pickFile(next);
            e.currentTarget.value = '';
          }}
        />
      </header>

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
          <div className={own.stage}>
            <div className={own.frame} style={frameStyle} data-testid="rotate-preview">
              <video
                className={own.video}
                src={url}
                muted
                playsInline
                autoPlay
                loop
                style={{ transform: previewTransform(turn, useFlip) }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (!Number.isFinite(v.duration) || v.videoWidth === 0) return;
                  setMeta({
                    file,
                    duration: v.duration,
                    size: { width: v.videoWidth, height: v.videoHeight },
                  });
                  track('file_selected', {
                    tool: 'rotate',
                    kind: 'video',
                    mime: contentTypeOf(file) ?? file.type,
                    sizeBucket: sizeBucket(file.size),
                    width: v.videoWidth,
                    height: v.videoHeight,
                    durationSec: Math.round(v.duration),
                  });
                }}
                onError={() => setVideoError(file)}
              />
            </div>
          </div>
          {info && after ? (
            <p className={`${styles.estimate} ${styles.num}`}>
              {info.size.width} × {info.size.height} →{' '}
              <b>
                {after.width} × {after.height}
              </b>{' '}
              · 프레임·길이 그대로
            </p>
          ) : videoError === file ? (
            <p className={styles.hint}>
              이 브라우저에서는 미리 볼 수 없지만 돌릴 수는 있어요. 보이는 방향을 모르니 결과를
              확인해 주세요.
            </p>
          ) : (
            <p className={styles.hint}>영상을 여는 중이에요…</p>
          )}
        </div>

        <div className={styles.panel}>
          <Segmented label="방향" value={turnChoice} options={TURNS} onChange={setTurn} />
          <Segmented label="방식" value={method} options={METHODS} onChange={setMethod} />
          <p className={styles.hint}>{METHOD_HINT[method]}</p>
          {!encodeOk && (
            <p className={styles.hint}>
              3분이 넘거나 큰 영상은 다시 압축하는 데 오래 걸려서 &lsquo;빠르게&rsquo;로 돌려요.
            </p>
          )}
          {method === 'rotate' && (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={flip}
                onChange={(e) => setFlip(e.currentTarget.checked)}
              />
              좌우 반전도 하기 (셀카처럼 뒤집힌 영상)
            </label>
          )}
          {tooLong && (
            <p className={styles.error} role="alert">
              영상이 너무 길어요. 10분 이하 영상을 골라 주세요.
            </p>
          )}

          {making?.phase === 'running' && (
            <p className={styles.status} role="status">
              {making.job.status === 'queued'
                ? '차례를 기다리고 있어요'
                : `돌리는 중이에요 · ${elapsed}초`}
              <span className={styles.hint}>
                {method === 'rotate' ? '1분 영상이면 30초쯤 걸려요.' : '보통 몇 초면 끝나요.'}
              </span>
            </p>
          )}
          {now?.phase === 'done' && now.job.downloadUrl && (
            <figure className={styles.result}>
              <video src={now.job.downloadUrl} crossOrigin="anonymous" controls playsInline />
              <figcaption className={styles.num} role="status">
                돌렸어요 · {formatBytes(now.job.outputBytes ?? 0)}
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
              disabled={!info || tooLong || busy}
              onClick={() => (now?.phase === 'done' ? void media.save() : media.make(request))}
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
              다른 방향으로 또 돌리기
            </button>
          )}
          {now?.phase === 'done' && SAVE_METHOD === 'share' && (
            <p className={styles.hint}>
              공유 화면에서 &lsquo;비디오 저장&rsquo;을 누르면 사진 앱에 들어가요.
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
