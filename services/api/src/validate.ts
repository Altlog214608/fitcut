/** POST /api/jobs 입력 검사 (순수 함수). 오류 문구는 화면에 그대로 보여준다 (docs/UI.md 문구 규칙). */
import { JOB_KINDS, LIMITS, type JobKind } from './limits';

export type CreateJob = {
  kind: JobKind;
  /** 구간 시작·끝 (초, 소수점 허용) */
  start: number;
  end: number;
  fileSize: number;
  contentType: string;
  fps: number;
  width: number;
};

export type Invalid = { code: string; message: string };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function intIn(value: unknown, min: number, max: number, fallback: number): number | null {
  if (value === undefined) return fallback;
  return isNum(value) && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function parseCreateJob(
  body: unknown,
): { ok: true; value: CreateJob } | { ok: false; error: Invalid } {
  const fail = (code: string, message: string) => ({
    ok: false as const,
    error: { code, message },
  });
  if (!isObj(body)) return fail('bad_body', '요청 형식이 올바르지 않아요.');

  const kind = body.kind;
  if (typeof kind !== 'string' || !JOB_KINDS.includes(kind as JobKind)) {
    return fail('bad_kind', 'GIF · WebP · MP4 중에서 골라 주세요.');
  }
  const k = kind as JobKind;

  const { start, end } = body;
  if (!isNum(start) || !isNum(end) || start < 0 || end <= start) {
    return fail('bad_range', '구간을 다시 골라 주세요. 끝이 시작보다 뒤여야 해요.');
  }
  const max = LIMITS.maxSeconds[k];
  if (end - start > max) {
    return fail('too_long', `구간이 너무 길어요. ${max}초 이하로 골라 주세요.`);
  }

  const { fileSize, contentType } = body;
  if (!isNum(fileSize) || !Number.isInteger(fileSize) || fileSize < 1) {
    return fail('bad_size', '파일 크기를 알 수 없어요. 다시 골라 주세요.');
  }
  if (fileSize > LIMITS.maxUploadBytes) {
    return fail(
      'too_big',
      `영상이 너무 커요. ${LIMITS.maxUploadBytes / 1024 / 1024}MB 이하로 골라 주세요.`,
    );
  }
  if (
    typeof contentType !== 'string' ||
    !(LIMITS.contentTypes as readonly string[]).includes(contentType)
  ) {
    return fail('bad_type', 'MP4 · MOV · WebM 영상만 만들 수 있어요.');
  }

  const fps = intIn(body.fps, LIMITS.fps.min, LIMITS.fps.max, LIMITS.fps.default);
  if (fps === null)
    return fail('bad_fps', `초당 장면 수는 ${LIMITS.fps.min}~${LIMITS.fps.max}로 골라 주세요.`);
  const width = intIn(body.width, LIMITS.width.min, LIMITS.width.max, LIMITS.width.default);
  if (width === null) {
    return fail(
      'bad_width',
      `가로 크기는 ${LIMITS.width.min}~${LIMITS.width.max}px로 골라 주세요.`,
    );
  }

  return { ok: true, value: { kind: k, start, end, fileSize, contentType, fps, width } };
}
