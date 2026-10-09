import { ToolPlaceholder } from '../components/ToolPlaceholder';

export function GifPage() {
  return (
    <ToolPlaceholder
      title="움짤"
      summary="영상에서 구간을 프레임 단위로 골라 GIF · WebP · MP4로 만들어요."
      accepts={['video']}
    />
  );
}
