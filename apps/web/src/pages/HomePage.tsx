import {
  AudioLines,
  ChevronRight,
  Crop,
  Film,
  Link as LinkIcon,
  MessageSquareText,
  RotateCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { DropZone } from '../components/DropZone';
import { detectKind } from '../lib/detectKind';
import { setSelectedFile } from '../lib/selectedFile';
import { parseYouTubeId } from '../lib/youtube';
import styles from './HomePage.module.css';

type Tool = { to: string; icon: LucideIcon; title: string; detail: string };

const TOOLS: Tool[] = [
  { to: '/photo', icon: Crop, title: '사진 크기 맞추기', detail: '배경화면 · 워치 화면' },
  { to: '/gif', icon: Film, title: '움짤 만들기', detail: 'GIF · WebP · MP4' },
  { to: '/audio', icon: AudioLines, title: '음성 추출', detail: 'MP3 · 벨소리' },
  { to: '/rotate', icon: RotateCw, title: '영상 세로로 돌리기', detail: '해상도·프레임 그대로' },
];

const VIDEO_CHOICES: Tool[] = [
  { to: '/gif', icon: Film, title: '움짤 만들기', detail: '구간을 골라 GIF · WebP · MP4로' },
  { to: '/audio', icon: AudioLines, title: '음성 추출', detail: '영상에서 소리만 MP3 · 벨소리로' },
  { to: '/rotate', icon: RotateCw, title: '세로로 돌리기', detail: '누워 있는 영상을 똑바로' },
];

const MESSAGES = {
  unknown:
    '이 파일은 열 수 없어요. 사진(JPG · PNG · WebP · HEIC), 영상(MP4 · MOV · WebM), 음성(MP3 · M4A · WAV)을 골라 주세요.',
  link: '유튜브 영상 링크를 확인해 주세요. 예: https://youtu.be/영상ID',
};

function ToolList({ tools, label }: { tools: Tool[]; label: string }) {
  return (
    <ul className={styles.rows} aria-label={label}>
      {tools.map(({ to, icon: Icon, title, detail }) => (
        <li key={to + title}>
          <Link to={to} className={styles.row}>
            <span className={styles.tile}>
              <Icon size={22} strokeWidth={1.75} />
            </span>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>{title}</span>
              <span className={styles.rowDetail}>{detail}</span>
            </span>
            <ChevronRight className={styles.chevron} size={18} strokeWidth={1.75} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const [video, setVideo] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  function openFile(file: File) {
    setFileError(null);
    setVideo(null);
    const result = detectKind(file);
    if (result.kind === 'unsupported') {
      setFileError(MESSAGES[result.reason]);
      return;
    }
    setSelectedFile(file);
    if (result.kind === 'image') navigate('/photo');
    else if (result.kind === 'audio') navigate('/audio');
    else setVideo(file);
  }

  function openLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = parseYouTubeId(link);
    if (!id) {
      setLinkError(MESSAGES.link);
      return;
    }
    setLinkError(null);
    navigate(`/link?v=${id}`);
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>
        사진·영상·음성을 <br />내 기기에 딱 맞게
      </h1>

      <DropZone onFile={openFile} />
      {fileError && (
        <p className={styles.error} role="alert">
          {fileError}
        </p>
      )}

      {video && (
        <section className={styles.chooser} aria-labelledby="video-choice">
          <h2 id="video-choice" className={styles.chooserTitle}>
            무엇을 만들까요?
          </h2>
          <p className={styles.chooserFile}>{video.name}</p>
          <ToolList tools={VIDEO_CHOICES} label="영상으로 할 수 있는 일" />
        </section>
      )}

      <form className={styles.linkForm} onSubmit={openLink} noValidate>
        <label htmlFor="youtube-link" className="visually-hidden">
          유튜브 링크
        </label>
        <div className={styles.field}>
          <LinkIcon size={20} strokeWidth={1.75} />
          <input
            id="youtube-link"
            type="url"
            inputMode="url"
            placeholder="유튜브 링크 붙여넣기"
            value={link}
            onChange={(event) => setLink(event.currentTarget.value)}
            aria-invalid={linkError ? true : undefined}
            aria-describedby={linkError ? 'youtube-link-error' : undefined}
          />
          {link && (
            <button type="submit" className={styles.linkButton}>
              구간 고르기
            </button>
          )}
        </div>
        {linkError && (
          <p id="youtube-link-error" className={styles.error} role="alert">
            {linkError}
          </p>
        )}
      </form>

      <ToolList tools={TOOLS} label="도구" />

      <div className={styles.streamer}>
        <p className={styles.streamerLabel}>스트리머라면</p>
        <ToolList
          tools={[
            {
              to: '/highlight',
              icon: MessageSquareText,
              title: '방송 하이라이트 찾기',
              detail: '채팅으로 하이라이트 후보 찾기',
            },
          ]}
          label="스트리머 도구"
        />
      </div>

      <p className={styles.trust}>
        <ShieldCheck size={18} strokeWidth={1.75} />
        광고 · 회원가입 · 워터마크 없음
      </p>
    </div>
  );
}
