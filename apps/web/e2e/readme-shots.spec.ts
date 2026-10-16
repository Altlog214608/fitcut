import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * README 화면 캡처 (docs/images). 평소 테스트에서는 건너뛴다.
 * 다시 찍기: README_SHOTS=1 pnpm --filter @fitcut/web e2e readme-shots --project=desktop
 */
test.skip(!process.env.README_SHOTS, 'README_SHOTS=1일 때만 찍는다');

const out = (name: string) =>
  fileURLToPath(new URL(`../../../docs/images/${name}.png`, import.meta.url));

/** 캡처용 부드러운 그라데이션 사진 */
async function pastel(page: Page, width: number, height: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, '#bcd7f5');
      g.addColorStop(0.45, '#f6b8c8');
      g.addColorStop(1, '#ffd36e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      return canvas.toDataURL('image/jpeg', 0.95);
    },
    { width, height },
  );
  return Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
}

test.describe('데스크톱', () => {
  test.use({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });

  test('홈과 사진 도구', async ({ page }) => {
    await page.goto('/');
    await page.screenshot({ path: out('home') });

    await page.getByLabel(/파일을 끌어다 놓으세요/).setInputFiles({
      name: 'sample.jpg',
      mimeType: 'image/jpeg',
      buffer: await pastel(page, 1600, 1200),
    });
    await expect(page.getByRole('heading', { level: 1, name: '사진' })).toBeVisible();
    await page.getByRole('searchbox', { name: '기기 이름으로 찾기' }).fill('17 프로');
    await page
      .getByRole('list', { name: '검색 결과' })
      .getByRole('button', { name: /^iPhone 17 Pro \d/ })
      .click();
    await page.getByRole('searchbox', { name: '기기 이름으로 찾기' }).fill('');
    await page.getByRole('searchbox', { name: '기기 이름으로 찾기' }).blur();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: out('photo') });
  });

  test('하이라이트 리플레이', async ({ page }) => {
    await page.route('**/api/streamer/me', (route) =>
      route.fulfill({ json: { connection: null } }),
    );
    await page.goto('/highlight');
    await page.getByRole('button', { name: '예시 방송 열기' }).click();
    await page.getByRole('button', { name: '10배' }).click();
    await page.getByRole('button', { name: '재생', exact: true }).click();
    await page.getByRole('button', { name: '잠시 멈춤' }).click();
    await page.getByRole('button', { name: '결과 바로 보기' }).click();
    await expect(page.getByText('30:00 / 30:00')).toBeVisible();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: out('highlight-replay') });
  });
});

test.describe('모바일', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });

  test('홈', async ({ page }) => {
    await page.goto('/');
    await page.screenshot({ path: out('home-mobile') });
  });
});
