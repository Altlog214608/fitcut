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
/** 채널 하나가 하루에 돌릴 수 있는 소리 분석 (녹화 파일 전체를 읽는다) */
export const DAILY_LOUDNESS = 10;
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

  /** 하루 개수 확인 (QUOTA#chzzk#<채널>#<날짜> / kind) */
  async function takeSlot(channelId: string, kind: 'CLIP' | 'LOUD', max: number, what: string) {
    const now = deps.now();
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: { PK: `QUOTA#chzzk#${channelId}#${seoulDay(now)}`, SK: kind },
          UpdateExpression: 'ADD #c :one SET #t = if_not_exists(#t, :ttl)',
          ConditionExpression: 'attribute_not_exists(#c) OR #c < :max',
          ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
          ExpressionAttributeValues: {
            ':one': 1,
            ':max': max,
            ':ttl': Math.floor(now.getTime() / 1000) + 2 * 86400,
          },
        }),
      );
    } catch (e) {
      if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
        throw new BroadcastError(
          429,
          'daily_limit',
          `${what}는 하루 ${max}번까지 할 수 있어요. 내일 다시 시도해 주세요.`,
        );
      }
      throw e;
    }
  }

  async function recordingOf(channelId: string, broadcastId: string) {
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
    return rec;
  }

  async function enqueue(job: Record<string, unknown>) {
    const now = deps.now();
    const id = randomUUID();
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: {
          PK: `JOB#${id}`,
          SK: 'META',
          id,
          status: 'queued',
          uploadId: '',
          inputBucket: 'recordings',
          createdAt: now.toISOString(),
          ttl: Math.floor(now.getTime() / 1000) + JOB_TTL_SECONDS,
          ...job,
        },
      }),
    );
    await deps.sqs.send(
      new SendMessageCommand({
        QueueUrl: deps.queueUrl,
        MessageBody: JSON.stringify({ jobId: id }),
      }),
    );
    return id;
  }

  async function create(channelId: string, broadcastId: string, input: Record<string, unknown>) {
    const range = checkRange(input);
    const rec = await recordingOf(channelId, broadcastId);
    await takeSlot(channelId, 'CLIP', DAILY_CLIPS, '클립 만들기');
    const jobId = await enqueue({
      kind: 'clip',
      params: { ...range, fps: 30, width: 0 },
      inputKey: rec.key,
      fileSize: rec.size,
    });
    return { jobId, ...range };
  }

  /**
   * 모드 C·B: 녹화 파일 전체의 소리 크기를 재고, 끝나면 워커가 분석 큐에 넘긴다 (ADR-044).
   * 채팅이 있는 방송이면 채팅과 소리를 함께 다시 분석한다
   */
  async function loudness(channelId: string, broadcastId: string, input: Record<string, unknown>) {
    // 녹화 파일 시각 = 채팅 시각 + offset. 분석이 소리를 그만큼 당겨 채팅과 맞춘다 (모드 C는 0)
    const offset = Number(input.offset ?? 0);
    if (!Number.isFinite(offset) || offset < 0 || offset > 24 * 3600) {
      throw new BroadcastError(400, 'bad_offset', '시각 맞추기 값이 올바르지 않아요.');
    }
    const rec = await recordingOf(channelId, broadcastId);
    await takeSlot(channelId, 'LOUD', DAILY_LOUDNESS, '소리 분석');
    const jobId = await enqueue({
      kind: 'loudness',
      params: { start: 0, end: 0, fps: 0, width: 0 },
      inputKey: rec.key,
      fileSize: rec.size,
      analysis: { channelId, broadcastId, offsetSec: Math.round(offset) },
    });
    await ddb.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: `CONN#chzzk#${channelId}`, SK: `BCAST#${broadcastId}` },
        UpdateExpression: 'SET analysisStatus = :s',
        ExpressionAttributeValues: { ':s': 'running' },
      }),
    );
    return { jobId };
  }

  return { create, loudness };
}
