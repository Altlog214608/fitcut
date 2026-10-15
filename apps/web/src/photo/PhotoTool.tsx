import { VISIBLE_PRESETS } from '@fitcut/presets';
import { Koi, KoiPond } from '../components/Koi';
import { ImageUp, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { DropZone } from '../components/DropZone';
import { detectKind } from '../lib/detectKind';
import { IN_APP, SAVE_METHOD } from '../lib/inApp';
import { useT } from '../i18n/context';
import { readJson, writeJson } from '../lib/storage';
import { track } from '../lib/analytics';
import { sizeBucket } from '@fitcut/shared';
import { canShareAll, download, openShare } from '../lib/save';
import { targetKey, uniqueNames, zipFiles, zipName } from './batch';
import { targetLabel } from './targetSize';
import { pickFactor } from '../upscale/tiles';
import { canUpscale, upscale } from '../upscale/upscaleClient';
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

/** 저장에 걸린 시간 재기 (이벤트 핸들러 안에서만 부른다) */
const now = () => performance.now();

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function PhotoTool({ initialFile }: { initialFile: File | null }) {
  const replaceId = useId();
  const all = useT();
  const t = all.photo;
  const blockedMessage = () =>
    all.inApp.blocked(all.inApp.app(IN_APP?.app === 'kakaotalk' ? 'kakaotalk' : 'other'));
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
  // AI로 키운 사진 (F20). 같은 파일일 때만 쓴다
  const [ai, setAi] = useState<{
    file: File;
    factor: 2 | 4;
    bitmap: ImageBitmap;
    preview: CanvasImageSource & { width: number; height: number };
    edges: EdgeBusyness;
    ms: number;
    backend: string;
  } | null>(null);
  const [aiRun, setAiRun] = useState<{ done: number; total: number; backend: string } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiAbort = useRef<AbortController | null>(null);
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
          message: error instanceof Error ? error.message : '',
        });
      });
    return () => {
      cancelled = true;
      decoded?.close();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const decoded = loaded && loaded.file === file ? loaded : null;
  const enhanced = decoded && ai && ai.file === file ? ai : null;
  // AI로 키웠으면 그 사진으로 맞추고 저장한다 (원본 주소는 꽉 채우기의 흐린 바깥 표시에만 쓴다)
  const current =
    decoded && enhanced
      ? { ...decoded, bitmap: enhanced.bitmap, preview: enhanced.preview, edges: enhanced.edges }
      : decoded;
  const bitmap = current?.bitmap ?? null;
  const imageUrl = current?.url ?? null;
  const fileError =
    pickError ?? (decodeError?.file === file ? decodeError.message || t.openFailed : null);
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
      setPickError(t.notPhoto);
      return;
    }
    setPickError(null);
    setPlacements({});
    aiAbort.current?.abort();
    setAi(null);
    setAiError(null);
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

  const aiFactor =
    decoded && layout && !enhanced && layout.scale > 1.05
      ? pickFactor(decoded.bitmap.width, decoded.bitmap.height, layout.scale)
      : null;

  /** AI로 선명하게 키우기 (F20): 브라우저 안에서만, 진행률·취소 */
  async function enhance(factor: 2 | 4) {
    if (!decoded || !file) return;
    const controller = new AbortController();
    aiAbort.current = controller;
    setAiError(null);
    setAiRun({ done: 0, total: 0, backend: '' });
    try {
      const r = await upscale(
        decoded.bitmap,
        factor,
        (done, total, backend) => setAiRun({ done, total, backend }),
        controller.signal,
      );
      const preview = downscaled(r.bitmap, PREVIEW_MAX_SIDE, makeCanvas);
      setAi({
        file,
        factor,
        bitmap: r.bitmap,
        preview,
        edges: sampleEdges(preview),
        ms: r.ms,
        backend: r.backend,
      });
      setPlacements({});
    } catch (error) {
      if (!(error as { cancelled?: boolean }).cancelled) {
        setAiError(error instanceof Error ? error.message : t.aiFailed);
      }
    } finally {
      setAiRun(null);
    }
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
      setSaveError(blockedMessage());
      return;
    }
    const started = now();
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
        elapsedMs: Math.round(now() - started),
      });
    } catch (error) {
      setSaveError(error instanceof Error ? t.retry(error.message) : t.saveFailed);
    } finally {
      setBatch(null);
    }
  }

  async function save() {
    if (!bitmap || !layout || !resolved || !file || !target) return;
    if (SAVE_METHOD === 'unsupported' && IN_APP) {
      // 안드로이드 인앱 브라우저는 페이지가 만든 파일을 내려받지 못한다. 만들기 전에 알린다.
      setSaveError(blockedMessage());
      return;
    }
    setSaving(true);
    const started = now();
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
        elapsedMs: Math.round(now() - started),
      });
      const nextRecent = pushRecent(recent, target);
      setRecent(nextRecent);
      writeJson(RECENT_KEY, nextRecent);
    } catch (error) {
      setSaveError(error instanceof Error ? t.retry(error.message) : t.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  if (!file) {
    return (
      <div className={styles.empty}>
        <h1 className={styles.title}>{t.title}</h1>
        <p className={styles.lead}>{t.lead}</p>
        <DropZone
          title={t.dropTitle}
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
          {t.trust}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.tool}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>{t.title}</h1>
          <p className={styles.fileInfo}>
            <span className={styles.fileName}>{file.name}</span>
            {source && (
              <span className={styles.num}>{t.original(source.width, source.height)}</span>
            )}
          </p>
        </div>
        <label htmlFor={replaceId} className={styles.replace}>
          <ImageUp size={18} strokeWidth={1.75} />
          {t.replace}
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
              <img src={imageUrl} alt={t.originalAlt} />
              <figcaption>{t.originalCaption}</figcaption>
            </figure>
          ) : (
            <div className={styles.placeholder}>
              {fileError ? (
                <p className={styles.error} role="alert">
                  {fileError}
                </p>
              ) : !resolved ? (
                <p>{t.pickDevice}</p>
              ) : (
                <p>{t.opening}</p>
              )}
            </div>
          )}
        </div>

        <div className={styles.below}>
          {layout && resolved && (
            <div className={styles.notices}>
              {resolved.guide && (
                <label className={styles.guideToggle}>
                  <input
                    type="checkbox"
                    checked={showGuide}
                    onChange={(e) => setShowGuide(e.currentTarget.checked)}
                  />
                  {t.guideToggle}
                  {showGuide && <span className={styles.hint}> {t.guideHint}</span>}
                </label>
              )}
              {mode === 'cover' && fit !== 'match' && (
                <p className={styles.notice}>
                  {fit === 'sides-cropped' ? t.sidesCropped : t.topBottomCropped}{' '}
                  <button type="button" onClick={() => chooseMode('contain')}>
                    {t.fitWhole}
                  </button>
                </p>
              )}
              {layout.scale > 1.05 && (
                <p className={styles.notice}>
                  {t.upscaled(layout.scale.toFixed(1))}{' '}
                  {aiFactor && canUpscale() && !aiRun && (
                    <button type="button" onClick={() => void enhance(aiFactor)}>
                      {t.aiEnhance(aiFactor)}
                    </button>
                  )}
                </p>
              )}
              {aiFactor && !aiRun && !enhanced && <p className={styles.hint}>{t.aiFirst}</p>}
              {aiRun && (
                <p className={styles.notice} role="status">
                  <KoiPond size={28} className={styles.inlineKoi} />
                  {t.aiRunning}{' '}
                  {aiRun.total > 0 && (
                    <b className={styles.num}>{Math.round((aiRun.done / aiRun.total) * 100)}%</b>
                  )}
                  {aiRun.backend === 'cpu' && t.aiCpu}{' '}
                  <button type="button" onClick={() => aiAbort.current?.abort()}>
                    {t.cancel}
                  </button>
                </p>
              )}
              {enhanced && (
                <p className={styles.hint} role="status">
                  {t.aiDone(
                    enhanced.factor,
                    enhanced.bitmap.width,
                    enhanced.bitmap.height,
                    (enhanced.ms / 1000).toFixed(1),
                  )}{' '}
                  <button type="button" className={styles.linkButton} onClick={() => setAi(null)}>
                    {t.aiUndo}
                  </button>
                </p>
              )}
              {aiError && (
                <p className={styles.error} role="alert">
                  {aiError}
                </p>
              )}
              {(layout.movable.x || layout.movable.y) && (
                <p className={styles.hint}>
                  {position === null && (auto.x !== 0 || auto.y !== 0) ? t.autoPlaced : ''}
                  {t.dragHint}
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
          {transparentCircle && format === 'jpeg' && <p className={styles.hint}>{t.jpgNoAlpha}</p>}

          <div className={styles.saveBar}>
            <button
              type="button"
              className={styles.save}
              disabled={!layout || saving}
              onClick={() => void save()}
            >
              {saving ? t.saving : t.save}
            </button>
            {mine.length >= 2 && (
              <button
                type="button"
                className={styles.again}
                disabled={!current || saving || batch !== null}
                onClick={() => void saveAll()}
              >
                {batch
                  ? t.batchProgress(Math.min(batch.done + 1, batch.total), batch.total)
                  : t.batchSave(mine.length)}
              </button>
            )}
            {batchNow && (
              <p className={styles.saved} role="status">
                <Koi mood="happy" size={22} className={styles.inlineKoi} />
                {batchNow.shared
                  ? t.batchShared(batchNow.count)
                  : t.batchZipped(batchNow.count)} · {formatBytes(batchNow.bytes)}
              </p>
            )}
            {batchNow && shareFiles && (
              <button
                type="button"
                className={styles.again}
                onClick={() => openShare(shareFiles, () => undefined)}
              >
                {t.saveToPhotos}
              </button>
            )}
            {mine.length >= 2 && !batchNow && <p className={styles.hint}>{t.batchHint}</p>}
            {savedNow && (
              <p className={styles.saved} role="status">
                <Koi mood="happy" size={22} className={styles.inlineKoi} />
                {savedNow.shared ? t.made : t.savedDone} ·{' '}
                <span className={styles.num}>
                  {savedNow.width} × {savedNow.height}
                </span>{' '}
                · {formatBytes(savedNow.bytes)}
                {savedNow.fellBack && <> · {t.webpFallback}</>}
                {savedNow.fitted?.fits && (
                  <>
                    {' '}
                    ·{' '}
                    {t.fittedTo(
                      targetLabel(savedNow.maxBytes ?? 0),
                      Math.round(savedNow.fitted.quality * 100),
                    )}
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
                {t.saveToPhotos}
              </button>
            )}
            {SAVE_METHOD === 'share' && <p className={styles.hint}>{t.shareHint}</p>}
            {savedNow?.fitted && !savedNow.fitted.fits && (
              <p className={styles.error} role="alert">
                {t.cannotFit(
                  formatBytes(savedNow.bytes),
                  savedNow.width,
                  savedNow.height,
                  targetLabel(savedNow.maxBytes ?? 0),
                )}
              </p>
            )}
            {targetKb > 0 && effectiveFormat === 'png' && (
              <p className={styles.hint}>{t.pngNoTarget}</p>
            )}
            {saveError && (
              <p className={styles.error} role="alert">
                {saveError}
              </p>
            )}
            <p className={styles.trust}>
              <ShieldCheck size={18} strokeWidth={1.75} />
              {t.trust}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
