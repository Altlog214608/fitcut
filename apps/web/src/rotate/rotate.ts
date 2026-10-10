/** 세로로 돌리기 계산 (순수 함수, FEATURES F21) */
import { JOB_LIMITS } from '@fitcut/shared';

export type Turn = 90 | 180 | 270;
export type Size = { width: number; height: number };

/** 돌린 뒤 화면에 보이는 크기 */
export function turnedSize(size: Size, turn: Turn): Size {
  return turn === 180 ? size : { width: size.height, height: size.width };
}

/** 미리보기 CSS: 시계 방향으로 돌리고(반전) */
export function previewTransform(turn: Turn, flip: boolean): string {
  return `rotate(${turn}deg)${flip ? ' scaleX(-1)' : ''}`;
}

/**
 * 다시 압축해서 돌릴 수 있는지 (워커와 같은 기준: 3분, 1080p 30fps 3분만큼의 작업량).
 * fps를 모르면 30으로 본다.
 */
export function canEncode(size: Size, seconds: number, fps = 30): boolean {
  return (
    seconds <= JOB_LIMITS.maxSeconds.rotate + 1 &&
    size.width * size.height * fps * seconds <= JOB_LIMITS.rotateEncodeBudget
  );
}
