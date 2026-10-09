import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { toCss, type Rgb } from './colors';
import type { FitMode, Layout, Position, Rect, Size } from './layout';
import styles from './Preview.module.css';
import type { Background } from './render';
import type { ResolvedTarget } from './target';

type Props = {
  imageUrl: string;
  target: ResolvedTarget;
  layout: Layout;
  mode: FitMode;
  background: Background;
  edge: { x: [Rgb, Rgb]; y: [Rgb, Rgb] } | null;
  circleOutside: 'black' | 'transparent';
  position: Position;
  onPositionChange: (position: Position) => void;
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
  const sign = mode === 'cover' ? -1 : 1;
  return {
    x: layout.movable.x ? Math.abs(image.width - size.width) : 0,
    y: layout.movable.y ? Math.abs(image.height - size.height) : 0,
    sign,
  };
}

export function Preview({
  imageUrl,
  target,
  layout,
  mode,
  background,
  edge,
  circleOutside,
  position,
  onPositionChange,
}: Props) {
  const { size, shape } = target;
  const screenRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; start: Position; k: number } | null>(null);
  const [screenWidth, setScreenWidth] = useState(0);

  useEffect(() => {
    const el = screenRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setScreenWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const free = freeSpace(layout, size, mode);
  const canMove = free.x > 0 || free.y > 0;

  function move(dxTarget: number, dyTarget: number, start: Position) {
    onPositionChange({
      x: free.x > 0 ? clamp(start.x + (free.sign * dxTarget * 2) / free.x) : start.x,
      y: free.y > 0 ? clamp(start.y + (free.sign * dyTarget * 2) / free.y) : start.y,
    });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canMove || !screenRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const k = screenRef.current.getBoundingClientRect().width / size.width;
    drag.current = { x: event.clientX, y: event.clientY, start: position, k };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.k === 0) return;
    move((event.clientX - d.x) / d.k, (event.clientY - d.y) / d.k, d.start);
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

  // 내보낼 때의 흐림(축소 배율)을 미리보기 크기에 맞춘 대략값
  const blurPx =
    background.kind === 'blur' && screenWidth
      ? ((6 + background.strength * 42) * 0.6 * screenWidth) / size.width
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
          {layout.background && background.kind === 'blur' && (
            <>
              <img
                className={styles.layer}
                src={imageUrl}
                alt=""
                style={{ ...rectStyle(layout.background, size), filter: `blur(${blurPx}px)` }}
                draggable={false}
              />
              <div
                className={styles.fill}
                style={{ background: `rgb(0 0 0 / ${background.dim})` }}
              />
            </>
          )}
          {layout.background && background.kind === 'solid' && (
            <div className={styles.fill} style={{ background: background.color }} />
          )}
          {layout.background && background.kind === 'edge' && edge && (
            <div
              className={styles.fill}
              style={{
                background: layout.movable.y
                  ? `linear-gradient(${toCss(edge.y[0])} 50%, ${toCss(edge.y[1])} 50%)`
                  : `linear-gradient(90deg, ${toCss(edge.x[0])} 50%, ${toCss(edge.x[1])} 50%)`,
              }}
            />
          )}
          <img
            className={styles.layer}
            src={imageUrl}
            alt=""
            style={rectStyle(layout.image, size)}
            draggable={false}
          />
          {shape === 'circle' && <div className={styles.circleMask} data-outside={circleOutside} />}
        </div>
      </div>
    </div>
  );
}
