import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * 움짤 도구 흐름 (FEATURES F3·F4, ADR-033). 서버는 가짜로 둔다:
 * 업로드 주소 → 같은 출처의 가짜 S3 → 잡 만들기 → 상태 조회 2번 → 결과 GIF.
 * 영상은 ffmpeg testsrc2로 만든 4초 320×180 30fps WebM이다 (e2e/fixtures/clip.webm).
 */
const CLIP = fileURLToPath(new URL('./fixtures/clip.webm', import.meta.url));
const UPLOAD_ID = '7d2e9a41-5b6c-4f8d-8e1a-3c9b0f2d4e6a';
const JOB_ID = '0b8f4c56-1d7e-4c3b-9a55-2f0d6c1e9a10';
// 1×1 GIF
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

type Fake = {
  jobBodies: Record<string, unknown>[];
  uploads: number;
};

async function fakeServer(
  page: Page,
  options: { uploadDelayMs?: number; fail?: string } = {},
): Promise<Fake> {
  const fake: Fake = { jobBodies: [], uploads: 0 };
  let polls = 0;
  await page.route('**/api/uploads', (route) =>
    route.fulfill({
      status: 201,
      json: {
        upload: {
          id: UPLOAD_ID,
          url: '/fake-s3',
          fields: { key: `in/${UPLOAD_ID}`, 'Content-Type': 'video/webm' },
        },
      },
    }),
  );
  await page.route('**/fake-s3', async (route) => {
    if (options.uploadDelayMs) await new Promise((r) => setTimeout(r, options.uploadDelayMs));
    fake.uploads += 1;
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/jobs', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    fake.jobBodies.push(body);
    await route.fulfill({
      status: 201,
      json: { job: { id: JOB_ID, status: 'queued', kind: body.kind, params: body } },
    });
  });
  await page.route(`**/api/jobs/${JOB_ID}`, (route) => {
    polls += 1;
    const params = fake.jobBodies.at(-1) ?? {};
    const job =
      polls < 2
        ? { id: JOB_ID, status: 'processing', kind: params.kind, params }
        : options.fail
          ? { id: JOB_ID, status: 'failed', kind: params.kind, params, error: options.fail }
          : {
              id: JOB_ID,
              status: 'done',
              kind: params.kind,
              params,
              outputBytes: GIF.length,
              downloadUrl: '/fake-result.gif',
            };
    return route.fulfill({ json: { job } });
  });
  await page.route('**/fake-result.gif', (route) =>
    route.fulfill({
      body: GIF,
      headers: {
        'content-type': 'image/gif',
        'content-disposition': 'attachment; filename="fitcut_gif_480_0b8f4c56.gif"',
        'access-control-allow-origin': '*',
      },
    }),
  );
  return fake;
}

async function openClip(page: Page) {
  await page.goto('/gif');
  await page.getByLabel(/영상을 끌어오세요/).setInputFiles(CLIP);
  await expect(page.getByRole('slider', { name: '시작' })).toBeVisible();
}

test.beforeEach(({ browserName }) => {
  // 테스트 영상이 WebM이라 Chromium에서 본다. 아이폰 Safari는 실제 기기로 확인한다
  test.skip(browserName !== 'chromium', 'WebM 미리보기는 Chromium에서 확인');
});

test('영상을 고르면 바로 올리고, 구간을 직접 입력해 GIF를 만들어 저장한다', async ({ page }) => {
  const fake = await fakeServer(page);
  await openClip(page);
  await expect(page.getByText('올리기 완료')).toBeVisible();
  expect(fake.uploads).toBe(1);
  await expect(page.getByText(/320 × 180 · 00:04\.00/)).toBeVisible();

  const start = page.getByRole('textbox', { name: '시작' });
  const end = page.getByRole('textbox', { name: '끝' });
  await expect(start).toHaveValue('00:00.00');
  await expect(end).toHaveValue('00:04.00');
  await start.fill('1');
  await start.press('Enter');
  await end.fill('0:03.5');
  await end.press('Enter');
  await expect(start).toHaveValue('00:01.00');
  await expect(end).toHaveValue('00:03.50');
  await expect(page.getByText('길이 2.50초')).toBeVisible();

  await page.getByRole('button', { name: 'GIF 만들기' }).click();
  await expect(page.getByText(/만들었어요/)).toBeVisible();
  expect(fake.jobBodies).toEqual([
    { uploadId: UPLOAD_ID, kind: 'gif', start: 1, end: 3.5, fps: 15, width: 320 },
  ]);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'GIF 저장' }).click();
  expect((await download).suggestedFilename()).toBe('fitcut_gif_480_0b8f4c56.gif');
});

