/**
 * 사용 이벤트 보내기 (docs/ADMIN.md). 몇 초씩 모아 /api/events로 보내고, 화면을 떠날 때는 sendBeacon으로 보낸다.
 * - sessionId는 이 탭에서만 쓰는 무작위 값이다 (sessionStorage). 신원과 연결하지 않는다
 * - 브라우저의 추적 거부(Do Not Track, Global Privacy Control)를 켜면 보내지 않는다
 * - 파일명·파일 내용은 보내지 않는다. 허용한 필드는 @fitcut/shared CLIENT_EVENTS에 있다
 */
import { MAX_EVENTS_PER_REQUEST, type ClientEventName, type EventProps } from '@fitcut/shared';

const ENDPOINT = '/api/events';
const FLUSH_MS = 5000;
const SESSION_KEY = 'fitcut.session';

export const APP_VERSION = String(import.meta.env.VITE_APP_VERSION ?? 'dev').slice(0, 7);

type Pending = { name: ClientEventName; ts: number } & EventProps;

export type DeviceInfo = {
  deviceType: 'mobile' | 'tablet' | 'desktop';
  os: 'ios' | 'android' | 'windows' | 'macos' | 'linux' | 'other';
  browser: 'safari' | 'chrome' | 'samsung' | 'firefox' | 'edge' | 'inapp' | 'other';
};

/** 기기 종류는 대략만 (순수 함수) */
export function deviceInfo(ua: string, maxTouchPoints = 0, inApp = false): DeviceInfo {
  const ipadDesktop = /Macintosh/.test(ua) && maxTouchPoints > 1;
  const os: DeviceInfo['os'] =
    /iPhone|iPad|iPod/.test(ua) || ipadDesktop
      ? 'ios'
      : /Android/.test(ua)
        ? 'android'
        : /Windows/.test(ua)
          ? 'windows'
          : /Macintosh/.test(ua)
            ? 'macos'
            : /Linux/.test(ua)
              ? 'linux'
              : 'other';
  const tablet = /iPad/.test(ua) || ipadDesktop || (/Android/.test(ua) && !/Mobile/.test(ua));
  const mobile = !tablet && /Mobile|iPhone|Android/.test(ua);
  const browser: DeviceInfo['browser'] = inApp
    ? 'inapp'
    : /SamsungBrowser/.test(ua)
      ? 'samsung'
      : /Edg\//.test(ua)
        ? 'edge'
        : /Firefox|FxiOS/.test(ua)
          ? 'firefox'
          : /Chrome|CriOS/.test(ua)
            ? 'chrome'
            : /Safari/.test(ua)
              ? 'safari'
              : 'other';
  return { deviceType: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', os, browser };
}

/** 다른 사이트에서 왔을 때만 그 도메인 (경로·검색어는 버린다) */
export function referrerDomain(referrer: string, ownHost: string): string | undefined {
  try {
    const host = new URL(referrer).hostname;
    return host && host !== ownHost ? host : undefined;
  } catch {
    return undefined;
  }
}

function optedOut(): boolean {
  if (typeof navigator === 'undefined') return true;
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  return n.doNotTrack === '1' || n.globalPrivacyControl === true;
}

function sessionId(): string {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return 'no-storage';
  }
}

const queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function send(events: Pending[], beacon: boolean) {
  const sid = sessionId();
  const body = JSON.stringify({
    events: events.map((e) => ({ ...e, sessionId: sid, appVersion: APP_VERSION })),
  });
  if (beacon && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    return;
  }
  void fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export function flush(beacon = false) {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length > 0) send(queue.splice(0, MAX_EVENTS_PER_REQUEST), beacon);
}

/** 이벤트 하나를 모아 둔다. 보내기에 실패해도 화면에는 영향이 없다 */
export function track(name: ClientEventName, props: EventProps = {}) {
  if (optedOut()) return;
  queue.push({ ...props, name, ts: Date.now() });
  if (queue.length >= MAX_EVENTS_PER_REQUEST) flush();
  else timer ??= setTimeout(() => flush(), FLUSH_MS);
}

let started = false;

/** 앱을 열 때 한 번. 화면을 떠날 때 남은 이벤트를 보내도록 건다 */
export function startSession(inApp: boolean) {
  if (started || optedOut()) return;
  started = true;
  const info = deviceInfo(navigator.userAgent, navigator.maxTouchPoints, inApp);
  const ref = referrerDomain(document.referrer, location.hostname);
  track('session_start', {
    ...info,
    lang: navigator.language,
    ...(ref ? { referrerDomain: ref } : {}),
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));
}

const TOOL_PATHS: Record<string, string> = {
  '/photo': 'photo',
  '/gif': 'gif',
  '/audio': 'audio',
  '/link': 'link',
  '/highlight': 'highlight',
  '/rotate': 'rotate',
};

/** 주소를 도구 이름으로 (도구가 아니면 undefined) */
export const toolOf = (pathname: string): string | undefined => TOOL_PATHS[pathname];
