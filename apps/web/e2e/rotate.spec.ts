import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** 영상 세로로 돌리기 (FEATURES F21). 서버는 가짜로 두고 요청과 미리보기를 본다 */
const CLIP = fileURLToPath(new URL('./fixtures/clip.webm', import.meta.url));

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'WebM 미리보기는 Chromium에서 확인');
});

test('가로 영상을 오른쪽 90°로 돌리면 미리보기가 세로가 되고, 영상 전체를 돌리도록 요청한다', async ({
  page,
}, testInfo) => {
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
          id: '0b8f4c56-1d7e-4c3b-9a55-2f0d6c1e9a10',
          status: 'done',
          kind: body.kind,
          params: body,
          outputBytes: 100_000,
          downloadUrl: '/fake-result',
        },
      },
    });
  });

  await page.goto('/rotate');
  await page.getByLabel(/영상을 끌어오세요/).setInputFiles(CLIP);
  await expect(page.getByText('올리기 완료')).toBeVisible();
  await expect(page.getByText('320 × 180 → 180 × 320')).toBeVisible();
  const box = await page.getByTestId('rotate-preview').boundingBox();
  expect((box?.height ?? 0) > (box?.width ?? 0)).toBe(true);
  await page.getByTestId('rotate-preview').screenshot({ path: testInfo.outputPath('rotated.png') });

  await page.getByLabel(/좌우 반전/).check();
  await page.getByRole('button', { name: '세로로 돌리기' }).click();
  await expect(page.getByText(/돌렸어요/)).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ kind: 'rotate', rotate: 90, flip: true, start: 0 });
  expect(Number(bodies.at(-1)?.end)).toBeCloseTo(4, 1);

  // 빠르게(회전 정보만)는 반전을 할 수 없다
  await page.getByRole('radio', { name: '빠르게' }).click();
  await expect(page.getByLabel(/좌우 반전/)).toHaveCount(0);
  await page.getByRole('radio', { name: '180°' }).click();
  await expect(page.getByText('320 × 180 → 320 × 180')).toBeVisible();
  await page.getByRole('button', { name: '세로로 돌리기' }).click();
  await expect(page.getByText(/돌렸어요/)).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ kind: 'rotate-fast', rotate: 180, flip: false });
});
