/**
 * 관리자 로그인 (ADR-011). Cognito 사용자 풀의 공개 인증 API를 브라우저에서 직접 부른다 (SDK 없이).
 * 흐름: 비밀번호 → (처음이면 새 비밀번호) → (처음이면 OTP 앱 등록) → OTP 코드 → 토큰
 * 토큰은 이 탭에만 둔다 (sessionStorage). 설정(풀 ID·클라이언트 ID)은 배포 때 만든 /admin-config.json.
 */

export type AdminConfig = { region: string; userPoolId: string; clientId: string };

export type Tokens = {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

export type Step =
  | { kind: 'done'; tokens: Tokens }
  | { kind: 'new-password'; session: string; username: string }
  | { kind: 'mfa-setup'; session: string; username: string; secret: string }
  | { kind: 'mfa'; session: string; username: string };

type AuthResult = {
  AuthenticationResult?: {
    IdToken: string;
    AccessToken: string;
    RefreshToken?: string;
    ExpiresIn: number;
  };
  ChallengeName?: string;
  Session?: string;
  ChallengeParameters?: Record<string, string>;
};

/** 화면에 보일 오류 문구 */
export class AuthError extends Error {}

const MESSAGES: Record<string, string> = {
  NotAuthorizedException: '이메일이나 비밀번호가 맞지 않아요.',
  UserNotFoundException: '이메일이나 비밀번호가 맞지 않아요.',
  CodeMismatchException: '인증 코드가 맞지 않아요. 앱에 보이는 새 코드를 넣어 주세요.',
  EnableSoftwareTokenMFAException: '인증 코드가 맞지 않아요. 앱에 보이는 새 코드를 넣어 주세요.',
  InvalidPasswordException: '비밀번호는 12자 이상, 대문자·소문자·숫자를 섞어 주세요.',
  ExpiredCodeException: '시간이 지났어요. 처음부터 다시 로그인해 주세요.',
  TooManyRequestsException: '잠시 후 다시 시도해 주세요.',
  LimitExceededException: '잠시 후 다시 시도해 주세요.',
};

let config: Promise<AdminConfig> | null = null;

export function loadConfig(): Promise<AdminConfig> {
  config ??= fetch('/admin-config.json', { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new AuthError('관리자 로그인 설정을 찾을 수 없어요.');
      return r.json() as Promise<AdminConfig>;
    })
    .catch((e: unknown) => {
      config = null;
      throw e;
    });
  return config;
}

async function call<T>(target: string, body: Record<string, unknown>): Promise<T> {
  const cfg = await loadConfig();
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('인터넷 연결을 확인해 주세요.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { __type?: string };
  if (!res.ok) {
    const type = (data.__type ?? '').split('#').at(-1) ?? '';
    throw new AuthError(MESSAGES[type] ?? '로그인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  return data;
}

function tokensOf(r: AuthResult['AuthenticationResult'], refresh?: string): Tokens {
  if (!r) throw new AuthError('로그인하지 못했어요.');
  const refreshToken = r.RefreshToken ?? refresh;
  return {
    idToken: r.IdToken,
    accessToken: r.AccessToken,
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: Date.now() + r.ExpiresIn * 1000,
  };
}

/** 응답을 다음 단계로 (순수 함수) */
export function nextStep(
  r: AuthResult,
  username: string,
): Step | { kind: 'associate'; session: string } {
  if (r.AuthenticationResult) return { kind: 'done', tokens: tokensOf(r.AuthenticationResult) };
  const session = r.Session ?? '';
  switch (r.ChallengeName) {
    case 'NEW_PASSWORD_REQUIRED':
      return { kind: 'new-password', session, username };
    case 'MFA_SETUP':
      return { kind: 'associate', session };
    case 'SOFTWARE_TOKEN_MFA':
      return { kind: 'mfa', session, username };
    default:
      throw new AuthError('이 계정은 이 화면으로 로그인할 수 없어요.');
  }
}

async function resolve(r: AuthResult, username: string): Promise<Step> {
  const step = nextStep(r, username);
  if (step.kind !== 'associate') return step;
  // OTP 앱 등록: 비밀 키를 받아 보여준다
  const a = await call<{ SecretCode: string; Session: string }>('AssociateSoftwareToken', {
    Session: step.session,
  });
  return { kind: 'mfa-setup', session: a.Session, username, secret: a.SecretCode };
}

export async function signIn(email: string, password: string): Promise<Step> {
  const cfg = await loadConfig();
  const r = await call<AuthResult>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: cfg.clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  return resolve(r, email);
}

export async function setNewPassword(
  step: Extract<Step, { kind: 'new-password' }>,
  password: string,
): Promise<Step> {
  const cfg = await loadConfig();
  const r = await call<AuthResult>('RespondToAuthChallenge', {
    ClientId: cfg.clientId,
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    Session: step.session,
    ChallengeResponses: { USERNAME: step.username, NEW_PASSWORD: password },
  });
  return resolve(r, step.username);
}

export async function finishMfaSetup(
  step: Extract<Step, { kind: 'mfa-setup' }>,
  code: string,
): Promise<Step> {
  const cfg = await loadConfig();
  const v = await call<{ Session: string; Status: string }>('VerifySoftwareToken', {
    Session: step.session,
    UserCode: code,
    FriendlyDeviceName: 'KoiCut admin',
  });
  if (v.Status !== 'SUCCESS') throw new AuthError('인증 코드가 맞지 않아요.');
  const r = await call<AuthResult>('RespondToAuthChallenge', {
    ClientId: cfg.clientId,
    ChallengeName: 'MFA_SETUP',
    Session: v.Session,
    ChallengeResponses: { USERNAME: step.username },
  });
  return resolve(r, step.username);
}

export async function answerMfa(step: Extract<Step, { kind: 'mfa' }>, code: string): Promise<Step> {
  const cfg = await loadConfig();
  const r = await call<AuthResult>('RespondToAuthChallenge', {
    ClientId: cfg.clientId,
    ChallengeName: 'SOFTWARE_TOKEN_MFA',
    Session: step.session,
    ChallengeResponses: { USERNAME: step.username, SOFTWARE_TOKEN_MFA_CODE: code },
  });
  return resolve(r, step.username);
}

/** OTP 앱에 넣을 주소 (otpauth://). 앱이 이 형식을 읽는다 */
export const otpauthUri = (email: string, secret: string) =>
  `otpauth://totp/KoiCut:${encodeURIComponent(email)}?secret=${secret}&issuer=KoiCut`;

// ---------- 토큰 보관 (이 탭에만) ----------

const KEY = 'fitcut.admin.tokens';

export function savedTokens(): Tokens | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const t = raw ? (JSON.parse(raw) as Tokens) : null;
    return t && t.expiresAt > Date.now() + 30_000 ? t : null;
  } catch {
    return null;
  }
}

export function saveTokens(t: Tokens | null) {
  try {
    if (t) sessionStorage.setItem(KEY, JSON.stringify(t));
    else sessionStorage.removeItem(KEY);
  } catch {
    // 저장할 수 없으면 이 화면에서만 쓴다
  }
}
