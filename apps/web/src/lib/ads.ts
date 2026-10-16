/**
 * Google AdSense (ADR-052). 게시자 ID는 공개 값이다 (ads.txt와 페이지 소스에 그대로 보인다).
 * 광고 단위 ID는 AdSense 승인 뒤 만들어 채운다. 비어 있으면 광고 자리를 그리지 않는다.
 * 광고는 홈 도구 목록 아래와 도구 화면 맨 아래에만 둔다. 링크 구간(YouTube)·관리자 화면에는 두지 않는다.
 */
export const AD_CLIENT = 'ca-pub-5555123248227301';

/** 배포 빌드에서만 켠다 (vite.config.ts가 같은 값으로 AdSense 코드를 넣는다) */
export const ADS_ON = import.meta.env.VITE_ADS === 'on';

export const AD_SLOTS = {
  home: '',
  tool: '',
} as const;

export type AdPlace = keyof typeof AD_SLOTS;

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** 광고 단위 하나를 채워 달라고 AdSense 스크립트에 알린다. 스크립트가 막혀도 화면은 그대로 둔다 */
export function requestAd(): void {
  try {
    (window.adsbygoogle = window.adsbygoogle ?? []).push({});
  } catch {
    // 광고 차단기 등으로 실패해도 무시한다
  }
}
