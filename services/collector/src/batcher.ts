/**
 * 이벤트를 모아 SQS 메시지 하나에 여러 개씩 넣는다 (ADR-030: SQS → 배치 Lambda → S3).
 * 메시지 본문: {"v":1,"broadcastId","channelId","events":[...]}. SQS 메시지 한도(256KB)보다 작게 자른다.
 */
import type { ChatEvent } from '@koicut/chzzk';

export const MAX_BODY_BYTES = 200_000;
/** 보내지 못한 이벤트를 이만큼까지만 들고 있는다 (메모리 보호) */
export const MAX_PENDING = 50_000;

export type Send = (body: string) => Promise<void>;

export function packBodies(
  events: ChatEvent[],
  head: { broadcastId: string; channelId: string },
  maxBytes = MAX_BODY_BYTES,
): { body: string; count: number }[] {
  const prefix = `{"v":1,"broadcastId":${JSON.stringify(head.broadcastId)},"channelId":${JSON.stringify(head.channelId)},"events":[`;
  const suffix = ']}';
  const out: { body: string; count: number }[] = [];
  let parts: string[] = [];
  let size = prefix.length + suffix.length;
  for (const e of events) {
    const s = JSON.stringify(e);
    const add = Buffer.byteLength(s) + (parts.length ? 1 : 0);
    if (parts.length && size + add > maxBytes) {
      out.push({ body: prefix + parts.join(',') + suffix, count: parts.length });
      parts = [];
      size = prefix.length + suffix.length;
    }
    parts.push(s);
    size += Buffer.byteLength(s) + (parts.length > 1 ? 1 : 0);
  }
  if (parts.length) out.push({ body: prefix + parts.join(',') + suffix, count: parts.length });
  return out;
}

export class Batcher {
  private pending: ChatEvent[] = [];
  dropped = 0;

  constructor(
    private readonly head: { broadcastId: string; channelId: string },
    private readonly send: Send,
  ) {}

  add(e: ChatEvent) {
    if (this.pending.length >= MAX_PENDING) {
      this.dropped += 1;
      return;
    }
    this.pending.push(e);
  }

  get size() {
    return this.pending.length;
  }

  /** 보낸 개수. 실패하면 못 보낸 것은 다음 flush 때 다시 보낸다 */
  async flush(): Promise<number> {
    if (!this.pending.length) return 0;
    const events = this.pending;
    this.pending = [];
    let sent = 0;
    for (const { body, count } of packBodies(events, this.head)) {
      try {
        await this.send(body);
        sent += count;
      } catch (e) {
        this.pending = events.slice(sent).concat(this.pending);
        throw e;
      }
    }
    return sent;
  }
}
