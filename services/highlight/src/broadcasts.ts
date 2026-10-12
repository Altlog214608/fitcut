/**
 * 방송 수집 시작·종료·목록 (M5, ADR-040). 스트리머 세션이 확인된 뒤에만 부른다.
 * - 시작: 하루 횟수 확인 → 채널에 "수집 중" 표시(한 번에 하나) → 방송 기록 → Fargate RunTask
 * - 종료: 방송 기록에 stopRequested. 수집기가 30초 안에 읽고 정리한다
 * 방송 기록: PK CONN#chzzk#<채널ID>, SK BCAST#<방송ID>. 90일 뒤 TTL로 지운다 (채팅 원본 보관 기간과 같다)
 */
import { RunTaskCommand, type ECSClient } from '@aws-sdk/client-ecs';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'node:crypto';

export type CollectorEnv = {
  TABLE_NAME: string;
  CLUSTER: string;
  TASK_FAMILY: string;
  /** 쉼표로 나눈 서브넷 ID */
  SUBNETS: string;
  SECURITY_GROUP: string;
};

export type BroadcastDeps = {
  env: CollectorEnv;
  ddb: DynamoDBDocumentClient;
  ecs: ECSClient;
  now: () => Date;
};

export type Broadcast = {
  id: string;
  status: 'starting' | 'collecting' | 'done' | 'failed';
  requestedAt: string;
  startedAt?: string;
  endedAt?: string;
  chatCount: number;
  donationCount: number;
  subscriptionCount: number;
  stopRequested?: boolean;
  stopReason?: string;
  /** 분석 중이면 'running', 끝났으면 'done' (ADR-041·044) */
  analysisStatus?: 'running' | 'done';
  /** 'file'이면 채팅 없이 녹화 파일만 분석하는 기록 (모드 C, ADR-044) */
  source?: 'file';
};

/** 분석 결과까지 (한 방송을 열 때) */
export type BroadcastDetail = Broadcast & {
  analyzedAt?: string;
  analysisVersion?: string;
  durationSec?: number;
  reactionCount?: number;
  candidates: unknown[];
  chatPer10s: number[];
  loudPer10s?: number[];
};

/** 채널 하나가 하루(서울)에 시작할 수 있는 수집 횟수. 공개 데모 비용 상한 (docs/HIGHLIGHT.md 데모와 비용) */
export const DAILY_STARTS = 3;
/** 채널 하나가 하루에 만들 수 있는 녹화 파일 분석 기록 (모드 C) */
export const DAILY_FILES = 5;
/** 이 시간 동안 수집기 소식이 없으면 멈춘 것으로 보고 새 수집을 허용한다 */
const STALE_MS = 5 * 60 * 1000;
const KEEP_SECONDS = 90 * 24 * 60 * 60;
export const BROADCAST_ID = /^\d{14}-[0-9a-f]{6}$/;

const connKey = (channelId: string) => ({ PK: `CONN#chzzk#${channelId}`, SK: 'META' });
const bcastKey = (channelId: string, id: string) => ({
  PK: `CONN#chzzk#${channelId}`,
  SK: `BCAST#${id}`,
});

export class BroadcastError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** 20261012093000-a1b2c3 (UTC). 정렬하면 시간 순서다 */
export function newBroadcastId(now: Date): string {
  const digits = now.toISOString().replace(/\D/g, '').slice(0, 14);
  return `${digits}-${randomBytes(3).toString('hex')}`;
}

const seoulDay = (now: Date) =>
  new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');

export function isStale(b: Partial<Broadcast> & { heartbeatAt?: string }, now: Date): boolean {
  if (b.status === 'done' || b.status === 'failed') return true;
  const last = Date.parse(b.heartbeatAt ?? b.requestedAt ?? '');
  return !Number.isFinite(last) || now.getTime() - last > STALE_MS;
}

