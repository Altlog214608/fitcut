import { describe, expect, it } from 'vitest';
import { VISIBLE_PRESETS } from './index';
import type { DevicePreset } from './schema';
import { normalizeQuery, searchPresets } from './search';

const ids = (query: string) => searchPresets(VISIBLE_PRESETS, query).map((p) => p.id);

describe('normalizeQuery', () => {
  it('공백·하이픈·대소문자를 무시한다', () => {
    expect(normalizeQuery(' 아이폰 17 Pro-Max ')).toBe('아이폰17promax');
  });
});

describe('searchPresets', () => {
  it('"16 프로"는 16 Pro를 먼저, 16 Pro Max를 그다음에 보여준다', () => {
    expect(ids('16 프로').slice(0, 2)).toEqual(['apple-iphone-16-pro', 'apple-iphone-16-pro-max']);
  });

  it('띄어쓰기가 달라도 찾는다', () => {
    expect(ids('아이폰17프로')[0]).toBe('apple-iphone-17-pro');
    expect(ids('플립 8')[0]).toBe('samsung-galaxy-z-flip8');
  });

  it('영문으로도 찾는다', () => {
    expect(ids('s26 ultra')[0]).toBe('samsung-galaxy-s26-ultra');
  });

  it('"워치9"는 두 크기를 모두 보여준다', () => {
    expect(ids('워치9').sort()).toEqual([
      'samsung-galaxy-watch9-40mm',
      'samsung-galaxy-watch9-44mm',
    ]);
  });

  it('태블릿·이전 세대·픽셀도 찾는다 (2차 배치)', () => {
    expect(ids('아이패드 프로 13')[0]).toBe('apple-ipad-pro-13-m5');
    expect(ids('탭 S11 울트라')[0]).toBe('samsung-galaxy-tab-s11-ultra');
    expect(ids('아이폰 15 프로')[0]).toBe('apple-iphone-15-pro');
    expect(ids('폴드7')[0]).toBe('samsung-galaxy-z-fold7');
    expect(ids('pixel 10 pro')[0]).toBe('google-pixel-10-pro');
    expect(ids('픽셀 11 프로 폴드')[0]).toBe('google-pixel-11-pro-fold');
  });

  it('확인되지 않은 프리셋은 보이는 목록에서 찾지 않는다', () => {
    expect(ids('폴드8')).toEqual([]);
  });

  it('없는 기기나 빈 검색어는 빈 목록', () => {
    expect(ids('없는기기123')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });

  it('점수가 같으면 최신 기기가 먼저다', () => {
    const make = (id: string, year: number): DevicePreset => ({
      id,
      brand: 'T',
      category: 'phone',
      name: `Phone ${id}`,
      aliases: [],
      releaseYear: year,
      screens: [{ role: 'main', widthPx: 1, heightPx: 2, shape: 'rect' }],
      source: '',
      verified: true,
    });
    const result = searchPresets([make('a', 2024), make('b', 2026)], 'phone');
    expect(result.map((p) => p.id)).toEqual(['b', 'a']);
  });
});
