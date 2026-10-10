import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { targetKey, uniqueNames, zipFiles, zipName } from './batch';

describe('여러 기기 한 번에', () => {
  it('기기·화면마다, 직접 입력한 크기마다 다른 키', () => {
    expect(targetKey({ kind: 'preset', presetId: 'samsung-galaxy-z-flip8', role: 'cover' })).toBe(
      'p:samsung-galaxy-z-flip8:cover',
    );
    expect(targetKey({ kind: 'custom', width: 1080, height: 1920 })).toBe('c:1080x1920');
  });

  it('겹치는 파일 이름은 뒤에 번호를 붙인다', () => {
    expect(uniqueNames(['a_1080x1920.jpg', 'b.jpg', 'a_1080x1920.jpg'])).toEqual([
      'a_1080x1920.jpg',
      'b.jpg',
      'a_1080x1920-2.jpg',
    ]);
  });

  it('ZIP 하나에 기기 이름이 든 파일들이 그대로 들어간다', () => {
    const files = [
      { name: 'a_iPhone-17-Pro_1206x2622.jpg', data: new Uint8Array([1, 2, 3]) },
      { name: 'a_Galaxy-Watch9-44mm_480x480.png', data: new Uint8Array([4, 5]) },
      { name: 'a_Galaxy-Z-Flip8_1080x2520.jpg', data: new Uint8Array([6]) },
    ];
    const back = unzipSync(zipFiles(files));
    expect(Object.keys(back)).toEqual(files.map((f) => f.name));
    expect([...(back['a_Galaxy-Watch9-44mm_480x480.png'] ?? [])]).toEqual([4, 5]);
  });

  it('ZIP 이름', () => {
    expect(zipName('여름 사진.jpg', 3)).toBe('여름-사진_기기3개.zip');
  });
});
