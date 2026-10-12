/**
 * 치지직 Open API 중 채널 연결에 쓰는 부분 (공식 문서 chzzk.gitbook.io/chzzk, 2026-10-12 확인).
 * - 인증 코드: https://chzzk.naver.com/account-interlock (Open API와 다른 도메인)
 * - 토큰 발급·갱신·삭제: POST https://openapi.chzzk.naver.com/auth/v1/token(/revoke), JSON 본문
 * - 응답은 { code, message, content } 로 감싸져 온다
 * 액세스 토큰 1일, 리프레시 토큰 30일이며 리프레시 토큰은 한 번만 쓸 수 있다.
 */

export const AUTH_URL = 'https://chzzk.naver.com/account-interlock';
export const API_BASE = 'https://openapi.chzzk.naver.com';

export type ChzzkTokens = {
  accessToken: string;
  refreshToken: string;
  /** ISO 시각. 응답의 expiresIn(초, 문자열)으로 계산한다 */
  expiresAt: string;
  scope?: string;
};

export type ChzzkUser = { channelId: string; channelName: string };

export type Fetch = typeof fetch;

export class ChzzkError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ clientId, redirectUri, state });
  return `${AUTH_URL}?${q.toString()}`;
}

async function call<T>(fetchFn: Fetch, path: string, init: RequestInit): Promise<T> {
  const r = await fetchFn(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(5000),
  });
  const text = await r.text();
  let body: { code?: number; message?: string | null; content?: unknown } = {};
  try {
    body = text ? (JSON.parse(text) as typeof body) : {};
  } catch {
    // 본문이 JSON이 아니면 상태 코드만 본다
  }
  if (!r.ok) throw new ChzzkError(r.status, body.message ?? `HTTP ${r.status}`);
  return body.content as T;
}

type TokenContent = {
  accessToken: string;
  refreshToken: string;
  expiresIn: string | number;
  scope?: string;
};

function toTokens(c: TokenContent, now: Date): ChzzkTokens {
  if (!c?.accessToken || !c.refreshToken) throw new ChzzkError(502, 'token missing');
  const seconds = Number(c.expiresIn) || 86400;
  return {
    accessToken: c.accessToken,
    refreshToken: c.refreshToken,
    expiresAt: new Date(now.getTime() + seconds * 1000).toISOString(),
    ...(c.scope ? { scope: c.scope } : {}),
  };
}

export async function exchangeCode(
  fetchFn: Fetch,
  client: { clientId: string; clientSecret: string },
  code: string,
  state: string,
  now: Date,
): Promise<ChzzkTokens> {
  const c = await call<TokenContent>(fetchFn, '/auth/v1/token', {
    method: 'POST',
    body: JSON.stringify({ grantType: 'authorization_code', ...client, code, state }),
  });
  return toTokens(c, now);
}

export async function refreshTokens(
  fetchFn: Fetch,
  client: { clientId: string; clientSecret: string },
  refreshToken: string,
  now: Date,
): Promise<ChzzkTokens> {
  const c = await call<TokenContent>(fetchFn, '/auth/v1/token', {
    method: 'POST',
    body: JSON.stringify({ grantType: 'refresh_token', refreshToken, ...client }),
  });
  return toTokens(c, now);
}

/** 같은 클라이언트·사용자로 받은 토큰이 모두 지워진다 (문서) */
export async function revokeToken(
  fetchFn: Fetch,
  client: { clientId: string; clientSecret: string },
  token: string,
  tokenTypeHint: 'access_token' | 'refresh_token',
): Promise<void> {
  await call<unknown>(fetchFn, '/auth/v1/token/revoke', {
    method: 'POST',
    body: JSON.stringify({ ...client, token, tokenTypeHint }),
  });
}

export async function currentUser(fetchFn: Fetch, accessToken: string): Promise<ChzzkUser> {
  const c = await call<ChzzkUser>(fetchFn, '/open/v1/users/me', {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!c?.channelId) throw new ChzzkError(502, 'channel missing');
  return { channelId: c.channelId, channelName: c.channelName ?? '' };
}
