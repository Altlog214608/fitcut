/**
 * 검색 엔진용 페이지 정보. 빌드할 때 경로마다 HTML(제목·설명·canonical)을 따로 만들고 (vite.config.ts),
 * 화면을 옮겨 다닐 때도 같은 값으로 머리말을 바꾼다 (Layout). 모두 같은 제목이면 Google이 중복으로 보고 색인하지 않는다.
 * 경로를 더하면 sitemap.xml과 CloudFront 함수(static-site 모듈 seo_pages)의 목록도 같이 고친다.
 */
export const ORIGIN = 'https://koicut.com';

export type SeoPage = { path: string; title: string; description: string };

export const DEFAULT_PAGE: SeoPage = {
  path: '/',
  title: 'KoiCut - 사진 크기 맞추기, 움짤, 벨소리 만들기',
  description:
    '사진을 폰·태블릿·워치 화면에 딱 맞게 자르고, 영상을 GIF 움짤로, 음성을 벨소리로 바꿔요. 사진은 내 기기 안에서만 처리돼요.',
};

export const SEO_PAGES: SeoPage[] = [
  DEFAULT_PAGE,
  {
    path: '/photo',
    title: '사진 크기 맞추기 - 폰·태블릿·워치 배경화면 | KoiCut',
    description:
      '아이폰·갤럭시·폴더블·아이패드·애플워치 화면 크기에 맞게 사진을 자르고 크기를 바꿔요. 사진은 서버로 보내지 않고 내 기기에서만 처리해요.',
  },
  {
    path: '/gif',
    title: '움짤 만들기 - 영상을 GIF·WebP·MP4로 | KoiCut',
    description:
      '영상에서 원하는 구간을 프레임 단위로 골라 GIF·WebP·MP4 움짤로 만들어요. 워치 화면 크기도 골라요. 올린 파일은 자동으로 지워져요.',
  },
  {
    path: '/audio',
    title: '벨소리 만들기 - 영상에서 음성 추출 | KoiCut',
    description:
      '영상이나 음성 파일에서 원하는 구간만 잘라 MP3·M4A·WAV로 저장하고, 아이폰·갤럭시 벨소리로 만들어요. 페이드와 음량 맞추기도 돼요.',
  },
  {
    path: '/rotate',
    title: '영상 세로로 돌리기 | KoiCut',
    description:
      '옆으로 누운 영상을 세로로 똑바로 돌려요. 다시 압축하거나 회전 정보만 바꿔 화질을 그대로 지킬 수 있어요.',
  },
  {
    path: '/highlight',
    title: '방송 하이라이트 찾기 - 치지직 채팅 분석 | KoiCut',
    description:
      '치지직 채널을 연결하면 라이브 채팅이 몰린 순간을 찾아 하이라이트 후보로 알려 줘요. 녹화 파일에서 바로 클립·움짤로 잘라요.',
  },
  {
    path: '/privacy',
    title: '개인정보 처리방침 | KoiCut',
    description: 'KoiCut이 저장하는 정보, 보관 기간, 파기 방법, 광고와 외부 서비스를 안내해요.',
  },
];

/** 주소 끝의 슬래시를 떼고 페이지를 찾는다 (없으면 undefined) */
export function seoPageOf(pathname: string): SeoPage | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return SEO_PAGES.find((p) => p.path === path);
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** index.html의 제목·설명을 이 페이지 값으로 바꾸고 canonical·og 태그를 붙인다 */
export function renderHead(html: string, page: SeoPage): string {
  const url = ORIGIN + page.path;
  const tags = [
    `<link rel="canonical" href="${url}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="KoiCut" />',
    `<meta property="og:title" content="${escape(page.title)}" />`,
    `<meta property="og:description" content="${escape(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
  ].join('\n    ');
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(page.title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
      `<meta name="description" content="${escape(page.description)}" />`,
    )
    .replace('</head>', `    ${tags}\n  </head>`);
}

/** 화면을 옮길 때 머리말을 맞춘다. 목록에 없는 경로는 기본 제목에 canonical을 뗀다 */
export function applyHead(doc: Document, pathname: string): void {
  const page = seoPageOf(pathname);
  const shown = page ?? DEFAULT_PAGE;
  doc.title = shown.title;
  const set = (selector: string, attr: string, value: string | null) => {
    const el = doc.head.querySelector(selector);
    if (!el) return;
    if (value === null) el.remove();
    else el.setAttribute(attr, value);
  };
  set('meta[name="description"]', 'content', shown.description);
  set('meta[property="og:title"]', 'content', shown.title);
  set('meta[property="og:description"]', 'content', shown.description);
  set('meta[property="og:url"]', 'content', ORIGIN + shown.path);
  if (page) {
    const canonical = doc.head.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', ORIGIN + page.path);
    else {
      const link = doc.createElement('link');
      link.rel = 'canonical';
      link.href = ORIGIN + page.path;
      doc.head.appendChild(link);
    }
  } else {
    set('link[rel="canonical"]', 'href', null);
  }
}

/** 없는 페이지는 검색에 넣지 않게 한다 (화면은 200으로 오므로 noindex로 알린다) */
export function setNoIndex(doc: Document, on: boolean): void {
  const found = doc.head.querySelector('meta[name="robots"]');
  if (on && !found) {
    const meta = doc.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    doc.head.appendChild(meta);
  } else if (!on && found) {
    found.remove();
  }
}
