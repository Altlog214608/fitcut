import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  scaleLayout,
  type FitMode,
  type Layout,
  type Position,
  type Rect,
  type Size,
} from './layout';
import styles from './Preview.module.css';
import { drawPhoto, type Background, type CanvasFactory } from './render';
import type { OutputFormat } from './fileName';
import type { ResolvedTarget } from './target';

type Props = {
  /** 미리보기용으로 줄인 사진 (저장은 원본으로 한다) */
  source: CanvasImageSource & { width: number; height: number };
  /** 꽉 채우기에서 잘려 나가는 부분을 흐릿하게 보여줄 때 쓰는 원본 주소 */
  imageUrl: string;
  target: ResolvedTarget;
  layout: Layout;
  mode: FitMode;
  background: Background;
  feather: number;
  format: OutputFormat;
  circleOutside: 'black' | 'transparent';
  position: Position;
  onPositionChange: (position: Position) => void;
};

const makeCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

function rectStyle(rect: Rect, size: Size): CSSProperties {
  return {
    left: `${(rect.x / size.width) * 100}%`,
    top: `${(rect.y / size.height) * 100}%`,
    width: `${(rect.width / size.width) * 100}%`,
    height: `${(rect.height / size.height) * 100}%`,
  };
}

const clamp = (v: number) => Math.min(1, Math.max(-1, v));

/** 움직일 수 있는 길이(목표 px)와 방향. cover는 사진을 끌면 반대 방향으로 위치 값이 바뀐다. */
function freeSpace(layout: Layout, size: Size, mode: FitMode) {
  const { image } = layout;
  return {
    x: layout.movable.x ? Math.abs(image.width - size.width) : 0,
    y: layout.movable.y ? Math.abs(image.height - size.height) : 0,
    sign: mode === 'cover' ? -1 : 1,
  };
}

export function Preview({
  source,
  imageUrl,
  target,
  layout,
  mode,
  background,
  feather,
  format,
  circleOutside,
  position,
  onPositionChange,
}: Props) {
  const { size, shape } = target;
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; start: Position; k: number } | null>(null);
  const [screenWidth, setScreenWidth] = useState(0);

  useEffect(() => {
    const el = screenRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setScreenWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 저장할 때와 같은 함수(drawPhoto)로 화면 크기에 맞춰 그린다. 미리보기 = 결과.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || screenWidth === 0) return;
    const frame = requestAnimationFrame(() => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(screenWidth * ratio));
      const height = Math.max(1, Math.round((width * size.height) / size.width));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      drawPhoto(
        ctx,
        source,
        {
          target: { width, height },
          layout: scaleLayout(layout, width / size.width),
          background,
          format,
          quality: 1,
          feather,
          ...(shape === 'circle' ? { circleOutside } : {}),
        },
        makeCanvas,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [source, layout, background, feather, format, circleOutside, shape, size, screenWidth]);

  const free = freeSpace(layout, size, mode);
  const canMove = free.x > 0 || free.y > 0;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canMove || !screenRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const k = screenRef.current.getBoundingClientRect().width / size.width;
    drag.current = { x: event.clientX, y: event.clientY, start: position, k };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.k === 0) return;
    const dx = (event.clientX - d.x) / d.k;
    const dy = (event.clientY - d.y) / d.k;
    onPositionChange({
      x: free.x > 0 ? clamp(d.start.x + (free.sign * dx * 2) / free.x) : d.start.x,
      y: free.y > 0 ? clamp(d.start.y + (free.sign * dy * 2) / free.y) : d.start.y,
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = 0.1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    // 키보드는 "사진을 그 방향으로 옮긴다"로 맞춘다
    onPositionChange({
      x: free.x > 0 ? clamp(position.x + free.sign * d[0]) : position.x,
      y: free.y > 0 ? clamp(position.y + free.sign * d[1]) : position.y,
    });
  }

  const isDevice = target.preset !== null;
  const radius =
    shape === 'circle'
      ? 0
      : shape === 'rounded-rect'
        ? (target.cornerRadiusRatio ?? 0.22)
        : isDevice && target.preset?.category !== 'tablet'
          ? 0.09
          : 0;

  const frameStyle = { '--ratio': size.width / size.height } as CSSProperties;
  const screenStyle: CSSProperties = {
    borderRadius: `${radius * 100}% / ${radius * 100 * (size.width / size.height)}%`,
  };

  return (
    <div className={styles.stage}>
      <div className={styles.frame} style={frameStyle}>
        {mode === 'cover' && (
          <img
            className={styles.ghost}
            src={imageUrl}
            alt=""
            style={rectStyle(layout.image, size)}
            draggable={false}
          />
        )}
        <div
          ref={screenRef}
          className={styles.screen}
          data-device={isDevice || undefined}
          data-shape={shape}
          data-transparent={(shape === 'circle' && circleOutside === 'transparent') || undefined}
          data-movable={canMove || undefined}
          style={screenStyle}
          tabIndex={canMove ? 0 : -1}
          role={canMove ? 'slider' : undefined}
          aria-label={canMove ? '사진 위치. 끌거나 화살표 키로 옮겨요' : undefined}
          aria-valuetext={
            canMove
              ? `가로 ${Math.round(position.x * 100)}, 세로 ${Math.round(position.y * 100)}`
              : undefined
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={onKeyDown}
        >
          <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
