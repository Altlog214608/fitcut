/**
 * SQS 메시지 묶음을 날짜 파티션별 JSON Lines로 (순수 함수).
 * 메시지 하나 = { events: [...] } (API가 요청 하나의 이벤트를 묶어 넣는다, 서버 잡 이벤트도 같은 모양).
 */
export type Message = { id: string; body: string };
export type Partition = { dt: string; lines: string[]; messageIds: string[] };

/** 서울 날짜 YYYY-MM-DD. 파티션은 서버가 받은 시각으로 정한다 (기기 시계는 틀릴 수 있다) */
export function seoulDate(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function partition(
  messages: readonly Message[],
  now: number,
): { partitions: Partition[]; skipped: string[] } {
  const byDt = new Map<string, Partition>();
  const skipped: string[] = [];
  for (const m of messages) {
    let events: unknown;
    try {
      events = (JSON.parse(m.body) as { events?: unknown }).events;
    } catch {
      events = undefined;
    }
    if (!Array.isArray(events)) {
      skipped.push(m.id); // 우리가 넣은 모양이 아니면 버린다 (다시 시도해도 같다)
      continue;
    }
    for (const e of events) {
      if (typeof e !== 'object' || e === null) continue;
      const receivedAt = (e as { receivedAt?: unknown }).receivedAt;
      const dt = seoulDate(typeof receivedAt === 'number' ? receivedAt : now);
      const p = byDt.get(dt) ?? { dt, lines: [], messageIds: [] };
      p.lines.push(JSON.stringify(e));
      if (!p.messageIds.includes(m.id)) p.messageIds.push(m.id);
      byDt.set(dt, p);
    }
  }
  return { partitions: [...byDt.values()], skipped };
}

/** S3 키: events/dt=2026-10-10/1760083200000-<id>.json.gz (Athena 파티션 규칙) */
export function objectKey(dt: string, now: number, id: string): string {
  return `events/dt=${dt}/${now}-${id}.json.gz`;
}
