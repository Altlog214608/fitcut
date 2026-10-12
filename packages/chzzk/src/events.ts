/**
 * 세션 소켓으로 오는 메시지를 우리 이벤트 형식으로 바꾼다 (docs/HIGHLIGHT.md 공통 이벤트 형식).
 * 닉네임, 작성자·후원자·구독자 채널 ID, 프로필, 이모티콘 주소는 버린다 (개인정보 최소 수집).
 */

export type ChatEvent = {
  broadcastId: string;
  /** 방송(수집) 시작 기준 초, 밀리초까지 */
  t: number;
  /** 원본 UTC 시각 (ms). 채팅은 messageTime, 후원·구독은 받은 시각 */
  at: number;
  type: 'chat' | 'donation' | 'subscription';
  text?: string;
  /** 후원 금액 (원) */
  amount?: number;
  donationType?: 'CHAT' | 'VIDEO';
  tier?: number;
  months?: number;
};

export type SystemMessage =
  | { type: 'connected'; sessionKey: string }
  | { type: 'subscribed' | 'unsubscribed' | 'revoked'; eventType: string; channelId: string };

/** 채팅 한 줄을 이 길이까지만 둔다 (도배·긴 붙여넣기) */
export const MAX_TEXT = 300;

type Raw = Record<string, unknown>;

/** Socket.IO가 JSON 문자열이나 객체로 줄 수 있어서 둘 다 받는다 */
export function parsePayload(data: unknown): Raw | null {
  if (typeof data === 'string') {
    try {
      const v: unknown = JSON.parse(data);
      return v && typeof v === 'object' ? (v as Raw) : null;
    } catch {
      return null;
    }
  }
  return data && typeof data === 'object' ? (data as Raw) : null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const clip = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s);
const seconds = (at: number, startedAt: number) => Math.max(0, Math.round(at - startedAt)) / 1000;

export function parseSystem(data: unknown): SystemMessage | null {
  const m = parsePayload(data);
  const d = m && parsePayload(m.data);
  if (!m || !d) return null;
  if (m.type === 'connected') {
    const sessionKey = str(d.sessionKey);
    return sessionKey ? { type: 'connected', sessionKey } : null;
  }
  if (m.type === 'subscribed' || m.type === 'unsubscribed' || m.type === 'revoked') {
    return { type: m.type, eventType: str(d.eventType) ?? '', channelId: str(d.channelId) ?? '' };
  }
  return null;
}

export function normalize(
  kind: 'CHAT' | 'DONATION' | 'SUBSCRIPTION',
  data: unknown,
  ctx: { broadcastId: string; channelId: string; startedAt: number; receivedAt: number },
): ChatEvent | null {
  const m = parsePayload(data);
  // 다른 채널 이벤트는 받지 않는다 (세션은 한 채널만 구독하지만 한 번 더 본다)
  if (!m || m.channelId !== ctx.channelId) return null;
  const base = { broadcastId: ctx.broadcastId };

  if (kind === 'CHAT') {
    const text = str(m.content);
    if (text === undefined) return null;
    const at = num(m.messageTime) ?? ctx.receivedAt;
    return { ...base, t: seconds(at, ctx.startedAt), at, type: 'chat', text: clip(text) };
  }
  const at = ctx.receivedAt;
  if (kind === 'DONATION') {
    const text = str(m.donationText);
    const amount = num(m.payAmount);
    const donationType = m.donationType === 'VIDEO' ? 'VIDEO' : 'CHAT';
    return {
      ...base,
      t: seconds(at, ctx.startedAt),
      at,
      type: 'donation',
      donationType,
      ...(amount !== undefined ? { amount } : {}),
      ...(text ? { text: clip(text) } : {}),
    };
  }
  const tier = num(m.tierNo);
  const months = num(m.month);
  return {
    ...base,
    t: seconds(at, ctx.startedAt),
    at,
    type: 'subscription',
    ...(tier !== undefined ? { tier } : {}),
    ...(months !== undefined ? { months } : {}),
  };
}
