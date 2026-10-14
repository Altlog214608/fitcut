/**
 * 브라우저 변환(ffmpeg.wasm)과 서버 변환 비교 (ADR-003, ADR-049).
 *
 *   cd experiments/ffmpeg-wasm
 *   pnpm install --ignore-workspace
 *   node run.mjs              # 브라우저만 (단일 스레드·멀티 스레드)
 *   node run.mjs --server     # 실제 사이트에 같은 영상으로 잡 1개도 (하루 업로드·잡 할당량 1개씩 쓴다)
 *
 * 입력은 시스템 ffmpeg로 만든 1080×1920 60fps 5초 영상(잡음을 넣어 카메라 영상처럼 색이 많다)이고,
 * 출력은 워커와 같은 명령의 480px 15fps GIF다. ffmpeg.wasm은 Web Worker에서 돌아 Chrome의 CPU 느리게 하기(CDP)가
 * 걸리지 않으므로 폰 숫자는 실제 기기에서 따로 재야 한다. 준비 시간은 로컬 서버라 내려받는 시간이 빠져 있다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const ROOT = import.meta.dirname;
const RUNS = Number(process.env.RUNS ?? 3);
const ONLY = process.env.ONLY; // st | mt
const PARAMS = { start: 0, end: 5, fps: 15, width: 480 };
const BASE = process.env.BASE_URL ?? 'https://d2iecjbez8jmja.cloudfront.net';
const input = join(ROOT, 'input.mp4');

if (!existsSync(input)) {
  execFileSync('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi'],
    ...['-i', 'testsrc2=s=1080x1920:r=60:d=5', '-vf', 'noise=alls=12:allf=t+u'],
    ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', input],
  ]);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = join(ROOT, path === '/' || path === '\\' ? 'index.html' : path);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  // 멀티 스레드(SharedArrayBuffer)는 교차 출처 격리가 있어야 한다
  res.writeHead(200, {
    'content-type': types[extname(file)] ?? 'application/octet-stream',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
  });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;
const sec = (ms) => `${(ms / 1000).toFixed(1)}초`;

const sizes = {};
for (const core of ['core', 'core-mt']) {
  const wasm = readFileSync(join(ROOT, 'node_modules/@ffmpeg', core, 'dist/esm/ffmpeg-core.wasm'));
  sizes[core] = { raw: wasm.length, gzip: gzipSync(wasm).length };
}

const browser = await chromium.launch();
const rows = [];
for (const mt of [false, true].filter((m) => !ONLY || (ONLY === 'mt') === m)) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const context = await browser.newContext(); // 캐시 없이 처음 여는 것처럼
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('pageerror:', e.message));
    if (process.env.DEBUG) page.on('console', (m) => console.error('console:', m.text()));
    page.setDefaultTimeout(600_000);
    await page.goto(origin);
    await page.waitForFunction(() => window.ready);
    let r;
    try {
      r = await page.evaluate((a) => window.bench(a), { mt, input: '/input.mp4', params: PARAMS });
    } catch (e) {
      // 멀티 스레드는 이 입력에서 탭이 죽었다 (2026-10-14, core-mt 0.12.10). 결과에 그대로 남긴다
      console.error(`${mt ? '멀티' : '단일'} 스레드 실패: ${e.message.split('\n')[0]}`);
      // 죽은 탭을 닫으면 멈추는 경우가 있어 기다리지 않는다
      void context.close().catch(() => {});
      break;
    }
    if (r.code !== 0) throw new Error(`ffmpeg 실패: ${JSON.stringify(r)}`);
    if (mt && !r.isolated) throw new Error('교차 출처 격리가 꺼져 있어요');
    runs.push(r);
    await context.close();
  }
  const name = `브라우저 ${mt ? '멀티 스레드' : '단일 스레드'} (PC)`;
  if (runs.length === 0) {
    rows.push({ name, failed: true });
    continue;
  }
  rows.push({
    name,
    loadMs: median(runs.map((r) => r.loadMs)),
    convertMs: median(runs.map((r) => r.convertMs)),
    outBytes: runs[0].outBytes,
  });
  console.error(`${rows.at(-1).name}: ${runs.map((r) => sec(r.convertMs)).join(', ')}`);
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
server.close();
console.error('브라우저 끝');

let serverRow = null;
if (process.argv.includes('--server')) serverRow = await runServer();

/** 실제 사이트: 업로드 주소 → S3 업로드 → 잡 → 완료까지 */
async function runServer() {
  const file = readFileSync(input);
  const post = (path, body) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
      return r.json();
    });
  const t0 = Date.now();
  const { upload } = await post('/api/uploads', {
    fileSize: file.length,
    contentType: 'video/mp4',
  });
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
  form.append('file', new Blob([file], { type: 'video/mp4' }));
  const s3 = await fetch(upload.url, { method: 'POST', body: form });
  if (!s3.ok) throw new Error(`S3 ${s3.status}`);
  const uploadMs = Date.now() - t0;
  console.error(`서버: 업로드 ${sec(uploadMs)}`);
  const t1 = Date.now();
  const { job } = await post('/api/jobs', { uploadId: upload.id, kind: 'gif', ...PARAMS });
  let status = job.status;
  let outBytes = 0;
  while (status !== 'done' && status !== 'failed' && Date.now() - t1 < 180_000) {
    await new Promise((r) => setTimeout(r, 500));
    const r = await fetch(`${BASE}/api/jobs/${job.id}`).then((x) => x.json());
    status = r.job.status;
    outBytes = r.job.outputBytes ?? 0;
  }
  if (status !== 'done') throw new Error(`서버 잡 ${status}`);
  return { uploadMs, jobMs: Date.now() - t1, outBytes };
}

const lines = [
  `입력: 1080×1920 60fps 5초 H.264 ${mb(statSync(input).size)} → GIF 480px 15fps (워커와 같은 명령), 실행 ${RUNS}번 중앙값`,
  '',
  `내려받을 wasm: 단일 스레드 ${mb(sizes.core.raw)} (gzip ${mb(sizes.core.gzip)}), 멀티 스레드 ${mb(sizes['core-mt'].raw)} (gzip ${mb(sizes['core-mt'].gzip)})`,
  '',
  '| 경로 | 준비 (wasm 불러오기) | 변환 | 결과 크기 |',
  '| --- | --- | --- | --- |',
  ...rows.map((r) =>
    r.failed
      ? `| ${r.name} | - | 실패 (탭이 죽음) | - |`
      : `| ${r.name} | ${sec(r.loadMs)} | ${sec(r.convertMs)} | ${mb(r.outBytes)} |`,
  ),
  ...(serverRow
    ? [
        `| 서버 (Lambda arm64 2GB) | 업로드 ${sec(serverRow.uploadMs)} | ${sec(serverRow.jobMs)} (대기·처리 포함) | ${mb(serverRow.outBytes)} |`,
      ]
    : []),
];
console.log(lines.join('\n'));
