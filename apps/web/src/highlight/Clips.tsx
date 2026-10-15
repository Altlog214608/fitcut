/**
 * 모드 B: 올린 녹화 파일에서 후보 구간 클립 만들기 (ADR-043).
 * 서버가 구간만 읽어 720p MP4로 자른다 → 받기, 또는 움짤 도구로 넘겨 프레임 단위로 다듬기 (F3·F4 재사용).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { getJob, type Job } from '../gif/api';
import { openDownloadUrl } from '../lib/save';
import { setSelectedFile } from '../lib/selectedFile';
import { StreamerError } from './streamer';
import { clock, type Candidate } from './timeline';
import { useT } from '../i18n/context';
import styles from './Recording.module.css';

type ClipState =
  { status: 'making' } | { status: 'done'; job: Job } | { status: 'failed'; message: string };

const POLL_MS = 2000;

async function createClip(
  id: string,
  start: number,
  end: number,
  fallback: string,
): Promise<string> {
  const r = await fetch(`/api/streamer/broadcasts/${encodeURIComponent(id)}/clips`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ start, end }),
  });
  const body = (await r.json().catch(() => null)) as {
    jobId?: string;
    error?: { message?: string };
  } | null;
  if (!r.ok || !body?.jobId) {
    throw new StreamerError(body?.error?.message ?? fallback);
  }
  return body.jobId;
}

export function Clips({
  id,
  candidates,
  offset,
}: {
  id: string;
  candidates: readonly Candidate[];
  offset: number;
}) {
  const all = useT();
  const t = all.highlight;
  const [clips, setClips] = useState<Record<number, ClipState>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const alive = useRef(true);
  const navigate = useNavigate();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const set = (rank: number, s: ClipState) => {
    if (alive.current) setClips((cur) => ({ ...cur, [rank]: s }));
  };

  async function make(c: Candidate) {
    set(c.rank, { status: 'making' });
    try {
      const jobId = await createClip(
        id,
        Math.max(0, c.start + offset),
        c.end + offset,
        t.clipFailed,
      );
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const job = await getJob(jobId);
        if (job.status === 'done') return set(c.rank, { status: 'done', job });
        if (job.status === 'failed') {
          return set(c.rank, {
            status: 'failed',
            message: job.error ? all.apiError('', job.error) : t.clipFailed,
          });
        }
      }
    } catch (e) {
      set(c.rank, {
        status: 'failed',
        message: e instanceof Error ? all.apiError('', e.message) : t.clipFailed,
      });
    }
  }

  /** 클립을 받아 움짤 도구의 원본으로 넘긴다 (홈에서 파일을 고른 것과 같다) */
  async function toGif(rank: number, job: Job) {
    if (!job.downloadUrl) return;
    setBusy(rank);
    try {
      const blob = await (await fetch(job.downloadUrl)).blob();
      setSelectedFile(new File([blob], `highlight-${rank}.mp4`, { type: 'video/mp4' }));
      void navigate('/gif');
    } catch {
      set(rank, { status: 'failed', message: t.clipLoadFailed });
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  const ordered = [...candidates].sort((a, b) => a.start - b.start);
  return (
    <ul className={styles.clips} aria-label={t.clips}>
      {ordered.map((c, i) => {
        const s = clips[c.rank];
        return (
          <li key={c.rank} className={styles.clip}>
            <span className={styles.clipTime}>
              {i + 1}. {clock(c.start + offset)} – {clock(c.end + offset)}
            </span>
            {!s || s.status === 'failed' ? (
              <button type="button" className={styles.chip} onClick={() => void make(c)}>
                {t.makeClip}
              </button>
            ) : s.status === 'making' ? (
              <span className={styles.meta}>{t.cutting}</span>
            ) : (
              <span className={styles.clipActions}>
                <button
                  type="button"
                  className={styles.chip}
                  onClick={() => s.job.downloadUrl && openDownloadUrl(s.job.downloadUrl)}
                >
                  {t.getClip}
                </button>
                <button
                  type="button"
                  className={styles.chip}
                  disabled={busy === c.rank}
                  onClick={() => void toGif(c.rank, s.job)}
                >
                  {t.toGif}
                </button>
              </span>
            )}
            {s?.status === 'failed' && (
              <span className={styles.meta} role="status">
                {s.message}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
