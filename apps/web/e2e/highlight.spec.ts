import { expect, test } from '@playwright/test';

/**
 * 하이라이트: 치지직 채널 연결 (M5). 스트리머 API는 가짜로 둔다.
 * 실제 로그인은 /api/streamer/chzzk/login → 치지직 → 콜백 → /highlight?connected=chzzk 로 돌아온다.
 */
const connection = {
  platform: 'chzzk',
  channelId: '909501f048b44cf0d5c1d28aaaaaaaa1',
  channelName: '테스트채널',
  connectedAt: '2026-10-12T09:00:00.000Z',
};

test('연결 안 됨: 연결 버튼이 로그인 주소로 간다', async ({ page }) => {
  await page.route('**/api/streamer/me', (route) => route.fulfill({ json: { connection: null } }));
  await page.goto('/highlight');
  const link = page.getByRole('link', { name: '치지직 채널 연결' });
  await expect(link).toHaveAttribute('href', '/api/streamer/chzzk/login');
});

test('연결됨: 채널 이름을 보여주고, 연결 해제하면 연결 버튼으로 돌아간다', async ({ page }) => {
  await page.route('**/api/streamer/me', (route) => route.fulfill({ json: { connection } }));
  let deleted = false;
  await page.route('**/api/streamer/connection', (route) => {
    deleted = route.request().method() === 'DELETE';
    return route.fulfill({ status: 204 });
  });
  await page.goto('/highlight?connected=chzzk');
  await expect(page.getByText('치지직 연결됨')).toBeVisible();
  await expect(page.getByText('테스트채널')).toBeVisible();
  // 콜백 표시는 주소에서 지운다
  await expect(page).toHaveURL(/\/highlight$/);

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '연결 해제' }).click();
  await expect(page.getByRole('status')).toContainText('연결을 해제했어요');
  await expect(page.getByRole('link', { name: '치지직 채널 연결' })).toBeVisible();
  expect(deleted).toBe(true);
});

test('콜백 오류를 안내한다', async ({ page }) => {
  await page.route('**/api/streamer/me', (route) => route.fulfill({ json: { connection: null } }));
  await page.goto('/highlight?error=denied');
  await expect(page.getByRole('status')).toContainText('권한을 허용하지 않아');
});
