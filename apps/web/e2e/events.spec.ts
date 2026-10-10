import { expect, test } from '@playwright/test';
import { makeImage } from './images';

/**
 * 사용 이벤트 (docs/ADMIN.md). 서버는 가짜로 받기만 하고, 보낸 내용에 파일명이 없는지 본다.
 */
test('사진 도구를 쓰면 허용한 이벤트만 모아 보내고 파일명은 보내지 않는다', async ({ page }) => {
  const bodies: { events: Record<string, unknown>[] }[] = [];
  await page.route('**/api/events', async (route) => {
    bodies.push(route.request().postDataJSON() as { events: Record<string, unknown>[] });
    await route.fulfill({ status: 204 });
  });
  await page.goto('/photo');
  await page.getByLabel(/사진을 끌어오세요/).setInputFiles({
    name: '비밀-파일이름.jpg',
    mimeType: 'image/jpeg',
    buffer: await makeImage(page, 800, 600),
  });
  await expect(page.getByAltText('고른 사진 원본')).toBeVisible();
  // 몇 초씩 모아 보낸다
  await expect
    .poll(() => bodies.flatMap((b) => b.events).map((e) => e.name), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(['session_start', 'tool_open', 'file_selected']));

  const events = bodies.flatMap((b) => b.events);
  expect(events.find((e) => e.name === 'file_selected')).toMatchObject({
    tool: 'photo',
    kind: 'image',
    sizeBucket: '<1MB',
    width: 800,
    height: 600,
  });
  for (const e of events) {
    expect(typeof e.sessionId).toBe('string');
    expect(typeof e.ts).toBe('number');
  }
  expect(JSON.stringify(bodies)).not.toContain('비밀-파일이름');
});
