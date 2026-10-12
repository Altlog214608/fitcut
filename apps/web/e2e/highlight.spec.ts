import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const CLIP = fileURLToPath(new URL('./fixtures/clip.webm', import.meta.url));

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

test('지난 수집의 하이라이트: 그래프, 후보 시각, offset 반영, 타임라인 복사', async ({
  page,
  context,
  browserName,
}) => {
  await page.route('**/api/streamer/me', (route) => route.fulfill({ json: { connection } }));
  const base = {
    id: '20261011120000-aaaaaa',
    status: 'done',
    requestedAt: '2026-10-11T12:00:00.000Z',
    startedAt: '2026-10-11T12:01:00.000Z',
    endedAt: '2026-10-11T13:30:00.000Z',
    chatCount: 5400,
    donationCount: 3,
    subscriptionCount: 1,
    stopReason: 'requested',
    analysisStatus: 'done',
  };
  await page.route('**/api/streamer/broadcasts', (route) =>
    route.fulfill({ json: { broadcasts: [base] } }),
  );
  await page.route('**/api/streamer/broadcasts/20261011120000-aaaaaa', (route) =>
    route.fulfill({
      json: {
        broadcast: {
          ...base,
          durationSec: 5340,
          reactionCount: 900,
          chatPer10s: Array.from({ length: 535 }, (_, i) => (i === 200 ? 90 : 10)),
          candidates: [
            {
              rank: 1,
              start: 1990,
              end: 2015,
              peak: 2005,
              score: 7.2,
              counts: { chat: 90, reaction: 60, donation: 1, subscription: 0 },
            },
            {
              rank: 2,
              start: 300,
              end: 325,
              peak: 315,
              score: 3.1,
              counts: { chat: 40, reaction: 20, donation: 0, subscription: 0 },
            },
          ],
        },
      },
    }),
  );
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  }

  await page.goto('/highlight');
  await page.getByRole('button', { name: '하이라이트 보기' }).click();
  await expect(page.getByRole('img', { name: /채팅 수 그래프/ })).toBeVisible();
  const list = page.getByRole('list', { name: '하이라이트 후보' });
  // 시간 순서: 05:00, 33:10
  await expect(list.getByRole('listitem').first()).toContainText('05:00 – 05:25');
  await expect(list).toContainText('33:10 – 33:35');
  await expect(list).toContainText('1위');

  await page.getByRole('textbox').fill('2:00');
  await expect(list.getByRole('listitem').first()).toContainText('07:00 – 07:25');

  // 편집용 마커: 자막(SRT) 파일은 offset이 반영된 시각으로
  const [srt] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '자막 (SRT)' }).click(),
  ]);
  expect(srt.suggestedFilename()).toBe('fitcut-highlight-20261011120000-aaaaaa.srt');
  const srtPath = await srt.path();
  const { readFile } = await import('node:fs/promises');
  expect(await readFile(srtPath, 'utf8')).toContain('1\n00:07:00,000 --> 00:07:25,000\n');

  await page.getByRole('button', { name: '유튜브 댓글용 타임라인 복사' }).click();
  if (browserName === 'chromium') {
    await expect(page.getByRole('button', { name: '복사했어요' })).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    // Windows 클립보드는 줄바꿈을 \r\n으로 바꾼다
    expect(text.replace(/\r\n/g, '\n')).toBe('07:00 하이라이트 1\n35:10 하이라이트 2');
  }
});

test('분석 전이면 기다려 달라고 안내한다', async ({ page }) => {
  await page.route('**/api/streamer/me', (route) => route.fulfill({ json: { connection } }));
  const b = {
    id: '20261012090000-cccccc',
    status: 'done',
    requestedAt: '2026-10-12T09:00:00.000Z',
    chatCount: 10,
    donationCount: 0,
    subscriptionCount: 0,
    stopReason: 'requested',
  };
  await page.route('**/api/streamer/broadcasts', (route) =>
    route.fulfill({ json: { broadcasts: [b] } }),
  );
  await page.route('**/api/streamer/broadcasts/20261012090000-cccccc', (route) =>
    route.fulfill({ json: { broadcast: { ...b, candidates: [], chatPer10s: [] } } }),
  );
  await page.goto('/highlight');
  await page.getByRole('button', { name: '하이라이트 보기' }).click();
  await expect(page.getByText('분석하고 있어요')).toBeVisible();
});

test('녹화 파일: 고르면 바로 후보 장면을 재생하고, 조각으로 나눠 올린다', async ({ page }) => {
  await page.route('**/api/streamer/me', (route) => route.fulfill({ json: { connection } }));
  const b = {
    id: '20261011120000-dddddd',
    status: 'done',
    requestedAt: '2026-10-11T12:00:00.000Z',
    chatCount: 100,
    donationCount: 0,
    subscriptionCount: 0,
    stopReason: 'requested',
    analysisStatus: 'done',
  };
  await page.route('**/api/streamer/broadcasts', (route) =>
    route.fulfill({ json: { broadcasts: [b] } }),
  );
  await page.route(`**/api/streamer/broadcasts/${b.id}`, (route) =>
    route.fulfill({
      json: {
        broadcast: {
          ...b,
          chatPer10s: [1, 2],
          candidates: [
            {
              rank: 1,
              start: 1,
              end: 3,
              peak: 2,
              score: 4,
              counts: { chat: 9, reaction: 5, donation: 0, subscription: 0 },
            },
          ],
        },
      },
    }),
  );
  let server: Record<string, unknown> | null = null;
  const put: string[] = [];
  await page.route(`**/api/streamer/broadcasts/${b.id}/recording`, async (route) => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ json: { recording: server } });
    const body = route.request().postDataJSON() as { size: number; name: string };
    // 작은 파일도 조각 2개로 나눠 보게 조각 크기를 작게 준다
    const partSize = Math.ceil(body.size / 2);
    server = { status: 'uploading', size: body.size, partSize, partCount: 2 };
    return route.fulfill({ status: 201, json: { recording: server } });
  });
  await page.route(`**/api/streamer/broadcasts/${b.id}/recording/parts`, (route) => {
    const { partNumbers } = route.request().postDataJSON() as { partNumbers: number[] };
    return route.fulfill({
      json: {
        parts: partNumbers.map((n) => ({ partNumber: n, url: `https://s3.example/part/${n}` })),
      },
    });
  });
  await page.route('https://s3.example/part/*', (route) => {
    put.push(`${route.request().method()} ${route.request().url().split('/').at(-1)}`);
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route(`**/api/streamer/broadcasts/${b.id}/recording/complete`, (route) => {
    server = { ...server, status: 'uploaded' };
    return route.fulfill({ json: { recording: server } });
  });

  await page.goto('/highlight');
  await page.getByRole('button', { name: '하이라이트 보기' }).click();
  await page.locator('input[type=file]').setInputFiles(CLIP);
  await expect(page.locator('video')).toBeVisible();
  await expect(page.getByRole('button', { name: '▶ 1. 00:01' })).toBeVisible();
  await page.getByRole('button', { name: '+5초' }).click();
  await expect(page.getByRole('button', { name: '▶ 1. 00:06' })).toBeVisible();

  await page.getByRole('button', { name: '녹화 파일 올리기' }).click();
  await expect(page.getByRole('status')).toContainText('녹화 파일을 올렸어요');
  expect(put.sort()).toEqual(['PUT 1', 'PUT 2']);
  await expect(page.getByRole('button', { name: '올린 파일 지우기' })).toBeVisible();
});
