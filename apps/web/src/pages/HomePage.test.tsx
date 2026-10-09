import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../routes';

function renderHome() {
  const router = createMemoryRouter(routes, { initialEntries: ['/'] });
  render(<RouterProvider router={router} />);
  return router;
}

function pick(name: string, type: string) {
  const input = screen.getByLabelText(/파일을 끌어오세요/);
  fireEvent.change(input, { target: { files: [new File(['x'], name, { type })] } });
}

describe('홈', () => {
  it('사진을 고르면 사진 도구가 열리고 파일 이름이 보인다', async () => {
    renderHome();
    pick('wallpaper.jpg', 'image/jpeg');
    expect(await screen.findByRole('heading', { level: 1, name: '사진' })).toBeDefined();
    expect(screen.getByText('고른 파일: wallpaper.jpg')).toBeDefined();
  });

  it('영상을 고르면 무엇을 만들지 고르게 한다', () => {
    renderHome();
    pick('clip.mov', '');
    expect(screen.getByRole('heading', { name: '무엇을 만들까요?' })).toBeDefined();
    const choices = screen.getByRole('list', { name: '영상으로 할 수 있는 일' });
    expect(choices.querySelectorAll('a')).toHaveLength(3);
  });

  it('음성 파일을 고르면 음성 도구가 열린다', async () => {
    renderHome();
    pick('voice.m4a', 'audio/x-m4a');
    expect(await screen.findByRole('heading', { level: 1, name: '음성' })).toBeDefined();
  });

  it('열 수 없는 파일은 이유와 고칠 방법을 알려준다', () => {
    renderHome();
    pick('notes.pdf', 'application/pdf');
    expect(screen.getByRole('alert').textContent).toContain('이 파일은 열 수 없어요');
  });

  it('유튜브 링크를 넣으면 링크 구간으로 간다', async () => {
    const router = renderHome();
    fireEvent.change(screen.getByLabelText('유튜브 링크'), {
      target: { value: 'https://youtu.be/dQw4w9WgXcQ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '구간 고르기' }));
    expect(await screen.findByText('영상 ID: dQw4w9WgXcQ')).toBeDefined();
    expect(router.state.location.search).toBe('?v=dQw4w9WgXcQ');
  });

  it('유튜브 링크가 아니면 안내한다', () => {
    renderHome();
    fireEvent.change(screen.getByLabelText('유튜브 링크'), {
      target: { value: 'https://example.com/video' },
    });
    fireEvent.click(screen.getByRole('button', { name: '구간 고르기' }));
    expect(screen.getByRole('alert').textContent).toContain('유튜브 영상 링크를 확인해 주세요');
  });
});
