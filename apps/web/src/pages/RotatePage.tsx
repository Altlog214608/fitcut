import { ToolPlaceholder } from '../components/ToolPlaceholder';

export function RotatePage() {
  return (
    <ToolPlaceholder
      title="영상 세로로 돌리기"
      summary="누워 있는 영상을 해상도와 프레임 그대로 90° 돌려요. 예: 1920×1080 → 1080×1920"
      accepts={['video']}
    />
  );
}
