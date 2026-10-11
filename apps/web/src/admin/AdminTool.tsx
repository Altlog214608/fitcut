import { LogOut, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Segmented } from '../components/Segmented';
import {
  answerMfa,
  AuthError,
  finishMfaSetup,
  otpauthUri,
  savedTokens,
  saveTokens,
  setNewPassword,
  signIn,
  type Step,
  type Tokens,
} from './cognito';
import styles from './AdminTool.module.css';
import { summarize, usd, type DayStats } from './summary';

type Audit = { at: string; admin: string; action: string; target: string };

async function adminGet<T>(path: string, tokens: Tokens): Promise<T> {
  // 토큰은 x-admin-token으로 보낸다 (API Gateway JWT 권한 부여자, CloudFront가 이 헤더만 넘긴다)
  const r = await fetch(path, { headers: { 'x-admin-token': tokens.idToken } });
  if (r.status === 401 || r.status === 403) throw new AuthError('다시 로그인해 주세요.');
  if (!r.ok) throw new Error('불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  return r.json() as Promise<T>;
}

/** 관리자 화면 (docs/ADMIN.md). 메뉴를 숨기는 것은 보호가 아니다: 실제 보호는 API의 JWT·admin 그룹 검사다 */
export function AdminTool() {
  const [tokens, setTokens] = useState<Tokens | null>(() => savedTokens());

  function done(t: Tokens | null) {
    saveTokens(t);
    setTokens(t);
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>관리자</h1>
        {tokens && (
          <button type="button" className={styles.ghost} onClick={() => done(null)}>
            <LogOut size={16} strokeWidth={1.75} /> 로그아웃
          </button>
        )}
      </header>
      {tokens ? (
        <Dashboard tokens={tokens} onExpired={() => done(null)} />
      ) : (
        <Login onDone={done} />
      )}
    </div>
  );
}

function Login({ onDone }: { onDone: (t: Tokens) => void }) {
  const [step, setStep] = useState<Step | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const next = !step
        ? await signIn(email.trim(), password)
        : step.kind === 'new-password'
          ? await setNewPassword(step, value)
          : step.kind === 'mfa-setup'
            ? await finishMfaSetup(step, value.trim())
            : step.kind === 'mfa'
              ? await answerMfa(step, value.trim())
              : step;
      setValue('');
      if (next.kind === 'done') onDone(next.tokens);
      else setStep(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '로그인하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.login} onSubmit={(e) => void submit(e)}>
      {!step && (
        <>
          <label className={styles.field}>
            이메일
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
          </label>
          <label className={styles.field}>
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
          </label>
        </>
      )}
      {step?.kind === 'new-password' && (
        <label className={styles.field}>
          새 비밀번호 (처음 로그인)
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
          <span className={styles.hint}>12자 이상, 대문자·소문자·숫자를 섞어 주세요.</span>
        </label>
      )}
      {step?.kind === 'mfa-setup' && (
        <>
          <p className={styles.hint}>
            OTP 앱(Google Authenticator 등)에 아래 키를 직접 입력해 등록한 뒤, 앱에 보이는 6자리
            코드를 넣어 주세요.
          </p>
          <code className={styles.secret}>{step.secret}</code>
          <a className={styles.hint} href={otpauthUri(step.username, step.secret)}>
            이 기기의 OTP 앱으로 열기
          </a>
          <label className={styles.field}>
            6자리 코드
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              required
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
            />
          </label>
        </>
      )}
      {step?.kind === 'mfa' && (
        <label className={styles.field}>
          OTP 앱의 6자리 코드
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            required
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
        </label>
      )}
      {message && (
        <p className={styles.error} role="alert">
          {message}
        </p>
      )}
      <button type="submit" className={styles.primary} disabled={busy}>
        {busy ? '확인하는 중…' : step ? '확인' : '로그인'}
      </button>
      <p className={styles.trust}>
        <ShieldCheck size={18} strokeWidth={1.75} />
        관리자 계정만 들어올 수 있어요. 2단계 인증(OTP)이 필요해요.
      </p>
    </form>
  );
}

type Period = '7' | '30' | '90';
const PERIODS: readonly { value: Period; label: string }[] = [
  { value: '7', label: '7일' },
  { value: '30', label: '30일' },
  { value: '90', label: '90일' },
];

function Dashboard({ tokens, onExpired }: { tokens: Tokens; onExpired: () => void }) {
  const [period, setPeriod] = useState<Period>('7');
  const [data, setData] = useState<{ period: Period; days: DayStats[] } | null>(null);
  const [audit, setAudit] = useState<Audit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminGet<{ days: DayStats[] }>(`/api/admin/stats?days=${period}`, tokens)
      .then((r) => {
        if (!cancelled) setData({ period, days: r.days });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof AuthError) onExpired();
        else setError(e instanceof Error ? e.message : '불러오지 못했어요.');
      });
    return () => {
      cancelled = true;
    };
  }, [period, tokens, onExpired]);

  function loadAudit() {
    adminGet<{ entries: Audit[] }>('/api/admin/audit', tokens)
      .then((r) => setAudit(r.entries))
      .catch((e: unknown) =>
        e instanceof AuthError ? onExpired() : setError('감사 로그를 불러오지 못했어요.'),
      );
  }

  const current = data && data.period === period ? data : null;
  const s = current ? summarize(current.days) : null;
  const maxSessions = Math.max(1, ...(s?.daily.map((d) => d.sessions) ?? [1]));

  return (
    <div className={styles.dashboard}>
      <Segmented label="기간 (어제까지)" value={period} options={PERIODS} onChange={setPeriod} />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!s ? (
        <p className={styles.hint}>불러오는 중이에요…</p>
      ) : (
        <>
          <section className={styles.cards} aria-label="개요">
            <Stat label="세션" value={String(s.sessions)} />
            <Stat label="변환 성공 / 실패" value={`${s.jobs.ok} / ${s.jobs.failed}`} />
            <Stat
              label="성공률"
              value={s.jobs.successRate === null ? '—' : `${Math.round(s.jobs.successRate * 100)}%`}
            />
            <Stat label="AWS 비용 (청구 기준)" value={usd(s.costUsd)} />
            <Stat label="링크 저장 / 재생 막힘" value={`${s.links.saved} / ${s.links.blocked}`} />
          </section>
          <p className={styles.hint}>집계된 날 {s.days}일 · 매일 새벽 3시에 전날까지 모아요.</p>

          <Section title="날짜별 세션">
            <ul className={styles.bars}>
              {s.daily.map((d) => (
                <li key={d.day}>
                  <span className={styles.num}>{d.day.slice(5)}</span>
                  <span
                    className={styles.bar}
                    style={{ width: `${(d.sessions / maxSessions) * 100}%` }}
                  />
                  <b className={styles.num}>{d.sessions}</b>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="도구 사용">
            <Table
              head={['도구', '열기', '파일 선택', '저장', '오류']}
              rows={s.tools.map(([n, t]) => [n, t.open, t.selected, t.exported, t.errors])}
            />
          </Section>

          <Section title="변환 (서버)">
            <Table
              head={['형식', '성공', '실패', 'p95 처리 (가장 느린 날)', '추정 비용']}
              rows={s.jobs.list.map((j) => [
                j.type,
                j.ok,
                j.failed,
                `${(j.p95Ms / 1000).toFixed(1)}초`,
                usd(j.costUsd),
              ])}
            />
          </Section>

          <div className={styles.columns}>
            <Section title="인기 기기 프리셋">
              <Table head={['프리셋', '선택']} rows={s.presets} />
            </Section>
            <Section title="찾았는데 없던 기기">
              <Table head={['검색어', '횟수']} rows={s.misses} />
            </Section>
            <Section title="기기 종류">
              <Table head={['종류 · OS', '세션']} rows={s.devices} />
            </Section>
            <Section title="오류 코드">
              <Table head={['코드', '횟수']} rows={s.errors} />
            </Section>
          </div>

          <Section title="서비스별 비용">
            <Table head={['서비스', '비용']} rows={s.services.map(([n, v]) => [n, usd(v)])} />
          </Section>
        </>
      )}

      <Section title="감사 로그 (이번 달)">
        {audit ? (
          <Table
            head={['시각', '관리자', '행동', '대상']}
            rows={audit.map((a) => [
              a.at.replace('T', ' ').slice(0, 19),
              a.admin,
              a.action,
              a.target,
            ])}
          />
        ) : (
          <button type="button" className={styles.ghost} onClick={loadAudit}>
            감사 로그 보기
          </button>
        )}
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.card}>
      <span className={styles.cardLabel}>{label}</span>
      <b className={`${styles.cardValue} ${styles.num}`}>{value}</b>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return <p className={styles.hint}>아직 없어요.</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={typeof c === 'number' ? styles.num : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
