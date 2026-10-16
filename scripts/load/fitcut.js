/* global __ENV, open */
// FitCut 부하 테스트 (ROADMAP M7, ADR-048). 비용 가드레일이 실제로 막는지 본다.
//
//   k6 run scripts/load/fitcut.js                     # 세 시나리오 모두 (약 3분)
//   k6 run -e ONLY=throttle scripts/load/fitcut.js    # 하나만 (throttle | events | jobs)
//
// - throttle: 잡 조회 경로에 초당 30건 (API 상한 초당 10건, 순간 20건) → 넘는 요청은 429, 5xx는 0
// - events:   사용 이벤트 경로에 초당 15건 (상한 초당 5건). 빈 묶음이라 대기열·S3에는 아무것도 쌓이지 않는다
// - jobs:     작은 영상(4초 320×180)으로 GIF 잡 6개를 한꺼번에 → 워커 동시 2개 상한 때문에 차례로 처리된다
//
// jobs는 하루 할당량(IP당 업로드 20·잡 20) 중 6개씩 쓰고, 잡 이벤트가 관리자 통계에 6건 남는다.
// 비용: 요청 약 1,500건 + 워커 6번 ≈ $0.003 (GIF 잡당 약 $0.0002, README 측정값)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://koicut.com';
const clip = open('../../apps/web/e2e/fixtures/clip.webm', 'b');

const serverErrors = new Counter('server_errors');
const throttled = new Counter('throttled');
const passed = new Counter('passed');
const jobWait = new Trend('job_wait_ms', true);
const jobTotal = new Trend('job_total_ms', true);

const all = {
  throttle: {
    executor: 'constant-arrival-rate',
    exec: 'throttle',
    rate: 30,
    timeUnit: '1s',
    duration: '30s',
    preAllocatedVUs: 20,
    maxVUs: 60,
  },
  events: {
    executor: 'constant-arrival-rate',
    exec: 'events',
    rate: 15,
    timeUnit: '1s',
    duration: '20s',
    preAllocatedVUs: 10,
    maxVUs: 30,
    startTime: '35s',
  },
  jobs: {
    executor: 'per-vu-iterations',
    exec: 'jobs',
    vus: Number(__ENV.JOBS || 6),
    iterations: 1,
    maxDuration: '4m',
    startTime: '60s',
  },
};

const only = __ENV.ONLY;
const scenarios = only ? { [only]: { ...all[only], startTime: '0s' } } : all;

export const options = {
  scenarios,
  thresholds: {
    server_errors: ['count==0'],
    ...(scenarios.jobs ? { 'checks{scenario:jobs}': ['rate==1'] } : {}),
  },
  summaryTrendStats: ['min', 'med', 'p(95)', 'max'],
};

function record(res, tags) {
  if (res.status >= 500) serverErrors.add(1, tags);
  else if (res.status === 429) throttled.add(1, tags);
  else passed.add(1, tags);
}

function uuid() {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20)}`;
}

export function throttle() {
  // 없는 잡이라 404가 정상. DynamoDB 읽기 한 번뿐이다
  const res = http.get(`${BASE}/api/jobs/${uuid()}`, { tags: { name: 'GET /api/jobs/{id}' } });
  record(res, { scenario: 'throttle' });
  check(res, { '404 또는 429': (r) => r.status === 404 || r.status === 429 });
}

export function events() {
  const res = http.post(`${BASE}/api/events`, JSON.stringify({ events: [] }), {
    headers: { 'content-type': 'application/json' },
    tags: { name: 'POST /api/events' },
  });
  record(res, { scenario: 'events' });
  check(res, { '204 또는 429': (r) => r.status === 204 || r.status === 429 });
}

const json = { headers: { 'content-type': 'application/json' } };

/** S3 POST는 file이 맨 뒤에 와야 하는데 k6 폼은 필드 순서를 지키지 않아 직접 만든다 (필드 값은 ASCII) */
function multipart(fields, file, type) {
  const boundary = `----fitcut${Math.random().toString(16).slice(2)}`;
  const nl = '\r\n';
  let head = '';
  for (const [k, v] of Object.entries(fields))
    head += `--${boundary}${nl}Content-Disposition: form-data; name="${k}"${nl}${nl}${v}${nl}`;
  head += `--${boundary}${nl}Content-Disposition: form-data; name="file"; filename="clip"${nl}`;
  head += `Content-Type: ${type}${nl}${nl}`;
  const tail = `${nl}--${boundary}--${nl}`;
  const bytes = new Uint8Array(head.length + file.byteLength + tail.length);
  for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);
  bytes.set(new Uint8Array(file), head.length);
  for (let i = 0; i < tail.length; i++)
    bytes[head.length + file.byteLength + i] = tail.charCodeAt(i);
  return { body: bytes.buffer, type: `multipart/form-data; boundary=${boundary}` };
}

export function jobs() {
  const up = http.post(
    `${BASE}/api/uploads`,
    JSON.stringify({ fileSize: clip.byteLength, contentType: 'video/webm' }),
    { ...json, tags: { name: 'POST /api/uploads' } },
  );
  record(up, { scenario: 'jobs' });
  if (!check(up, { '업로드 주소 201': (r) => r.status === 201 })) return;
  const upload = up.json('upload');

  const form = multipart(upload.fields, clip, 'video/webm');
  const s3 = http.post(upload.url, form.body, {
    headers: { 'content-type': form.type },
    tags: { name: 'S3 업로드' },
  });
  if (!check(s3, { 'S3 업로드 2xx': (r) => r.status >= 200 && r.status < 300 })) return;

  const created = http.post(
    `${BASE}/api/jobs`,
    JSON.stringify({ uploadId: upload.id, kind: 'gif', start: 0, end: 3, fps: 10, width: 320 }),
    { ...json, tags: { name: 'POST /api/jobs' } },
  );
  record(created, { scenario: 'jobs' });
  if (!check(created, { '잡 201': (r) => r.status === 201 })) return;
  const id = created.json('job.id');

  const t0 = Date.now();
  let started = 0;
  let status = 'queued';
  while (Date.now() - t0 < 180_000) {
    sleep(1);
    const r = http.get(`${BASE}/api/jobs/${id}`, { tags: { name: 'GET /api/jobs/{id}' } });
    record(r, { scenario: 'jobs' });
    if (r.status !== 200) continue;
    status = r.json('job.status');
    if (!started && status !== 'queued') started = Date.now();
    if (status === 'done' || status === 'failed') break;
  }
  jobWait.add((started || Date.now()) - t0);
  jobTotal.add(Date.now() - t0);
  check(status, { '잡 완료': (s) => s === 'done' });
}
