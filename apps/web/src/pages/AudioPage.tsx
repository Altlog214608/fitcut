import { ToolPlaceholder } from '../components/ToolPlaceholder';

export function AudioPage() {
  return (
    <ToolPlaceholder
      title="음성"
      summary="영상이나 음성 파일에서 원하는 구간만 MP3 · M4A · WAV, 벨소리로 만들어요."
      accepts={['audio', 'video']}
    />
  );
}
