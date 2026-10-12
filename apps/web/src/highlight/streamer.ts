/**
 * 스트리머 채널 연결 API (M5, ADR-015·039). 세션은 HttpOnly 쿠키라 화면은 값을 볼 수 없다.
 * 로그인은 페이지 이동으로 한다: /api/streamer/chzzk/login → 치지직 → /highlight?connected=chzzk
 */
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
