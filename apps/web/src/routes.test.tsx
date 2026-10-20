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
    ['/rotate', '영상 똑바로 세우기'],
    ['/highlight', '하이라이트'],
    ['/admin', '관리자'],
    ['/my-jobs', '내 작업 기록'],
    ['/privacy', '개인정보 처리방침'],
  ])('%s 경로는 "%s" 페이지를 보여준다', (path, heading) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeDefined();
  });

  it.each(['/no-such-page', '/link', '/r/Ab3dEf9Z'])('%s는 404 페이지를 보여준다', (path) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: '여기는 없는 페이지예요' })).toBeDefined();
  });
});
