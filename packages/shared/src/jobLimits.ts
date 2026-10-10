/**
 * 영상 잡 입력 제한 (FEATURES F3). 서버(services/api)가 검사하고 화면(apps/web)이 미리 알린다.
 * 바꾸면 양쪽 문구가 함께 바뀐다.
 */
export const JOB_LIMITS = {
  /** 원본 최대 크기 */
  maxUploadBytes: 500 * 1024 * 1024,
  /** 내보낼 구간 최대 길이(초) */
  maxSeconds: { gif: 30, webp: 30, mp4: 180 },
  fps: { min: 5, max: 30, default: 15 },
  /** 결과 가로 폭(px) */
  width: { min: 120, max: 1080, default: 480 },
  contentTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
} as const;

export type JobKind = keyof typeof JOB_LIMITS.maxSeconds;
export const JOB_KINDS = Object.keys(JOB_LIMITS.maxSeconds) as JobKind[];
