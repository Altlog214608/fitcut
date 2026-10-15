import { expect, test } from '@playwright/test';

/** 머리말의 언어·테마 버튼 (2026-10-15). 고르면 새로고침 뒤에도 남는다 */
test('영어로 바꾸면 홈·사진 도구가 영어로 나오고, 새로고침해도 유지된다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('내 기기에 딱 맞게');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('made to fit your devices');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.reload();
  await expect(page.getByRole('link', { name: /Resize a photo/ })).toBeVisible();
  await page.goto('/photo');
  await expect(page.getByLabel(/Drop a photo here/)).toBeAttached();

  for (const [path, title, drop] of [
    ['/gif', 'GIF maker', /Drop a video here/],
    ['/audio', 'Audio', /Drop a video or audio file/],
    ['/rotate', 'Straighten a video', /Drop a video here/],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByLabel(drop)).toBeAttached();
  }
  for (const [path, title] of [
    ['/link', 'Link sections'],
    ['/highlight', 'Highlights'],
    ['/my-jobs', 'My jobs'],
    ['/privacy', 'Privacy policy'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  }
  await expect(page.getByText(/the Korean version applies/)).toBeVisible();
  await page.goto('/photo');
  await page.getByRole('button', { name: '한국어' }).click();
  await expect(page.getByLabel(/사진을 끌어다 놓으세요/)).toBeAttached();
});

test('어두운 화면을 고르면 기기 설정과 상관없이 유지된다', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: '어두운 화면으로' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(16, 18, 21)');
  await page.getByRole('button', { name: '밝은 화면으로' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
