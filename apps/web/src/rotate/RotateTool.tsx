import { JOB_LIMITS, sizeBucket, type JobKind } from '@koicut/shared';
import { Koi, KoiPond } from '../components/Koi';
import { Film, ShieldCheck } from 'lucide-react';
import { useId, useState, type CSSProperties } from 'react';
import { DropZone } from '../components/DropZone';
import { useT } from '../i18n/context';
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
import { RetainConsent } from '../media/RetainConsent';
import { UploadStatus } from '../media/UploadStatus';
import { canEncode, previewTransform, turnedSize, type Size, type Turn } from './rotate';
import own from './RotateTool.module.css';

const ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';

const TURNS = ['90', '270', '180'] as const;

type Method = 'rotate' | 'rotate-fast';
const METHODS: readonly Method[] = ['rotate', 'rotate-fast'];

type Picked = { file: File; url: string };
type Meta = { file: File; duration: number; size: Size };

/** 영상 세로로 돌리기 (FEATURES F21): 해상도·프레임은 그대로, 가로·세로만 바꾼다 */
export function RotateTool({ initialFile }: { initialFile: File | null }) {
  const replaceId = useId();
  const all = useT();
  const t = all.rotate;
  const m = all.media;
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
      setPickError(all.gif.notVideo);
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
  }

  if (!file || !url) {
    return (
      <div className={styles.empty}>
        <h1 className={styles.title}>{t.title}</h1>
        <p className={styles.lead}>{t.lead}</p>
        <DropZone title={all.gif.dropTitle} accept={ACCEPT} onFile={pickFile} />
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
      ? t.save
      : making?.phase === 'pending'
        ? t.afterUpload
        : busy
          ? t.busy
          : t.go;

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
          {all.gif.replace}
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

      <UploadStatus up={up} onCancel={media.cancelUpload} onRetry={media.retryUpload} />

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
              · {t.sameFrames}
            </p>
          ) : videoError === file ? (
            <p className={styles.hint}>{t.cantPreview}</p>
          ) : (
            <p className={styles.hint}>{all.gif.opening}</p>
          )}
        </div>

        <div className={styles.panel}>
          <Segmented
            label={t.turn}
            value={turnChoice}
            options={TURNS.map((value) => ({ value, label: t.turns[value] }))}
            onChange={setTurn}
          />
          <Segmented
            label={t.method}
            value={method}
            options={METHODS.map((value) => ({ value, label: t.methods[value] }))}
            onChange={setMethod}
          />
          <p className={styles.hint}>{t.methodHint[method]}</p>
          {!encodeOk && <p className={styles.hint}>{t.fastOnly}</p>}
          {method === 'rotate' && (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={flip}
                onChange={(e) => setFlip(e.currentTarget.checked)}
              />
              {t.flip}
            </label>
          )}
          {tooLong && (
            <p className={styles.error} role="alert">
              {t.tooLong}
            </p>
          )}

          {making?.phase === 'running' && (
            <p className={styles.status} role="status">
              <KoiPond size={48} className={styles.pond} />
              {making.job.status === 'queued' ? m.queued : t.working(elapsed)}
              <span className={styles.hint}>
                {method === 'rotate' ? t.usuallyEncode : t.usuallyFast}
              </span>
            </p>
          )}
          {now?.phase === 'done' && now.job.downloadUrl && (
            <figure className={styles.result}>
              <video src={now.job.downloadUrl} crossOrigin="anonymous" controls playsInline />
              <figcaption className={styles.num} role="status">
                <Koi mood="happy" size={22} className={styles.doneKoi} />
                {t.done} · {formatBytes(now.job.outputBytes ?? 0)}
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
                {m.saveToPhotos}
              </button>
            )}
          </div>
          {now?.phase === 'done' && (
            <button type="button" className={styles.secondary} onClick={media.clearResult}>
              {t.again}
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
