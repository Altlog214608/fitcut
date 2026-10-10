/**
 * 잡 API 클라이언트 (ADR-033). 같은 주소의 /api/* 로 부른다 (CloudFront → HTTP API).
 * 1) createUpload → 2) sendFile(S3 presigned POST, 진행률·취소) → 3) createJob → 4) getJob 반복 조회
 */
import { JOB_LIMITS, type JobKind } from '@fitcut/shared';

export type Upload = { id: string; url: string; fields: Record<string, string> };

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';
export type Job = {
  id: string;
  status: JobStatus;
  kind: JobKind;
  params: { start: number; end: number; fps: number; width: number };
  error?: string;
  outputBytes?: number;
  /** done일 때만. 10분 동안 쓸 수 있다 */
  downloadUrl?: string;
};

export type JobRequest = {
  uploadId: string;
  kind: JobKind;
  start: number;
  end: number;
  fps: number;
  width: number;
};

/** 화면에 그대로 보여줄 문구를 담은 오류 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const NETWORK = '인터넷 연결을 확인하고 다시 시도해 주세요.';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(NETWORK, 'network', 0);
  }
  const body = (await res.json().catch(() => null)) as
    (T & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !body) {
    throw new ApiError(
      body?.error?.message ?? '잠시 후 다시 시도해 주세요.',
      body?.error?.code ?? 'server',
      res.status,
    );
  }
  return body;
}

const EXT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

/** 서버가 받는 영상 형식. 브라우저가 형식을 모르면(Windows의 .mov 등) 확장자로 정한다 */
export function contentTypeOf(file: Pick<File, 'name' | 'type'>): string | null {
  const allowed: readonly string[] = JOB_LIMITS.contentTypes;
  if (allowed.includes(file.type)) return file.type;
  const ext = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  return EXT_TYPES[ext] ?? null;
}

export async function createUpload(fileSize: number, contentType: string): Promise<Upload> {
  const { upload } = await call<{ upload: Upload }>('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ fileSize, contentType }),
  });
  return upload;
}

export type Sending = { done: Promise<void>; abort: () => void };

/** S3에 직접 올린다. fetch는 업로드 진행률을 알 수 없어 XMLHttpRequest를 쓴다 */
export function sendFile(
  upload: Upload,
  file: Blob,
  onProgress: (sent: number, total: number) => void,
): Sending {
  const xhr = new XMLHttpRequest();
  const done = new Promise<void>((resolve, reject) => {
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError('영상을 올리지 못했어요. 다시 올려 주세요.', 'upload', xhr.status));
    };
    xhr.onerror = () => reject(new ApiError(`영상을 올리지 못했어요. ${NETWORK}`, 'network', 0));
    xhr.onabort = () => reject(new ApiError('업로드를 취소했어요.', 'aborted', 0));
  });
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append('file', file);
  xhr.open('POST', upload.url);
  xhr.send(form);
  return { done, abort: () => xhr.abort() };
}

export async function createJob(request: JobRequest): Promise<Job> {
  const { job } = await call<{ job: Job }>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return job;
}

export async function getJob(id: string): Promise<Job> {
  const { job } = await call<{ job: Job }>(`/api/jobs/${encodeURIComponent(id)}`);
  return job;
}

/** 저장할 파일 이름. 서버가 첨부 파일로 줄 때와 같다 (services/api downloadName) */
export function resultName(job: Pick<Job, 'id' | 'kind' | 'params'>): string {
  return `fitcut_${job.kind}_${job.params.width}_${job.id.slice(0, 8)}.${job.kind}`;
}

/** 상태 조회 간격: 처음엔 자주, 길어지면 천천히 (ARCHITECTURE 5단계) */
export function pollDelay(attempt: number): number {
  return [1000, 1000, 1500, 2000, 2000, 3000][attempt] ?? 4000;
}
