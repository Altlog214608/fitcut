import { VISIBLE_PRESETS } from '@fitcut/presets';
import { ImageUp, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { DropZone } from '../components/DropZone';
import { detectKind } from '../lib/detectKind';
import { readJson, writeJson } from '../lib/storage';
import { DevicePicker } from './DevicePicker';
import { outputFileName, type OutputFormat } from './fileName';
import { computeLayout, ratioFit, type FitMode, type Position } from './layout';
import { Options } from './Options';
import styles from './PhotoTool.module.css';
import { Preview } from './Preview';
import { downscaled, type Background, type CanvasFactory } from './render';
import { decodePhoto, renderPhoto } from './renderClient';
import { isTargetList, pushRecent, resolveTarget, sameTarget, type Target } from './target';

const RECENT_KEY = 'fitcut.photo.recent';
const MINE_KEY = 'fitcut.photo.mine';
const CENTER: Position = { x: 0, y: 0 };

type Loaded = {
  file: File;
  url: string;
  bitmap: ImageBitmap;
  /** 미리보기용으로 줄인 사본. 끌 때마다 다시 그리므로 작게 둔다 */
  preview: CanvasImageSource & { width: number; height: number };
};

/** 배경 채우기에서 사진 경계를 섞는 길이 (사진 길이 대비) */
const FEATHER = 0.05;
const PREVIEW_MAX_SIDE = 1600;

const makeCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

type Saved = { name: string; width: number; height: number; bytes: number; fellBack: boolean };

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function PhotoTool({ initialFile }: { initialFile: File | null }) {
  const replaceId = useId();
  const [file, setFile] = useState<File | null>(initialFile);
  // 디코딩 결과와 오류는 어느 파일의 것인지 함께 둔다. 파일이 바뀌면 지난 결과는 쓰지 않는다.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [decodeError, setDecodeError] = useState<{ file: File; message: string } | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const [stored] = useState(() => ({
    recent: readJson<Target[]>(RECENT_KEY, [], isTargetList),
    mine: readJson<Target[]>(MINE_KEY, [], isTargetList),
  }));
  const [recent, setRecent] = useState<Target[]>(stored.recent);
  const [mine, setMine] = useState<Target[]>(stored.mine);
  const [target, setTarget] = useState<Target | null>(stored.mine[0] ?? stored.recent[0] ?? null);

  const [mode, setMode] = useState<FitMode>('cover');
  const [position, setPosition] = useState<Position>(CENTER);
  // 비교해 보니 가장자리 늘이기가 가장 자연스러워 기본값으로 둔다 (ROADMAP M1 배경 채우기)
  const [background, setBackground] = useState<Background>({
    kind: 'extend',
    strength: 0.4,
    dim: 0,
  });
  const [format, setFormat] = useState<OutputFormat>('jpeg');
  const [quality, setQuality] = useState(0.92);
  const [circleOutside, setCircleOutside] = useState<'black' | 'transparent'>('black');
  const [soft, setSoft] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<(Saved & { key: string }) | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let decoded: ImageBitmap | null = null;
    const url = URL.createObjectURL(file);
    decodePhoto(file)
      .then((bitmap) => {
        decoded = bitmap;
        if (cancelled) {
          bitmap.close();
          return;
        }
        setLoaded({ file, url, bitmap, preview: downscaled(bitmap, PREVIEW_MAX_SIDE, makeCanvas) });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDecodeError({
          file,
          message: error instanceof Error ? error.message : '사진을 열지 못했어요.',
        });
      });
    return () => {
      cancelled = true;
      decoded?.close();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const current = loaded && loaded.file === file ? loaded : null;
  const bitmap = current?.bitmap ?? null;
  const imageUrl = current?.url ?? null;
  const fileError = pickError ?? (decodeError?.file === file ? decodeError.message : null);
  // 저장 결과 안내는 저장할 때와 설정이 같을 때만 보여준다
  const settingsKey = JSON.stringify([
    target,
    mode,
    position,
    background,
    format,
    quality,
    circleOutside,
    soft,
  ]);
  const savedNow = saved && saved.key === settingsKey && current ? saved : null;

  const resolved = useMemo(
    () => (target ? resolveTarget(target, VISIBLE_PRESETS) : null),
    [target],
  );
  const source = bitmap ? { width: bitmap.width, height: bitmap.height } : null;
  const layout = resolved && source ? computeLayout(source, resolved.size, mode, position) : null;
  const fit = resolved && source ? ratioFit(source, resolved.size) : 'match';
  const isCircle = resolved?.shape === 'circle';
  const transparentCircle = isCircle && circleOutside === 'transparent';
  const feather = mode === 'contain' && soft ? FEATHER : 0;
  const effectiveFormat: OutputFormat = transparentCircle && format === 'jpeg' ? 'png' : format;

  function pickFile(next: File) {
    const kind = detectKind(next);
    if (kind.kind !== 'image') {
      setPickError(
        kind.kind === 'unsupported' && kind.reason === 'heic'
          ? 'HEIC 사진은 아직 열 수 없어요. 곧 지원할게요. 지금은 JPG · PNG · WebP로 골라 주세요.'
          : '사진 파일이 아니에요. JPG · PNG · WebP 사진을 골라 주세요.',
      );
      return;
    }
    setPickError(null);
    setPosition(CENTER);
    setFile(next);
  }

  function chooseTarget(next: Target) {
    setTarget(next);
    setPosition(CENTER);
  }

  function chooseMode(next: FitMode) {
    setMode(next);
    setPosition(CENTER);
  }

  function toggleMine(t: Target) {
    const next = mine.some((m) => sameTarget(m, t))
      ? mine.filter((m) => !sameTarget(m, t))
      : [t, ...mine];
    setMine(next);
    writeJson(MINE_KEY, next);
  }

  async function save() {
    if (!bitmap || !layout || !resolved || !file || !target) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await renderPhoto(bitmap, {
        target: resolved.size,
        layout,
        background,
        format: effectiveFormat,
        quality,
        feather,
        ...(isCircle ? { circleOutside } : {}),
      });
      const name = outputFileName(file.name, resolved.label, resolved.size, result.format);
      download(result.blob, name);
      setSaved({
        key: settingsKey,
        name,
        width: resolved.size.width,
        height: resolved.size.height,
        bytes: result.blob.size,
        fellBack: result.format !== effectiveFormat,
      });
      const nextRecent = pushRecent(recent, target);
      setRecent(nextRecent);
      writeJson(RECENT_KEY, nextRecent);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? `${error.message} 다시 시도해 주세요.`
          : '이미지를 만들지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!file) {
    return (
      <div className={styles.empty}>
        <h1 className={styles.title}>사진</h1>
        <p className={styles.lead}>폰·워치 화면에 딱 맞는 배경화면을 만들어요.</p>
        <DropZone
          title="사진을 끌어오세요"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          onFile={pickFile}
        />
        {fileError && (
          <p className={styles.error} role="alert">
            {fileError}
          </p>
        )}
        <p className={styles.trust}>
          <ShieldCheck size={18} strokeWidth={1.75} />
          사진은 이 기기 밖으로 나가지 않아요
        </p>
      </div>
    );
  }

  return (
    <div className={styles.tool}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>사진</h1>
          <p className={styles.fileInfo}>
            <span className={styles.fileName}>{file.name}</span>
            {source && (
              <span className={styles.num}>
                원본 {source.width} × {source.height}
              </span>
            )}
          </p>
        </div>
        <label htmlFor={replaceId} className={styles.replace}>
          <ImageUp size={18} strokeWidth={1.75} />
          다른 사진
        </label>
        <input
          id={replaceId}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          className="visually-hidden"
          onChange={(e) => {
            const next = e.currentTarget.files?.[0];
            if (next) pickFile(next);
            e.currentTarget.value = '';
          }}
        />
      </header>

      <div className={styles.main}>
        <div className={styles.previewCol}>
          {current && imageUrl && resolved && layout ? (
            <Preview
              source={current.preview}
              imageUrl={imageUrl}
              target={resolved}
              layout={layout}
              mode={mode}
              background={background}
              feather={feather}
              format={effectiveFormat}
              circleOutside={circleOutside}
              position={position}
              onPositionChange={setPosition}
            />
          ) : (
            <div className={styles.placeholder}>
              {fileError ? (
                <p className={styles.error} role="alert">
                  {fileError}
                </p>
              ) : !resolved ? (
                <p>어떤 기기에 쓸 사진인가요? 기기를 고르면 여기에 화면 모양대로 보여드려요.</p>
              ) : (
                <p>사진을 여는 중이에요…</p>
              )}
            </div>
          )}

          {layout && resolved && (
            <div className={styles.notices}>
              {mode === 'cover' && fit !== 'match' && (
                <p className={styles.notice}>
                  {fit === 'sides-cropped'
                    ? '이 사진은 화면보다 가로가 넓어서 양옆이 잘려요.'
                    : '이 사진은 화면보다 세로가 길어서 위아래가 잘려요.'}{' '}
                  <button type="button" onClick={() => chooseMode('contain')}>
                    배경 채우기로 사진 전체 넣기
                  </button>
                </p>
              )}
              {layout.scale > 1.05 && (
                <p className={styles.notice}>
                  원본보다 <b className={styles.num}>{layout.scale.toFixed(1)}배</b> 커요. 흐려 보일
                  수 있어요.
                </p>
              )}
              {(layout.movable.x || layout.movable.y) && (
                <p className={styles.hint}>사진을 끌어서 위치를 옮길 수 있어요.</p>
              )}
            </div>
          )}
        </div>

        <div className={styles.panel}>
          <DevicePicker
            value={target}
            recent={recent}
            mine={mine}
            onChange={chooseTarget}
            onToggleMine={toggleMine}
          />
          <hr className={styles.rule} />
          <Options
            mode={mode}
            onMode={chooseMode}
            background={background}
            onBackground={setBackground}
            format={format}
            onFormat={setFormat}
            quality={quality}
            onQuality={setQuality}
            isCircle={isCircle}
            circleOutside={circleOutside}
            onCircleOutside={setCircleOutside}
            soft={soft}
            onSoft={setSoft}
          />
          {transparentCircle && format === 'jpeg' && (
            <p className={styles.hint}>JPG는 투명을 담을 수 없어서 PNG로 저장돼요.</p>
          )}

          <div className={styles.saveBar}>
            <button
              type="button"
              className={styles.save}
              disabled={!layout || saving}
              onClick={() => void save()}
            >
              {saving ? '만드는 중…' : '이미지 저장'}
            </button>
            {savedNow && (
              <p className={styles.saved} role="status">
                저장했어요 ·{' '}
                <span className={styles.num}>
                  {savedNow.width} × {savedNow.height}
                </span>{' '}
                · {formatBytes(savedNow.bytes)}
                {savedNow.fellBack && <> · 이 브라우저는 WebP를 만들 수 없어서 PNG로 저장했어요</>}
              </p>
            )}
            {saveError && (
              <p className={styles.error} role="alert">
                {saveError}
              </p>
            )}
            <p className={styles.trust}>
              <ShieldCheck size={18} strokeWidth={1.75} />
              사진은 이 기기 밖으로 나가지 않아요
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
