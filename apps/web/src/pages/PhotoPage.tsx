import { ToolPlaceholder } from '../components/ToolPlaceholder';

export function PhotoPage() {
  return (
    <ToolPlaceholder
      title="사진"
      summary="폰·워치 화면에 맞게 자르거나, 사진 전체를 넣고 배경을 채워요. 사진은 이 기기 밖으로 나가지 않아요."
      accepts={['image']}
    />
  );
}
