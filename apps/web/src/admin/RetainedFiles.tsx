/**
 * 관리자 화면: 보관 동의 파일 (F16, docs/ADMIN.md). 목록·열람·삭제는 모두 서버가 감사 로그에 남긴다.
 * 열람 주소는 5분만 쓸 수 있다.
 */
import { useState } from 'react';
import { AuthError, type Tokens } from './cognito';
import styles from './AdminTool.module.css';

type RetainedFile = {
  id: string;
  kind: string;
  createdAt: string;
  retainUntil: string;
  inputBytes: number;
  outputBytes: number;
};

async function adminCall(path: string, tokens: Tokens, method = 'GET'): Promise<Response> {
  const r = await fetch(path, { method, headers: { 'x-admin-token': tokens.idToken } });
  if (r.status === 401 || r.status === 403) throw new AuthError('다시 로그인해 주세요.');
  if (!r.ok) throw new Error('처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
  return r;
}

const mb = (n: number) => `${(n / 1_000_000).toFixed(1)}MB`;
const when = (iso: string) => iso.replace('T', ' ').slice(0, 16);

export function RetainedFiles({ tokens, onExpired }: { tokens: Tokens; onExpired: () => void }) {
  const [files, setFiles] = useState<RetainedFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function fail(e: unknown) {
    if (e instanceof AuthError) onExpired();
    else setMessage(e instanceof Error ? e.message : '처리하지 못했어요.');
  }

  async function load() {
    setMessage(null);
    try {
      const r = await adminCall('/api/admin/retained', tokens);
      setFiles(((await r.json()) as { files: RetainedFile[] }).files);
    } catch (e) {
      fail(e);
    }
  }

  async function open(id: string, file: 'input' | 'output') {
    // 응답을 기다린 뒤 창을 열면 팝업 차단에 걸려서, 누르는 순간 빈 창을 먼저 연다
    const win = window.open('', '_blank');
    setBusy(id);
    try {
      const r = await adminCall(`/api/admin/retained/${id}?file=${file}`, tokens);
      const { url } = (await r.json()) as { url: string };
      if (win) win.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      win?.close();
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('이 보관 파일을 지울까요? 되돌릴 수 없어요.')) return;
    setBusy(id);
    try {
      await adminCall(`/api/admin/retained/${id}`, tokens, 'DELETE');
      setFiles((list) => list?.filter((f) => f.id !== id) ?? null);
      setMessage('지웠어요.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  if (!files) {
    return (
      <>
        <p className={styles.hint}>목록을 볼 때와 파일을 열 때마다 감사 로그에 남아요.</p>
        <button type="button" className={styles.ghost} onClick={() => void load()}>
          보관 파일 보기
        </button>
        {message && (
          <p className={styles.error} role="alert">
            {message}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      {files.length === 0 ? (
        <p className={styles.hint}>보관 중인 파일이 없어요.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>만든 때</th>
                <th>형식</th>
                <th>원본 / 결과</th>
                <th>자동 삭제</th>
                <th aria-label="동작" />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td className={styles.num}>{when(f.createdAt)}</td>
                  <td>{f.kind}</td>
                  <td className={styles.num}>
                    {mb(f.inputBytes)} / {mb(f.outputBytes)}
                  </td>
                  <td className={styles.num}>{f.retainUntil.slice(0, 10)}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.ghost}
                        disabled={busy === f.id}
                        onClick={() => void open(f.id, 'input')}
                      >
                        원본
                      </button>
                      <button
                        type="button"
                        className={styles.ghost}
                        disabled={busy === f.id}
                        onClick={() => void open(f.id, 'output')}
                      >
                        결과
                      </button>
                      <button
                        type="button"
                        className={styles.ghost}
                        disabled={busy === f.id}
                        onClick={() => void remove(f.id)}
                      >
                        지우기
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {message && (
        <p className={styles.hint} role="status">
          {message}
        </p>
      )}
    </>
  );
}
