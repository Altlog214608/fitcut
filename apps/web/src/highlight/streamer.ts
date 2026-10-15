/**
 * 스트리머 채널 연결 API (M5, ADR-015·039). 세션은 HttpOnly 쿠키라 화면은 값을 볼 수 없다.
 * 로그인은 페이지 이동으로 한다: /api/streamer/chzzk/login → 치지직 → /highlight?connected=chzzk
 */
import type { Candidate } from './timeline';

export const CHZZK_LOGIN_PATH = '/api/streamer/chzzk/login';

export type Connection = {
  platform: 'chzzk';
  channelId: string;
  channelName: string;
  connectedAt: string;
};

export class StreamerError extends Error {}

export async function getConnection(): Promise<Connection | null> {
  const r = await fetch('/api/streamer/me', { credentials: 'same-origin' });
  if (!r.ok) throw new StreamerError('연결 상태를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  return ((await r.json()) as { connection: Connection | null }).connection;
}

export async function disconnect(): Promise<void> {
  const r = await fetch('/api/streamer/connection', {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  // 세션이 이미 끝났으면(401) 이 브라우저에서는 연결이 없는 것과 같다
  if (!r.ok && r.status !== 401) {
    throw new StreamerError('연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/streamer/logout', { method: 'POST', credentials: 'same-origin' });
}

export type Broadcast = {
  id: string;
  status: 'starting' | 'collecting' | 'done' | 'failed';
  requestedAt: string;
  startedAt?: string;
  endedAt?: string;
  chatCount: number;
  donationCount: number;
  subscriptionCount: number;
  stopRequested?: boolean;
  stopReason?: string;
  analysisStatus?: 'running' | 'done';
  /** 채팅 없이 녹화 파일만 분석하는 기록 (모드 C) */
  source?: 'file';
};

export type BroadcastDetail = Broadcast & {
  analyzedAt?: string;
  durationSec?: number;
  reactionCount?: number;
  candidates: Candidate[];
  /** 10초마다 채팅 수 (그래프) */
  chatPer10s: number[];
  /** 10초마다 평균 소리 크기 (dB). 녹화 파일 소리를 분석했을 때만 */
  loudPer10s?: number[];
};

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new StreamerError(body?.error?.message ?? '잠시 후 다시 시도해 주세요.');
  }
  return (await r.json()) as T;
}

export const listBroadcasts = () =>
  call<{ broadcasts: Broadcast[] }>('/api/streamer/broadcasts').then((r) => r.broadcasts);

export const startBroadcast = () =>
  call<{ broadcast: Broadcast }>('/api/streamer/broadcasts', 'POST').then((r) => r.broadcast);

/** 모드 C: 채팅 없이 녹화 파일만 분석할 기록 */
export const startFileAnalysis = () =>
  call<{ broadcast: Broadcast }>('/api/streamer/broadcasts', 'POST', { source: 'file' }).then(
    (r) => r.broadcast,
  );

/** 녹화 파일 소리 크기로 (다시) 분석. offset: 녹화 파일 시각 = 채팅 시각 + offset (모드 C는 0) */
export const analyzeSound = (id: string, offset: number) =>
  call<{ jobId: string }>(`/api/streamer/broadcasts/${encodeURIComponent(id)}/loudness`, 'POST', {
    offset,
  });

export const stopBroadcast = (id: string) =>
  call<{ broadcast: Broadcast }>(
    `/api/streamer/broadcasts/${encodeURIComponent(id)}/stop`,
    'POST',
  ).then((r) => r.broadcast);

export const getBroadcast = (id: string) =>
  call<{ broadcast: BroadcastDetail }>(`/api/streamer/broadcasts/${encodeURIComponent(id)}`).then(
    (r) => r.broadcast,
  );

export const isActive = (b: Broadcast) => b.status === 'starting' || b.status === 'collecting';

/** 콜백이 붙여 보낸 ?error= 값의 종류. 문구는 i18n 사전 highlight.callback,
 * 수집이 끝난 이유(services/collector/src/rules.ts)는 highlight.stopReasons */
export function callbackKind(error: string | null): 'denied' | 'state' | 'failed' | null {
  if (error === null) return null;
  return error === 'denied' || error === 'state' ? error : 'failed';
}
