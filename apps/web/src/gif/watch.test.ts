import { describe, expect, it } from 'vitest';
import { centerCrop, WATCHES } from './watch';

describe('워치 출력', () => {
  it('갤럭시 워치는 GIF, 애플워치는 MP4(Live Photo로 바꿔야 움직임)', () => {
    const galaxy = WATCHES.find((w) => w.id === 'samsung-galaxy-watch9-44mm');
    const apple = WATCHES.find((w) => w.id === 'apple-watch-series-11-46mm');
    expect(galaxy).toMatchObject({ width: 480, height: 480, shape: 'circle', kind: 'gif' });
    expect(apple).toMatchObject({ width: 416, height: 496, kind: 'mp4', livePhoto: true });
  });

  it('갤럭시가 먼저, 같은 브랜드는 최신 기기가 위', () => {
    expect(WATCHES[0]?.id.startsWith('samsung-')).toBe(true);
    const samsung = WATCHES.filter((w) => w.id.startsWith('samsung-'));
    expect(samsung.findIndex((w) => w.id.includes('watch9'))).toBeLessThan(
      samsung.findIndex((w) => w.id.includes('watch8')),
    );
  });

  it('가로 영상을 정사각 워치에 맞추면 가운데 세로 띠만 남는다', () => {
    const c = centerCrop({ width: 1920, height: 1080 }, { width: 480, height: 480 });
    expect(c.height).toBeCloseTo(1);
    expect(c.width).toBeCloseTo(1080 / 1920);
    expect(c.x).toBeCloseTo((1 - 1080 / 1920) / 2);
  });

  it('세로 영상을 애플워치에 맞추면 위아래가 조금 잘린다', () => {
    const c = centerCrop({ width: 1080, height: 1920 }, { width: 416, height: 496 });
    expect(c.width).toBeCloseTo(1);
    expect(c.height).toBeCloseTo((1080 * 496) / 416 / 1920);
  });
});
