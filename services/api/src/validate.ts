/** POST /api/uploads · POST /api/jobs 입력 검사 (순수 함수). 오류 문구는 화면에 그대로 보여준다 (docs/UI.md 문구 규칙). */
import { isUuid } from './jobs';
import { isAudioKind } from '@fitcut/shared';
import { JOB_KINDS, LIMITS, type JobKind } from './limits';

export type CreateUpload = {
  fileSize: number;
  contentType: string;
};

export type CreateJob = {
  /** POST /api/uploads로 받은 업로드 ID. 한 번 올린 영상으로 여러 결과를 만들 수 있다 */
  uploadId: string;
  kind: JobKind;
  /** 구간 시작·끝 (초, 소수점 허용) */
  start: number;
  end: number;
  fps: number;
  width: number;
  /** 정하면 가로×세로에 꽉 차게 가운데를 잘라 맞춘다 */
  height?: number;
  /** 음성 형식만 (F14) */
  audio?: AudioOptions;
};

export type AudioOptions = {
  fadeIn: number;
  fadeOut: number;
  normalize: boolean;
  channels: 1 | 2;
  bitrate: number;
};

export type Invalid = { code: string; message: string };

type Result<T> = { ok: true; value: T } | { ok: false; error: Invalid };
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fail = (code: string, message: string) => ({
  ok: false as const,
  error: { code, message },
});

function intIn(value: unknown, min: number, max: number, fallback: number): number | null {
  if (value === undefined) return fallback;
  return isNum(value) && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function parseCreateUpload(body: unknown): Result<CreateUpload> {
  if (!isObj(body)) return fail('bad_body', '요청 형식이 올바르지 않아요.');

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
  return { ok: true, value: { fileSize, contentType } };
}

export function parseCreateJob(body: unknown): Result<CreateJob> {
  if (!isObj(body)) return fail('bad_body', '요청 형식이 올바르지 않아요.');

  const { uploadId } = body;
  if (typeof uploadId !== 'string' || !isUuid(uploadId)) {
    return fail('bad_upload', '영상을 다시 골라 주세요.');
  }

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
    return fail(
      'too_long',
      k === 'm4r'
        ? `아이폰 벨소리는 ${max}초까지예요. 구간을 ${max}초 이하로 골라 주세요.`
        : `구간이 너무 길어요. ${max}초 이하로 골라 주세요.`,
    );
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

  let height: number | undefined;
  if (body.height !== undefined) {
    const h = intIn(body.height, LIMITS.height.min, LIMITS.height.max, 0);
    if (!h) {
      return fail(
        'bad_height',
        `세로 크기는 ${LIMITS.height.min}~${LIMITS.height.max}px로 골라 주세요.`,
      );
    }
    height = h;
  }

  let audio: AudioOptions | undefined;
  if (isAudioKind(k)) {
    const a = isObj(body.audio) ? body.audio : {};
    const fade = (v: unknown) =>
      v === undefined ? 0 : isNum(v) && v >= 0 && v <= LIMITS.audio.fadeMax ? v : null;
    const fadeIn = fade(a.fadeIn);
    const fadeOut = fade(a.fadeOut);
    if (fadeIn === null || fadeOut === null || fadeIn + fadeOut > end - start) {
      return fail(
        'bad_fade',
        `페이드는 ${LIMITS.audio.fadeMax}초 이하로, 구간 길이 안에서 골라 주세요.`,
      );
    }
    const { min, max: top, default: def } = LIMITS.audio.bitrate;
    const bitrate = intIn(a.bitrate, min, top, def);
    if (bitrate === null) return fail('bad_bitrate', `음질은 ${min}~${top}kbps로 골라 주세요.`);
    const channels = a.channels === undefined ? 2 : a.channels;
    if (channels !== 1 && channels !== 2) {
      return fail('bad_channels', '모노나 스테레오 중에서 골라 주세요.');
    }
    audio = { fadeIn, fadeOut, normalize: a.normalize === true, channels, bitrate };
  }

  return {
    ok: true,
    value: {
      uploadId,
      kind: k,
      start,
      end,
      fps,
      width,
      ...(height ? { height } : {}),
      ...(audio ? { audio } : {}),
    },
  };
}
