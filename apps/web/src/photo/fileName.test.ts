import { describe, expect, it } from 'vitest';
import { outputFileName } from './fileName';

describe('outputFileName', () => {
  it('원본이름_기기_가로x세로.확장자', () => {
    expect(
      outputFileName('IMG_0001.HEIC.jpg', 'iPhone 17 Pro', { width: 1206, height: 2622 }, 'jpeg'),
    ).toBe('IMG_0001.HEIC_iPhone-17-Pro_1206x2622.jpg');
  });

  it('기기 없이 크기만', () => {
    expect(outputFileName('여름 바다.png', null, { width: 1080, height: 1920 }, 'webp')).toBe(
      '여름-바다_1080x1920.webp',
    );
  });

  it('파일 이름에 쓸 수 없는 글자는 뺀다', () => {
    expect(outputFileName('a/b:c?.jpg', 'Watch 46mm', { width: 416, height: 496 }, 'png')).toBe(
      'abc_Watch-46mm_416x496.png',
    );
  });

  it('이름이 비면 photo', () => {
    expect(outputFileName('.jpg', null, { width: 1, height: 1 }, 'jpeg')).toBe('photo_1x1.jpg');
  });
});
