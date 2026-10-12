/**
 * 하이라이트 분석 Lambda (모드 A: 채팅만, ADR-041).
 * 수집기가 끝날 때 분석 큐에 3분 지연 메시지를 넣는다 → 채팅 저장 Lambda가 남은 이벤트를 다 쓴 뒤에 돈다.
 * S3 chat/chzzk/<채널>/<방송>/ 아래를 모두 읽어 점수를 매기고, 후보를 방송 기록(CONN#/BCAST#)에 남긴다.
 * 녹화 파일 소리 크기(워커 loudness 잡 결과, ADR-044)가 있으면 함께 쓴다: 메시지의 loudnessKey.
 */
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ChatEvent } from '@fitcut/chzzk';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { gunzipSync } from 'node:zlib';
import { analyze } from './analysis/score';

export type Deps = {
  bucket: string;
  /** 워커 결과 버킷 (소리 크기 JSON) */
  outputsBucket: string;
  table: string;
  s3: S3Client;
  ddb: DynamoDBDocumentClient;
  now: () => Date;
};

const CHANNEL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BROADCAST_ID = /^\d{14}-[0-9a-f]{6}$/;
const LOUDNESS_KEY = /^out\/[0-9a-f-]{36}\.json$/;

export function parseLines(text: string): ChatEvent[] {
  const out: ChatEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as ChatEvent;
      if (typeof e.t === 'number' && typeof e.type === 'string') out.push(e);
    } catch {
      // 깨진 줄은 건너뛴다
    }
  }
  return out;
}

export function makeHandler(deps: Deps) {
  async function readEvents(prefix: string): Promise<ChatEvent[]> {
    const events: ChatEvent[] = [];
    let token: string | undefined;
    do {
      const page = await deps.s3.send(
        new ListObjectsV2Command({ Bucket: deps.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of page.Contents ?? []) {
        if (!o.Key) continue;
        const r = await deps.s3.send(new GetObjectCommand({ Bucket: deps.bucket, Key: o.Key }));
        const bytes = await r.Body?.transformToByteArray();
        if (bytes) events.push(...parseLines(gunzipSync(bytes).toString('utf8')));
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return events;
  }

  async function readLoudness(key: string): Promise<number[]> {
    const r = await deps.s3.send(new GetObjectCommand({ Bucket: deps.outputsBucket, Key: key }));
    const body = JSON.parse((await r.Body?.transformToString()) ?? '{}') as { rmsDb?: unknown };
    return Array.isArray(body.rmsDb) ? body.rmsDb.map(Number).filter(Number.isFinite) : [];
  }

  async function run(channelId: string, broadcastId: string, loudnessKey?: string, offsetSec = 0) {
    const key = { PK: `CONN#chzzk#${channelId}`, SK: `BCAST#${broadcastId}` };
    const item = (await deps.ddb.send(new GetCommand({ TableName: deps.table, Key: key }))).Item as
      { startedAt?: string; endedAt?: string } | undefined;
    if (!item) return; // 연결 해제 등으로 기록이 없다
    const events = await readEvents(`chat/chzzk/${channelId}/${broadcastId}/`);
    const started = Date.parse(item.startedAt ?? '');
    const ended = Date.parse(item.endedAt ?? '');
    const duration =
      Number.isFinite(started) && Number.isFinite(ended) ? (ended - started) / 1000 : 0;
    const t0 = Date.now();
    // 소리는 녹화 파일 0초부터, 채팅은 수집 시작부터다. 녹화 파일이 offset초 먼저 시작했으면 그만큼 당긴다
    const loudness = loudnessKey ? (await readLoudness(loudnessKey)).slice(offsetSec) : undefined;
    const result = analyze(events, duration, undefined, loudness);
    await deps.ddb.send(
      new UpdateCommand({
        TableName: deps.table,
        Key: key,
        UpdateExpression:
          'SET analysisStatus = :s, analyzedAt = :a, analysisVersion = :v, candidates = :c, chatPer10s = :g, reactionCount = :r, durationSec = :d' +
          (result.loudPer10s ? ', loudPer10s = :l' : ''),
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: {
          ':s': 'done',
          ':a': deps.now().toISOString(),
          ':v': result.version,
          ':c': result.candidates,
          ':g': result.chatPer10s,
          ':r': result.totals.reaction,
          ':d': result.durationSec,
          ...(result.loudPer10s ? { ':l': result.loudPer10s } : {}),
        },
      }),
    );
    console.log(
      JSON.stringify({
        msg: 'analyzed',
        events: events.length,
        candidates: result.candidates.length,
        ms: Date.now() - t0,
      }),
    );
  }

  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failed: string[] = [];
    for (const r of event.Records) {
      let body: {
        channelId?: unknown;
        broadcastId?: unknown;
        loudnessKey?: unknown;
        offsetSec?: unknown;
      };
      try {
        body = JSON.parse(r.body) as typeof body;
      } catch {
        continue;
      }
      const { channelId, broadcastId, loudnessKey, offsetSec } = body;
      const offset = Number(offsetSec);
      if (
        typeof channelId !== 'string' ||
        typeof broadcastId !== 'string' ||
        !CHANNEL_ID.test(channelId) ||
        !BROADCAST_ID.test(broadcastId)
      ) {
        continue; // 우리가 넣은 모양이 아니면 버린다
      }
      try {
        await run(
          channelId,
          broadcastId,
          typeof loudnessKey === 'string' && LOUDNESS_KEY.test(loudnessKey)
            ? loudnessKey
            : undefined,
          Number.isInteger(offset) && offset > 0 ? offset : 0,
        );
      } catch (e) {
        if ((e as { name?: string }).name === 'ConditionalCheckFailedException') continue;
        console.error(JSON.stringify({ msg: 'analysis failed', broadcastId, error: String(e) }));
        failed.push(r.messageId);
      }
    }
    return { batchItemFailures: failed.map((itemIdentifier) => ({ itemIdentifier })) };
  };
}

let real: ReturnType<typeof makeHandler> | null = null;
export const handler = (event: SQSEvent) => {
  const bucket = process.env.CHAT_BUCKET;
  const table = process.env.TABLE_NAME;
  const outputsBucket = process.env.OUTPUTS_BUCKET;
  if (!bucket || !table || !outputsBucket) {
    throw new Error('env CHAT_BUCKET, TABLE_NAME, OUTPUTS_BUCKET are required');
  }
  real ??= makeHandler({
    bucket,
    outputsBucket,
    table,
    s3: new S3Client({}),
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    }),
    now: () => new Date(),
  });
  return real(event);
};