function publicBroadcast(item: Record<string, unknown>): Broadcast {
  const pick = <T>(k: string) => item[k] as T;
  return {
    id: String(item.id),
    status: pick<Broadcast['status']>('status'),
    requestedAt: pick<string>('requestedAt'),
    ...(item.startedAt ? { startedAt: pick<string>('startedAt') } : {}),
    ...(item.endedAt ? { endedAt: pick<string>('endedAt') } : {}),
    chatCount: Number(item.chatCount ?? 0),
    donationCount: Number(item.donationCount ?? 0),
    subscriptionCount: Number(item.subscriptionCount ?? 0),
    ...(item.stopRequested ? { stopRequested: true } : {}),
    ...(item.stopReason ? { stopReason: pick<string>('stopReason') } : {}),
    ...(item.analysisStatus === 'done' || item.analysisStatus === 'running'
      ? { analysisStatus: item.analysisStatus }
      : {}),
    ...(item.source === 'file' ? { source: 'file' as const } : {}),
  };
}

/** 목록에서는 무거운 분석 결과(후보, 그래프)를 읽지 않는다 */
const LIST_FIELDS = [
  'id',
  '#s',
  'requestedAt',
  'startedAt',
  'endedAt',
  'chatCount',
  'donationCount',
  'subscriptionCount',
  'stopRequested',
  'stopReason',
  'analysisStatus',
  'source',
].join(', ');

const conditionFailed = (e: unknown) =>
  (e as { name?: string }).name === 'ConditionalCheckFailedException';

