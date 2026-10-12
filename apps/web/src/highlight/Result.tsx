/**
 * 방송 하나의 하이라이트 결과 (모드 A: 채팅만). 그래프, 후보 목록, 유튜브 댓글용 타임라인 복사, 편집용 마커 파일.
 * 시각은 수집 시작 기준이라, 방송을 켠 뒤 수집을 누르기까지 걸린 시간을 넣으면 다시보기 시각이 된다.
 */
import { useEffect, useState } from 'react';
import { Recording } from './Recording';
import { getBroadcast, StreamerError, type BroadcastDetail } from './streamer';
import { SAVE_METHOD } from '../lib/inApp';
import { download } from '../lib/save';
import { clock, markerFile, parseClock, timelineText, type MarkerFormat } from './timeline';
import styles from './Result.module.css';

const count = (n: number) => n.toLocaleString('ko-KR');

const MARKERS: { format: MarkerFormat; label: string }[] = [
  { format: 'csv', label: '표 (CSV)' },
  { format: 'srt', label: '자막 (SRT)' },
  { format: 'audacity', label: 'Audacity 라벨' },
];

function Graph({ detail }: { detail: BroadcastDetail }) {
  const data = detail.chatPer10s;
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
      aria-label="10초마다 채팅 수 그래프. 칠한 곳이 하이라이트 후보예요."
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

  useEffect(() => {
    let alive = true;
    getBroadcast(id)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof StreamerError ? e.message : '잠시 후 다시 시도해 주세요.');
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <p className={styles.meta}>{error}</p>;
  if (!detail) return <p className={styles.meta}>결과를 불러오고 있어요…</p>;
  if (detail.analysisStatus !== 'done') {
    return <p className={styles.meta}>분석하고 있어요. 수집이 끝나고 3~4분 뒤에 결과가 나와요.</p>;
  }

  const offset = parseClock(offsetText);
  const shift = offset ?? 0;
  const ordered = [...detail.candidates].sort((a, b) => a.start - b.start);

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

  return (
    <div className={styles.result}>
      <Graph detail={detail} />
      {detail.candidates.length === 0 ? (
        <p className={styles.meta}>
          채팅이 눈에 띄게 몰린 순간이 없어 후보를 찾지 못했어요. 채팅이 많은 방송일수록 잘 찾아요.
        </p>
      ) : (
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
          <ol className={styles.list} aria-label="하이라이트 후보">
            {ordered.map((c) => (
              <li key={c.rank} className={styles.item}>
                <b className={styles.time}>
                  {clock(c.start + shift)} – {clock(c.end + shift)}
                </b>
                <span className={styles.meta}>
                  채팅 {count(c.counts.chat)} · 반응 {count(c.counts.reaction)}
                  {c.counts.donation > 0 && ` · 후원 ${count(c.counts.donation)}`}
                  {c.counts.subscription > 0 && ` · 구독 ${count(c.counts.subscription)}`}
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
          <Recording
            id={detail.id}
            candidates={detail.candidates}
            offset={shift}
            onOffset={(sec) => setOffsetText(clock(sec))}
          />
        </>
      )}
      <p className={styles.meta}>
        채팅 {count(detail.chatCount)}개 중 반응 채팅 {count(detail.reactionCount ?? 0)}개로
        찾았어요.
      </p>
    </div>
  );
}
