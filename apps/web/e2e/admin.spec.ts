import { expect, test } from '@playwright/test';

/**
 * 관리자 화면 (docs/ADMIN.md). Cognito와 관리자 API는 가짜로 둔다.
 * 처음 로그인: 비밀번호 → 새 비밀번호 → OTP 앱 등록 → 대시보드
 */
test('처음 로그인하면 새 비밀번호와 OTP를 등록하고, 토큰을 x-admin-token으로 보내 집계를 본다', async ({
  page,
}) => {
  await page.route('**/admin-config.json', (route) =>
    route.fulfill({ json: { region: 'ap-northeast-2', userPoolId: 'pool', clientId: 'client' } }),
  );
  const targets: string[] = [];
  await page.route('https://cognito-idp.ap-northeast-2.amazonaws.com/', async (route) => {
    const target = route.request().headers()['x-amz-target']?.split('.').at(-1) ?? '';
    targets.push(target);
    const body = route.request().postDataJSON() as { ChallengeName?: string };
    const reply =
      target === 'InitiateAuth'
        ? { ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 's1' }
        : target === 'AssociateSoftwareToken'
          ? { SecretCode: 'JBSWY3DPEHPK3PXP', Session: 's3' }
          : target === 'VerifySoftwareToken'
            ? { Status: 'SUCCESS', Session: 's4' }
            : body.ChallengeName === 'NEW_PASSWORD_REQUIRED'
              ? { ChallengeName: 'MFA_SETUP', Session: 's2' }
              : {
                  AuthenticationResult: {
                    IdToken: 'ID',
                    AccessToken: 'AC',
                    RefreshToken: 'RF',
                    ExpiresIn: 3600,
                  },
                };
    await route.fulfill({ contentType: 'application/x-amz-json-1.1', body: JSON.stringify(reply) });
  });
  const tokens: string[] = [];
  await page.route('**/api/admin/stats?days=7', (route) => {
    tokens.push(route.request().headers()['x-admin-token'] ?? '');
    return route.fulfill({
      json: {
        days: [
          {
            day: '2026-10-11',
            sessions: 5,
            tools: { photo: { open: 5, selected: 3, exported: 3, errors: 0 } },
            devices: [],
            presets: [{ id: 'samsung-galaxy-s26:main', n: 1 }],
            misses: [],
            jobs: [{ type: 'gif', ok: 3, failed: 1, p50Ms: 5000, p95Ms: 9000, costUsd: 0.0006 }],
            errors: [],
            links: { saved: 2, blocked: 0 },
            cost: { totalUsd: 0.01, services: [{ service: 'AWS Lambda', usd: 0.01 }] },
          },
        ],
      },
    });
  });

  await page.goto('/admin');
  await page.getByLabel('이메일').fill('admin@example.com');
  await page.getByLabel('비밀번호').fill('Temporary-123');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.getByLabel(/새 비밀번호/).fill('NewPassword1234');
  await page.getByRole('button', { name: '확인' }).click();
  await expect(page.getByText('JBSWY3DPEHPK3PXP')).toBeVisible();
  await page.getByLabel('6자리 코드').fill('123456');
  await page.getByRole('button', { name: '확인' }).click();

  await expect(page.getByText('변환 성공 / 실패')).toBeVisible();
  await expect(page.getByText('75%')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'samsung-galaxy-s26:main' })).toBeVisible();
  expect(tokens).toEqual(['ID']);
  expect(targets).toEqual([
    'InitiateAuth',
    'RespondToAuthChallenge',
    'AssociateSoftwareToken',
    'VerifySoftwareToken',
    'RespondToAuthChallenge',
  ]);
});

test('비밀번호가 틀리면 이유를 보여준다', async ({ page }) => {
  await page.route('**/admin-config.json', (route) =>
    route.fulfill({ json: { region: 'ap-northeast-2', userPoolId: 'pool', clientId: 'client' } }),
  );
  await page.route('https://cognito-idp.ap-northeast-2.amazonaws.com/', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/x-amz-json-1.1',
      body: JSON.stringify({ __type: 'NotAuthorizedException', message: 'Incorrect' }),
    }),
  );
  await page.goto('/admin');
  await page.getByLabel('이메일').fill('admin@example.com');
  await page.getByLabel('비밀번호').fill('wrong-password');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('alert')).toHaveText('이메일이나 비밀번호가 맞지 않아요.');
});
