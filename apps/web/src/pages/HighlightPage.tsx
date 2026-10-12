/**
 * 하이라이트 (M5): 치지직 채널 연결 → 방송 중 채팅 수집.
 * 분석·결과 화면은 다음 작업에서 붙는다 (docs/ROADMAP.md M5).
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Collection } from '../highlight/Collection';
import {
  CHZZK_LOGIN_PATH,
  callbackMessage,
  disconnect,
  getConnection,
  logout,
  StreamerError,
  type Connection,
} from '../highlight/streamer';
import styles from './HighlightPage.module.css';

type State = { status: 'loading' } | { status: 'ready'; connection: Connection | null };

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

export function HighlightPage() {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(() => callbackMessage(params.get('error')));

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
        setMessage(e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.');
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
      setMessage(e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  function onDisconnect() {
    if (!window.confirm('채널 연결을 해제할까요? 받은 치지직 권한도 함께 지워요.')) return;
    void run(disconnect, '연결을 해제했어요. 치지직 권한과 저장한 정보를 지웠어요.');
  }

  const connection = state.status === 'ready' ? state.connection : null;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>하이라이트</h1>
      <p className={styles.summary}>
        채널을 연결하면 방송 중 채팅으로 하이라이트 후보를 찾아드려요.
      </p>

      {state.status === 'loading' ? (
        <p className={styles.hint}>연결 상태를 확인하고 있어요…</p>
      ) : connection ? (
        <section className={styles.card} aria-label="연결된 채널">
          <div className={styles.channel}>
            <span className={styles.badge}>치지직 연결됨</span>
            <b className={styles.name}>{connection.channelName || '내 채널'}</b>
            <span className={styles.meta}>{dateText(connection.connectedAt)}에 연결</span>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.ghost}
              disabled={busy}
              onClick={() => void run(logout, '이 브라우저에서 나갔어요. 채널 연결은 그대로예요.')}
            >
              이 브라우저에서 나가기
            </button>
            <button type="button" className={styles.danger} disabled={busy} onClick={onDisconnect}>
              연결 해제
            </button>
          </div>
        </section>
      ) : (
        <section className={styles.card} aria-label="채널 연결">
          <p>
            치지직 로그인으로 채널을 연결해요. 채팅·후원·구독을 읽는 권한만 받고, 채팅을 쓰거나 방송
            설정을 바꾸지 않아요.
          </p>
          <a className={styles.primary} href={CHZZK_LOGIN_PATH}>
            치지직 채널 연결
          </a>
          <p className={styles.hint}>
            채팅 닉네임은 저장하지 않아요. 연결은 언제든 해제할 수 있고, 해제하면 받은 권한을 바로
            지워요.
          </p>
        </section>
      )}

      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}

      {connection && <Collection />}

      <p className={styles.hint}>
        하이라이트 분석은 만들고 있어요. 채팅 원본은 90일 동안 보관해요.{' '}
        <Link to="/privacy">개인정보 처리방침</Link>
      </p>
    </div>
  );
}
