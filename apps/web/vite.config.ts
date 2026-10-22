import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { renderHead, SEO_PAGES } from './src/seo/pages';

/**
 * AdSense 코드는 배포 빌드(VITE_ADS=on)에만 넣는다 (ADR-052).
 * 로컬·CI·e2e에서 실제 광고를 부르면 무효 트래픽이 되고, 사진 화면의 "밖으로 나가는 요청 없음" 검사도 깨진다.
 */
const ADSENSE_TAG =
  '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5555123248227301" crossorigin="anonymous"></script>';

function adsense(enabled: boolean): Plugin {
  return {
    name: 'koicut-adsense',
    transformIndexHtml: (html) => html.replace(/<!-- adsense:[^>]*-->/, enabled ? ADSENSE_TAG : ''),
  };
}

/**
 * 검색 엔진용으로 경로마다 HTML을 만든다: index.html(홈)과 photo.html 같은 파일에 서로 다른 제목·설명·canonical.
 * CloudFront 함수가 /photo를 /photo.html로 바꿔 준다 (static-site 모듈).
 */
function seoPages(): Plugin {
  return {
    name: 'koicut-seo-pages',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const index = bundle['index.html'];
        if (!index || index.type !== 'asset') return;
        const html = String(index.source);
        for (const page of SEO_PAGES) {
          const out = renderHead(html, page);
          if (page.path === '/') index.source = out;
          else
            this.emitFile({ type: 'asset', fileName: `${page.path.slice(1)}.html`, source: out });
        }
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), adsense(process.env.VITE_ADS === 'on'), seoPages()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
