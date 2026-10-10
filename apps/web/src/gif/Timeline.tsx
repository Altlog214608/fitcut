import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatTime, moveEnd, moveStart, type Range } from './time';
import styles from './Timeline.module.css';

type Props = {
  duration: number;
  range: Range;
  /** 재생 위치(초) */
  current: number;
  /** 한 프레임 길이(초) */
  frame: number;
  thumbnails: readonly (string | undefined)[];
  /** 음성 도구: 썸네일 대신 파형 (0~1) */
  waveform?: readonly number[] | null;
  onRange: (range: Range) => void;
  onSeek: (t: number) => void;
};

type Drag = 'start' | 'end' | 'seek';

/** 가장 크게 확대했을 때 화면에 보이는 길이(초) */
const MIN_VIEW_SECONDS = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 구간 타임라인 (FEATURES F4): 썸네일 스트립, 시작·끝 핸들, 재생 위치, 확대.
 * 핸들은 slider 역할이라 포커스한 뒤 화살표로 1프레임(Shift는 1초)씩 옮길 수 있다.
 */
export function Timeline({
  duration,
  range,
  current,
  frame,
  thumbnails,
  waveform,
  onRange,
  onSeek,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);

  const maxZoom = Math.max(1, duration / MIN_VIEW_SECONDS);
  const span = duration / zoom;
  const view = clamp(viewStart, 0, Math.max(0, duration - span));
  const pct = (t: number) => ((t - view) / span) * 100;

  function timeAt(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp(view + ((clientX - rect.left) / rect.width) * span, 0, duration);
  }

  function apply(kind: Drag, t: number) {
    if (kind === 'start') onRange(moveStart(range, t, frame));
    else if (kind === 'end') onRange(moveEnd(range, t, frame, duration));
    else onSeek(t);
  }

  function startDrag(kind: Drag, e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = kind;
    trackRef.current?.setPointerCapture(e.pointerId);
    // 핸들을 누른 것만으로는 옮기지 않는다 (손가락 위치가 핸들 가운데가 아닐 수 있다)
    if (kind === 'seek') apply(kind, timeAt(e.clientX));
    else e.currentTarget.focus();
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    if (drag.current) apply(drag.current, timeAt(e.clientX));
  }

  function up(e: PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (trackRef.current?.hasPointerCapture(e.pointerId)) {
      trackRef.current.releasePointerCapture(e.pointerId);
    }
  }

  function handleKey(kind: 'start' | 'end') {
    return (e: KeyboardEvent<HTMLButtonElement>) => {
      const step = e.shiftKey ? 1 : frame;
      const value = kind === 'start' ? range.start : range.end;
      let next: number | null = null;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step;
      else if (e.key === 'Home') next = kind === 'start' ? 0 : range.start;
      else if (e.key === 'End') next = kind === 'start' ? range.end : duration;
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation(); // 도구 전체의 ←/→(재생 위치 이동)와 겹치지 않게
      apply(kind, next);
    };
  }

  function changeZoom(next: number) {
    // 확대하면 고른 구간이 가운데 오게 한다
    const nextSpan = duration / next;
    setViewStart((range.start + range.end) / 2 - nextSpan / 2);
    setZoom(next);
  }

  const visible = (t: number) => t >= view - span && t <= view + 2 * span;
  const slot = duration / Math.max(1, thumbnails.length);

  return (
    <div className={styles.timeline}>
      <div
        ref={trackRef}
        className={styles.track}
        onPointerDown={(e) => startDrag('seek', e)}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        data-testid="timeline-track"
      >
        {waveform && waveform.length > 0 && (
          <svg
            className={styles.wave}
            viewBox={`0 0 ${waveform.length} 100`}
            preserveAspectRatio="none"
            aria-hidden="true"
            style={{
              left: `${pct(0)}%`,
              width: `${(duration / span) * 100}%`,
            }}
          >
            {waveform.map((v, i) => (
              <rect key={i} x={i} width={0.8} y={50 - v * 46} height={Math.max(1, v * 92)} />
            ))}
          </svg>
        )}
        <div className={styles.thumbs} aria-hidden="true">
          {thumbnails.map((url, i) =>
            url && visible(i * slot) ? (
              <img
                key={i}
                src={url}
                alt=""
                className={styles.thumb}
                style={{ left: `${pct(i * slot)}%`, width: `${(slot / span) * 100}%` }}
                draggable={false}
              />
            ) : null,
          )}
        </div>
        <div
          className={styles.dim}
          style={{ left: 0, width: `${clamp(pct(range.start), 0, 100)}%` }}
        />
        <div
          className={styles.dim}
          style={{ left: `${clamp(pct(range.end), 0, 100)}%`, right: 0 }}
        />
        <div
          className={styles.selection}
          style={{ left: `${pct(range.start)}%`, width: `${pct(range.end) - pct(range.start)}%` }}
        />
        <div className={styles.playhead} style={{ left: `${pct(current)}%` }} />
        <button
          type="button"
          role="slider"
          aria-label="시작"
          aria-valuemin={0}
          aria-valuemax={range.end}
          aria-valuenow={range.start}
          aria-valuetext={formatTime(range.start)}
          className={`${styles.handle} ${styles.startHandle}`}
          style={{ left: `${pct(range.start)}%` }}
          onPointerDown={(e) => startDrag('start', e)}
          onKeyDown={handleKey('start')}
        />
        <button
          type="button"
          role="slider"
          aria-label="끝"
          aria-valuemin={range.start}
          aria-valuemax={duration}
          aria-valuenow={range.end}
          aria-valuetext={formatTime(range.end)}
          className={`${styles.handle} ${styles.endHandle}`}
          style={{ left: `${pct(range.end)}%` }}
          onPointerDown={(e) => startDrag('end', e)}
          onKeyDown={handleKey('end')}
        />
      </div>
      {maxZoom > 1.5 && (
        <label className={styles.zoom}>
          <span>확대</span>
          <input
            type="range"
            min={1}
            max={maxZoom}
            step="any"
            value={zoom}
            onChange={(e) => changeZoom(Number(e.currentTarget.value))}
          />
        </label>
      )}
    </div>
  );
}
