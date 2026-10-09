import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { detectKind, type FileKind } from '../lib/detectKind';
import { getSelectedFile } from '../lib/selectedFile';
import styles from './ToolPlaceholder.module.css';

type Props = {
  title: string;
  summary: string;
  /** 홈에서 고른 파일 중 이 도구가 받는 종류. 맞으면 파일 이름을 보여준다. */
  accepts?: Exclude<FileKind['kind'], 'unsupported'>[];
  children?: ReactNode;
};

/** 아직 만들지 않은 도구 화면. 마일스톤마다 실제 도구로 바뀐다 (docs/ROADMAP.md). */
export function ToolPlaceholder({ title, summary, accepts, children }: Props) {
  const file = getSelectedFile();
  const kind = file ? detectKind(file).kind : null;
  const showFile = file && kind && kind !== 'unsupported' && accepts?.includes(kind);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.summary}>{summary}</p>
      {showFile && <p className={styles.file}>고른 파일: {file.name}</p>}
      {children}
      <p className={styles.note}>
        이 도구는 만들고 있어요. <Link to="/">처음으로 돌아가기</Link>
      </p>
    </div>
  );
}
