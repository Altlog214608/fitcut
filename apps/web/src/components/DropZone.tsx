import { useId, useRef, useState, type DragEvent } from 'react';
import { FitIllustration } from './FitIllustration';
import styles from './DropZone.module.css';

type Props = {
  onFile: (file: File) => void;
  title?: string;
  accept?: string;
};

const ALL_TYPES =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,video/webm,.mov,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,.m4a,.mp3,.wav';

/** 파일을 끌어다 놓거나 눌러서 고르는 영역. 파일은 브라우저 안에서만 다룬다. */
export function DropZone({
  onFile,
  title = '사진·영상·음성 파일을 끌어오세요',
  accept = ALL_TYPES,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <label
      htmlFor={inputId}
      className={styles.zone}
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <FitIllustration />
      <span className={styles.title}>{title}</span>
      <span className={styles.hint}>또는 눌러서 선택</span>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="visually-hidden"
        accept={accept}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onFile(file);
          // 같은 파일을 다시 골라도 change가 일어나게 비운다
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </label>
  );
}
