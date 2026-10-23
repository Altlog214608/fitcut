/**
 * 리플레이 데모 (ADR-045): 로그인 없이 예시 방송의 채팅 흐름을 시간 순서대로 재생하며,
 * 서버와 같은 점수 계산으로 그때까지 들어온 채팅만 보고 하이라이트를 찾는 모습을 보여준다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  candidatesAt,
  foundScenes,
  replayEvents,
  sampleReplay,
  trackDetections,
  type Candidate,
  type Detection,
} from '@koicut/shared';
import { clock } from './timeline';
import { useT } from '../i18n/context';
import styles from './Replay.module.css';

const SPEEDS = [1, 10, 60] as const;
const TICK_MS = 250;

type Play = { t: number; playing: boolean; detections: Detection[] };

export function Replay() {
  const dict = useT();
  const t = dict.highlight;
  const data = useMemo(() => sampleReplay(), []);
  const events = useMemo(() => replayEvents(data), [data]);
  const end = data.durationSec;
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(10);
  const [play, setPlay] = useState<Play>({ t: 0, playing: false, detections: [] });
  const sec = Math.floor(play.t);
  const finished = sec >= end;
  const { detections, playing } = play;

  /** to초까지 1초씩 따라가며 처음 감지한 때를 기록한다 (끝만 계산하면 언제 감지했는지 알 수 없다) */
  const advance = useCallback(
    (p: Play, to: number): Play => {
      const t = Math.min(end, to);
      let d = p.detections;
      for (let s = Math.floor(p.t) + 1; s <= Math.floor(t); s++)
        d = trackDetections(d, candidatesAt(events, s), s);
      return { t, playing: p.playing && t < end, detections: d };
    },
    [events, end],
  );

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () => setPlay((p) => advance(p, p.t + (TICK_MS / 1000) * speed)),
      TICK_MS,
    );
    return () => window.clearInterval(timer);
  }, [playing, speed, advance]);

  // 지금까지(sec초) 들어온 채팅만 보고 찾은 후보
  const candidates = useMemo(() => (sec > 0 ? candidatesAt(events, sec) : []), [events, sec]);

  const toggle = () =>
    setPlay((p) =>
      finished ? { t: 0, playing: true, detections: [] } : { ...p, playing: !p.playing },
    );
  // 30분을 1초씩 따라가도 1초 안팎이다
  const skip = () => setPlay((p) => ({ ...advance(p, end), playing: false }));

  // 그래프 높이는 끝까지의 최댓값에 맞춰 두고, 지난 10초 칸만 그린다
  const all = useMemo(
    () =>
      Array.from({ length: Math.ceil(end / 10) }, (_, k) => sum(data.chat, k * 10, k * 10 + 10)),
    [data, end],
  );
  const max = Math.max(1, ...all);
  const per10 = all.slice(0, Math.floor(sec / 10));
  const recent = sum(data.chat, Math.max(0, sec - 10), sec);
  const total = sum(data.chat, 0, sec);

  const w = 600;
  const h = 80;
  const x = (s: number) => (s / end) * w;
  const points = per10
    .map((v, i) => `${x(i * 10).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(' ');
  const ordered = [...candidates].sort((a, b) => a.start - b.start);
  const detectedAt = (c: Candidate) =>
    detections.find((d) => Math.abs(d.peak - c.peak) < 30)?.at ?? sec;

  const scenes = data.scenes ?? [];
  const found = foundScenes(scenes, candidates);
  const top5 = candidates.slice(0, 5).filter((c) => foundScenes(scenes, [c]).length > 0).length;

  return (
    <div className={styles.replay}>
      <p className={styles.meta}>{t.replayLead}</p>

      <div className={styles.controls}>
        <button type="button" className={styles.primary} onClick={toggle}>
          {finished
            ? t.replayAgain
            : playing
              ? t.replayPause
              : sec > 0
                ? t.replayResume
                : t.replayPlay}
        </button>
        <div className={styles.speeds} role="group" aria-label={t.speed}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.speed}
              aria-pressed={speed === s}
              onClick={() => setSpeed(s)}
            >
              {t.speedX(s)}
            </button>
          ))}
        </div>
        {!finished && (
          <button type="button" className={styles.ghost} onClick={skip}>
            {t.skip}
          </button>
        )}
      </div>

      <p className={styles.status} aria-live="off">
        <b className={styles.time}>
          {clock(sec)} / {clock(end)}
        </b>
        <span className={styles.meta}>
          {t.replayCounts(recent, total.toLocaleString(dict.locale))}
        </span>
      </p>

      <svg
        className={styles.graph}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t.replayGraph}
      >
        {candidates.map((c) => (
          <rect
            key={c.peak}
            className={styles.band}
            x={x(c.start)}
            width={Math.max(2, x(c.end - c.start))}
            y={0}
            height={h}
          />
        ))}
        {per10.length > 1 && <polyline className={styles.line} points={points} />}
        <line className={styles.cursor} x1={x(sec)} x2={x(sec)} y1={0} y2={h} />
      </svg>

      {ordered.length === 0 ? (
        <p className={styles.meta}>{t.replayNone}</p>
      ) : (
        <ol className={styles.list} aria-label={t.replayFound}>
          {ordered.map((c) => (
            <li key={c.peak} className={styles.item}>
              <b className={styles.time}>
                {clock(c.start)} – {clock(c.end)}
              </b>
              <span className={styles.meta}>
                {t.detectedAt(clock(detectedAt(c)))} · {t.chat} {c.counts.chat} · {t.reaction}{' '}
                {c.counts.reaction}
                {c.counts.donation > 0 && ` · ${t.donation} ${c.counts.donation}`}
                {c.counts.subscription > 0 && ` · ${t.subscription} ${c.counts.subscription}`}
              </span>
              {c.rank <= 3 && <span className={styles.badge}>{t.rank(c.rank)}</span>}
            </li>
          ))}
        </ol>
      )}

      {finished && scenes.length > 0 && (
        <div className={styles.summary} role="status">
          <b>{t.replaySummary(scenes.length, found.length)}</b>
          <span className={styles.meta}>{t.replayTop5(top5)}</span>
          <ul className={styles.scenes}>
            {scenes.map((s) => (
              <li key={s.t}>
                {clock(s.t)} {t.sceneLabel(s.label)} · {found.includes(s) ? t.foundYes : t.foundNo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function sum(x: readonly number[], a: number, b: number) {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] ?? 0;
  return s;
}
