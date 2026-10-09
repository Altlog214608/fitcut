import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <>
      <h1>페이지를 찾을 수 없어요</h1>
      <p>
        주소를 다시 확인해 주세요. <Link to="/">처음으로 돌아가기</Link>
      </p>
    </>
  );
}
