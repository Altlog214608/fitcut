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

/**
 * 결과 파일을 저장하는 방법.
 * - blob: 내려받기 (기본)
 * - data-url: iOS 인앱 브라우저용 내려받기
 * - share: 아이폰·아이패드 Safari. 내려받으면 '파일' 앱에 들어가서 배경화면으로 쓰기 어렵다.
 *   공유 화면을 열어 '이미지 저장'으로 사진 앱에 넣게 한다 (Web Share, iOS 15부터)
 * - unsupported: 안드로이드 인앱 브라우저. 다운로드 대신 다른 브라우저로 열라고 안내한다
 */
export type SaveMethod = 'blob' | 'data-url' | 'share' | 'unsupported';

export type SaveEnv = { inApp: InApp | null; ios: boolean; canShareFiles: boolean };

export function saveMethod({ inApp, ios, canShareFiles }: SaveEnv): SaveMethod {
  if (inApp) {
    if (inApp.os === 'android') return 'unsupported';
    if (inApp.os === 'ios') return 'data-url';
    return 'blob';
  }
  if (ios && canShareFiles) return 'share';
  return 'blob';
}

/** 아이폰·아이패드. 아이패드 Safari는 맥처럼 보이게 알리므로 터치 지점 수로 가린다 */
export function isIOS(userAgent: string, maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

function canShareFiles(): boolean {
  try {
    if (typeof navigator.canShare !== 'function') return false;
    return navigator.canShare({ files: [new File([''], 'test.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

export const IN_APP: InApp | null =
  typeof navigator === 'undefined' ? null : detectInApp(navigator.userAgent);

export const SAVE_METHOD: SaveMethod =
  typeof navigator === 'undefined'
    ? 'blob'
    : saveMethod({
        inApp: IN_APP,
        ios: isIOS(navigator.userAgent, navigator.maxTouchPoints),
        canShareFiles: canShareFiles(),
      });

export function inAppLabel(app: InAppName): string {
  return app === 'kakaotalk' ? '카카오톡' : '앱';
}
