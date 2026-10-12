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
  await page.route('**/api/streamer/broadcasts', (route) =>
    route.fulfill({ json: { broadcasts: [] } }),
  );
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

test('수집 시작 → 수집 중 숫자 → 종료 요청, 지난 수집 기록', async ({ page }) => {
  await page.route('**/api/streamer/me', (route) => route.fulfill({ json: { connection } }));
  const done = {
    id: '20261011120000-aaaaaa',
    status: 'done',
    requestedAt: '2026-10-11T12:00:00.000Z',
    startedAt: '2026-10-11T12:01:00.000Z',
    endedAt: '2026-10-11T15:00:00.000Z',
    chatCount: 12034,
    donationCount: 5,
    subscriptionCount: 2,
    stopReason: 'idle',
  };
  const live = {
    id: '20261012090000-bbbbbb',
    status: 'collecting',
    requestedAt: '2026-10-12T09:00:00.000Z',
    startedAt: '2026-10-12T09:01:00.000Z',
    chatCount: 321,
    donationCount: 1,
    subscriptionCount: 0,
  };
  let started = false;
  let stopped = false;
  await page.route('**/api/streamer/broadcasts', (route) => {
    if (route.request().method() === 'POST') {
      started = true;
      return route.fulfill({ status: 201, json: { broadcast: { ...live, status: 'starting' } } });
    }
    const current = stopped ? { ...live, stopRequested: true } : live;
    return route.fulfill({ json: { broadcasts: started ? [current, done] : [done] } });
  });
  await page.route('**/api/streamer/broadcasts/*/stop', (route) => {
    stopped = true;
    return route.fulfill({ json: { broadcast: { ...live, stopRequested: true } } });
  });

  await page.goto('/highlight');
  const history = page.getByRole('list', { name: '지난 수집' });
  await expect(history).toContainText('채팅 12,034');
  await expect(history).toContainText('30분 동안 채팅이 없어 끝났어요');

  await page.getByRole('button', { name: '수집 시작' }).click();
  await expect(page.getByText('수집 중', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '채팅 수집' })).toContainText('321');

  await page.getByRole('button', { name: '수집 종료' }).click();
  await expect(page.getByText('멈추는 중')).toBeVisible();
  await expect(page.getByRole('button', { name: '수집 종료' })).toBeDisabled();
  expect(started && stopped).toBe(true);
});

test('하루 횟수를 넘으면 서버 문구를 그대로 보여준다', async ({ page }) => {
  await page.route('**/api/streamer/me', (route) => route.fulfill({ json: { connection } }));
  await page.route('**/api/streamer/broadcasts', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 429,
          json: {
            error: { code: 'daily_limit', message: '수집은 하루 3번까지 시작할 수 있어요.' },
          },
        })
      : route.fulfill({ json: { broadcasts: [] } }),
  );
  await page.goto('/highlight');
  await page.getByRole('button', { name: '수집 시작' }).click();
  await expect(page.getByRole('status')).toContainText('하루 3번까지');
});
