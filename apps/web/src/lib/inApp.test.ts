import { describe, expect, it } from 'vitest';
import { detectInApp, kakaoOpenExternal, saveMethod } from './inApp';

const KAKAO_ANDROID =
  'Mozilla/5.0 (Linux; Android 15; SM-S938N Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 KAKAOTALK/26.8.1 (INAPP)';
const KAKAO_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 26.8.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 15; SM-S938N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const INSTAGRAM_ANDROID = `${CHROME_ANDROID} Instagram 380.0.0.0.1 Android`;

describe('detectInApp', () => {
  it('카카오톡 안드로이드·iOS', () => {
    expect(detectInApp(KAKAO_ANDROID)).toEqual({ app: 'kakaotalk', os: 'android' });
    expect(detectInApp(KAKAO_IOS)).toEqual({ app: 'kakaotalk', os: 'ios' });
  });

  it('다른 인앱 브라우저', () => {
    expect(detectInApp(INSTAGRAM_ANDROID)).toEqual({ app: 'instagram', os: 'android' });
  });

  it('일반 브라우저는 null', () => {
    expect(detectInApp(CHROME_ANDROID)).toBeNull();
    expect(detectInApp(SAFARI_IOS)).toBeNull();
  });
});

describe('saveMethod', () => {
  it('일반 브라우저는 blob 다운로드', () => {
    expect(saveMethod(null)).toBe('blob');
  });

  it('안드로이드 인앱은 저장할 수 없다 (blob·data URL 모두 안 됨)', () => {
    expect(saveMethod(detectInApp(KAKAO_ANDROID))).toBe('unsupported');
  });

  it('iOS 인앱은 data URL로 저장한다', () => {
    expect(saveMethod(detectInApp(KAKAO_IOS))).toBe('data-url');
  });
});

describe('kakaoOpenExternal', () => {
  it('지금 주소를 인코딩해서 넘긴다', () => {
    expect(kakaoOpenExternal('https://example.com/photo?a=1&b=2')).toBe(
      'kakaotalk://web/openExternal?url=https%3A%2F%2Fexample.com%2Fphoto%3Fa%3D1%26b%3D2',
    );
  });
});
