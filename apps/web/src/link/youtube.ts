/**
 * YouTube IFrame Player API (공식 임베드 플레이어). 영상은 유튜브에서 바로 재생되고 FitCut 서버를 거치지 않는다.
 * 개인정보 보호 모드 주소(youtube-nocookie.com)로 띄운다.
 * 정책: 플레이어 위에 아무것도 겹치지 않는다, 200×200 이상 (YouTube API 개발자 정책).
 */

/** 이 앱이 쓰는 만큼만 적은 플레이어 타입 */
export type YTPlayer = {
  getDuration(): number;
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
  destroy(): void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host?: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onError?: (e: { data: number }) => void;
        onStateChange?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const PLAYING = 1;

let loading: Promise<YTNamespace> | null = null;

/** 공식 스크립트를 한 번만 불러온다 */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error('유튜브 플레이어를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'));
    };
    document.head.append(script);
  });
  return loading;
}

/** 플레이어 오류 코드를 화면 문구로 (YouTube IFrame API onError) */
export function playerErrorMessage(code: number): { message: string; blocked: boolean } {
  if (code === 101 || code === 150) {
    return {
      message: '이 영상은 다른 사이트에서 재생할 수 없게 설정돼 있어요. 유튜브에서 직접 봐 주세요.',
      blocked: true,
    };
  }
  if (code === 100) {
    return { message: '영상을 찾을 수 없어요. 삭제됐거나 비공개일 수 있어요.', blocked: false };
  }
  return { message: '영상을 재생하지 못했어요. 링크를 다시 확인해 주세요.', blocked: false };
}

/** 유튜브에서 그 시점부터 여는 공유 링크 (초 단위, 유튜브 규칙) */
export const youtubeAt = (videoId: string, start: number) =>
  `https://youtu.be/${videoId}?t=${Math.floor(start)}`;
