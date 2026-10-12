/**
 * 녹화 파일 멀티파트 올리기 (모드 B, ADR-042). 조각(32MiB)마다 서명 주소로 S3에 바로 올린다.
 * 끊겨도 같은 파일을 다시 고르면 이미 올라간 조각은 건너뛴다 (서버가 ListParts로 알려준다).
 * 이 브라우저에는 "어느 방송에 어떤 크기·수정 시각의 파일을 올리던 중인지"만 남긴다 (파일 이름은 남기지 않는다).
 */
import { StreamerError } from './streamer';

export type RecordingView = {
  status: 'uploading' | 'uploaded';
  size: number;
  partSize: number;
  partCount: number;
  uploadedParts?: number[];
};

const base = (id: string) => `/api/streamer/broadcasts/${encodeURIComponent(id)}/recording`;
const CONCURRENCY = 3;
const RETRIES = 3;

async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    credentials: 'same-origin',
    ...(body
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!r.ok) {
    const b = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new StreamerError(b?.error?.message ?? '잠시 후 다시 시도해 주세요.');
  }
  return (r.status === 204 ? null : await r.json()) as T;
}

export const recordingStatus = (id: string) =>
  api<{ recording: RecordingView | null }>(base(id), 'GET').then((r) => r.recording);

export const deleteRecording = (id: string) => api<null>(base(id), 'DELETE');

type Marker = { size: number; lastModified: number };
const markerKey = (id: string) => `fitcut.recording.${id}`;

function readMarker(id: string): Marker | null {
  try {
    return JSON.parse(localStorage.getItem(markerKey(id)) ?? 'null') as Marker | null;
  } catch {
    return null;
  }
}
function writeMarker(id: string, m: Marker | null) {
  try {
    if (m) localStorage.setItem(markerKey(id), JSON.stringify(m));
    else localStorage.removeItem(markerKey(id));
  } catch {
    // 저장소를 못 쓰면 이어 올리기만 안 된다
  }
}

/** 이어 올릴 수 있는지: 서버에 올리던 것이 있고, 이 브라우저가 같은 파일(크기·수정 시각)로 시작했다 */
export function canResume(id: string, file: File, server: RecordingView | null): boolean {
  const m = readMarker(id);
  return (
    !!server &&
    server.status === 'uploading' &&
    server.size === file.size &&
    !!m &&
    m.size === file.size &&
    m.lastModified === file.lastModified
  );
}

function putPart(url: string, blob: Blob, onBytes: (n: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let sent = 0;
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => {
      onBytes(e.loaded - sent);
      sent = e.loaded;
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        onBytes(-sent);
        reject(new Error(`part ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      onBytes(-sent);
      reject(new Error('network'));
    };
    const abort = () => xhr.abort();
    xhr.onabort = () => {
      onBytes(-sent);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    xhr.send(blob);
  });
}

/**
 * 파일을 올린다. onProgress(올린 바이트, 전체). 취소하면 AbortError.
 * 이미 올라간 조각은 건너뛰고, 조각마다 세 번까지 다시 시도한다.
 */
export async function uploadRecording(
  id: string,
  file: File,
  onProgress: (sent: number, total: number) => void,
  signal: AbortSignal,
): Promise<RecordingView> {
  const server = await recordingStatus(id);
  let plan: RecordingView;
  let done = new Set<number>();
  if (canResume(id, file, server) && server) {
    plan = server;
    done = new Set(server.uploadedParts ?? []);
  } else {
    plan = (
      await api<{ recording: RecordingView }>(base(id), 'POST', {
        size: file.size,
        contentType: file.type,
        name: file.name,
      })
    ).recording;
    writeMarker(id, { size: file.size, lastModified: file.lastModified });
  }

  const partBytes = (n: number) => Math.min(plan.partSize, file.size - (n - 1) * plan.partSize);
  let sent = [...done].reduce((s, n) => s + partBytes(n), 0);
  onProgress(sent, file.size);
  const todo = Array.from({ length: plan.partCount }, (_, i) => i + 1).filter((n) => !done.has(n));

  const urls = new Map<number, string>();
  async function urlFor(n: number): Promise<string> {
    const cached = urls.get(n);
    if (cached) return cached;
    // 서명 주소는 1시간이라 필요할 때 50개씩 받는다
    const batch = todo.filter((k) => k >= n && !urls.has(k)).slice(0, 50);
    const { parts } = await api<{ parts: { partNumber: number; url: string }[] }>(
      `${base(id)}/parts`,
      'POST',
      { partNumbers: batch },
    );
    for (const p of parts) urls.set(p.partNumber, p.url);
    return urls.get(n) ?? '';
  }

  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const n = todo[next++] as number;
      const start = (n - 1) * plan.partSize;
      const blob = file.slice(start, start + partBytes(n));
      for (let attempt = 1; ; attempt++) {
        try {
          await putPart(
            await urlFor(n),
            blob,
            (d) => {
              sent += d;
              onProgress(sent, file.size);
            },
            signal,
          );
          break;
        } catch (e) {
          if (signal.aborted || attempt >= RETRIES) throw e;
          urls.delete(n); // 주소가 만료됐을 수 있다
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const result = (await api<{ recording: RecordingView }>(`${base(id)}/complete`, 'POST'))
    .recording;
  writeMarker(id, null);
  return result;
}
