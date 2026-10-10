import { ExternalLink, Pause, Play, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import { ApiError } from '../gif/api';
import styles from '../gif/GifTool.module.css';
import { formatTime } from '../gif/time';
import own from './LinkTool.module.css';
import { getLink, type Link } from './links';
import { useYouTube } from './useYouTube';
import { youtubeAt } from './youtube';

/** 구간 반복 링크 (/r/:id): 열면 그 구간만 반복 재생 (F15) */
export function RepeatPage() {
  const { id = '' } = useParams();
  const [link, setLink] = useState<Link | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLink(id)
      .then((l) => {
        if (!cancelled) setLink(l);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError({
            id,
            message: e instanceof ApiError ? e.message : '구간을 불러오지 못했어요.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const current = link && link.id === id ? link : null;
  const range = current ? { start: current.start, end: current.end } : null;
  const { attach, ...yt } = useYouTube(current?.videoId ?? null, range, true);

  return (
    <div className={styles.tool}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>구간 반복</h1>
          {current && (
            <p className={`${styles.fileInfo} ${styles.num}`}>
              {formatTime(current.start)} ~ {formatTime(current.end)} 반복
            </p>
          )}
        </div>
      </header>
      {error && error.id === id ? (
        <p className={styles.error} role="alert">
          {error.message}
        </p>
      ) : (
        <div className={own.repeat}>
          <div className={own.player} ref={attach} data-testid="yt-host" />
          {yt.error && (
            <p className={styles.error} role="alert">
              {yt.error.message}
            </p>
          )}
          {current && yt.ready && (
            <div className={styles.controls}>
              <button
                type="button"
                className={styles.playButton}
                aria-label={yt.playing ? '일시 정지' : '구간 재생'}
                onClick={() =>
                  yt.playing
                    ? yt.pause()
                    : yt.play(
                        yt.current < current.start || yt.current >= current.end
                          ? current.start
                          : undefined,
                      )
                }
              >
                {yt.playing ? (
                  <Pause size={20} strokeWidth={1.75} />
                ) : (
                  <Play size={20} strokeWidth={1.75} />
                )}
              </button>
              <span className={`${styles.clock} ${styles.num}`}>{formatTime(yt.current)}</span>
            </div>
          )}
          {current && (
            <div className={styles.marks}>
              <a
                className={styles.chip}
                href={youtubeAt(current.videoId, current.start)}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={16} strokeWidth={1.75} /> 유튜브에서 보기
              </a>
              <RouterLink
                className={styles.chip}
                to={`/link?v=${current.videoId}&s=${current.start}&e=${current.end}`}
              >
                이 구간 고쳐서 새로 만들기
              </RouterLink>
            </div>
          )}
          <p className={styles.trust}>
            <ShieldCheck size={18} strokeWidth={1.75} />
            영상은 유튜브에서 재생돼요. FitCut은 링크와 구간만 저장해요
          </p>
        </div>
      )}
    </div>
  );
}
