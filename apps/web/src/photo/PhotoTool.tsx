import { VISIBLE_PRESETS } from '@fitcut/presets';
import { ImageUp, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { DropZone } from '../components/DropZone';
import { detectKind } from '../lib/detectKind';
import { IN_APP, inAppLabel, SAVE_METHOD } from '../lib/inApp';
import { readJson, writeJson } from '../lib/storage';
import { track } from '../lib/analytics';
import { sizeBucket } from '@fitcut/shared';
import { canShareAll, download, openShare } from '../lib/save';
import { targetKey, uniqueNames, zipFiles, zipName } from './batch';
import { targetLabel } from './targetSize';
import { DevicePicker } from './DevicePicker';
import { outputFileName, type OutputFormat } from './fileName';
import { computeLayout, fillAxis, maxZoom, ratioFit, type FitMode, type Position } from './layout';
import { Options } from './Options';
import { measureEdges, suggestPosition, type EdgeBusyness } from './placement';
import styles from './PhotoTool.module.css';
import { Preview } from './Preview';
import { downscaled, type Background, type CanvasFactory } from './render';
import { decodePhoto, renderPhoto } from './renderClient';
import { isTargetList, pushRecent, resolveTarget, sameTarget, type Target } from './target';

const RECENT_KEY = 'fitcut.photo.recent';
const MINE_KEY = 'fitcut.photo.mine';
const CENTER: Position = { x: 0, y: 0 };

/** 기기마다 따로 기억하는 사진 위치·크기 (F8). position이 null이면 자동 */
type Placement = { position: Position | null; zoom: number };
const DEFAULT_PLACEMENT: Placement = { position: null, zoom: 1 };

type Loaded = {
  file: File;
  url: string;
  bitmap: ImageBitmap;
  /** 미리보기용으로 줄인 사본. 끌 때마다 다시 그리므로 작게 둔다 */
  preview: CanvasImageSource & { width: number; height: number };
  /** 가장자리가 얼마나 복잡한지. 배경 채우기에서 사진을 붙일 쪽을 고른다 */
  edges: EdgeBusyness;
};

/** 배경 채우기에서 사진 경계를 섞는 길이 (사진 길이 대비) */
const FEATHER = 0.05;
const PREVIEW_MAX_SIDE = 1600;
/** 가장자리를 잴 때 줄이는 가로 길이. 잡음 대신 큰 모양만 보도록 작게 줄인다 */
const EDGE_SAMPLE_WIDTH = 96;

const makeCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

function sampleEdges(image: CanvasImageSource & { width: number; height: number }): EdgeBusyness {
  const width = Math.min(EDGE_SAMPLE_WIDTH, image.width);
  const height = Math.max(1, Math.round((image.height * width) / image.width));
  const ctx = makeCanvas(width, height).getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return { top: 0, bottom: 0, left: 0, right: 0 };
  ctx.drawImage(image, 0, 0, width, height);
  return measureEdges(ctx.getImageData(0, 0, width, height));
}

type Saved = {
  name: string;
  width: number;
  height: number;
  bytes: number;
  fellBack: boolean;
  /** 공유 화면으로 넘겼다 (아이폰) */
  shared: boolean;
  /** 목표 용량을 썼을 때 (F9) */
  maxBytes?: number;
  fitted?: { quality: number; fits: boolean };
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
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
  // null이면 자동: 배경 채우기에서는 사진이 잘린 쪽을 화면 끝에 붙인다. 끌면 직접 정한 위치가 된다.
  const [placements, setPlacements] = useState<Record<string, Placement>>({});
  const placementKey = target ? targetKey(target) : '';
  const { position, zoom } = placements[placementKey] ?? DEFAULT_PLACEMENT;
  const place = (patch: Partial<Placement>) =>
    setPlacements((all) => ({
      ...all,
      [placementKey]: { ...(all[placementKey] ?? DEFAULT_PLACEMENT), ...patch },
    }));
  const setPosition = (next: Position | null) => place({ position: next });
  const setZoom = (next: number) => place({ zoom: next });
  // '자연스럽게'(결 이어 붙이기)는 색이 튀어 뺐다 (2026-10-10 사용자 결정, ADR-028)
  const [background, setBackground] = useState<Background>({
    kind: 'extend',
    strength: 0.4,
    dim: 0,
  });
  const [format, setFormat] = useState<OutputFormat>('jpeg');
  const [quality, setQuality] = useState(0.92);
  const [targetKb, setTargetKb] = useState(0);
  const [showGuide, setShowGuide] = useState(false);
  const [circleOutside, setCircleOutside] = useState<'black' | 'transparent'>('black');
  const [soft, setSoft] = useState(true);

  const [saving, setSaving] = useState(false);
  // 여러 기기 한 번에 (F8): 진행 상황과 결과
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [batchSaved, setBatchSaved] = useState<{
    key: string;
    count: number;
    bytes: number;
    shared: boolean;
  } | null>(null);
  const [shareFiles, setShareFiles] = useState<File[] | null>(null);
  const [saved, setSaved] = useState<(Saved & { key: string }) | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 만드는 사이 '누른 직후' 상태가 풀려 공유 화면이 막혔을 때, 다시 눌러 열 파일
  const [shareFile, setShareFile] = useState<File | null>(null);

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
        const preview = downscaled(bitmap, PREVIEW_MAX_SIDE, makeCanvas);
        setLoaded({ file, url, bitmap, preview, edges: sampleEdges(preview) });
        track('file_selected', {
          tool: 'photo',
          kind: 'image',
          mime: file.type,
          sizeBucket: sizeBucket(file.size),
          width: bitmap.width,
          height: bitmap.height,
        });
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
    zoom,
    background,
    format,
    quality,
    targetKb,
    circleOutside,
    soft,
  ]);
  const savedNow = saved && saved.key === settingsKey && current ? saved : null;

  const resolved = useMemo(
    () => (target ? resolveTarget(target, VISIBLE_PRESETS) : null),
    [target],
  );
  const source = bitmap ? { width: bitmap.width, height: bitmap.height } : null;
  const contain = mode === 'contain';
  const auto =
    contain && current && resolved && source
      ? suggestPosition(current.edges, fillAxis(source, resolved.size))
      : CENTER;
  const placed = position ?? auto;
  const zoomMax = contain && resolved && source ? maxZoom(source, resolved.size) : 1;
  const layout =
    resolved && source
      ? computeLayout(source, resolved.size, mode, placed, contain ? zoom : 1)
      : null;
  const fit = resolved && source ? ratioFit(source, resolved.size) : 'match';
  const isCircle = resolved?.shape === 'circle';
  const transparentCircle = isCircle && circleOutside === 'transparent';
  const feather = contain && soft ? FEATHER : 0;
  const effectiveFormat: OutputFormat = transparentCircle && format === 'jpeg' ? 'png' : format;
  // 목표 용량은 JPEG·WebP에서만 (PNG는 화질을 낮출 수 없다)
  const maxBytes = targetKb > 0 ? targetKb * 1000 : 0;

  function pickFile(next: File) {
    const kind = detectKind(next);
    if (kind.kind !== 'image') {
      setPickError('사진 파일이 아니에요. JPG · PNG · WebP · HEIC 사진을 골라 주세요.');
      return;
    }
    setPickError(null);
    setPlacements({});
    setFile(next);
  }

  function chooseTarget(next: Target) {
    track('preset_selected', {
      presetId: next.kind === 'preset' ? `${next.presetId}:${next.role}` : 'custom',
    });
    // 기기마다 맞춘 위치는 그대로 둔다 (다시 돌아오면 그 위치)
    setTarget(next);
  }

  function chooseMode(next: FitMode) {
    setMode(next);
    setPlacements({});
  }

  function toggleMine(t: Target) {
    const next = mine.some((m) => sameTarget(m, t))
      ? mine.filter((m) => !sameTarget(m, t))
      : [t, ...mine];
    setMine(next);
    writeJson(MINE_KEY, next);
  }

  const batchKey = JSON.stringify([
    mine,
    placements,
    mode,
    background,
    format,
    quality,
    targetKb,
    circleOutside,
    soft,
  ]);
  const batchNow = batchSaved && batchSaved.key === batchKey && current ? batchSaved : null;

  /** 내 기기 모두를 같은 설정으로 만들어 ZIP 하나로 (아이폰은 공유 화면으로 한 번에) */
  async function saveAll() {
    if (!bitmap || !file || !current || !source || mine.length < 2) return;
    if (SAVE_METHOD === 'unsupported' && IN_APP) {
      setSaveError(
        `${inAppLabel(IN_APP.app)} 안에서는 저장할 수 없어요. 맨 위의 안내대로 크롬 같은 다른 브라우저에서 열어 주세요.`,
      );
      return;
    }
    const started = performance.now();
    setSaveError(null);
    setShareFiles(null);
    setBatch({ done: 0, total: mine.length });
    try {
      const made: { name: string; blob: Blob }[] = [];
      for (const t of mine) {
        const r = resolveTarget(t, VISIBLE_PRESETS);
        if (!r) continue;
        const p = placements[targetKey(t)] ?? DEFAULT_PLACEMENT;
        const autoT = contain ? suggestPosition(current.edges, fillAxis(source, r.size)) : CENTER;
        const lay = computeLayout(source, r.size, mode, p.position ?? autoT, contain ? p.zoom : 1);
        const circle = r.shape === 'circle';
        const fmt: OutputFormat =
          circle && circleOutside === 'transparent' && format === 'jpeg' ? 'png' : format;
        const result = await renderPhoto(bitmap, {
          target: r.size,
          layout: lay,
          background,
          format: fmt,
          quality,
          feather,
          ...(circle ? { circleOutside } : {}),
          ...(maxBytes ? { maxBytes } : {}),
        });
        made.push({
          name: outputFileName(file.name, r.label, r.size, result.format),
          blob: result.blob,
        });
        setBatch({ done: made.length, total: mine.length });
      }
      const names = uniqueNames(made.map((m) => m.name));
      const files = made.map(
        (m, i) => new File([m.blob], names[i] ?? m.name, { type: m.blob.type }),
      );
      let bytes = files.reduce((sum, f) => sum + f.size, 0);
      const shared = SAVE_METHOD === 'share' && canShareAll(files);
      if (shared) {
        openShare(files, () => setShareFiles(files));
      } else {
        const zip = zipFiles(
          await Promise.all(
            files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })),
          ),
        );
        const blob = new Blob([zip.slice()], { type: 'application/zip' });
        bytes = blob.size;
        await download(
          blob,
          zipName(file.name, files.length),
          SAVE_METHOD === 'share' ? 'blob' : SAVE_METHOD,
        );
      }
      setBatchSaved({ key: batchKey, count: files.length, bytes, shared });
      track('export_done', {
        tool: 'photo',
        format: shared ? format : 'zip',
        count: files.length,
        sizeBytes: bytes,
        elapsedMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? `${error.message} 다시 시도해 주세요.`
          : '이미지를 만들지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      setBatch(null);
    }
  }

  async function save() {
    if (!bitmap || !layout || !resolved || !file || !target) return;
    if (SAVE_METHOD === 'unsupported' && IN_APP) {
      // 안드로이드 인앱 브라우저는 페이지가 만든 파일을 내려받지 못한다. 만들기 전에 알린다.
      setSaveError(
        `${inAppLabel(IN_APP.app)} 안에서는 저장할 수 없어요. 맨 위의 안내대로 크롬 같은 다른 브라우저에서 열어 주세요.`,
      );
      return;
    }
    setSaving(true);
    const started = performance.now();
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
        ...(maxBytes ? { maxBytes } : {}),
      });
      const name = outputFileName(file.name, resolved.label, resolved.size, result.format);
      setShareFile(null);
      if (SAVE_METHOD === 'share') {
        const made = new File([result.blob], name, { type: result.blob.type });
        openShare(made, () => setShareFile(made));
      } else {
        await download(result.blob, name, SAVE_METHOD);
      }
      setSaved({
        key: settingsKey,
        name,
        width: resolved.size.width,
        height: resolved.size.height,
        bytes: result.blob.size,
        fellBack: result.format !== effectiveFormat,
        shared: SAVE_METHOD === 'share',
        ...(result.fitted ? { fitted: result.fitted } : {}),
        ...(maxBytes ? { maxBytes } : {}),
      });
      track('export_done', {
        tool: 'photo',
        format: result.format,
        width: resolved.size.width,
        height: resolved.size.height,
        sizeBytes: result.blob.size,
        elapsedMs: Math.round(performance.now() - started),
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
              background={background}
              feather={feather}
              format={effectiveFormat}
              circleOutside={circleOutside}
              position={placed}
              onPositionChange={setPosition}
              showGuide={showGuide && resolved.guide !== null}
            />
          ) : current && imageUrl && !resolved && !fileError ? (
            // 기기를 고르기 전에도 고른 사진을 먼저 보여준다 (2026-10-10 사용자 요청)
            <figure className={styles.original}>
              <img src={imageUrl} alt="고른 사진 원본" />
              <figcaption>기기를 고르면 이 사진을 화면 모양대로 맞춰 보여드려요.</figcaption>
            </figure>
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
              {resolved.guide && (
                <label className={styles.guideToggle}>
                  <input
                    type="checkbox"
                    checked={showGuide}
                    onChange={(e) => setShowGuide(e.currentTarget.checked)}
                  />
                  잠금화면 시계·카메라 자리 보기
                  {showGuide && <span className={styles.hint}> 대략적인 위치예요</span>}
                </label>
              )}
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
                <p className={styles.hint}>
                  {position === null && (auto.x !== 0 || auto.y !== 0)
                    ? '사람이나 물건이 잘린 쪽은 화면 끝에 붙이고 반대쪽만 채웠어요. '
                    : ''}
                  사진을 끌어서 위치를 옮길 수 있어요.
                </p>
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
            targetKb={targetKb}
            onTargetKb={setTargetKb}
            isCircle={isCircle}
            circleOutside={circleOutside}
            onCircleOutside={setCircleOutside}
            soft={soft}
            onSoft={setSoft}
            zoom={zoom}
            zoomMax={zoomMax}
            onZoom={setZoom}
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
            {mine.length >= 2 && (
              <button
                type="button"
                className={styles.again}
                disabled={!current || saving || batch !== null}
                onClick={() => void saveAll()}
              >
                {batch
                  ? `${batch.total}개 중 ${batch.done + 1 > batch.total ? batch.total : batch.done + 1}개째 만드는 중…`
                  : `내 기기 ${mine.length}개 한 번에 저장`}
              </button>
            )}
            {batchNow && (
              <p className={styles.saved} role="status">
                {batchNow.shared
                  ? `${batchNow.count}개를 만들었어요`
                  : `${batchNow.count}개를 ZIP 하나로 저장했어요`}{' '}
                · {formatBytes(batchNow.bytes)}
              </p>
            )}
            {batchNow && shareFiles && (
              <button
                type="button"
                className={styles.again}
                onClick={() => openShare(shareFiles, () => undefined)}
              >
                사진 앱에 저장
              </button>
            )}
            {mine.length >= 2 && !batchNow && (
              <p className={styles.hint}>
                사진 위치와 크기는 기기마다 따로 기억해요. 기기를 바꿔 가며 맞춘 뒤 한 번에
                저장하세요.
              </p>
            )}
            {savedNow && (
              <p className={styles.saved} role="status">
                {savedNow.shared ? '만들었어요' : '저장했어요'} ·{' '}
                <span className={styles.num}>
                  {savedNow.width} × {savedNow.height}
                </span>{' '}
                · {formatBytes(savedNow.bytes)}
                {savedNow.fellBack && <> · 이 브라우저는 WebP를 만들 수 없어서 PNG로 저장했어요</>}
                {savedNow.fitted?.fits && (
                  <>
                    {' '}
                    · 목표 {targetLabel(savedNow.maxBytes ?? 0)} 이하 (화질{' '}
                    {Math.round(savedNow.fitted.quality * 100)})
                  </>
                )}
              </p>
            )}
            {savedNow && shareFile && (
              <button
                type="button"
                className={styles.again}
                onClick={() => openShare(shareFile, () => undefined)}
              >
                사진 앱에 저장
              </button>
            )}
            {SAVE_METHOD === 'share' && (
              <p className={styles.hint}>
                공유 화면에서 &lsquo;이미지 저장&rsquo;을 누르면 사진 앱에 들어가요.
              </p>
            )}
            {savedNow?.fitted && !savedNow.fitted.fits && (
              <p className={styles.error} role="alert">
                가장 낮은 화질로도 {formatBytes(savedNow.bytes)}예요. 화면 크기(
                {savedNow.width} × {savedNow.height})를 그대로 두면{' '}
                {targetLabel(savedNow.maxBytes ?? 0)} 이하로 줄일 수 없어요. 더 작은 기기나 크기를
                골라 주세요.
              </p>
            )}
            {targetKb > 0 && effectiveFormat === 'png' && (
              <p className={styles.hint}>
                PNG는 화질을 낮출 수 없어서 목표 용량은 JPG · WebP에서만 맞춰요.
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
