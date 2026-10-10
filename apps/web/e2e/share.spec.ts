import { expect, test, type Page } from '@playwright/test';
import { makeImage } from './images';

/**
 * 아이폰 Safari의 공유 화면(Web Share)을 흉내 낸다. 실제 공유 화면은 자동화로 열 수 없어서
 * navigator.share가 받은 파일을 기록만 한다. blockFirst면 첫 번째는 "누른 직후가 아님"으로 막는다.
 */
async function fakeShare(page: Page, blockFirst: boolean) {
  await page.addInitScript((block) => {
    const shares: { name: string; type: string; size: number }[] = [];
    let blockNext = block;
    Object.assign(window, { __shares: shares });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { files: File[] }) => {
        const f = data.files[0];
        if (f) shares.push({ name: f.name, type: f.type, size: f.size });
        if (blockNext) {
          blockNext = false;
          throw new DOMException('no user activation', 'NotAllowedError');
        }
      },
    });
  }, blockFirst);
}

async function shares(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __shares: { name: string; type: string; size: number }[] }).__shares,
  );
}

async function makeWallpaper(page: Page) {
  await page.goto('/photo');
  await page.getByLabel(/사진을 끌어오세요/).setInputFiles({
    name: 'a.jpg',
    mimeType: 'image/jpeg',
    buffer: await makeImage(page, 1600, 1000),
  });
  await page.getByRole('searchbox', { name: '기기 이름으로 찾기' }).fill('17 프로');
  await page
    .getByRole('list', { name: '검색 결과' })
    .getByRole('button', { name: /^iPhone 17 Pro \d/ })
    .click();
}

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'iphone' || browserName !== 'webkit',
    '아이폰(WebKit)에서만 공유 화면으로 저장한다',
  );
});

test('아이폰은 공유 화면으로 넘겨서 사진 앱에 저장하게 한다', async ({ page }) => {
  await fakeShare(page, false);
  await makeWallpaper(page);
  await expect(
    page.getByText('공유 화면에서 ‘이미지 저장’을 누르면 사진 앱에 들어가요.'),
  ).toBeVisible();

  let downloaded = false;
  page.on('download', () => (downloaded = true));
  await page.getByRole('button', { name: '이미지 저장' }).click();
  await expect(page.getByRole('status')).toContainText('만들었어요');
  expect(await shares(page)).toEqual([
    { name: 'a_iPhone-17-Pro_1206x2622.jpg', type: 'image/jpeg', size: expect.any(Number) },
  ]);
  expect((await shares(page))[0]?.size).toBeGreaterThan(10_000);
  expect(downloaded).toBe(false);
  await expect(page.getByRole('button', { name: '사진 앱에 저장' })).toHaveCount(0);
});

test('만드는 사이 공유 화면이 막히면 "사진 앱에 저장"을 다시 누르게 한다', async ({ page }) => {
  await fakeShare(page, true);
  await makeWallpaper(page);
  await page.getByRole('button', { name: '이미지 저장' }).click();
  const again = page.getByRole('button', { name: '사진 앱에 저장' });
  await expect(again).toBeVisible();
  await again.click();
  await expect.poll(async () => (await shares(page)).length).toBe(2);
});
