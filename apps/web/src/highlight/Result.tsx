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
import styles from './Result.module.css';

const count = (n: number) => n.toLocaleString('ko-KR');
const POLL_MS = 15_000;

const MARKERS: { format: MarkerFormat; label: string }[] = [
  { format: 'csv', label: '표 (CSV)' },
  { format: 'srt', label: '자막 (SRT)' },
  { format: 'audacity', label: 'Audacity 라벨' },
];

function Graph({ detail }: { detail: BroadcastDetail }) {
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
      aria-label={`10초마다 ${sound ? '소리 크기' : '채팅 수'} 그래프. 칠한 곳이 하이라이트 후보예요.`}
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
  const [detail, setDetail] = useState<BroadcastDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          if (alive)
            setError(e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.');
        });
    void load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [id, reload]);

  if (!detail) return <p className={styles.meta}>{error ?? '결과를 불러오고 있어요…'}</p>;

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
      setError(e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.');
    } finally {
      setAsking(false);
    }
  }

  function saveMarkers(format: MarkerFormat) {
    if (!detail) return;
    const { text, ext, type } = markerFile(detail.candidates, shift, format);
    // iOS 인앱 브라우저는 blob 다운로드를 못 한다 (lib/inApp.ts)
    void download(
      new Blob([text], { type }),
      `fitcut-highlight-${detail.id}.${ext}`,
      SAVE_METHOD === 'data-url' ? 'data-url' : 'blob',
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(timelineText(detail?.candidates ?? [], shift));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('복사하지 못했어요. 아래 시각을 직접 골라 복사해 주세요.');
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
        label: file
          ? '소리 크기로 후보 찾기'
          : detail.loudPer10s
            ? '소리도 함께 다시 분석'
            : '소리도 함께 분석',
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
            ? '녹화 파일의 소리를 분석하고 있어요. 1시간 파일이면 몇 분 걸려요. 이 화면에 저절로 떠요.'
            : '분석하고 있어요. 수집이 끝나고 3~4분 뒤에 결과가 나오고, 이 화면에 저절로 떠요.'}
        </p>
      </div>
    );
  }

  if (file && !done) {
    return (
      <div className={styles.result}>
        <p className={styles.meta}>
          채팅 없이 녹화 파일의 소리 크기로 후보를 찾아요. 웃음·함성처럼 소리가 크게 튄 순간을
          골라요. 녹화 파일을 올린 뒤 "소리 크기로 후보 찾기"를 눌러 주세요.
        </p>
        {recording}
      </div>
    );
  }

  return (
    <div className={styles.result}>
      <Graph detail={detail} />
      {detail.candidates.length === 0 ? (
        <p className={styles.meta}>
          {file
            ? '소리가 눈에 띄게 커진 순간이 없어 후보를 찾지 못했어요.'
            : '채팅이 눈에 띄게 몰린 순간이 없어 후보를 찾지 못했어요. 채팅이 많은 방송일수록 잘 찾아요.'}
        </p>
      ) : (
        <>
          {!file && (
            <>
              <label className={styles.offset}>
                <span>방송을 켠 뒤 수집을 누르기까지</span>
                <input
                  inputMode="numeric"
                  value={offsetText}
                  onChange={(e) => setOffsetText(e.target.value)}
                  aria-invalid={offset === null}
                  aria-describedby="offset-help"
                />
              </label>
              <p id="offset-help" className={styles.meta}>
                {offset === null
                  ? '분:초 모양으로 적어 주세요. 예: 2:30'
                  : '이 시간만큼 더해서 다시보기 시각으로 보여드려요.'}
              </p>
            </>
          )}
          <ol className={styles.list} aria-label="하이라이트 후보">
            {ordered.map((c) => (
              <li key={c.rank} className={styles.item}>
                <b className={styles.time}>
                  {clock(c.start + shift)} – {clock(c.end + shift)}
                </b>
                <span className={styles.meta}>
                  {file
                    ? `소리 ${c.counts.loudness ?? 0}dB`
                    : `채팅 ${count(c.counts.chat)} · 반응 ${count(c.counts.reaction)}`}
                  {c.counts.donation > 0 && ` · 후원 ${count(c.counts.donation)}`}
                  {c.counts.subscription > 0 && ` · 구독 ${count(c.counts.subscription)}`}
                  {!file && c.counts.loudness !== undefined && ` · 소리 ${c.counts.loudness}dB`}
                </span>
                {c.rank <= 3 && <span className={styles.badge}>{c.rank}위</span>}
              </li>
            ))}
          </ol>
          <button type="button" className={styles.primary} onClick={() => void copy()}>
            {copied ? '복사했어요' : '유튜브 댓글용 타임라인 복사'}
          </button>
          <div className={styles.markers} role="group" aria-label="편집용 마커 파일 받기">
            <span className={styles.meta}>편집용 마커 파일</span>
            {MARKERS.map((m) => (
              <button
                key={m.format}
                type="button"
                className={styles.ghost}
                onClick={() => saveMarkers(m.format)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className={styles.meta}>
            자막(SRT)은 프리미어·다빈치 리졸브·캡컷에서 자막 트랙으로 불러오면 후보 구간에 글자가
            떠서 마커처럼 쓸 수 있어요.
          </p>
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
          ? '녹화 파일의 소리 크기로 찾았어요.'
          : `채팅 ${count(detail.chatCount)}개 중 반응 채팅 ${count(detail.reactionCount ?? 0)}개${
              detail.loudPer10s ? '와 녹화 파일 소리' : ''
            }로 찾았어요.`}
      </p>
    </div>
  );
}
