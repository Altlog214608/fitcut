import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { imageSize, makeImage } from './images';

/** 카카오톡 인앱 브라우저처럼 보이게 사용자 에이전트를 바꿔서 확인한다 (실제 카카오톡 웹뷰는 아니다) */
const KAKAO_ANDROID =
  'Mozilla/5.0 (Linux; Android 15; SM-S938N Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 KAKAOTALK/26.8.1 (INAPP)';
const KAKAO_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 26.8.1';

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(
    browserName !== 'chromium' || testInfo.project.name !== 'desktop',
    '사용자 에이전트만 바꾸는 시험이라 한 번만',
  );
});

async function openPhoto(page: import('@playwright/test').Page) {
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

test.describe('카카오톡 안드로이드', () => {
  test.use({ userAgent: KAKAO_ANDROID });

  test('맨 위에 다른 브라우저로 열기 안내가 있고, 저장 대신 안내를 보여준다', async ({ page }) => {
    await openPhoto(page);
    const notice = page.getByRole('complementary', { name: '다른 브라우저로 열기 안내' });
    await expect(notice).toContainText('카카오톡 안에서는 사진 저장이 안 될 수 있어요.');
    await expect(notice.getByRole('link', { name: '다른 브라우저로 열기' })).toHaveAttribute(
      'href',
      'kakaotalk://web/openExternal?url=http%3A%2F%2Flocalhost%3A4173%2Fphoto',
    );

    let downloaded = false;
    page.on('download', () => (downloaded = true));
    await page.getByRole('button', { name: '이미지 저장' }).click();
    await expect(page.getByRole('alert')).toContainText('카카오톡 안에서는 저장할 수 없어요.');
    expect(downloaded).toBe(false);
  });
});

test.describe('카카오톡 iOS', () => {
  test.use({ userAgent: KAKAO_IOS });

  test('data URL로 내려받는다', async ({ page }) => {
    await openPhoto(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '이미지 저장' }).click(),
    ]);
    expect(download.url().startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(download.suggestedFilename()).toBe('a_iPhone-17-Pro_1206x2622.jpg');
    expect(imageSize(await readFile(await download.path()))).toMatchObject({
      width: 1206,
      height: 2622,
    });
  });
});

test('일반 브라우저에는 안내가 없다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: '다른 브라우저로 열기 안내' })).toHaveCount(
    0,
  );
});
