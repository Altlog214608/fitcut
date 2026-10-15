/**
 * 모드 B: 녹화 파일 연결 (ADR-042).
 * - 고르는 즉시 이 기기에서 후보 구간을 재생해 본다 (올리지 않아도 된다)
 * - 영상을 보며 시각을 맞춘다 (offset ±1초·±5초)
 * - 후보 구간을 클립·움짤로 만들려면 서버에 올린다. 멀티파트, 끊기면 이어 올리기, 2일 뒤 삭제
 * - 올린 뒤에는 후보마다 클립 만들기 → 받기·움짤 도구로 (Clips.tsx)
 */
import { useEffect, useRef, useState } from 'react';
import {
  canResume,
  deleteRecording,
  recordingStatus,
  uploadRecording,
  type RecordingView,
} from './recordingUpload';
import { Clips } from './Clips';
import { StreamerError } from './streamer';
import { clock, type Candidate } from './timeline';
import { useT } from '../i18n/context';
import styles from './Recording.module.css';

type Props = {
  id: string;
  candidates: readonly Candidate[];
  offset: number;
  onOffset: (sec: number) => void;
  /** 모드 C는 시각이 녹화 파일 기준이라 맞출 것이 없다 */
  syncable?: boolean;
  /** 올린 녹화 파일의 소리 크기로 (다시) 분석하는 버튼 (ADR-044) */
  sound?: { label: string; busy: boolean; onClick: () => void };
};

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1)}GB`;

export function Recording({ id, candidates, offset, onOffset, syncable = true, sound }: Props) {
  const all = useT();
  const t = all.highlight;
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [server, setServer] = useState<RecordingView | null | undefined>(undefined);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    recordingStatus(id)
      .then((r) => {
        if (alive) setServer(r);
      })
      .catch(() => {
        if (alive) setServer(null);
      });
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, [id]);

  useEffect(() => {
    if (!src) return;
    return () => URL.revokeObjectURL(src);
  }, [src]);

  function choose(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setSrc(URL.createObjectURL(f));
    setMessage(null);
  }

  function play(c: Candidate) {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, c.start + offset);
    stopAt.current = c.end + offset;
    void v.play().catch(() => undefined);
  }

  function onTime() {
    const v = video.current;
    if (v && stopAt.current !== null && v.currentTime >= stopAt.current) {
      v.pause();
      stopAt.current = null;
    }
  }

  async function upload() {
    if (!file) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setMessage(null);
    setProgress({ sent: 0, total: file.size });
    try {
      const r = await uploadRecording(
        id,
        file,
        (sent, total) => setProgress({ sent, total }),
        ctrl.signal,
      );
      setServer(r);
      setMessage(t.uploadedMsg);
    } catch (e) {
      if (ctrl.signal.aborted) setMessage(t.paused);
      else if (e instanceof StreamerError) setMessage(all.apiError('', e.message));
      else setMessage(t.cutOff);
      setServer(await recordingStatus(id).catch(() => null));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  }

  async function remove() {
    if (!window.confirm(t.confirmRemove)) return;
    try {
      await deleteRecording(id);
      setServer(null);
      setMessage(t.removed);
    } catch (e) {
      setMessage(
        all.apiError('', e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.'),
      );
    }
  }

  const resumable = !!file && canResume(id, file, server ?? null);
  const ordered = [...candidates].sort((a, b) => a.start - b.start);
  const pct = progress ? Math.floor((progress.sent / progress.total) * 100) : 0;

  return (
    <section className={styles.box} aria-label={t.recording}>
      <h3 className={styles.heading}>{t.recording}</h3>
      <p className={styles.meta}>{t.recordingLead}</p>
      <label className={styles.pick}>
        <input
          type="file"
          accept="video/*,audio/*,.mkv,.flv,.ts"
          onChange={(e) => choose(e.target.files?.[0])}
        />
        <span>{file ? t.pickAnother : t.pick}</span>
      </label>

      {src && (
        <>
          <video
            ref={video}
            className={styles.video}
            src={src}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={onTime}
          />
          <div className={styles.chips} role="group" aria-label={t.playScenes}>
            {ordered.map((c, i) => (
              <button key={c.rank} type="button" className={styles.chip} onClick={() => play(c)}>
                ▶ {i + 1}. {clock(c.start + offset)}
              </button>
            ))}
          </div>
          {syncable && (
            <div className={styles.sync} role="group" aria-label={t.sync}>
              <span className={styles.meta}>{t.syncLead}</span>
              {[-5, -1, 1, 5].map((d) => (
                <button
                  key={d}
                  type="button"
                  className={styles.chip}
                  onClick={() => onOffset(Math.max(0, offset + d))}
                >
                  {t.sec(d)}
                </button>
              ))}
              <span className={styles.meta}>{t.syncNow(clock(offset))}</span>
            </div>
          )}
        </>
      )}

      <div className={styles.upload}>
        {server?.status === 'uploaded' ? (
          <>
            <p className={styles.meta}>{t.uploadedFile(gb(server.size))}</p>
            {sound && (
              <button
                type="button"
                className={styles.primary}
                disabled={sound.busy}
                onClick={sound.onClick}
              >
                {sound.busy ? t.analyzingShort : sound.label}
              </button>
            )}
            {candidates.length > 0 && <Clips id={id} candidates={candidates} offset={offset} />}
            <button type="button" className={styles.ghost} onClick={() => void remove()}>
              {t.removeFile}
            </button>
          </>
        ) : progress ? (
          <>
            <progress className={styles.bar} value={progress.sent} max={progress.total} />
            <p className={styles.meta}>
              {pct}% · {gb(progress.sent)} / {gb(progress.total)}
            </p>
            <button type="button" className={styles.ghost} onClick={() => abort.current?.abort()}>
              {t.stopUpload}
            </button>
          </>
        ) : (
          file && (
            <>
              <p className={styles.meta}>
                {t.needUpload(gb(file.size))}
                {resumable && t.resumable}
              </p>
              <button type="button" className={styles.primary} onClick={() => void upload()}>
                {resumable ? t.resume : t.upload}
              </button>
            </>
          )
        )}
      </div>

      {message && (
        <p className={styles.meta} role="status">
          {message}
        </p>
      )}
    </section>
  );
}
