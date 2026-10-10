import { describe, expect, it } from 'vitest';
import { deviceInfo, referrerDomain, toolOf } from './analytics';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const GALAXY =
  'Mozilla/5.0 (Linux; Android 15; SM-S938N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('deviceInfo', () => {
  it.each([
    [IPHONE, 0, false, { deviceType: 'mobile', os: 'ios', browser: 'safari' }],
    [GALAXY, 5, false, { deviceType: 'mobile', os: 'android', browser: 'samsung' }],
    [WINDOWS, 0, false, { deviceType: 'desktop', os: 'windows', browser: 'chrome' }],
    [IPAD_DESKTOP, 5, false, { deviceType: 'tablet', os: 'ios', browser: 'safari' }],
    [GALAXY, 5, true, { deviceType: 'mobile', os: 'android', browser: 'inapp' }],
  ])('%#', (ua, touch, inApp, info) => {
    expect(deviceInfo(ua, touch, inApp)).toEqual(info);
  });
});

describe('referrerDomain', () => {
  it('다른 사이트의 도메인만 남기고 경로·검색어는 버린다', () => {
    expect(referrerDomain('https://www.google.com/search?q=비밀', 'fitcut.example')).toBe(
      'www.google.com',
    );
    expect(referrerDomain('https://fitcut.example/photo', 'fitcut.example')).toBeUndefined();
    expect(referrerDomain('', 'fitcut.example')).toBeUndefined();
  });
});

describe('toolOf', () => {
  it('도구 주소만', () => {
    expect(toolOf('/gif')).toBe('gif');
    expect(toolOf('/')).toBeUndefined();
  });
});