test('키보드로 구간을 고른다: →·Shift+→로 옮기고 I·O로 시작·끝', async ({ page }) => {
  await fakeServer(page);
  await openClip(page);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < 15; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('KeyI');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('KeyO');
  await expect(page.getByRole('textbox', { name: '시작' })).toHaveValue('00:00.50');
  await expect(page.getByRole('textbox', { name: '끝' })).toHaveValue('00:01.50');

  // 핸들에 포커스하면 화살표가 핸들을 1프레임씩 옮긴다
  await page.getByRole('slider', { name: '끝' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('textbox', { name: '끝' })).toHaveValue('00:01.60');
});

test('올리는 중에 만들기를 누르면 올리기가 끝나는 대로 만든다', async ({ page }) => {
  const fake = await fakeServer(page, { uploadDelayMs: 1500 });
  await openClip(page);
  await page.getByRole('radio', { name: 'MP4' }).click();
  await page.getByRole('button', { name: 'MP4 만들기' }).click();
  await expect(page.getByRole('button', { name: '올리기가 끝나면 바로 만들어요' })).toBeDisabled();
  await expect(page.getByText(/만들었어요/)).toBeVisible();
  expect(fake.jobBodies).toHaveLength(1);
  expect(fake.jobBodies[0]).toMatchObject({ kind: 'mp4', start: 0, end: 4 });
});

test('변환에 실패하면 서버가 준 이유를 보여주고 다시 만들 수 있다', async ({ page }) => {
  await fakeServer(page, { fail: '영상을 읽을 수 없어요. 다른 영상을 골라 주세요.' });
  await openClip(page);
  await expect(page.getByText('올리기 완료')).toBeVisible();
  await page.getByRole('button', { name: 'GIF 만들기' }).click();
  await expect(page.getByText('영상을 읽을 수 없어요. 다른 영상을 골라 주세요.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'GIF 만들기' })).toBeEnabled();
});

test('영상이 아닌 파일은 이유를 알려준다', async ({ page }) => {
  await page.goto('/gif');
  await page.getByLabel(/영상을 끌어오세요/).setInputFiles({
    name: 'a.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await expect(page.getByRole('alert')).toHaveText(
    '영상 파일이 아니에요. MP4 · MOV · WebM 영상을 골라 주세요.',
  );
});

test('워치 화면용: 갤럭시 워치는 화면 크기 GIF, 애플워치는 MP4로 정확한 크기를 요청한다', async ({
  page,
}) => {
  const fake = await fakeServer(page);
  await openClip(page);
  await expect(page.getByText('올리기 완료')).toBeVisible();
  await page.getByRole('radio', { name: '워치 화면' }).click();
  await page.getByLabel('워치').selectOption({ label: 'Galaxy Watch9 44mm (480 × 480)' });
  await expect(page.getByText(/둥근 화면이라 네 모서리는 보이지 않아요/)).toBeVisible();
  await page.getByRole('button', { name: 'GIF 만들기' }).click();
  await expect(page.getByText(/만들었어요 · 480 × 480/)).toBeVisible();
  expect(fake.jobBodies.at(-1)).toMatchObject({ kind: 'gif', width: 480, height: 480 });

  await page.getByLabel('워치').selectOption({ label: 'Apple Watch Series 11 46mm (416 × 496)' });
  await expect(page.getByText(/Live Photo만 움직여요/)).toBeVisible();
  await page.getByRole('button', { name: 'MP4 만들기' }).click();
  await expect(page.getByText(/만들었어요 · 416 × 496/)).toBeVisible();
  expect(fake.jobBodies.at(-1)).toMatchObject({ kind: 'mp4', width: 416, height: 496 });
});
