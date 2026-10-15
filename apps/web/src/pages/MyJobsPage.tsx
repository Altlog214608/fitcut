/**
 * 내 작업 기록 (F16): 이 브라우저에서 보관에 동의한 작업. 받기와 지우기만 한다.
 * 목록과 삭제 열쇠는 이 브라우저에만 있다. 다른 기기·브라우저에서는 보이지 않는다.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { Koi } from '../components/Koi';
import { ApiError, deleteJob, getJob } from '../gif/api';
import { useT } from '../i18n/context';
import { openDownloadUrl } from '../lib/save';
import { readMyJobs, removeMyJob, type MyJob } from '../media/myJobs';
import styles from './MyJobsPage.module.css';

const daysLeft = (iso: string, now: Date) =>
  Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));

export function MyJobsPage() {
  const all = useT();
  const t = all.myJobs;
  const [jobs, setJobs] = useState<MyJob[]>(() => readMyJobs());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const now = new Date();
  const dateText = (iso: string) =>
    new Date(iso).toLocaleDateString(all.locale, { month: 'long', day: 'numeric' });
  const errorText = (error: unknown) =>
    error instanceof ApiError
      ? all.apiError(error.code, error.message)
      : all.apiError('server', '잠시 후 다시 시도해 주세요.');

  async function save(job: MyJob) {
    setBusyId(job.id);
    setMessage(null);
    try {
      const fresh = await getJob(job.id);
      if (fresh.status === 'done' && fresh.downloadUrl) openDownloadUrl(fresh.downloadUrl);
      else setMessage(t.noResult);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(job: MyJob) {
    if (!window.confirm(t.confirmRemove)) return;
    setBusyId(job.id);
    setMessage(null);
    try {
      await deleteJob(job.id, job.token);
      removeMyJob(job.id);
      setJobs(readMyJobs());
      setMessage(t.removed);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t.title}</h1>
      <p className={styles.summary}>{t.summary}</p>
      {jobs.length === 0 ? (
        <div className={styles.emptyBox}>
          <Koi mood="sleepy" size={64} />
          <p className={styles.empty}>
            {t.empty} <Link to="/">{t.home}</Link>
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {jobs.map((job) => (
            <li key={job.id} className={styles.item}>
              <div className={styles.info}>
                <b>{t.kinds[job.kind] ?? job.kind.toUpperCase()}</b>
                <span className={styles.meta}>
                  {t.meta(dateText(job.createdAt), daysLeft(job.retainUntil, now))}
                </span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.ghost}
                  disabled={busyId === job.id}
                  onClick={() => void save(job)}
                >
                  {t.get}
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={busyId === job.id}
                  onClick={() => void remove(job)}
                >
                  {t.remove}
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
