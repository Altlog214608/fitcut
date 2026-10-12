/**
 * 채팅 저장 Lambda (ADR-030): SQS 이벤트 소스가 최대 60초·1000개씩 모아 부르면
 * 방송마다 gzip JSON Lines 객체 하나씩 S3 chat/ 아래에 쓴다. 쓰지 못한 방송의 메시지만 다시 받는다.
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { chatKey, groupByBroadcast } from './chatBatch';

export type Deps = { bucket: string; s3: S3Client; now: () => number; newId: () => string };

export function makeHandler(deps: Deps) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const { groups, skipped } = groupByBroadcast(
      event.Records.map((r) => ({ id: r.messageId, body: r.body })),
    );
    if (skipped.length)
      console.warn(JSON.stringify({ msg: 'skipped messages', count: skipped.length }));
    const failed = new Set<string>();
    for (const g of groups) {
      try {
        await deps.s3.send(
          new PutObjectCommand({
            Bucket: deps.bucket,
            Key: chatKey(g, deps.now(), deps.newId()),
            Body: gzipSync(`${g.lines.join('\n')}\n`),
            ContentType: 'application/x-ndjson',
            ContentEncoding: 'gzip',
          }),
        );
      } catch (e) {
        console.error(
          JSON.stringify({ msg: 'put failed', broadcastId: g.broadcastId, error: String(e) }),
        );
        for (const id of g.messageIds) failed.add(id);
      }
    }
    return { batchItemFailures: [...failed].map((itemIdentifier) => ({ itemIdentifier })) };
  };
}

let real: ReturnType<typeof makeHandler> | null = null;
export const handler = (event: SQSEvent) => {
  const bucket = process.env.CHAT_BUCKET;
  if (!bucket) throw new Error('env CHAT_BUCKET is required');
  real ??= makeHandler({ bucket, s3: new S3Client({}), now: () => Date.now(), newId: randomUUID });
  return real(event);
};
