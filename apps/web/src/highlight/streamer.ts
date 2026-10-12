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
  analysisStatus?: 'done';
};

export type BroadcastDetail = Broadcast & {
  analyzedAt?: string;
  durationSec?: number;
  reactionCount?: number;
  candidates: Candidate[];
  /** 10초마다 채팅 수 (그래프) */
  chatPer10s: number[];
};

async function call<T>(path: string, method = 'GET'): Promise<T> {
  const r = await fetch(path, { method, credentials: 'same-origin' });
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

/** 수집이 끝난 이유를 화면 문구로 (services/collector/src/rules.ts) */
export function stopReasonText(reason: string | undefined): string {
  switch (reason) {
    case 'requested':
      return '종료를 눌러 끝났어요';
    case 'idle':
      return '30분 동안 채팅이 없어 끝났어요';
    case 'max_duration':
      return '최대 8시간이 지나 끝났어요';
    case 'terminated':
      return '수집기가 정리되며 끝났어요';
    case 'revoked':
      return '치지직에서 권한이 회수됐어요';
    case 'token':
      return '치지직 권한이 만료됐어요. 채널을 다시 연결해 주세요';
    case 'disconnected':
      return '치지직 연결이 계속 끊겨 멈췄어요';
    case 'run_task':
      return '수집기를 시작하지 못했어요';
    default:
      return '수집이 멈췄어요';
  }
}

/** 콜백이 붙여 보낸 ?error= 값을 화면 문구로 */
export function callbackMessage(error: string | null): string | null {
  switch (error) {
    case null:
      return null;
    case 'denied':
      return '치지직에서 권한을 허용하지 않아 연결하지 않았어요.';
    case 'state':
      return '연결 시간이 지났거나 다른 창에서 시작한 연결이에요. 다시 연결해 주세요.';
    default:
      return '치지직과 연결하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}
