import { useEffect, useRef, useState } from 'react';
import type { Range } from '../gif/time';
import { loadYouTubeApi, playerErrorMessage, PLAYING, type YTPlayer } from './youtube';

type Loaded = {
  videoId: string;
  duration: number;
  error?: { message: string; blocked: boolean };
};

/**
 * 공식 플레이어를 띄우고 재생 위치를 따라간다. 구간 반복은 플레이어 API로 현재 시간을 보고
 * 끝을 지나면 시작으로 돌린다 (임베드 파라미터의 시작·끝은 초 단위라 더 세밀하게 하려고, F15).
 */
export function useYouTube(videoId: string | null, range: Range | null, loop: boolean) {
  // 플레이어를 넣을 요소 (콜백 ref)
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!videoId || !host) return;
    let cancelled = false;
    let player: YTPlayer | null = null;
    // 플레이어가 이 요소를 iframe으로 바꾼다. React가 그리는 요소와 섞이지 않게 따로 만든다
    const mount = document.createElement('div');
    host.append(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        player = new YT.Player(mount, {
          videoId,
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              playerRef.current = e.target;
              setLoaded({ videoId, duration: e.target.getDuration() });
            },
            onError: (e) => {
              if (!cancelled)
                setLoaded({ videoId, duration: 0, error: playerErrorMessage(e.data) });
            },
            onStateChange: (e) => {
              if (!cancelled) setPlaying(e.data === PLAYING);
            },
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoaded({
          videoId,
          duration: 0,
          error: {
            message: error instanceof Error ? error.message : '플레이어를 불러오지 못했어요.',
            blocked: false,
          },
        });
      });
    return () => {
      cancelled = true;
      player?.destroy();
      playerRef.current = null;
      mount.remove();
    };
  }, [videoId, host]);

  // 재생하는 동안 위치를 따라가고, 구간 반복이면 끝에서 시작으로
  const start = range?.start ?? 0;
  const end = range?.end ?? 0;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      const t = p.getCurrentTime();
      if (loop && end > start && t >= end) {
        p.seekTo(start, true);
        setCurrent(start);
      } else {
        setCurrent(t);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [playing, loop, start, end]);

  const info = loaded && loaded.videoId === videoId ? loaded : null;

  return {
    attach: setHost,
    ready: !!info && !info.error && info.duration > 0,
    duration: info?.duration ?? 0,
    error: info?.error ?? null,
    current,
    playing,
    seek(t: number) {
      playerRef.current?.seekTo(t, true);
      setCurrent(t);
    },
    play(from?: number) {
      const p = playerRef.current;
      if (!p) return;
      if (from !== undefined) p.seekTo(from, true);
      p.playVideo();
    },
    pause() {
      playerRef.current?.pauseVideo();
    },
  };
}
