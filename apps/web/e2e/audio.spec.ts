import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * 음성 도구 (FEATURES F14). 서버는 가짜로 두고, 화면이 보내는 요청과 안내를 본다.
 * 시험 파일은 ffmpeg로 만든 4초 440Hz Opus WebM (e2e/fixtures/tone.webm).
 */
const TONE = fileURLToPath(new URL('./fixtures/tone.webm', import.meta.url));
const JOB_ID = '0b8f4c56-1d7e-4c3b-9a55-2f0d6c1e9a10';

async function fakeServer(page: Page) {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/uploads', (route) =>
    route.fulfill({
      status: 201,
      json: { upload: { id: 'u', url: '/fake-s3', fields: { key: 'in/u' } } },
    }),
  );
  await page.route('**/fake-s3', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/jobs', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    await route.fulfill({
      status: 201,
      json: {
        job: {
          id: JOB_ID,
          status: 'done',
          kind: body.kind,
          params: body,
          outputBytes: 48_000,
          downloadUrl: '/fake-result',
        },
      },
    });
  });
  return bodies;
}

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Opus WebM은 Chromium에서 확인');
});

test('파형을 보며 구간을 고르고 페이드·음량 맞추기를 넣어 MP3를 만든다', async ({ page }) => {
  const bodies = await fakeServer(page);
  await page.goto('/audio');
  await page.getByLabel(/영상이나 음성 파일을 끌어오세요/).setInputFiles(TONE);
  await expect(page.getByText('올리기 완료')).toBeVisible();
  await expect(page.locator('svg rect').first()).toBeAttached(); // 파형
  // Opus는 인코더 지연 때문에 4.0065초쯤이다
  await expect(page.getByRole('textbox', { name: '끝' })).toHaveValue(/^00:04\.0\d$/);

  await page.getByRole('textbox', { name: '시작' }).fill('0.5');
  await page.getByRole('textbox', { name: '시작' }).press('Enter');
  await page
    .getByRole('radiogroup', { name: '페이드 인' })
    .getByRole('radio', { name: '1초' })
    .click();
  await page
    .getByRole('radiogroup', { name: '페이드 아웃' })
    .getByRole('radio', { name: '0.5초' })
    .click();
  await page.getByLabel(/음량 맞추기/).check();
  await page.getByRole('button', { name: 'MP3 만들기' }).click();
  await expect(page.getByText(/만들었어요/)).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({
    kind: 'mp3',
    start: 0.5,
    audio: { fadeIn: 1, fadeOut: 0.5, normalize: true, channels: 2, bitrate: 192 },
  });
});

test('아이폰 벨소리는 M4R로, 페이드가 구간보다 길면 안내한다', async ({ page }) => {
  const bodies = await fakeServer(page);
  await page.goto('/audio');
  await page.getByLabel(/영상이나 음성 파일을 끌어오세요/).setInputFiles(TONE);
  await expect(page.getByText('올리기 완료')).toBeVisible();
  await page.getByRole('radio', { name: '아이폰 벨소리' }).click();
  await expect(page.getByText(/30초까지예요/)).toBeVisible();

  await page
    .getByRole('radiogroup', { name: '페이드 인' })
    .getByRole('radio', { name: '3초' })
    .click();
  await page
    .getByRole('radiogroup', { name: '페이드 아웃' })
    .getByRole('radio', { name: '2초' })
    .click();
  await expect(page.getByRole('alert')).toHaveText(
    '페이드가 구간보다 길어요. 페이드를 줄여 주세요.',
  );
  await expect(page.getByRole('button', { name: '아이폰 벨소리 만들기' })).toBeDisabled();

  await page
    .getByRole('radiogroup', { name: '페이드 아웃' })
    .getByRole('radio', { name: '없음' })
    .click();
  await page.getByRole('button', { name: '아이폰 벨소리 만들기' }).click();
  await expect(page.getByText(/만들었어요/)).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ kind: 'm4r', audio: { fadeIn: 3, fadeOut: 0 } });
});
