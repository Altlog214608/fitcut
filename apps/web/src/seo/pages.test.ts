import { beforeEach, describe, expect, it } from 'vitest';
import { applyHead, renderHead, seoPageOf, setNoIndex, SEO_PAGES } from './pages';

const HTML =
  '<html><head><title>KoiCut</title>\n<meta name="description" content="old" />\n</head><body></body></html>';

describe('seo pages', () => {
  it('페이지마다 제목·설명이 다르다', () => {
    expect(new Set(SEO_PAGES.map((p) => p.title)).size).toBe(SEO_PAGES.length);
    expect(new Set(SEO_PAGES.map((p) => p.description)).size).toBe(SEO_PAGES.length);
  });

  it('끝 슬래시는 같은 페이지', () => {
    expect(seoPageOf('/photo/')?.path).toBe('/photo');
    expect(seoPageOf('/')?.path).toBe('/');
    expect(seoPageOf('/link')).toBeUndefined();
  });

  it('renderHead는 제목·설명을 바꾸고 canonical을 붙인다', () => {
    const page = seoPageOf('/gif');
    if (!page) throw new Error('no /gif page');
    const out = renderHead(HTML, page);
    expect(out).toContain(`<title>${page.title}</title>`);
    expect(out).toContain('<link rel="canonical" href="https://koicut.com/gif" />');
    expect(out).not.toContain('content="old"');
  });

  describe('applyHead', () => {
    beforeEach(() => {
      document.head.innerHTML =
        '<title>KoiCut</title><meta name="description" content="old" /><link rel="canonical" href="https://koicut.com/" />';
    });

    it('도구 화면으로 옮기면 그 페이지 값으로', () => {
      applyHead(document, '/audio');
      expect(document.title).toContain('벨소리');
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        'https://koicut.com/audio',
      );
    });

    it('목록에 없는 경로는 canonical을 떼고, 돌아오면 다시 붙인다', () => {
      applyHead(document, '/my-jobs');
      expect(document.querySelector('link[rel="canonical"]')).toBeNull();
      applyHead(document, '/photo');
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        'https://koicut.com/photo',
      );
    });
  });

  it('setNoIndex는 robots 태그를 넣고 뺀다', () => {
    setNoIndex(document, true);
    setNoIndex(document, true);
    expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    setNoIndex(document, false);
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });
});
