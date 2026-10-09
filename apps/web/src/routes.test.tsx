import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from './routes';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

describe('routes', () => {
  it.each([
    ['/', '사진·영상·음성을 내 기기에 딱 맞게'],
    ['/photo', '사진'],
    ['/gif', '움짤'],
    ['/audio', '음성'],
    ['/rotate', '영상 세로로 돌리기'],
    ['/link', '링크 구간'],
    ['/highlight', '하이라이트'],
    ['/admin', '관리자'],
  ])('%s 경로는 "%s" 페이지를 보여준다', (path, heading) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeDefined();
  });

  it('없는 경로는 404 페이지를 보여준다', () => {
    renderAt('/no-such-page');
    expect(
      screen.getByRole('heading', { level: 1, name: '페이지를 찾을 수 없어요' }),
    ).toBeDefined();
  });
});
