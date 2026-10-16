import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

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

export default defineConfig({
  plugins: [react(), adsense(process.env.VITE_ADS === 'on')],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
