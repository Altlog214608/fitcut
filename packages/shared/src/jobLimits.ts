/**
 * 영상 잡 입력 제한 (FEATURES F3). 서버(services/api)가 검사하고 화면(apps/web)이 미리 알린다.
 * 바꾸면 양쪽 문구가 함께 바뀐다.
 */
export const JOB_LIMITS = {
  /** 원본 최대 크기 */
  maxUploadBytes: 500 * 1024 * 1024,
  /**
   * 내보낼 구간 최대 길이(초). 음성은 10분.
   * m4r(아이폰 벨소리)는 30초: Apple 지원 문서 "Create a custom ringtone on your iPhone"
   * (support.apple.com/120692, 2026-10-10 확인) "ringtones can be up to 30 seconds long"
   */
  maxSeconds: {
    gif: 30,
    webp: 30,
    mp4: 180,
    mp3: 600,
    m4a: 600,
    wav: 600,
    m4r: 30,
    // 영상 세로로 돌리기 (F21): 다시 압축은 Lambda 시간 안에 끝나게 3분, 회전 정보만은 10분
    rotate: 180,
    'rotate-fast': 600,
  },
  /**
   * 다시 압축하는 회전의 작업량 상한: 가로×세로×fps×초. 1080p 30fps 3분 기준 (2048MB에서 약 4분, ADR-002·024).
   * 넘으면 회전 정보만 바꾸는 방식을 권한다
   */
  rotateEncodeBudget: 1920 * 1080 * 30 * 180,
  fps: { min: 5, max: 30, default: 15 },
  /** 결과 가로 폭(px) */
  width: { min: 120, max: 1080, default: 480 },
  /** 결과 세로(px). 정하면 가로×세로에 꽉 차게 가운데를 잘라 맞춘다 (워치 화면 등). 없으면 비율대로 */
  height: { min: 120, max: 1920 },
  contentTypes: [
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'audio/mpeg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
  ],
  /** 음성 옵션 (F14) */
  audio: {
    fadeMax: 10,
    bitrate: { min: 64, max: 320, default: 192 },
  },
} as const;

export type JobKind = keyof typeof JOB_LIMITS.maxSeconds;
export const JOB_KINDS = Object.keys(JOB_LIMITS.maxSeconds) as JobKind[];

/** 음성만 내보내는 형식 (영상이 없는 원본도 받는다) */
export const AUDIO_KINDS: readonly JobKind[] = ['mp3', 'm4a', 'wav', 'm4r'];
export const isAudioKind = (kind: JobKind) => AUDIO_KINDS.includes(kind);

/** 영상 전체를 돌리는 형식 (구간이 아니라 처음부터 끝까지) */
export const ROTATE_KINDS: readonly JobKind[] = ['rotate', 'rotate-fast'];
export const isRotateKind = (kind: JobKind) => ROTATE_KINDS.includes(kind);
