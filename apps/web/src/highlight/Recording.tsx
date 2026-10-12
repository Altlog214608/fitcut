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
import styles from './Recording.module.css';

type Props = {
  id: string;
  candidates: readonly Candidate[];
  offset: number;
  onOffset: (sec: number) => void;
};

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1)}GB`;

export function Recording({ id, candidates, offset, onOffset }: Props) {
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
      setMessage('녹화 파일을 올렸어요. 2일 뒤 자동으로 지워져요.');
    } catch (e) {
      if (ctrl.signal.aborted) setMessage('멈췄어요. 같은 파일을 다시 고르면 이어서 올려요.');
      else if (e instanceof StreamerError) setMessage(e.message);
      else setMessage('올리다 끊겼어요. 같은 파일로 다시 누르면 이어서 올려요.');
      setServer(await recordingStatus(id).catch(() => null));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  }

  async function remove() {
    if (!window.confirm('올린 녹화 파일을 지울까요?')) return;
    try {
      await deleteRecording(id);
      setServer(null);
      setMessage('올린 녹화 파일을 지웠어요.');
    } catch (e) {
      setMessage(e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.');
    }
  }

  const resumable = !!file && canResume(id, file, server ?? null);
  const ordered = [...candidates].sort((a, b) => a.start - b.start);
  const pct = progress ? Math.floor((progress.sent / progress.total) * 100) : 0;

  return (
    <section className={styles.box} aria-label="녹화 파일">
      <h3 className={styles.heading}>녹화 파일로 장면 확인하기</h3>
      <p className={styles.meta}>
        OBS 등으로 녹화한 파일을 고르면 이 기기에서 바로 후보 장면을 재생해요. 올리지 않아도 돼요.
      </p>
      <label className={styles.pick}>
        <input
          type="file"
          accept="video/*,audio/*,.mkv,.flv,.ts"
          onChange={(e) => choose(e.target.files?.[0])}
        />
        <span>{file ? '다른 녹화 파일 고르기' : '녹화 파일 고르기'}</span>
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
          <div className={styles.chips} role="group" aria-label="후보 장면 재생">
            {ordered.map((c, i) => (
              <button key={c.rank} type="button" className={styles.chip} onClick={() => play(c)}>
                ▶ {i + 1}. {clock(c.start + offset)}
              </button>
            ))}
          </div>
          <div className={styles.sync} role="group" aria-label="시각 맞추기">
            <span className={styles.meta}>장면이 어긋나면</span>
            {[-5, -1, 1, 5].map((d) => (
              <button
                key={d}
                type="button"
                className={styles.chip}
                onClick={() => onOffset(Math.max(0, offset + d))}
              >
                {d > 0 ? `+${d}초` : `${d}초`}
              </button>
            ))}
            <span className={styles.meta}>지금 {clock(offset)}만큼 더해요</span>
          </div>
        </>
      )}

      <div className={styles.upload}>
        {server?.status === 'uploaded' ? (
          <>
            <p className={styles.meta}>
              올린 녹화 파일 {gb(server.size)} · 2일 뒤 자동으로 지워져요
            </p>
            <Clips id={id} candidates={candidates} offset={offset} />
            <button type="button" className={styles.ghost} onClick={() => void remove()}>
              올린 파일 지우기
            </button>
          </>
        ) : progress ? (
          <>
            <progress className={styles.bar} value={progress.sent} max={progress.total} />
            <p className={styles.meta}>
              {pct}% · {gb(progress.sent)} / {gb(progress.total)}
            </p>
            <button type="button" className={styles.ghost} onClick={() => abort.current?.abort()}>
              멈추기
            </button>
          </>
        ) : (
          file && (
            <>
              <p className={styles.meta}>
                후보 장면을 클립·움짤로 만들려면 녹화 파일을 올려야 해요 ({gb(file.size)},
                20GB까지).
                {resumable && ' 올리다 멈춘 파일이에요. 이어서 올려요.'}
              </p>
              <button type="button" className={styles.primary} onClick={() => void upload()}>
                {resumable ? '이어서 올리기' : '녹화 파일 올리기'}
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
