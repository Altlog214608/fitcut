/** 잡 입력 제한 (FEATURES F3 초안). 바꾸면 화면 안내 문구도 같이 바꾼다. */
export const LIMITS = {
  /** 원본 최대 크기 */
  maxUploadBytes: 500 * 1024 * 1024,
  /** 내보낼 구간 최대 길이(초) */
  maxSeconds: { gif: 30, webp: 30, mp4: 180 },
  fps: { min: 5, max: 30, default: 15 },
  /** 결과 가로 폭(px) */
  width: { min: 120, max: 1080, default: 480 },
  contentTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
  /** 업로드 주소 유효 시간(초) */
  uploadUrlSeconds: 15 * 60,
  /** 결과 내려받기 주소 유효 시간(초). 상태를 다시 조회하면 새 주소를 준다 */
  downloadUrlSeconds: 10 * 60,
  /** 잡 기록 보관(초). DynamoDB TTL은 바로 지워지지 않으므로 조회할 때도 확인한다 */
  jobTtlSeconds: 2 * 24 * 60 * 60,
  /** 올린 영상으로 잡을 만들 수 있는 시간(초). 업로드 버킷 수명 주기(1일)와 맞춘다 */
  uploadTtlSeconds: 24 * 60 * 60,
} as const;

export type JobKind = keyof typeof LIMITS.maxSeconds;
export const JOB_KINDS = Object.keys(LIMITS.maxSeconds) as JobKind[];
