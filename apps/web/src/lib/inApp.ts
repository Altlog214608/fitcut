/**
 * 메신저·SNS 앱 안의 브라우저(인앱 브라우저) 판별.
 * 인앱 브라우저는 페이지가 만든 파일(blob: · data: 주소)을 내려받지 못하는 경우가 많다.
 * 카카오 답변(devtalk.kakao.com/t/topic/146696, /146168): 안드로이드 웹뷰는 blob·data URL 다운로드가
 * 안 되고, iOS는 data URL로 저장할 수 있다. 다른 인앱 브라우저도 비슷하다.
 */
export type InAppName = 'kakaotalk' | 'instagram' | 'facebook' | 'line' | 'naver' | 'daum' | 'band';
export type InApp = { app: InAppName; os: 'ios' | 'android' | 'other' };

/** 사용자 에이전트에 들어가는 앱 표시. 카카오톡은 "KAKAOTALK"이 들어간다 */
const MARKERS: [InAppName, RegExp][] = [
  ['kakaotalk', /KAKAOTALK/i],
  ['instagram', /Instagram/],
  ['facebook', /FBAN|FBAV/],
  ['line', /\bLine\//],
  ['naver', /NAVER\(inapp/],
  ['daum', /DaumApps/],
  ['band', /\bBAND\//],
];

export function detectInApp(userAgent: string): InApp | null {
  const found = MARKERS.find(([, pattern]) => pattern.test(userAgent));
  if (!found) return null;
  const os = /Android/i.test(userAgent)
    ? 'android'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'ios'
      : 'other';
  return { app: found[0], os };
}

/**
 * 카카오톡에서 이 주소를 기본 브라우저(크롬·사파리)로 여는 링크.
 * 카카오 공식 문서에는 없고 개발자들이 널리 쓰는 방식이라, 안 될 때를 대비해 화면에 다른 방법도 함께 안내한다.
 */
export function kakaoOpenExternal(url: string): string {
  return `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
}

/** 결과 파일을 저장하는 방법. unsupported면 다운로드 대신 다른 브라우저로 열라고 안내한다 */
export type SaveMethod = 'blob' | 'data-url' | 'unsupported';

export function saveMethod(inApp: InApp | null): SaveMethod {
  if (!inApp) return 'blob';
  if (inApp.os === 'android') return 'unsupported';
  if (inApp.os === 'ios') return 'data-url';
  return 'blob';
}

export const IN_APP: InApp | null =
  typeof navigator === 'undefined' ? null : detectInApp(navigator.userAgent);

export function inAppLabel(app: InAppName): string {
  return app === 'kakaotalk' ? '카카오톡' : '앱';
}
