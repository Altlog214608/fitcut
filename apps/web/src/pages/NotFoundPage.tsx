import { Link } from 'react-router';
import styles from '../components/ToolPlaceholder.module.css';

export function NotFoundPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>페이지를 찾을 수 없어요</h1>
      <p className={styles.note}>
        주소를 다시 확인해 주세요. <Link to="/">처음으로 돌아가기</Link>
      </p>
    </div>
  );
}
