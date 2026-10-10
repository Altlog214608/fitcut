/**
 * 서버에서 만드는 도구(움짤·음성)가 같이 쓰는 흐름 (ADR-033):
 * 파일을 고르자마자 올리기 → 만들기(올리는 중이면 끝나는 대로) → 상태 조회 → 결과 저장.
 * 화면마다 다른 것(구간·형식·옵션)은 request와 key로 받는다. key가 바뀌면 지난 결과는 감춘다.
 */
import { isAudioKind } from '@fitcut/shared';
import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  contentTypeOf,
  createJob,
  createUpload,
  getJob,
  pollDelay,
  resultName,
  sendFile,
  type Job,
  type JobRequest,
  type Sending,
} from '../gif/api';
import { track } from '../lib/analytics';
import { SAVE_METHOD } from '../lib/inApp';
import { download, openDownloadUrl, openShare } from '../lib/save';

/** 이보다 오래 걸리면 멈춘 것으로 보고 다시 만들게 한다 (워커 최대 10분 + 여유) */
const POLL_LIMIT_MS = 15 * 60 * 1000;
/** 내려받기 주소는 10분 동안 쓸 수 있다. 조금 일찍 새로 받는다 */
const URL_FRESH_MS = 9 * 60 * 1000;
/** 다른 출처의 결과를 미리 받아 둔다 (아이폰 공유 화면·인앱 저장은 누른 순간 파일이 있어야 한다) */
const NEEDS_BLOB = SAVE_METHOD === 'share' || SAVE_METHOD === 'data-url';

export type MediaRequest = Omit<JobRequest, 'uploadId'>;
export type Tool = 'gif' | 'audio';

export type UploadView =
  | { state: 'starting' }
  | { state: 'sending'; sent: number; total: number }
  | { state: 'done'; id: string }
  | { state: 'failed'; message: string };
type UploadState = UploadView & { file: File; attempt: number };

export type Making =
  | { phase: 'pending'; key: string }
  | { phase: 'creating'; key: string }
  | { phase: 'running'; key: string; job: Job }
  | { phase: 'done'; key: string; job: Job; fetchedAt: number; blob: Blob | null }
  | { phase: 'failed'; key: string; message: string };

