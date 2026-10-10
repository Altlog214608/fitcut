/**
 * 사용 이벤트 배치 Lambda (ADR-030, docs/ADMIN.md 파이프라인).
 * SQS 이벤트 소스가 최대 5분·1000개씩 모아 부르면 날짜별로 gzip JSON Lines 객체 하나씩 쓴다.
 * 쓰지 못한 날짜의 메시지만 실패로 돌려 SQS가 다시 보내게 한다.
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { objectKey, partition } from './batch';

export type Deps = { bucket: string; s3: S3Client; now: () => number; newId: () => string };

export function makeHandler(deps: Deps) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const { partitions } = partition(
      event.Records.map((r) => ({ id: r.messageId, body: r.body })),
      deps.now(),
    );
    const failed = new Set<string>();
    for (const p of partitions) {
      try {
        await deps.s3.send(
          new PutObjectCommand({
            Bucket: deps.bucket,
            Key: objectKey(p.dt, deps.now(), deps.newId()),
            Body: gzipSync(`${p.lines.join('\n')}\n`),
            ContentType: 'application/x-ndjson',
            ContentEncoding: 'gzip',
          }),
        );
      } catch (e) {
        console.error(JSON.stringify({ msg: 'put failed', dt: p.dt, error: String(e) }));
        for (const id of p.messageIds) failed.add(id);
      }
    }
    return { batchItemFailures: [...failed].map((itemIdentifier) => ({ itemIdentifier })) };
  };
}

let real: ReturnType<typeof makeHandler> | null = null;
export const handler = (event: SQSEvent) => {
  const bucket = process.env.ANALYTICS_BUCKET;
  if (!bucket) throw new Error('env ANALYTICS_BUCKET is required');
  real ??= makeHandler({ bucket, s3: new S3Client({}), now: () => Date.now(), newId: randomUUID });
  return real(event);
};
