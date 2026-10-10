/** 잡 입력 제한. 화면과 같이 쓰는 값은 @fitcut/shared에 있다 (바꾸면 화면 안내 문구도 같이 바뀐다). */
import { JOB_LIMITS } from '@fitcut/shared';

export { JOB_KINDS, type JobKind } from '@fitcut/shared';

export const LIMITS = {
  ...JOB_LIMITS,
  /** 업로드 주소 유효 시간(초) */
  uploadUrlSeconds: 15 * 60,
  /** 결과 내려받기 주소 유효 시간(초). 상태를 다시 조회하면 새 주소를 준다 */
  downloadUrlSeconds: 10 * 60,
  /** 잡 기록 보관(초). DynamoDB TTL은 바로 지워지지 않으므로 조회할 때도 확인한다 */
  jobTtlSeconds: 2 * 24 * 60 * 60,
  /** 올린 영상으로 잡을 만들 수 있는 시간(초). 업로드 버킷 수명 주기(1일)와 맞춘다 */
  uploadTtlSeconds: 24 * 60 * 60,
} as const;
