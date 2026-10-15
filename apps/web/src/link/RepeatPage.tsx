import { ExternalLink, Pause, Play, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import { ApiError } from '../gif/api';
import { useT } from '../i18n/context';
import styles from '../gif/GifTool.module.css';
import { formatTime } from '../gif/time';
import own from './LinkTool.module.css';
import { getLink, type Link } from './links';
import { useYouTube } from './useYouTube';
import { youtubeAt } from './youtube';

/** 구간 반복 링크 (/r/:id): 열면 그 구간만 반복 재생 (F15) */
export function RepeatPage() {
  const { id = '' } = useParams();
  const all = useT();
  const t = all.link;
  const [link, setLink] = useState<Link | null>(null);
  const [error, setError] = useState<{ id: string; message: string | null } | null>(null);

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
            // 문구는 그릴 때 지금 언어로 만든다
            message: e instanceof ApiError ? e.message : null,
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
          <h1 className={styles.title}>{t.repeatTitle}</h1>
          {current && (
            <p className={`${styles.fileInfo} ${styles.num}`}>
              {t.repeatRange(formatTime(current.start), formatTime(current.end))}
            </p>
          )}
        </div>
      </header>
      {error && error.id === id ? (
        <p className={styles.error} role="alert">
          {error.message === null ? t.loadFailed : all.apiError('not_found', error.message)}
        </p>
      ) : (
        <div className={own.repeat}>
          <div className={own.player} ref={attach} data-testid="yt-host" />
          {yt.error && (
            <p className={styles.error} role="alert">
              {t.playerErrors[yt.error.kind]}
            </p>
          )}
          {current && yt.ready && (
            <div className={styles.controls}>
              <button
                type="button"
                className={styles.playButton}
                aria-label={yt.playing ? all.media.pause : t.playRange}
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
                <ExternalLink size={16} strokeWidth={1.75} /> {t.watchOnYoutube}
              </a>
              <RouterLink
                className={styles.chip}
                to={`/link?v=${current.videoId}&s=${current.start}&e=${current.end}`}
              >
                {t.editAsNew}
              </RouterLink>
            </div>
          )}
          <p className={styles.trust}>
            <ShieldCheck size={18} strokeWidth={1.75} />
            {t.repeatTrust}
          </p>
        </div>
      )}
    </div>
  );
}
