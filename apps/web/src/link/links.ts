/**
 * 링크 구간 API와 "내 구간" 목록 (FEATURES F15).
 * 서버에는 유튜브 영상 ID와 구간만 보낸다. 내 구간 목록은 이 브라우저에만 둔다.
 */
import { ApiError } from '../gif/api';
import { readJson, writeJson } from '../lib/storage';

export type Link = { id: string; platform: 'youtube'; videoId: string; start: number; end: number };

const MINE_KEY = 'fitcut.link.mine';
const MINE_MAX = 30;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError('인터넷 연결을 확인하고 다시 시도해 주세요.', 'network', 0);
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

export async function saveLink(videoId: string, start: number, end: number): Promise<Link> {
  const { link } = await call<{ link: Link }>('/api/links', {
    method: 'POST',
    body: JSON.stringify({ videoId, start, end }),
  });
  return link;
}

export async function getLink(id: string): Promise<Link> {
  const { link } = await call<{ link: Link }>(`/api/links/${encodeURIComponent(id)}`);
  return link;
}

/** FitCut 구간 반복 링크: 열면 그 구간만 반복 재생 */
export const repeatUrl = (origin: string, id: string) => `${origin}/r/${id}`;

const isLink = (v: unknown): v is Link => {
  const l = v as Partial<Link> | null;
  return (
    !!l &&
    typeof l.id === 'string' &&
    typeof l.videoId === 'string' &&
    typeof l.start === 'number' &&
    typeof l.end === 'number'
  );
};

export function readMine(): Link[] {
  return readJson<Link[]>(MINE_KEY, [], (v): v is Link[] => Array.isArray(v) && v.every(isLink));
}

/** 새 구간을 맨 앞에. 같은 ID는 빼고 최대 30개 */
export function addMine(list: readonly Link[], link: Link): Link[] {
  const next = [link, ...list.filter((l) => l.id !== link.id)].slice(0, MINE_MAX);
  writeJson(MINE_KEY, next);
  return next;
}

export function removeMine(list: readonly Link[], id: string): Link[] {
  const next = list.filter((l) => l.id !== id);
  writeJson(MINE_KEY, next);
  return next;
}
