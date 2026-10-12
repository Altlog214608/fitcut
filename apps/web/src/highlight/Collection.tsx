/**
 * 방송 채팅 수집 (M5, ADR-040): 수집 시작 → 수집 중 상태(10초마다 새로고침) → 종료, 최근 기록.
 * 수집기는 방송 중에만 돌고, 채팅이 30분 없거나 8시간이 지나면 스스로 끝난다.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  isActive,
  listBroadcasts,
  startBroadcast,
  stopBroadcast,
  stopReasonText,
  StreamerError,
  type Broadcast,
} from './streamer';
import styles from './Collection.module.css';

const POLL_MS = 10_000;

const timeText = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const count = (n: number) => n.toLocaleString('ko-KR');

function statusText(b: Broadcast): string {
  if (b.status === 'starting') return b.stopRequested ? '멈추는 중' : '수집기 켜는 중';
  if (b.status === 'collecting') return b.stopRequested ? '멈추는 중' : '수집 중';
  if (b.status === 'done') return '수집 끝';
  return '멈춤';
}

export function Collection() {
  const [items, setItems] = useState<Broadcast[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listBroadcasts());
    } catch (e) {
      setMessage(e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.');
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
        if (alive)
          setMessage(e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.');
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

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await load();
    } catch (e) {
      setMessage(e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-label="채팅 수집">
      <h2 className={styles.heading}>채팅 수집</h2>

      {active ? (
        <div className={styles.live}>
          <div className={styles.liveHead}>
            <span className={styles.dot} aria-hidden />
            <b>{statusText(active)}</b>
            <span className={styles.meta}>
              {timeText(active.startedAt ?? active.requestedAt)}부터
            </span>
          </div>
          <dl className={styles.counts}>
            <div>
              <dt>채팅</dt>
              <dd>{count(active.chatCount)}</dd>
            </div>
            <div>
              <dt>후원</dt>
              <dd>{count(active.donationCount)}</dd>
            </div>
            <div>
              <dt>구독</dt>
              <dd>{count(active.subscriptionCount)}</dd>
            </div>
          </dl>
          <button
            type="button"
            className={styles.ghost}
            disabled={busy || !!active.stopRequested}
            onClick={() => void run(() => stopBroadcast(active.id))}
          >
            수집 종료
          </button>
          <p className={styles.meta}>
            숫자는 30초마다 늘어나요. 방송이 끝나고 채팅이 30분 없으면 저절로 멈춰요.
          </p>
        </div>
      ) : (
        <div className={styles.start}>
          <p>방송을 켠 뒤 수집을 시작하세요. 지난 방송의 채팅은 가져올 수 없어요.</p>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || items === null}
            onClick={() => void run(startBroadcast)}
          >
            수집 시작
          </button>
          <p className={styles.meta}>하루 3번까지, 한 번에 최대 8시간 수집해요.</p>
        </div>
      )}

      {message && (
        <p className={styles.meta} role="status">
          {message}
        </p>
      )}

      {items && items.some((b) => !isActive(b)) && (
        <ul className={styles.list} aria-label="지난 수집">
          {items
            .filter((b) => !isActive(b))
            .map((b) => (
              <li key={b.id} className={styles.item}>
                <b>{timeText(b.startedAt ?? b.requestedAt)}</b>
                <span className={styles.meta}>
                  채팅 {count(b.chatCount)} · 후원 {count(b.donationCount)} · 구독{' '}
                  {count(b.subscriptionCount)}
                </span>
                <span className={styles.meta}>{stopReasonText(b.stopReason)}</span>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
