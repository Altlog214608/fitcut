import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { hasExif, imageSize, makeImage, withExif } from './images';

/** 사진 작업 중 업로드 요청이 없는지 본다 (F1 수용 기준, M1 완료 기준) */
function watchUploads(page: Page): string[] {
  const suspicious: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const local =
      url.hostname === 'localhost' || url.protocol === 'blob:' || url.protocol === 'data:';
    if (request.method() !== 'GET' || !local)
      suspicious.push(`${request.method()} ${request.url()}`);
  });
  return suspicious;
}

async function openPhotoFromHome(page: Page, file: Buffer, name: string) {
  await page
    .getByLabel(/파일을 끌어오세요/)
    .setInputFiles({ name, mimeType: 'image/jpeg', buffer: file });
  await expect(page.getByRole('heading', { level: 1, name: '사진' })).toBeVisible();
}

async function chooseDevice(page: Page, query: string, name: string) {
  await page.getByRole('searchbox', { name: '기기 이름으로 찾기' }).fill(query);
  await page
    .getByRole('list', { name: '검색 결과' })
    // 이름 바로 뒤에 해상도가 온다: "iPhone 17 Pro 1206 × 2622" (Pro Max와 구분)
    .getByRole('button', { name: new RegExp(`^${name} \\d`) })
    .click();
}

async function save(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '이미지 저장' }).click(),
  ]);
  return { name: download.suggestedFilename(), file: await readFile(await download.path()) };
}

test('가로가 넓은 사진을 배경 채우기로 아이폰 배경화면으로 만든다 (위치정보 제거, 업로드 없음)', async ({
  page,
}) => {
  const uploads = watchUploads(page);
  await page.goto('/');
  const photo = withExif(await makeImage(page, 1600, 1000), 1, true);
  expect(hasExif(photo)).toBe(true);

  await openPhotoFromHome(page, photo, 'landscape.jpg');
  await expect(page.getByText('원본 1600 × 1000')).toBeVisible();
  await chooseDevice(page, '17 프로', 'iPhone 17 Pro');
  await expect(page.getByText('이 사진은 화면보다 가로가 넓어서 양옆이 잘려요.')).toBeVisible();

  await page.getByRole('button', { name: '배경 채우기로 사진 전체 넣기' }).click();
  await expect(page.getByRole('radio', { name: '배경 채우기' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  const { name, file } = await save(page);
  expect(name).toBe('landscape_iPhone-17-Pro_1206x2622.jpg');
  expect(imageSize(file)).toEqual({ width: 1206, height: 2622, type: 'jpeg' });
  expect(hasExif(file)).toBe(false);
  await expect(page.getByRole('status')).toContainText('저장했어요');
  expect(uploads).toEqual([]);
});

test('EXIF 방향을 반영해서 세로로 찍은 사진이 눕지 않는다', async ({ page }) => {
  await page.goto('/');
  // 400x300으로 저장됐지만 "90도 돌려서 보라"(6)는 정보가 있는 사진
  const photo = withExif(await makeImage(page, 400, 300), 6);
  await openPhotoFromHome(page, photo, 'rotated.jpg');
  await expect(page.getByText('원본 300 × 400')).toBeVisible();
});

test('원형 워치는 원 바깥을 투명하게 PNG로 저장할 수 있다', async ({ page }) => {
  await page.goto('/');
  await openPhotoFromHome(page, await makeImage(page, 1000, 1000), 'square.jpg');
  await chooseDevice(page, '워치9 44', 'Galaxy Watch9 44mm');
  await page.getByRole('radio', { name: '투명 (PNG)' }).click();
  await expect(page.getByText('JPG는 투명을 담을 수 없어서 PNG로 저장돼요.')).toBeVisible();

  const { name, file } = await save(page);
  expect(name).toBe('square_Galaxy-Watch9-44mm_480x480.png');
  expect(imageSize(file)).toEqual({ width: 480, height: 480, type: 'png' });

  const [corner, center] = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(bitmap, 0, 0);
    return [ctx.getImageData(2, 2, 1, 1).data[3], ctx.getImageData(240, 240, 1, 1).data[3]];
  }, file.toString('base64'));
  expect(corner).toBe(0);
  expect(center).toBe(255);
});

test('최근 기기와 내 기기가 새로고침 후에도 남는다', async ({ page }) => {
  await page.goto('/photo');
  await page.getByLabel(/사진을 끌어오세요/).setInputFiles({
    name: 'a.jpg',
    mimeType: 'image/jpeg',
    buffer: await makeImage(page, 800, 600),
  });
  await chooseDevice(page, '플립8', 'Galaxy Z Flip8');
  await page.getByRole('radio', { name: '커버 화면' }).click();
  await page.getByRole('button', { name: '내 기기로 저장' }).click();
  await page.reload();
  await page.getByLabel(/사진을 끌어오세요/).setInputFiles({
    name: 'b.jpg',
    mimeType: 'image/jpeg',
    buffer: await makeImage(page, 800, 600),
  });
  await expect(page.getByText('Galaxy Z Flip8 커버 화면').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '내 기기', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('화면 캡처 (라이트·다크)', async ({ page }, testInfo) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await page.screenshot({ path: testInfo.outputPath(`home-${scheme}.png`), fullPage: true });
    await openPhotoFromHome(page, await makeImage(page, 850, 1134), 'portrait.jpg');
    await chooseDevice(page, '17 프로', 'iPhone 17 Pro');
    await page.screenshot({
      path: testInfo.outputPath(`photo-cover-${scheme}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: '배경 채우기로 사진 전체 넣기' }).click();
    await page.screenshot({
      path: testInfo.outputPath(`photo-contain-${scheme}.png`),
      fullPage: true,
    });
  }
});
