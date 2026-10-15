/**
 * 방송 채팅 수집 (M5, ADR-040): 수집 시작 → 수집 중 상태(10초마다 새로고침) → 종료, 최근 기록.
 * 수집기는 방송 중에만 돌고, 채팅이 30분 없거나 8시간이 지나면 스스로 끝난다.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  isActive,
  listBroadcasts,
  startBroadcast,
  startFileAnalysis,
  stopBroadcast,
  StreamerError,
  type Broadcast,
} from './streamer';
import { Result } from './Result';
import { useT } from '../i18n/context';
import type { Dict } from '../i18n/ko';
import styles from './Collection.module.css';

const POLL_MS = 10_000;

/** 서버 오류 원문. 문구는 그릴 때 지금 언어로 바꾼다 */
const serverMessage = (e: unknown) =>
  e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.';

function statusText(b: Broadcast, t: Dict['highlight']['status']): string {
  if (b.status === 'starting') return b.stopRequested ? t.stopping : t.starting;
  if (b.status === 'collecting') return b.stopRequested ? t.stopping : t.collecting;
  if (b.status === 'done') return t.done;
  return t.stopped;
}

export function Collection() {
  const all = useT();
  const t = all.highlight;
  const timeText = (iso: string) =>
    new Date(iso).toLocaleString(all.locale, {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const count = (n: number) => n.toLocaleString(all.locale);
  const [items, setItems] = useState<Broadcast[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listBroadcasts());
    } catch (e) {
      setMessage(serverMessage(e));
    }
  }, []);

  const active = items?.find(isActive) ?? null;

  useEffect(() => {
    let alive = true;
    listBroadcasts()
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch((e: unknown) => {
        if (alive) setMessage(serverMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  // 수집 중일 때만 새로고침한다
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [active, load]);

  /** 모드 C: 녹화 파일만 분석할 기록을 만들고 바로 연다 */
  async function startFile() {
    setBusy(true);
    setMessage(null);
    try {
      const b = await startFileAnalysis();
      await load();
      setOpenId(b.id);
    } catch (e) {
      setMessage(serverMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await load();
    } catch (e) {
      setMessage(serverMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-label={t.collection}>
      <h2 className={styles.heading}>{t.collection}</h2>

      {active ? (
        <div className={styles.live}>
          <div className={styles.liveHead}>
            <span className={styles.dot} aria-hidden />
            <b>{statusText(active, t.status)}</b>
            <span className={styles.meta}>
              {t.since(timeText(active.startedAt ?? active.requestedAt))}
            </span>
          </div>
          <dl className={styles.counts}>
            <div>
              <dt>{t.chat}</dt>
              <dd>{count(active.chatCount)}</dd>
            </div>
            <div>
              <dt>{t.donation}</dt>
              <dd>{count(active.donationCount)}</dd>
            </div>
            <div>
              <dt>{t.subscription}</dt>
              <dd>{count(active.subscriptionCount)}</dd>
            </div>
          </dl>
          <button
            type="button"
            className={styles.ghost}
            disabled={busy || !!active.stopRequested}
            onClick={() => void run(() => stopBroadcast(active.id))}
          >
            {t.stop}
          </button>
          <p className={styles.meta}>{t.liveHint}</p>
        </div>
      ) : (
        <div className={styles.start}>
          <p>{t.startLead}</p>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || items === null}
            onClick={() => void run(startBroadcast)}
          >
            {t.start}
          </button>
          <p className={styles.meta}>{t.startLimit}</p>
          <button
            type="button"
            className={styles.ghost}
            disabled={busy || items === null}
            onClick={() => void startFile()}
          >
            {t.fileOnly}
          </button>
          <p className={styles.meta}>{t.fileOnlyHint}</p>
        </div>
      )}

      {message && (
        <p className={styles.meta} role="status">
          {all.apiError('', message)}
        </p>
      )}

      {items && items.some((b) => !isActive(b)) && (
        <ul className={styles.list} aria-label={t.pastList}>
          {items
            .filter((b) => !isActive(b))
            .map((b) => (
              <li key={b.id} className={styles.item}>
                <b>{timeText(b.startedAt ?? b.requestedAt)}</b>
                {b.source === 'file' ? (
                  <span className={styles.meta}>{t.fileOnlyItem}</span>
                ) : (
                  <>
                    <span className={styles.meta}>
                      {t.counts(
                        count(b.chatCount),
                        count(b.donationCount),
                        count(b.subscriptionCount),
                      )}
                    </span>
                    <span className={styles.meta}>
                      {t.stopReasons[b.stopReason ?? ''] ?? t.stopUnknown}
                    </span>
                  </>
                )}
                {(b.source === 'file' ||
                  b.chatCount + b.donationCount + b.subscriptionCount > 0) && (
                  <button
                    type="button"
                    className={styles.ghost}
                    aria-expanded={openId === b.id}
                    onClick={() => setOpenId((cur) => (cur === b.id ? null : b.id))}
                  >
                    {openId === b.id ? t.closeResult : t.openResult}
                  </button>
                )}
                {openId === b.id && <Result id={b.id} />}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
