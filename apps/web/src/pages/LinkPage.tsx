import { useSearchParams } from 'react-router';
import { ToolPlaceholder } from '../components/ToolPlaceholder';

export function LinkPage() {
  const [params] = useSearchParams();
  const videoId = params.get('v');

  return (
    <ToolPlaceholder
      title="링크 구간"
      summary="영상은 유튜브에서 재생되고, 링크와 구간만 저장돼요."
    >
      {videoId && <p>영상 ID: {videoId}</p>}
    </ToolPlaceholder>
  );
}