export function makeBroadcasts(deps: BroadcastDeps) {
  const { env, ddb } = deps;
  const T = env.TABLE_NAME;

  async function list(channelId: string): Promise<Broadcast[]> {
    const r = await ddb.send(
      new QueryCommand({
        TableName: T,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `CONN#chzzk#${channelId}`, ':sk': 'BCAST#' },
        ExpressionAttributeNames: { '#s': 'status' },
        ProjectionExpression: LIST_FIELDS,
        ScanIndexForward: false,
        Limit: 20,
      }),
    );
    return (r.Items ?? []).map(publicBroadcast);
  }

  async function detail(channelId: string, id: string): Promise<BroadcastDetail> {
    const item = (await ddb.send(new GetCommand({ TableName: T, Key: bcastKey(channelId, id) })))
      .Item;
    if (!item) throw new BroadcastError(404, 'not_found', '방송 기록이 없어요.');
    return {
      ...publicBroadcast(item),
      ...(item.analyzedAt ? { analyzedAt: String(item.analyzedAt) } : {}),
      ...(item.analysisVersion ? { analysisVersion: String(item.analysisVersion) } : {}),
      ...(item.durationSec !== undefined ? { durationSec: Number(item.durationSec) } : {}),
      ...(item.reactionCount !== undefined ? { reactionCount: Number(item.reactionCount) } : {}),
      candidates: Array.isArray(item.candidates) ? (item.candidates as unknown[]) : [],
      chatPer10s: Array.isArray(item.chatPer10s) ? (item.chatPer10s as number[]) : [],
      ...(Array.isArray(item.loudPer10s) ? { loudPer10s: item.loudPer10s as number[] } : {}),
    };
  }

  async function takeDailySlot(channelId: string) {
    const now = deps.now();
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: T,
          Key: { PK: `QUOTA#chzzk#${channelId}#${seoulDay(now)}`, SK: 'COLLECT' },
          UpdateExpression: 'ADD #c :one SET #t = if_not_exists(#t, :ttl)',
          ConditionExpression: 'attribute_not_exists(#c) OR #c < :max',
          ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
          ExpressionAttributeValues: {
            ':one': 1,
            ':max': DAILY_STARTS,
            ':ttl': Math.floor(now.getTime() / 1000) + 2 * 86400,
          },
        }),
      );
    } catch (e) {
      if (conditionFailed(e)) {
        throw new BroadcastError(
          429,
          'daily_limit',
          `수집은 하루 ${DAILY_STARTS}번까지 시작할 수 있어요. 내일 다시 시도해 주세요.`,
        );
      }
      throw e;
    }
  }

  /** 채널에 이 방송을 "수집 중"으로 건다. 이미 다른 수집이 살아 있으면 409 */
  async function claim(channelId: string, id: string) {
    const set = (condition: string, values: Record<string, unknown>) =>
      ddb.send(
        new UpdateCommand({
          TableName: T,
          Key: connKey(channelId),
          UpdateExpression: 'SET activeBroadcastId = :id',
          ConditionExpression: `attribute_exists(PK) AND (${condition})`,
          ExpressionAttributeValues: { ':id': id, ...values },
        }),
      );
    try {
      await set('attribute_not_exists(activeBroadcastId)', {});
      return;
    } catch (e) {
      if (!conditionFailed(e)) throw e;
    }
    const conn = (await ddb.send(new GetCommand({ TableName: T, Key: connKey(channelId) }))).Item;
    if (!conn) throw new BroadcastError(401, 'no_connection', '채널 연결을 다시 해 주세요.');
    const activeId = conn.activeBroadcastId as string | undefined;
    const active = activeId
      ? (await ddb.send(new GetCommand({ TableName: T, Key: bcastKey(channelId, activeId) }))).Item
      : undefined;
    if (active && !isStale(active, deps.now())) {
      throw new BroadcastError(409, 'already_collecting', '이미 수집 중인 방송이 있어요.');
    }
    try {
      await set('activeBroadcastId = :old', { ':old': activeId });
    } catch (e) {
      if (conditionFailed(e)) {
        throw new BroadcastError(409, 'already_collecting', '이미 수집 중인 방송이 있어요.');
      }
      throw e;
    }
  }

  async function release(channelId: string, id: string) {
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: T,
          Key: connKey(channelId),
          UpdateExpression: 'REMOVE activeBroadcastId',
          ConditionExpression: 'activeBroadcastId = :id',
          ExpressionAttributeValues: { ':id': id },
        }),
      );
    } catch {
      // 이미 다른 방송으로 바뀌었거나 연결이 해제됐다
    }
  }

  async function start(channelId: string): Promise<Broadcast> {
    await takeDailySlot(channelId);
    const now = deps.now();
    const id = newBroadcastId(now);
    await claim(channelId, id);
    const item = {
      ...bcastKey(channelId, id),
      id,
      platform: 'chzzk',
      channelId,
      status: 'starting',
      requestedAt: now.toISOString(),
      chatCount: 0,
      donationCount: 0,
      subscriptionCount: 0,
      ttl: Math.floor(now.getTime() / 1000) + KEEP_SECONDS,
    };
    await ddb.send(new PutCommand({ TableName: T, Item: item }));

    let taskArn: string | undefined;
    let failure: string | undefined;
    try {
      const r = await deps.ecs.send(
        new RunTaskCommand({
          cluster: env.CLUSTER,
          taskDefinition: env.TASK_FAMILY,
          launchType: 'FARGATE',
          count: 1,
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: env.SUBNETS.split(',').filter(Boolean),
              securityGroups: [env.SECURITY_GROUP],
              // NAT Gateway 없이 치지직·AWS API에 나가려고 공인 IP를 붙인다 (태스크가 도는 동안만 과금)
              assignPublicIp: 'ENABLED',
            },
          },
          overrides: {
            containerOverrides: [
              {
                name: 'collector',
                environment: [
                  { name: 'BROADCAST_ID', value: id },
                  { name: 'CHANNEL_ID', value: channelId },
                ],
              },
            ],
          },
        }),
      );
      taskArn = r.tasks?.[0]?.taskArn;
      failure = taskArn ? undefined : (r.failures?.[0]?.reason ?? 'no task');
    } catch (e) {
      failure = e instanceof Error ? e.name : 'run_task';
    }

    if (!taskArn) {
      console.error(JSON.stringify({ msg: 'run task failed', failure }));
      await ddb.send(
        new UpdateCommand({
          TableName: T,
          Key: bcastKey(channelId, id),
          UpdateExpression: 'SET #s = :s, stopReason = :r, endedAt = :e',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':s': 'failed', ':r': 'run_task', ':e': now.toISOString() },
        }),
      );
      await release(channelId, id);
      throw new BroadcastError(
        503,
        'run_task',
        '수집기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
    }
    await ddb.send(
      new UpdateCommand({
        TableName: T,
        Key: bcastKey(channelId, id),
        UpdateExpression: 'SET taskArn = :a',
        ExpressionAttributeValues: { ':a': taskArn },
      }),
    );
    return publicBroadcast(item);
  }

  async function stop(channelId: string, id: string): Promise<Broadcast> {
    try {
      const r = await ddb.send(
        new UpdateCommand({
          TableName: T,
          Key: bcastKey(channelId, id),
          UpdateExpression: 'SET stopRequested = :t',
          ConditionExpression: 'attribute_exists(PK) AND #s IN (:a, :b)',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':t': true, ':a': 'starting', ':b': 'collecting' },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return publicBroadcast(r.Attributes ?? {});
    } catch (e) {
      if (!conditionFailed(e)) throw e;
      const cur = (await ddb.send(new GetCommand({ TableName: T, Key: bcastKey(channelId, id) })))
        .Item;
      if (!cur) throw new BroadcastError(404, 'not_found', '방송 기록이 없어요.');
      return publicBroadcast(cur); // 이미 끝난 방송
    }
  }

  /** 연결 해제 때: 돌고 있는 수집을 멈추게 한다 */
  async function stopActive(channelId: string) {
    const conn = (await ddb.send(new GetCommand({ TableName: T, Key: connKey(channelId) }))).Item;
    const activeId = conn?.activeBroadcastId as string | undefined;
    if (!activeId) return;
    try {
      await stop(channelId, activeId);
    } catch {
      // 기록이 없으면 멈출 것도 없다
    }
  }

  /**
   * 모드 C: 채팅 없이 녹화 파일만 분석할 기록을 만든다. 수집기를 띄우지 않는다.
   * 녹화 파일 올리기·소리 크기 분석은 다른 방송 기록과 같은 경로를 쓴다
   */
  async function createFile(channelId: string): Promise<Broadcast> {
    const now = deps.now();
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: T,
          Key: { PK: `QUOTA#chzzk#${channelId}#${seoulDay(now)}`, SK: 'FILE' },
          UpdateExpression: 'ADD #c :one SET #t = if_not_exists(#t, :ttl)',
          ConditionExpression: 'attribute_not_exists(#c) OR #c < :max',
          ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
          ExpressionAttributeValues: {
            ':one': 1,
            ':max': DAILY_FILES,
            ':ttl': Math.floor(now.getTime() / 1000) + 2 * 86400,
          },
        }),
      );
    } catch (e) {
      if (conditionFailed(e)) {
        throw new BroadcastError(
          429,
          'daily_limit',
          `녹화 파일 분석은 하루 ${DAILY_FILES}번까지 시작할 수 있어요.`,
        );
      }
      throw e;
    }
    const id = newBroadcastId(now);
    const item = {
      ...bcastKey(channelId, id),
      id,
      platform: 'chzzk',
      channelId,
      source: 'file',
      status: 'done',
      requestedAt: now.toISOString(),
      chatCount: 0,
      donationCount: 0,
      subscriptionCount: 0,
      ttl: Math.floor(now.getTime() / 1000) + KEEP_SECONDS,
    };
    await ddb.send(new PutCommand({ TableName: T, Item: item }));
    return publicBroadcast(item);
  }

  return { list, detail, start, createFile, stop, stopActive };
}