export const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : '잠시 후 다시 시도해 주세요.';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useMediaJob(file: File | null, tool: Tool, key: string) {
  const abortUpload = useRef<(() => void) | null>(null);
  /** 올리는 중에 '만들기'를 누르면 여기 두었다가 올리기가 끝나면 만든다 */
  const pending = useRef<{ key: string; request: MediaRequest } | null>(null);
  /** 파일을 바꾸거나 다시 만들면 지난 조회를 멈춘다 */
  const runToken = useRef(0);

  const [attempt, setAttempt] = useState(0);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [making, setMaking] = useState<Making | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [shareFile, setShareFile] = useState<File | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const up: UploadView =
    upload && upload.file === file && upload.attempt === attempt ? upload : { state: 'starting' };
  const now = making && making.key === key ? making : null;
  const busy =
    making?.phase === 'pending' || making?.phase === 'creating' || making?.phase === 'running';

  async function run(uploadId: string, runKey: string, req: MediaRequest) {
    const token = ++runToken.current;
    const live = () => runToken.current === token;
    setMaking({ phase: 'creating', key: runKey });
    try {
      let job = await createJob({ uploadId, ...req });
      const started = Date.now();
      let misses = 0;
      for (let i = 0; job.status === 'queued' || job.status === 'processing'; i += 1) {
        if (!live()) return;
        setMaking({ phase: 'running', key: runKey, job });
        if (Date.now() - started > POLL_LIMIT_MS) {
          throw new ApiError('시간이 너무 오래 걸려요. 다시 만들어 주세요.', 'timeout', 0);
        }
        await sleep(pollDelay(i));
        try {
          job = await getJob(job.id);
          misses = 0;
        } catch (error) {
          // 잠깐 끊긴 연결은 몇 번 더 기다린다
          if (!(error instanceof ApiError) || error.code !== 'network' || ++misses > 3) throw error;
        }
      }
      if (!live()) return;
      if (job.status === 'failed') {
        track('error_shown', { tool, code: 'job_failed' });
        setMaking({
          phase: 'failed',
          key: runKey,
          message: job.error ?? '변환하지 못했어요. 잠시 후 다시 시도해 주세요.',
        });
        return;
      }
      setMaking({ phase: 'done', key: runKey, job, fetchedAt: Date.now(), blob: null });
      if (NEEDS_BLOB && job.downloadUrl) {
        const blob = await fetch(job.downloadUrl)
          .then((r) => (r.ok ? r.blob() : null))
          .catch(() => null);
        if (blob && live()) {
          setMaking((m) => (m?.phase === 'done' && m.job.id === job.id ? { ...m, blob } : m));
        }
      }
    } catch (error) {
      if (!live()) return;
      track('error_shown', { tool, code: error instanceof ApiError ? error.code : 'unknown' });
      setMaking({ phase: 'failed', key: runKey, message: messageOf(error) });
    }
  }

  // ---------- 업로드: 파일을 고르자마자 올린다 (ADR-033) ----------
  useEffect(() => {
    if (!file) return;
    const type = contentTypeOf(file);
    if (!type) return;
    let cancelled = false;
    let sending: Sending | null = null;
    const set = (view: UploadView) => {
      if (!cancelled) setUpload({ ...view, file, attempt });
    };
    abortUpload.current = () => sending?.abort();
    void (async () => {
      try {
        const target = await createUpload(file.size, type);
        if (cancelled) return;
        sending = sendFile(target, file, (sent, total) => set({ state: 'sending', sent, total }));
        set({ state: 'sending', sent: 0, total: file.size });
        await sending.done;
        set({ state: 'done', id: target.id });
        const waiting = pending.current;
        pending.current = null;
        if (waiting && !cancelled) void run(target.id, waiting.key, waiting.request);
      } catch (error) {
        pending.current = null;
        set({ state: 'failed', message: messageOf(error) });
        if (!cancelled) {
          setMaking((m) =>
            m?.phase === 'pending'
              ? { phase: 'failed', key: m.key, message: '파일을 다시 올린 뒤 만들어 주세요.' }
              : m,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      sending?.abort();
    };
    // run은 매번 새로 만들어지지만 안에서 쓰는 값은 모두 인자와 ref로 받는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, attempt]);

  // ---------- 만드는 동안 걸린 시간 ----------
  const runningJob = making?.phase === 'running' ? making.job.id : null;
  useEffect(() => {
    if (!runningJob) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [runningJob]);

  /** 만들기. 올리는 중이면 끝나는 대로 만든다 */
  function make(request: MediaRequest) {
    setShareFile(null);
    setSaveError(null);
    if (up.state === 'done') {
      void run(up.id, key, request);
    } else if (up.state === 'failed') {
      setMaking({ phase: 'failed', key, message: '파일을 다시 올린 뒤 만들어 주세요.' });
    } else {
      pending.current = { key, request };
      setMaking({ phase: 'pending', key });
    }
  }

  /** 다른 파일을 골랐을 때: 지난 조회·대기·결과를 버린다 */
  function reset() {
    runToken.current += 1;
    pending.current = null;
    setMaking(null);
    setShareFile(null);
    setSaveError(null);
  }

  async function save() {
    if (now?.phase !== 'done') return;
    const name = resultName(now.job);
    setSaveError(null);
    const { width: w, height: h } = now.job.params;
    track('export_done', {
      tool,
      format: now.job.kind,
      ...(isAudioKind(now.job.kind) ? {} : { width: w, ...(h ? { height: h } : {}) }),
      sizeBytes: now.job.outputBytes ?? 0,
    });
    if (SAVE_METHOD === 'share' && now.blob) {
      const made = new File([now.blob], name, { type: now.blob.type });
      openShare(made, () => setShareFile(made));
      return;
    }
    if (SAVE_METHOD === 'data-url' && now.blob) {
      await download(now.blob, name, 'data-url');
      return;
    }
    let job = now.job;
    try {
      if (Date.now() - now.fetchedAt > URL_FRESH_MS) {
        job = await getJob(job.id);
        setMaking({ ...now, job, fetchedAt: Date.now() });
      }
      if (job.downloadUrl) openDownloadUrl(job.downloadUrl);
    } catch (error) {
      setSaveError(messageOf(error));
    }
  }

  return {
    up,
    retryUpload: () => setAttempt((a) => a + 1),
    cancelUpload: () => abortUpload.current?.(),
    making,
    now,
    busy,
    elapsed,
    shareFile,
    saveError,
    make,
    reset,
    clearResult: () => setMaking(null),
    save,
  };
}
