/**
 * 사용 이벤트 (docs/ADMIN.md "사용 이벤트"). 화면이 보내고 API가 검사한다.
 * 허용한 이벤트·필드만 통과시키고 나머지는 버린다. 파일명·IP·자유 입력은 받지 않는다
 * (기기 검색어만 예외: 없는 기기를 찾으려는 목적이고 40자로 자른다).
 */

type StringField = { type: 'string'; max: number; values?: readonly string[] };
type NumberField = { type: 'number'; min: number; max: number };
type Field = StringField | NumberField;

const str = (max: number): StringField => ({ type: 'string', max });
const oneOf = (...values: string[]): StringField => ({ type: 'string', max: 32, values });
const num = (min: number, max: number): NumberField => ({ type: 'number', min, max });

const TOOLS = ['photo', 'gif', 'audio', 'link', 'highlight', 'rotate'];
const SIZE_BUCKETS = ['<1MB', '1-10MB', '10-50MB', '50-200MB', '200MB+'];

/** 화면에서 받는 이벤트와 필드. 잡 이벤트(job_*)는 서버만 만든다 */
export const CLIENT_EVENTS = {
  session_start: {
    deviceType: oneOf('mobile', 'tablet', 'desktop'),
    os: oneOf('ios', 'android', 'windows', 'macos', 'linux', 'other'),
    browser: oneOf('safari', 'chrome', 'samsung', 'firefox', 'edge', 'inapp', 'other'),
    referrerDomain: str(100),
    lang: str(16),
  },
  tool_open: { tool: oneOf(...TOOLS) },
  file_selected: {
    tool: oneOf(...TOOLS),
    kind: oneOf('image', 'video', 'audio'),
    mime: str(40),
    sizeBucket: oneOf(...SIZE_BUCKETS),
    width: num(0, 20000),
    height: num(0, 20000),
    durationSec: num(0, 86400),
  },
  preset_selected: { presetId: str(80) },
  preset_search_miss: { query: str(40) },
  export_done: {
    tool: oneOf(...TOOLS),
    format: oneOf('jpeg', 'png', 'webp', 'gif', 'mp4'),
    width: num(0, 20000),
    height: num(0, 20000),
    sizeBytes: num(0, 1e10),
    elapsedMs: num(0, 3.6e6),
  },
  error_shown: { tool: oneOf(...TOOLS), code: str(40) },
} as const satisfies Record<string, Record<string, Field>>;

export type ClientEventName = keyof typeof CLIENT_EVENTS;

/** 모든 이벤트에 붙는 값 */
const COMMON = {
  sessionId: str(40),
  appVersion: str(20),
  ts: num(1.5e12, 4e12),
} as const satisfies Record<string, Field>;

export type EventProps = Record<string, string | number>;
export type ClientEvent = { name: ClientEventName } & EventProps;

/** 한 번에 받는 이벤트 수 */
export const MAX_EVENTS_PER_REQUEST = 20;

function cleanField(field: Field, value: unknown): string | number | undefined {
  if (field.type === 'number') {
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= field.min &&
      value <= field.max
      ? value
      : undefined;
  }
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (field.values) return field.values.includes(value) ? value : undefined;
  return value.slice(0, field.max);
}

/**
 * 받은 이벤트 하나를 허용한 모양으로 다듬는다. 이름을 모르거나 공통 값이 없으면 null.
 * 모르는 필드와 범위를 벗어난 값은 조용히 버린다.
 */
export function cleanEvent(raw: unknown): ClientEvent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const name = input.name;
  if (typeof name !== 'string' || !Object.hasOwn(CLIENT_EVENTS, name)) return null;
  const out: EventProps = {};
  for (const [key, field] of Object.entries(COMMON)) {
    const value = cleanField(field, input[key]);
    if (value === undefined) return null;
    out[key] = value;
  }
  const fields: Record<string, Field> = CLIENT_EVENTS[name as ClientEventName];
  for (const [key, field] of Object.entries(fields)) {
    const value = cleanField(field, input[key]);
    if (value !== undefined) out[key] = value;
  }
  return { ...out, name: name as ClientEventName };
}

/** 파일 크기를 구간으로 (정확한 크기는 남기지 않는다) */
export function sizeBucket(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb < 1) return '<1MB';
  if (mb < 10) return '1-10MB';
  if (mb < 50) return '10-50MB';
  if (mb < 200) return '50-200MB';
  return '200MB+';
}

/** 서버가 만드는 잡 이벤트 (ADMIN.md job_created / job_succeeded / job_failed) */
export type JobEvent = {
  name: 'job_created' | 'job_succeeded' | 'job_failed';
  ts: number;
  jobId: string;
  type: string;
  inputSize?: number;
  durationSec?: number;
  worker?: 'lambda' | 'fargate';
  processingMs?: number;
  estCostUsd?: number;
  errorCode?: string;
};
