/**
 * 치지직 세션 API (공식 문서 Session, 2026-10-12 확인).
 * - 세션(유저): GET /open/v1/sessions/auth → { url }. 사용자당 연결 3개까지, 같은 사용자의 이벤트만 구독할 수 있다
 * - 소켓: Socket.IO 클라이언트 2.x(문서는 1.0.0~2.0.3), websocket 전송, 자동 재연결 끔
 * - 연결되면 SYSTEM {type:'connected', data:{sessionKey}} → sessionKey로 이벤트 구독
 * - 구독: POST /open/v1/sessions/events/subscribe/{chat|donation|subscription}?sessionKey=
 *   (권한: 채팅 메시지 조회, 후원 조회, 구독 조회). 세션당 이벤트 30개까지
 */
import { call, type Fetch } from './auth';

export type EventKind = 'chat' | 'donation' | 'subscription';
export const EVENT_KINDS: readonly EventKind[] = ['chat', 'donation', 'subscription'];

/** 문서의 연결 옵션 그대로 */
export const SOCKET_OPTIONS = {
  reconnection: false,
  'force new connection': true,
  timeout: 3000,
  transports: ['websocket'],
} as const;

const bearer = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

export async function createUserSession(fetchFn: Fetch, accessToken: string): Promise<string> {
  const c = await call<{ url?: string }>(fetchFn, '/open/v1/sessions/auth', {
    method: 'GET',
    headers: bearer(accessToken),
  });
  if (!c?.url) throw new Error('session url missing');
  return c.url;
}

export async function subscribe(
  fetchFn: Fetch,
  accessToken: string,
  kind: EventKind,
  sessionKey: string,
): Promise<void> {
  const q = new URLSearchParams({ sessionKey });
  await call<unknown>(fetchFn, `/open/v1/sessions/events/subscribe/${kind}?${q.toString()}`, {
    method: 'POST',
    headers: bearer(accessToken),
  });
}

export async function unsubscribe(
  fetchFn: Fetch,
  accessToken: string,
  kind: EventKind,
  sessionKey: string,
): Promise<void> {
  const q = new URLSearchParams({ sessionKey });
  await call<unknown>(fetchFn, `/open/v1/sessions/events/unsubscribe/${kind}?${q.toString()}`, {
    method: 'POST',
    headers: bearer(accessToken),
  });
}
