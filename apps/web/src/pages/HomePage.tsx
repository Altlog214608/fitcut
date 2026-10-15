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
import { useT } from '../i18n/context';
import { detectKind } from '../lib/detectKind';
import { setSelectedFile } from '../lib/selectedFile';
import { parseYouTubeId } from '../lib/youtube';
import styles from './HomePage.module.css';

type Tool = { to: string; icon: LucideIcon; title: string; detail: string };

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
  const t = useT().home;
  const tools: Tool[] = [
    { to: '/photo', icon: Crop, ...t.photo },
    { to: '/gif', icon: Film, ...t.gif },
    { to: '/audio', icon: AudioLines, ...t.audio },
    { to: '/rotate', icon: RotateCw, ...t.rotate },
  ];
  const videoChoices: Tool[] = [
    { to: '/gif', icon: Film, title: t.gif.title, detail: t.gifChoice },
    { to: '/audio', icon: AudioLines, title: t.audio.title, detail: t.audioChoice },
    { to: '/rotate', icon: RotateCw, title: t.rotate.title, detail: t.rotateChoice },
  ];
  const [video, setVideo] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  function openFile(file: File) {
    setFileError(null);
    setVideo(null);
    const result = detectKind(file);
    if (result.kind === 'unsupported') {
      setFileError(t.unknownFile);
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
      setLinkError(t.badLink);
      return;
    }
    setLinkError(null);
    navigate(`/link?v=${id}`);
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>
        {t.title1} <br />
        {t.title2}
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
            {t.chooseTitle}
          </h2>
          <p className={styles.chooserFile}>{video.name}</p>
          <ToolList tools={videoChoices} label={t.chooseLabel} />
        </section>
      )}

      <form className={styles.linkForm} onSubmit={openLink} noValidate>
        <label htmlFor="youtube-link" className="visually-hidden">
          {t.linkLabel}
        </label>
        <div className={styles.field}>
          <LinkIcon size={20} strokeWidth={1.75} />
          <input
            id="youtube-link"
            type="url"
            inputMode="url"
            placeholder={t.linkPlaceholder}
            value={link}
            onChange={(event) => setLink(event.currentTarget.value)}
            aria-invalid={linkError ? true : undefined}
            aria-describedby={linkError ? 'youtube-link-error' : undefined}
          />
          {link && (
            <button type="submit" className={styles.linkButton}>
              {t.linkGo}
            </button>
          )}
        </div>
        {linkError && (
          <p id="youtube-link-error" className={styles.error} role="alert">
            {linkError}
          </p>
        )}
      </form>

      <ToolList tools={tools} label={t.tools} />

      <div className={styles.streamer}>
        <p className={styles.streamerLabel}>{t.streamerLabel}</p>
        <ToolList
          tools={[{ to: '/highlight', icon: MessageSquareText, ...t.highlight }]}
          label={t.streamerTools}
        />
      </div>

      <p className={styles.trust}>
        <ShieldCheck size={18} strokeWidth={1.75} />
        {t.trust}
      </p>
    </div>
  );
}
