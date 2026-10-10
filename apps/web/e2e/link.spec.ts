import { expect, test, type Page } from '@playwright/test';

/**
 * 링크 구간 (FEATURES F15). 유튜브 공식 스크립트(iframe_api)를 가짜로 바꿔 네트워크 없이 확인한다.
 * 가짜 플레이어: 길이 120초, 재생하면 0.1초마다 0.5초씩 간다. BLOCKED0000은 퍼가기 금지(150).
 */
const FAKE_YT = `
window.__seeks = [];
window.YT = {
  Player: class {
    constructor(el, opts) {
      this.t = 0; this.timer = null; this.opts = opts;
      el.setAttribute('data-video', opts.videoId);
      setTimeout(() => {
        if (opts.videoId === 'BLOCKED0000') opts.events.onError({ data: 150 });
        else opts.events.onReady({ target: this });
      }, 10);
    }
    getDuration() { return 120; }
    getCurrentTime() { return this.t; }
    getPlayerState() { return this.timer ? 1 : 2; }
    seekTo(t) { this.t = t; window.__seeks.push(t); }
    playVideo() {
      if (this.timer) return;
      this.timer = setInterval(() => { this.t += 0.5; }, 100);
      this.opts.events.onStateChange({ data: 1 });
    }
    pauseVideo() { clearInterval(this.timer); this.timer = null; this.opts.events.onStateChange({ data: 2 }); }
    destroy() { clearInterval(this.timer); }
  },
};
window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();
`;

async function fakeYouTube(page: Page) {
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: FAKE_YT }),
  );
}

test('유튜브 링크를 열어 구간을 저장하면 반복 링크가 생기고, 영상 데이터는 서버로 가지 않는다', async ({
  page,
}) => {
  await fakeYouTube(page);
  const bodies: unknown[] = [];
  await page.route('**/api/links', async (route) => {
    const body = route.request().postDataJSON() as { videoId: string; start: number; end: number };
    bodies.push(body);
    await route.fulfill({
      status: 201,
      json: { link: { id: 'Ab3dEf9Z', platform: 'youtube', ...body } },
    });
  });
  await page.route('**/api/links/Ab3dEf9Z', (route) =>
    route.fulfill({
      json: {
        link: { id: 'Ab3dEf9Z', platform: 'youtube', videoId: 'dQw4w9WgXcQ', start: 10, end: 12 },
      },
    }),
  );

  await page.goto('/link');
  await page.getByLabel('유튜브 링크').fill('https://youtu.be/dQw4w9WgXcQ?si=share');
  await page.getByRole('button', { name: '열기' }).click();
  await expect(page.getByRole('textbox', { name: '끝' })).toHaveValue('00:15.00');
  await page.getByRole('textbox', { name: '시작' }).fill('10');
  await page.getByRole('textbox', { name: '시작' }).press('Enter');
  await page.getByRole('textbox', { name: '끝' }).fill('12');
  await page.getByRole('textbox', { name: '끝' }).press('Enter');
  await page.getByRole('button', { name: '구간 저장' }).click();
  await expect(page.getByText('구간을 저장했어요')).toBeVisible();
  await expect(page.getByText(/\/r\/Ab3dEf9Z$/)).toBeVisible();
  expect(bodies).toEqual([{ videoId: 'dQw4w9WgXcQ', start: 10, end: 12 }]);
  // 내 구간 목록 (이 브라우저에만)
  await expect(page.getByRole('link', { name: /dQw4w9WgXcQ · 00:10.00 ~ 00:12.00/ })).toBeVisible();

  // 반복 링크를 열면 그 구간을 반복한다: 끝(12초)을 지나면 시작(10초)으로 돌아간다
  await page.goto('/r/Ab3dEf9Z');
  await page.getByRole('button', { name: '구간 재생' }).click();
  // 재생 시작(10초로) + 끝을 지나 다시 10초로 = 두 번 이상
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __seeks: number[] }).__seeks.filter((t) => t === 10).length,
        ),
      { timeout: 5000 },
    )
    .toBeGreaterThanOrEqual(2);
});

test('다른 사이트 재생이 막힌 영상은 안내하고, 유튜브 링크가 아니면 이유를 알려준다', async ({
  page,
}) => {
  await fakeYouTube(page);
  await page.goto('/link');
  await page.getByLabel('유튜브 링크').fill('https://example.com/watch?v=dQw4w9WgXcQ');
  await page.getByRole('button', { name: '열기' }).click();
  await expect(page.getByRole('alert')).toContainText('유튜브 링크가 아니에요');

  await page.goto('/link?v=BLOCKED0000');
  await expect(page.getByRole('alert')).toContainText(
    '이 영상은 다른 사이트에서 재생할 수 없게 설정돼 있어요',
  );
  await expect(page.getByRole('link', { name: '유튜브에서 열기' })).toBeVisible();
});
