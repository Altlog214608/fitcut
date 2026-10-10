/** 업로드·잡 기록 모양 (DynamoDB 단일 테이블, docs/ARCHITECTURE.md 데이터 모델) */
import { LIMITS } from './limits';
import type { CreateJob, CreateUpload } from './validate';

/** 올린 원본 하나. 이 원본으로 잡을 여러 개 만들 수 있다 (ADR-033) */
export type UploadItem = {
  PK: string;
  SK: 'META';
  id: string;
  inputKey: string;
  contentType: string;
  fileSize: number;
  createdAt: string;
  /** 초 단위 만료 시각 (DynamoDB TTL). 원본이 버킷에서 지워질 때와 맞춘다 */
  ttl: number;
};

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

export type JobItem = {
  PK: string;
  SK: 'META';
  id: string;
  status: JobStatus;
  kind: CreateJob['kind'];
  params: {
    start: number;
    end: number;
    fps: number;
    width: number;
    height?: number;
    /** 음성 (워커 Params와 같은 이름) */
    fadeIn?: number;
    fadeOut?: number;
    normalize?: boolean;
    channels?: 1 | 2;
    bitrate?: number;
    rotate?: 90 | 180 | 270;
    flip?: boolean;
  };
  uploadId: string;
  inputKey: string;
  /** 원본 크기. Lambda·Fargate 분배 기준에 쓴다 (ADR-002) */
  fileSize: number;
  createdAt: string;
  /** 초 단위 만료 시각 (DynamoDB TTL) */
  ttl: number;
  error?: string;
  /** 워커가 채운다 (status done) */
  outputKey?: string;
  outputBytes?: number;
};

export const uploadKey = (id: string) => ({ PK: `UPLOAD#${id}`, SK: 'META' as const });
export const jobKey = (id: string) => ({ PK: `JOB#${id}`, SK: 'META' as const });

/** 업로드 원본 위치. 버킷 수명 주기로 1일 후 지워진다 */
export const inputKey = (uploadId: string) => `in/${uploadId}`;

const expiry = (now: Date, seconds: number) => Math.floor(now.getTime() / 1000) + seconds;

export function newUpload(id: string, input: CreateUpload, now: Date): UploadItem {
  return {
    ...uploadKey(id),
    id,
    inputKey: inputKey(id),
    contentType: input.contentType,
    fileSize: input.fileSize,
    createdAt: now.toISOString(),
    ttl: expiry(now, LIMITS.uploadTtlSeconds),
  };
}

/** 만료된 기록은 없는 것으로 본다 (DynamoDB TTL은 바로 지우지 않는다) */
export const isLive = (item: { ttl: number } | undefined, now: Date) =>
  !!item && item.ttl * 1000 > now.getTime();

export function newJob(id: string, input: CreateJob, upload: UploadItem, now: Date): JobItem {
  return {
    ...jobKey(id),
    id,
    status: 'queued',
    kind: input.kind,
    params: {
      start: input.start,
      end: input.end,
      fps: input.fps,
      width: input.width,
      ...(input.height ? { height: input.height } : {}),
      ...(input.audio ?? {}),
      ...(input.rotate ? { rotate: input.rotate, flip: input.flip ?? false } : {}),
    },
    uploadId: upload.id,
    inputKey: upload.inputKey,
    fileSize: upload.fileSize,
    createdAt: now.toISOString(),
    ttl: expiry(now, LIMITS.jobTtlSeconds),
  };
}

/** 화면에 돌려줄 잡 정보. 내부 키와 크기 같은 값은 빼고, 만료된 기록은 없는 것으로 본다 */
export function publicJob(item: JobItem | undefined, now: Date) {
  if (!item || !isLive(item, now)) return null;
  return {
    id: item.id,
    status: item.status,
    kind: item.kind,
    params: item.params,
    createdAt: item.createdAt,
    ...(item.error ? { error: item.error } : {}),
    ...(item.status === 'done' && item.outputBytes ? { outputBytes: item.outputBytes } : {}),
  };
}

/** 내려받을 때 쓸 파일 이름: fitcut_gif_480_0b8f4c56.gif, 크기를 정했으면 fitcut_gif_480x480_… */
export function downloadName(item: JobItem): string {
  const ext = item.outputKey?.split('.').at(-1) ?? item.kind;
  const { width, height } = item.params;
  if (item.kind === 'rotate' || item.kind === 'rotate-fast') {
    return `fitcut_rotated_${item.id.slice(0, 8)}.${ext}`;
  }
  if (['mp3', 'm4a', 'wav', 'm4r'].includes(item.kind)) {
    return `fitcut_${item.kind === 'm4r' ? 'ringtone' : 'audio'}_${item.id.slice(0, 8)}.${ext}`;
  }
  const size = height ? `${width}x${height}` : `${width}`;
  return `fitcut_${item.kind}_${size}_${item.id.slice(0, 8)}.${ext}`;
}

/** 업로드·잡 ID 모양 검사 (UUID). 이상한 값으로 DynamoDB를 부르지 않는다 */
export const isUuid = (id: string | undefined): id is string =>
  !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
