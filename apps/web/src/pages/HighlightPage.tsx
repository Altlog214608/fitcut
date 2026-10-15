/**
 * 하이라이트 (M5): 치지직 채널 연결 → 방송 중 채팅 수집 → 하이라이트 후보.
 * 연결하지 않은 방문자도 예시 방송 리플레이로 감지 과정을 볼 수 있다 (ADR-045).
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Collection } from '../highlight/Collection';
import {
  CHZZK_LOGIN_PATH,
  callbackKind,
  disconnect,
  getConnection,
  logout,
  StreamerError,
  type Connection,
} from '../highlight/streamer';
import { useT } from '../i18n/context';
import styles from './HighlightPage.module.css';

const Replay = lazy(() => import('../highlight/Replay').then((m) => ({ default: m.Replay })));

type State = { status: 'loading' } | { status: 'ready'; connection: Connection | null };

export function HighlightPage() {
  const [params, setParams] = useSearchParams();
  const all = useT();
  const t = all.highlight;
  const dateText = (iso: string) =>
    new Date(iso).toLocaleDateString(all.locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  const errorText = (e: unknown) =>
    all.apiError('', e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(() => {
    const kind = callbackKind(params.get('error'));
    return kind ? t.callback[kind] : null;
  });
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    // 콜백이 붙인 ?connected·?error는 한 번 보여주고 주소에서 뺀다
    if (params.has('error') || params.has('connected')) setParams({}, { replace: true });
    let alive = true;
    getConnection()
      .then((connection) => {
        if (alive) setState({ status: 'ready', connection });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState({ status: 'ready', connection: null });
        setMessage(errorText(e));
      });
    return () => {
      alive = false;
    };
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setState({ status: 'ready', connection: null });
      setMessage(done);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function onDisconnect() {
    if (!window.confirm(t.confirmDisconnect)) return;
    void run(disconnect, t.disconnected);
  }

  const connection = state.status === 'ready' ? state.connection : null;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t.title}</h1>
      <p className={styles.summary}>{t.summary}</p>

      {state.status === 'loading' ? (
        <p className={styles.hint}>{t.checking}</p>
      ) : connection ? (
        <section className={styles.card} aria-label={t.connectedRegion}>
          <div className={styles.channel}>
            <span className={styles.badge}>{t.connected}</span>
            <b className={styles.name}>{connection.channelName || t.myChannel}</b>
            <span className={styles.meta}>{t.connectedOn(dateText(connection.connectedAt))}</span>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.ghost}
              disabled={busy}
              onClick={() => void run(logout, t.loggedOut)}
            >
              {t.logout}
            </button>
            <button type="button" className={styles.danger} disabled={busy} onClick={onDisconnect}>
              {t.disconnect}
            </button>
          </div>
        </section>
      ) : (
        <section className={styles.card} aria-label={t.connectRegion}>
          <p>{t.connectLead}</p>
          <a className={styles.primary} href={CHZZK_LOGIN_PATH}>
            {t.connect}
          </a>
          <p className={styles.hint}>{t.connectHint}</p>
        </section>
      )}

      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}

      {connection && <Collection />}

      <section className={styles.card} aria-label={t.demoTitle}>
        <b>{t.demoTitle}</b>
        <p className={styles.hint}>{t.demoLead}</p>
        {demo ? (
          <Suspense fallback={<p className={styles.hint}>{t.demoLoading}</p>}>
            <Replay />
          </Suspense>
        ) : (
          <button type="button" className={styles.ghost} onClick={() => setDemo(true)}>
            {t.demoOpen}
          </button>
        )}
      </section>

      <p className={styles.hint}>
        {t.retention} <Link to="/privacy">{all.layout.privacy}</Link>
      </p>
    </div>
  );
}
