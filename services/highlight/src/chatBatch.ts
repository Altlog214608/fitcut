/**
 * 수집기가 SQS에 넣은 채팅 이벤트 묶음을 방송별 JSON Lines로 나눈다 (순수 함수, ADR-030).
 * 메시지 하나 = {"v":1,"broadcastId","channelId","events":[...]} (services/collector/src/batcher.ts)
 */
export type Message = { id: string; body: string };
export type Group = {
  channelId: string;
  broadcastId: string;
  lines: string[];
  messageIds: string[];
};

/** S3 경로에 들어가므로 우리가 만든 모양만 받는다 */
const CHANNEL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BROADCAST_ID = /^\d{14}-[0-9a-f]{6}$/;

export function groupByBroadcast(messages: readonly Message[]): {
  groups: Group[];
  skipped: string[];
} {
  const byKey = new Map<string, Group>();
  const skipped: string[] = [];
  for (const m of messages) {
    let parsed: { v?: unknown; broadcastId?: unknown; channelId?: unknown; events?: unknown };
    try {
      parsed = JSON.parse(m.body) as typeof parsed;
    } catch {
      skipped.push(m.id);
      continue;
    }
    const { broadcastId, channelId, events } = parsed;
    if (
      parsed.v !== 1 ||
      typeof broadcastId !== 'string' ||
      typeof channelId !== 'string' ||
      !BROADCAST_ID.test(broadcastId) ||
      !CHANNEL_ID.test(channelId) ||
      !Array.isArray(events)
    ) {
      skipped.push(m.id); // 다시 시도해도 같으므로 버린다
      continue;
    }
    const k = `${channelId}/${broadcastId}`;
    const g = byKey.get(k) ?? { channelId, broadcastId, lines: [], messageIds: [] };
    for (const e of events) {
      if (typeof e === 'object' && e !== null) g.lines.push(JSON.stringify(e));
    }
    g.messageIds.push(m.id);
    byKey.set(k, g);
  }
  return { groups: [...byKey.values()].filter((g) => g.lines.length), skipped };
}

/** chat/chzzk/<채널ID>/<방송ID>/<시각>-<id>.jsonl.gz — 분석은 방송 경로 아래를 모두 읽는다 */
export function chatKey(g: Pick<Group, 'channelId' | 'broadcastId'>, now: number, id: string) {
  return `chat/chzzk/${g.channelId}/${g.broadcastId}/${now}-${id}.jsonl.gz`;
}
