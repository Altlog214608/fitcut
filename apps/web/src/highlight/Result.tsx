/**
 * 방송 하나의 하이라이트 결과. 그래프, 후보 목록, 유튜브 댓글용 타임라인 복사, 편집용 마커 파일, 녹화 파일.
 * - 모드 A(채팅): 시각은 수집 시작 기준. 방송을 켠 뒤 수집을 누르기까지 걸린 시간을 넣으면 다시보기 시각이 된다
 * - 모드 B: 녹화 파일을 올리면 소리도 함께 분석할 수 있다 (시각 맞추기 값으로 소리와 채팅을 맞춘다)
 * - 모드 C(녹화 파일만): 시각은 녹화 파일 기준. 올린 뒤 소리 크기로 후보를 찾는다 (ADR-044)
 */
import { useEffect, useState } from 'react';
import { Recording } from './Recording';
import { analyzeSound, getBroadcast, StreamerError, type BroadcastDetail } from './streamer';
import { SAVE_METHOD } from '../lib/inApp';
import { download } from '../lib/save';
import { clock, markerFile, parseClock, timelineText, type MarkerFormat } from './timeline';
import { useT } from '../i18n/context';
import type { Dict } from '../i18n/ko';
import styles from './Result.module.css';

const POLL_MS = 15_000;

const MARKERS: MarkerFormat[] = ['csv', 'srt', 'audacity'];

/** 서버 오류 원문 */
const serverMessage = (e: unknown) =>
  e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.';

