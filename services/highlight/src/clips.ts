/**
 * 모드 B: 후보 구간 클립 만들기 (ADR-043). 올린 녹화 파일에서 구간만 잘라 MP4로.
 * 잡은 기존 워커가 처리한다: JOB# 기록(kind clip, inputBucket recordings)을 만들고 워커 큐에 넣는다.
 * 화면은 기존 잡 API(GET /api/jobs/{id})로 상태와 받을 주소를 본다.
 */
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { BroadcastError } from './broadcasts';
import type { RecordingState } from './recording';

/** 워커 ffmpeg.ts CLIP_MAX_SECONDS와 같다 */
export const CLIP_MAX_SECONDS = 60;
/** 채널 하나가 하루(서울)에 만들 수 있는 클립 수 (데모 비용 상한) */
export const DAILY_CLIPS = 30;
const JOB_TTL_SECONDS = 2 * 24 * 60 * 60;

export type ClipDeps = {
  table: string;
  queueUrl: string;
  ddb: DynamoDBDocumentClient;
  sqs: SQSClient;
  now: () => Date;
};

export function checkRange(input: { start?: unknown; end?: unknown }) {
  const start = Number(input.start);
  const end = Number(input.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new BroadcastError(400, 'bad_range', '구간이 올바르지 않아요.');
  }
  if (end - start > CLIP_MAX_SECONDS) {
    throw new BroadcastError(400, 'too_long', '클립은 1분까지 자를 수 있어요.');
  }
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { start: round(start), end: round(end) };
}

const seoulDay = (now: Date) =>
  new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');

export function makeClips(deps: ClipDeps) {
  const { ddb, table } = deps;

  async function create(channelId: string, broadcastId: string, input: Record<string, unknown>) {
    const range = checkRange(input);
    const item = (
      await ddb.send(
        new GetCommand({
          TableName: table,
          Key: { PK: `CONN#chzzk#${channelId}`, SK: `BCAST#${broadcastId}` },
        }),
      )
    ).Item as { recording?: RecordingState } | undefined;
    if (!item) throw new BroadcastError(404, 'not_found', '방송 기록이 없어요.');
    const rec = item.recording;
    if (rec?.status !== 'uploaded') {
      throw new BroadcastError(409, 'no_recording', '녹화 파일을 먼저 다 올려 주세요.');
    }

    const now = deps.now();
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: { PK: `QUOTA#chzzk#${channelId}#${seoulDay(now)}`, SK: 'CLIP' },
          UpdateExpression: 'ADD #c :one SET #t = if_not_exists(#t, :ttl)',
          ConditionExpression: 'attribute_not_exists(#c) OR #c < :max',
          ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
          ExpressionAttributeValues: {
            ':one': 1,
            ':max': DAILY_CLIPS,
            ':ttl': Math.floor(now.getTime() / 1000) + 2 * 86400,
          },
        }),
      );
    } catch (e) {
      if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
        throw new BroadcastError(
          429,
          'daily_limit',
          `클립은 하루 ${DAILY_CLIPS}개까지 만들 수 있어요. 내일 다시 시도해 주세요.`,
        );
      }
      throw e;
    }

    const id = randomUUID();
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: {
          PK: `JOB#${id}`,
          SK: 'META',
          id,
          status: 'queued',
          kind: 'clip',
          params: { ...range, fps: 30, width: 0 },
          uploadId: '',
          inputKey: rec.key,
          inputBucket: 'recordings',
          fileSize: rec.size,
          createdAt: now.toISOString(),
          ttl: Math.floor(now.getTime() / 1000) + JOB_TTL_SECONDS,
        },
      }),
    );
    await deps.sqs.send(
      new SendMessageCommand({
        QueueUrl: deps.queueUrl,
        MessageBody: JSON.stringify({ jobId: id }),
      }),
    );
    return { jobId: id, ...range };
  }

  return { create };
}
