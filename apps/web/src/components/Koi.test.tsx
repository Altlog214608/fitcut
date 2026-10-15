import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Koi, KoiPond, type KoiMood } from './Koi';

describe('Koi', () => {
  it('이름이 없으면 장식으로 숨긴다', () => {
    const { container } = render(<Koi />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('이름이 있으면 그림으로 읽힌다', () => {
    const { getByRole } = render(<Koi label="KoiCut" />);
    expect(getByRole('img', { name: 'KoiCut' })).toBeTruthy();
  });

  it.each<[KoiMood, number, number]>([
    ['calm', 2, 0],
    ['happy', 0, 2],
    ['surprised', 4, 0],
    ['sleepy', 0, 2],
  ])('%s 표정은 눈 모양이 다르다', (mood, eyes, lines) => {
    const { container } = render(<Koi mood={mood} />);
    const svg = container.querySelector('svg');
    expect(svg?.dataset.mood).toBe(mood);
    // 몸통의 주황 점 하나(circle)를 빼고 센다
    expect(svg?.querySelectorAll('circle').length).toBe(1 + eyes);
    expect(svg?.querySelectorAll('path').length).toBe(3 + lines);
  });

  it('연못 표시는 화면 읽기에서 숨긴다 (옆 문장이 상태를 말한다)', () => {
    const { container } = render(<KoiPond />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