function Graph({ detail, t }: { detail: BroadcastDetail; t: Dict['highlight'] }) {
  // 채팅이 없으면(모드 C) 소리 크기를 그린다. dB는 -70을 바닥으로 본다
  const sound = detail.source === 'file' && !!detail.loudPer10s?.length;
  const data = sound
    ? (detail.loudPer10s ?? []).map((v) => Math.max(0, v + 70))
    : detail.chatPer10s;
  if (data.length < 2) return null;
  const max = Math.max(1, ...data);
  const w = 600;
  const h = 80;
  const x = (i: number) => (i / (data.length - 1)) * w;
  const points = data
    .map((v, i) => `${x(i).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(' ');
  const total = (data.length - 1) * 10;
  return (
    <svg
      className={styles.graph}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={t.graphLabel(sound)}
    >
      {detail.candidates.map((c) => (
        <rect
          key={c.rank}
          className={styles.band}
          x={(c.start / total) * w}
          width={Math.max(2, ((c.end - c.start) / total) * w)}
          y={0}
          height={h}
        />
      ))}
      <polyline className={styles.line} points={points} />
    </svg>
  );
}

export function Result({ id }: { id: string }) {
  const all = useT();
  const t = all.highlight;
  const count = (n: number) => n.toLocaleString(all.locale);
  const errorText = (e: unknown) => all.apiError('', serverMessage(e));
  const [detail, setDetail] = useState<BroadcastDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 불러오기 실패 (서버 원문, 그릴 때 번역) */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offsetText, setOffsetText] = useState('0:00');
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    // 분석 중이면 15초마다 다시 본다 (수집이 끝나고 3~4분, 소리 분석은 파일 길이에 따라 몇 분)
    const load = () =>
      getBroadcast(id)
        .then((d) => {
          if (!alive) return;
          setDetail(d);
          const waiting =
            d.analysisStatus === 'running' || (d.source !== 'file' && d.analysisStatus !== 'done');
          if (waiting) timer = window.setTimeout(load, POLL_MS);
        })
        .catch((e: unknown) => {
          if (alive) setLoadError(serverMessage(e));
        });
    void load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [id, reload]);

  if (!detail)
    return (
      <p className={styles.meta}>
        {loadError ? all.apiError('', loadError) : (error ?? t.loadingResult)}
      </p>
    );

  const file = detail.source === 'file';
  const offset = file ? 0 : parseClock(offsetText);
  const shift = offset ?? 0;
  const ordered = [...detail.candidates].sort((a, b) => a.start - b.start);
  const done = detail.analysisStatus === 'done';

  async function askSound() {
    setAsking(true);
    setError(null);
    try {
      await analyzeSound(id, shift);
      setDetail((d) => (d ? { ...d, analysisStatus: 'running' } : d));
      setReload((n) => n + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAsking(false);
    }
  }

  function saveMarkers(format: MarkerFormat) {
    if (!detail) return;
    const { text, ext, type } = markerFile(detail.candidates, shift, format, t.fileWords);
    // iOS 인앱 브라우저는 blob 다운로드를 못 한다 (lib/inApp.ts)
    void download(
      new Blob([text], { type }),
      `koicut-highlight-${detail.id}.${ext}`,
      SAVE_METHOD === 'data-url' ? 'data-url' : 'blob',
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        timelineText(detail?.candidates ?? [], shift, t.fileWords),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t.copyFailed);
    }
  }

  const recording = (
    <Recording
      id={detail.id}
      candidates={done ? detail.candidates : []}
      offset={shift}
      onOffset={(sec) => setOffsetText(clock(sec))}
      syncable={!file}
      sound={{
        label: file ? t.soundFind : detail.loudPer10s ? t.soundReanalyze : t.soundAnalyze,
        busy: asking || detail.analysisStatus === 'running',
        onClick: () => void askSound(),
      }}
    />
  );

  if (detail.analysisStatus === 'running' || (!file && !done)) {
    return (
      <div className={styles.result}>
        <p className={styles.meta} role="status">
          {detail.analysisStatus === 'running' && detail.chatCount === 0
            ? t.analyzingSound
            : t.analyzing}
        </p>
      </div>
    );
  }

  if (file && !done) {
    return (
      <div className={styles.result}>
        <p className={styles.meta}>{t.fileIntro}</p>
        {recording}
      </div>
    );
  }

  return (
    <div className={styles.result}>
      <Graph detail={detail} t={t} />
      {detail.candidates.length === 0 ? (
        <p className={styles.meta}>{file ? t.noSoundPeak : t.noChatPeak}</p>
      ) : (
        <>
          {!file && (
            <>
              <label className={styles.offset}>
                <span>{t.offsetLabel}</span>
                <input
                  inputMode="numeric"
                  value={offsetText}
                  onChange={(e) => setOffsetText(e.target.value)}
                  aria-invalid={offset === null}
                  aria-describedby="offset-help"
                />
              </label>
              <p id="offset-help" className={styles.meta}>
                {offset === null ? t.offsetBad : t.offsetHelp}
              </p>
            </>
          )}
          <ol className={styles.list} aria-label={t.candidates}>
            {ordered.map((c) => (
              <li key={c.rank} className={styles.item}>
                <b className={styles.time}>
                  {clock(c.start + shift)} – {clock(c.end + shift)}
                </b>
                <span className={styles.meta}>
                  {file
                    ? t.sound(c.counts.loudness ?? 0)
                    : `${t.chat} ${count(c.counts.chat)} · ${t.reaction} ${count(c.counts.reaction)}`}
                  {c.counts.donation > 0 && ` · ${t.donation} ${count(c.counts.donation)}`}
                  {c.counts.subscription > 0 &&
                    ` · ${t.subscription} ${count(c.counts.subscription)}`}
                  {!file && c.counts.loudness !== undefined && ` · ${t.sound(c.counts.loudness)}`}
                </span>
                {c.rank <= 3 && <span className={styles.badge}>{t.rank(c.rank)}</span>}
              </li>
            ))}
          </ol>
          <button type="button" className={styles.primary} onClick={() => void copy()}>
            {copied ? t.copied : t.copyTimeline}
          </button>
          <div className={styles.markers} role="group" aria-label={t.markerGroup}>
            <span className={styles.meta}>{t.markerTitle}</span>
            {MARKERS.map((format) => (
              <button
                key={format}
                type="button"
                className={styles.ghost}
                onClick={() => saveMarkers(format)}
              >
                {t.markers[format]}
              </button>
            ))}
          </div>
          <p className={styles.meta}>{t.srtHint}</p>
          {recording}
        </>
      )}
      {file && detail.candidates.length === 0 && recording}
      {error && (
        <p className={styles.meta} role="status">
          {error}
        </p>
      )}
      <p className={styles.meta}>
        {file
          ? t.foundBySound
          : t.foundByChat(
              count(detail.chatCount),
              count(detail.reactionCount ?? 0),
              !!detail.loudPer10s,
            )}
      </p>
    </div>
  );
}
