/**
 * 링크 구간 (FEATURES F15). 영상은 저장하지 않고 YouTube 영상 ID와 구간(초)만 둔다 (ADR-007).
 * 순수 함수: 입력 검사, 기록 모양, 짧은 ID.
 */
import { randomBytes } from 'node:crypto';

export type CreateLink = { videoId: string; start: number; end: number };

export type LinkItem = {
  PK: string;
  SK: 'META';
  id: string;
  platform: 'youtube';
  videoId: string;
  start: number;
  end: number;
  createdAt: string;
  ttl: number;
};

/** 링크는 12개월 보관 (docs/ADMIN.md) */
export const LINK_TTL_SECONDS = 365 * 24 * 60 * 60;
/** 한 구간 최대 길이(초). 반복 재생용이라 넉넉히 */
export const LINK_MAX_SECONDS = 3 * 60 * 60;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LINK_ID = /^[A-Za-z0-9]{8}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const linkKey = (id: string) => ({ PK: `LINK#${id}`, SK: 'META' as const });
export const isLinkId = (id: string | undefined): id is string => !!id && LINK_ID.test(id);

/** 공유하기 좋은 짧은 ID (8자, 62^8 ≈ 2×10^14). 겹치면 저장할 때 조건부 쓰기로 다시 만든다 */
export function newLinkId(bytes: Uint8Array = randomBytes(8)): string {
  return Array.from(bytes.slice(0, 8), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const round = (t: number) => Math.round(t * 1000) / 1000;

export function parseCreateLink(
  body: unknown,
): { ok: true; value: CreateLink } | { ok: false; code: string; message: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, code: 'bad_body', message: '요청 형식이 올바르지 않아요.' };
  }
  const { videoId, start, end } = body as Record<string, unknown>;
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) {
    return { ok: false, code: 'bad_video', message: '유튜브 링크를 다시 확인해 주세요.' };
  }
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!num(start) || !num(end) || start < 0 || end <= start) {
    return {
      ok: false,
      code: 'bad_range',
      message: '구간을 다시 골라 주세요. 끝이 시작보다 뒤여야 해요.',
    };
  }
  if (end - start > LINK_MAX_SECONDS) {
    return { ok: false, code: 'too_long', message: '구간은 3시간 이하로 골라 주세요.' };
  }
  return { ok: true, value: { videoId, start: round(start), end: round(end) } };
}

export function newLink(id: string, input: CreateLink, now: Date): LinkItem {
  return {
    ...linkKey(id),
    id,
    platform: 'youtube',
    videoId: input.videoId,
    start: input.start,
    end: input.end,
    createdAt: now.toISOString(),
    ttl: Math.floor(now.getTime() / 1000) + LINK_TTL_SECONDS,
  };
}

export const publicLink = (item: LinkItem) => ({
  id: item.id,
  platform: item.platform,
  videoId: item.videoId,
  start: item.start,
  end: item.end,
});
