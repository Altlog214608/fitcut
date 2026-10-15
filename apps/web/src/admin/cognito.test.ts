import { describe, expect, it } from 'vitest';
import { nextStep, otpauthUri } from './cognito';

describe('관리자 로그인 단계', () => {
  it('처음 로그인: 새 비밀번호 → OTP 앱 등록 → 코드', () => {
    expect(nextStep({ ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 's1' }, 'a@b.c')).toEqual({
      kind: 'new-password',
      session: 's1',
      username: 'a@b.c',
    });
    expect(nextStep({ ChallengeName: 'MFA_SETUP', Session: 's2' }, 'a@b.c')).toEqual({
      kind: 'associate',
      session: 's2',
    });
    expect(nextStep({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 's3' }, 'a@b.c')).toMatchObject(
      {
        kind: 'mfa',
      },
    );
  });

  it('끝나면 토큰, 모르는 단계는 오류', () => {
    const s = nextStep(
      {
        AuthenticationResult: {
          IdToken: 'i',
          AccessToken: 'a',
          RefreshToken: 'r',
          ExpiresIn: 3600,
        },
      },
      'a@b.c',
    );
    expect(s).toMatchObject({ kind: 'done', tokens: { idToken: 'i', refreshToken: 'r' } });
    expect(() => nextStep({ ChallengeName: 'SMS_MFA' }, 'a@b.c')).toThrow();
  });

  it('OTP 앱 주소', () => {
    expect(otpauthUri('a@b.c', 'ABC')).toBe(
      'otpauth://totp/KoiCut:a%40b.c?secret=ABC&issuer=KoiCut',
    );
  });
});
