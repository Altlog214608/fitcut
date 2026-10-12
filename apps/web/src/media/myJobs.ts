/**
 * "내 작업 기록" (F16): 보관에 동의한 작업과 삭제 열쇠를 이 브라우저에만 둔다.
 * 로그인이 없어서 열쇠를 가진 브라우저만 지울 수 있다. 서버는 열쇠의 해시만 가진다.
 */
import { readJson, writeJson } from '../lib/storage';

export type MyJob = {
  id: string;
  kind: string;
  createdAt: string;
  retainUntil: string;
  token: string;
};

const KEY = 'fitcut.myJobs';
const MAX = 50;

const isMyJob = (v: unknown): v is MyJob => {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as Record<string, unknown>;
  return ['id', 'kind', 'createdAt', 'retainUntil', 'token'].every((k) => typeof x[k] === 'string');
};
const isList = (v: unknown): v is unknown[] => Array.isArray(v);

/** 보관 기간이 끝난 작업은 서버에서도 지워졌으니 목록에서 뺀다. 최신순 */
export function liveJobs(list: readonly unknown[], now: Date): MyJob[] {
  return list
    .filter(isMyJob)
    .filter((j) => new Date(j.retainUntil).getTime() > now.getTime())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX);
}

export function readMyJobs(now = new Date()): MyJob[] {
  return liveJobs(readJson<unknown[]>(KEY, [], isList), now);
}

export function addMyJob(job: MyJob): void {
  writeJson(KEY, liveJobs([job, ...readMyJobs().filter((j) => j.id !== job.id)], new Date()));
}

export function removeMyJob(id: string): void {
  writeJson(
    KEY,
    readMyJobs().filter((j) => j.id !== id),
  );
}
