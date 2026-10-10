/** 잡 기록 모양 (DynamoDB 단일 테이블, docs/ARCHITECTURE.md 데이터 모델) */
import { LIMITS } from './limits';
import type { CreateJob } from './validate';

export type JobStatus = 'created' | 'uploaded' | 'queued' | 'processing' | 'done' | 'failed';

export type JobItem = {
  PK: string;
  SK: 'META';
  id: string;
  status: JobStatus;
  kind: CreateJob['kind'];
  params: { start: number; end: number; fps: number; width: number };
  inputKey: string;
  contentType: string;
  fileSize: number;
  createdAt: string;
  /** 초 단위 만료 시각 (DynamoDB TTL) */
  ttl: number;
  error?: string;
};

export const jobKey = (id: string) => ({ PK: `JOB#${id}`, SK: 'META' as const });

/** 업로드 원본 위치. 버킷 수명 주기로 1일 후 지워진다 */
export const inputKey = (id: string) => `in/${id}`;

export function newJob(id: string, input: CreateJob, now: Date): JobItem {
  return {
    ...jobKey(id),
    id,
    status: 'created',
    kind: input.kind,
    params: { start: input.start, end: input.end, fps: input.fps, width: input.width },
    inputKey: inputKey(id),
    contentType: input.contentType,
    fileSize: input.fileSize,
    createdAt: now.toISOString(),
    ttl: Math.floor(now.getTime() / 1000) + LIMITS.jobTtlSeconds,
  };
}

/** 화면에 돌려줄 잡 정보. 내부 키와 크기 같은 값은 빼고, 만료된 기록은 없는 것으로 본다 */
export function publicJob(item: JobItem | undefined, now: Date) {
  if (!item || item.ttl * 1000 <= now.getTime()) return null;
  return {
    id: item.id,
    status: item.status,
    kind: item.kind,
    params: item.params,
    createdAt: item.createdAt,
    ...(item.error ? { error: item.error } : {}),
  };
}

/** 잡 ID 모양 검사 (UUID). 이상한 값으로 DynamoDB를 부르지 않는다 */
export const isJobId = (id: string | undefined): id is string =>
  !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
