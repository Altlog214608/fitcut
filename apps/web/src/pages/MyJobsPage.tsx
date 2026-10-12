/**
 * 내 작업 기록 (F16): 이 브라우저에서 보관에 동의한 작업. 받기와 지우기만 한다.
 * 목록과 삭제 열쇠는 이 브라우저에만 있다. 다른 기기·브라우저에서는 보이지 않는다.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError, deleteJob, getJob } from '../gif/api';
import { openDownloadUrl } from '../lib/save';
import { readMyJobs, removeMyJob, type MyJob } from '../media/myJobs';
import styles from './MyJobsPage.module.css';

const KIND_LABEL: Record<string, string> = {
  gif: 'GIF',
  webp: 'WebP',
  mp4: 'MP4',
  mp3: 'MP3',
  m4a: 'M4A',
  wav: 'WAV',
  m4r: '벨소리',
  rotate: '세로로 돌리기',
  'rotate-fast': '세로로 돌리기',
};

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
const daysLeft = (iso: string, now: Date) =>
  Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));

export function MyJobsPage() {
  const [jobs, setJobs] = useState<MyJob[]>(() => readMyJobs());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const now = new Date();

  async function save(job: MyJob) {
    setBusyId(job.id);
    setMessage(null);
    try {
      const fresh = await getJob(job.id);
      if (fresh.status === 'done' && fresh.downloadUrl) openDownloadUrl(fresh.downloadUrl);
      else setMessage('이 작업은 결과가 없어요. 만들지 못했거나 이미 지워졌어요.');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : '잠시 후 다시 시도해 주세요.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(job: MyJob) {
    if (!window.confirm('원본과 결과를 지금 지울까요? 되돌릴 수 없어요.')) return;
    setBusyId(job.id);
    setMessage(null);
    try {
      await deleteJob(job.id, job.token);
      removeMyJob(job.id);
      setJobs(readMyJobs());
      setMessage('지웠어요.');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : '잠시 후 다시 시도해 주세요.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>내 작업 기록</h1>
      <p className={styles.summary}>
        30일 보관에 동의한 작업이에요. 이 브라우저에서 만든 것만 보이고, 언제든 지울 수 있어요.
      </p>
      {jobs.length === 0 ? (
        <p className={styles.empty}>
          보관 중인 작업이 없어요. 보관하지 않은 파일은 1~2일 안에 자동으로 지워져요.{' '}
          <Link to="/">처음으로</Link>
        </p>
      ) : (
        <ul className={styles.list}>
          {jobs.map((job) => (
            <li key={job.id} className={styles.item}>
              <div className={styles.info}>
                <b>{KIND_LABEL[job.kind] ?? job.kind}</b>
                <span className={styles.meta}>
                  {dateText(job.createdAt)} 만듦 · {daysLeft(job.retainUntil, now)}일 뒤 자동 삭제
                </span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.ghost}
                  disabled={busyId === job.id}
                  onClick={() => void save(job)}
                >
                  받기
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={busyId === job.id}
                  onClick={() => void remove(job)}
                >
                  지우기
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}
    </div>
  );
}
