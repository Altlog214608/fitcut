/**
 * 치지직 채팅 수집기 (M5, docs/HIGHLIGHT.md 수집기 설계, ADR-013·040).
 * 방송 하나를 맡아 방송 중에만 돈다: 토큰 준비 → 세션 소켓 연결 → 채팅·후원·구독 구독
 * → 이벤트를 모아 SQS로 → 30초마다 상태 기록·종료 확인 → 끝나면 구독 취소·정리.
 * 방송 기록: PK CONN#chzzk#<채널ID>, SK BCAST#<방송ID> (status starting → collecting → done|failed)
 */
import {
  createUserSession,
  EVENT_KINDS,
  normalize,
  parseSystem,
  refreshTokens,
  subscribe,
  unsubscribe,
  type ChzzkTokens,
  type Fetch,
} from '@fitcut/chzzk';
import { GetParameterCommand, PutParameterCommand, type SSMClient } from '@aws-sdk/client-ssm';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { GetCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Batcher } from './batcher';
import {
  backoffMs,
  isCleanStop,
  MAX_RECONNECTS,
  stopReason,
  type Limits,
  type StopReason,
} from './rules';

export type SocketLike = {
  on(event: string, cb: (data?: unknown) => void): void;
  close(): void;
};

export type Env = {
  TABLE_NAME: string;
  QUEUE_URL: string;
  TOKEN_PREFIX: string;
  CHZZK_CLIENT_ID: string;
  CHZZK_SECRET_PARAM: string;
  BROADCAST_ID: string;
  CHANNEL_ID: string;
};

export type Deps = {
  env: Env;
  ddb: DynamoDBDocumentClient;
  ssm: SSMClient;
  sqs: SQSClient;
  fetch: Fetch;
  connect: (url: string) => SocketLike;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  limits: Limits & { heartbeatMs: number };
  log: (msg: string, extra?: Record<string, unknown>) => void;
};

/** 액세스 토큰은 1일. 최대 수집 시간(8시간)보다 넉넉히 남아 있지 않으면 시작할 때 갱신한다 */
const REFRESH_MARGIN_MS = 9 * 60 * 60 * 1000;

type Counts = { chat: number; donation: number; subscription: number };

export async function runCollector(deps: Deps): Promise<StopReason | 'not_starting'> {
  const { env, ddb } = deps;
  const key = { PK: `CONN#chzzk#${env.CHANNEL_ID}`, SK: `BCAST#${env.BROADCAST_ID}` };
  const tokenParam = `${env.TOKEN_PREFIX}chzzk/${env.CHANNEL_ID}`;

  const item = (await ddb.send(new GetCommand({ TableName: env.TABLE_NAME, Key: key }))).Item as
    { status?: string } | undefined;
  if (item?.status !== 'starting') {
    deps.log('broadcast is not starting', { status: item?.status });
    return 'not_starting';
  }

  const startedAt = deps.now();
  const counts: Counts = { chat: 0, donation: 0, subscription: 0 };
  let lastEventAt: number | null = null;
  const batcher = new Batcher(
    { broadcastId: env.BROADCAST_ID, channelId: env.CHANNEL_ID },
    (body) =>
      deps.sqs
        .send(new SendMessageCommand({ QueueUrl: env.QUEUE_URL, MessageBody: body }))
        .then(() => undefined),
  );

  let socket: SocketLike | null = null;
  let sessionKey: string | null = null;
  let open = false;
  let revoked = false;
  let failures = 0;
  let wake: (() => void) | null = null;
  const nudge = () => wake?.();
  let reason: StopReason | null = null;
  let tokens: ChzzkTokens | null = null;
  try {
    tokens = await loadTokens();
  } catch (e) {
    deps.log('token unavailable', { error: errorText(e) });
    return finish('token');
  }

  const terminate = () => {
    reason = 'terminated';
    nudge();
  };
  process.once('SIGTERM', terminate);

  await ddb.send(
    new UpdateCommand({
      TableName: env.TABLE_NAME,
      Key: key,
      UpdateExpression: 'SET #s = :s, startedAt = :t',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'collecting', ':t': new Date(startedAt).toISOString() },
    }),
  );

  try {
    while (!reason) {
      if (!open) {
        if (failures > MAX_RECONNECTS) {
          reason = 'disconnected';
          break;
        }
        if (failures > 0) await deps.sleep(backoffMs(failures));
        try {
          await openSession();
        } catch (e) {
          failures += 1;
          deps.log('session open failed', { attempt: failures, error: errorText(e) });
          continue;
        }
      }

      await Promise.race([
        deps.sleep(deps.limits.heartbeatMs),
        new Promise<void>((resolve) => (wake = resolve)),
      ]);
      wake = null;

      await quietly(() => batcher.flush(), 'sqs send failed');
      const stopRequested = await heartbeat();
      if (stopRequested === null) reason = 'gone';
      reason ??=
        (revoked ? 'revoked' : null) ??
        stopReason(
          { now: deps.now(), startedAt, lastEventAt, stopRequested: !!stopRequested },
          deps.limits,
        );
    }
  } finally {
    process.removeListener('SIGTERM', terminate);
  }
  return finish(reason ?? 'terminated');

  function accessToken(): string {
    if (!tokens) throw new Error('no tokens');
    return tokens.accessToken;
  }

  async function loadTokens(): Promise<ChzzkTokens> {
    const r = await deps.ssm.send(
      new GetParameterCommand({ Name: tokenParam, WithDecryption: true }),
    );
    let t = JSON.parse(r.Parameter?.Value ?? 'null') as ChzzkTokens | null;
    if (!t?.refreshToken) throw new Error('no tokens');
    if (Date.parse(t.expiresAt) - deps.now() < REFRESH_MARGIN_MS) {
      const secret = await deps.ssm.send(
        new GetParameterCommand({ Name: env.CHZZK_SECRET_PARAM, WithDecryption: true }),
      );
      t = await refreshTokens(
        deps.fetch,
        { clientId: env.CHZZK_CLIENT_ID, clientSecret: secret.Parameter?.Value ?? '' },
        t.refreshToken,
        new Date(deps.now()),
      );
      // 리프레시 토큰은 한 번만 쓸 수 있어서 바로 저장한다. 그사이 연결이 해제됐으면 되살리지 않는다
      const conn = await ddb.send(
        new GetCommand({
          TableName: env.TABLE_NAME,
          Key: { PK: `CONN#chzzk#${env.CHANNEL_ID}`, SK: 'META' },
        }),
      );
      if (!conn.Item) throw new Error('connection removed');
      await deps.ssm.send(
        new PutParameterCommand({
          Name: tokenParam,
          Type: 'SecureString',
          Value: JSON.stringify(t),
          Overwrite: true,
        }),
      );
    }
    return t;
  }

  async function openSession() {
    const url = await createUserSession(deps.fetch, accessToken());
    sessionKey = null;
    const s = deps.connect(url);
    socket = s;
    open = true;
    const closed = () => {
      if (socket !== s) return;
      open = false;
      failures += 1;
      nudge();
    };
    s.on('disconnect', closed);
    s.on('connect_error', closed);
    s.on('SYSTEM', (data) => {
      const m = parseSystem(data);
      if (!m) return;
      if (m.type === 'connected') {
        sessionKey = m.sessionKey;
        void subscribeAll(m.sessionKey).catch((e: unknown) => {
          deps.log('subscribe failed', { error: errorText(e) });
          s.close();
          closed();
        });
      } else if (m.type === 'revoked') {
        // 스트리머가 치지직에서 권한을 거둬들였다
        revoked = true;
        nudge();
      }
    });
    for (const kind of ['CHAT', 'DONATION', 'SUBSCRIPTION'] as const) {
      s.on(kind, (data) => {
        const receivedAt = deps.now();
        const e = normalize(kind, data, {
          broadcastId: env.BROADCAST_ID,
          channelId: env.CHANNEL_ID,
          startedAt,
          receivedAt,
        });
        if (!e) return;
        counts[e.type] += 1;
        lastEventAt = receivedAt;
        batcher.add(e);
      });
    }
  }

  async function subscribeAll(key: string) {
    for (const kind of EVENT_KINDS) await subscribe(deps.fetch, accessToken(), kind, key);
    failures = 0;
    deps.log('subscribed', { kinds: EVENT_KINDS.length });
  }

  /** 상태를 남기고, 스트리머가 종료를 눌렀는지 읽는다. 기록이 지워졌으면 null */
  async function heartbeat(): Promise<boolean | null> {
    try {
      const r = await ddb.send(
        new UpdateCommand({
          TableName: env.TABLE_NAME,
          Key: key,
          UpdateExpression:
            'SET chatCount = :c, donationCount = :d, subscriptionCount = :u, heartbeatAt = :h' +
            (lastEventAt ? ', lastEventAt = :l' : ''),
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: {
            ':c': counts.chat,
            ':d': counts.donation,
            ':u': counts.subscription,
            ':h': new Date(deps.now()).toISOString(),
            ...(lastEventAt ? { ':l': new Date(lastEventAt).toISOString() } : {}),
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return Boolean((r.Attributes as { stopRequested?: boolean } | undefined)?.stopRequested);
    } catch (e) {
      if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return null;
      deps.log('heartbeat failed', { error: errorText(e) });
      return false;
    }
  }

  /** 정리 단계의 실패는 기록만 하고 넘어간다 */
  async function quietly(fn: () => Promise<unknown>, what?: string) {
    try {
      await fn();
    } catch (e) {
      if (what) deps.log(what, { error: errorText(e) });
    }
  }

  async function finish(r: StopReason): Promise<StopReason> {
    const s = socket as SocketLike | null;
    if (s) {
      const keyNow = sessionKey;
      if (keyNow) {
        for (const kind of EVENT_KINDS) {
          await quietly(() => unsubscribe(deps.fetch, accessToken(), kind, keyNow));
        }
      }
      socket = null;
      s.close();
    }
    await quietly(() => batcher.flush(), 'final flush failed');
    const endedAt = new Date(deps.now()).toISOString();
    await quietly(
      () =>
        ddb.send(
          new UpdateCommand({
            TableName: env.TABLE_NAME,
            Key: key,
            UpdateExpression:
              'SET #s = :s, endedAt = :e, stopReason = :r, chatCount = :c, donationCount = :d, subscriptionCount = :u',
            ConditionExpression: 'attribute_exists(PK)',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':s': isCleanStop(r) ? 'done' : 'failed',
              ':e': endedAt,
              ':r': r,
              ':c': counts.chat,
              ':d': counts.donation,
              ':u': counts.subscription,
            },
          }),
        ),
      'final update failed',
    );
    // 이 채널의 "수집 중" 표시를 푼다 (다른 방송으로 바뀌었으면 건드리지 않는다)
    await quietly(() =>
      ddb.send(
        new UpdateCommand({
          TableName: env.TABLE_NAME,
          Key: { PK: `CONN#chzzk#${env.CHANNEL_ID}`, SK: 'META' },
          UpdateExpression: 'REMOVE activeBroadcastId',
          ConditionExpression: 'activeBroadcastId = :id',
          ExpressionAttributeValues: { ':id': env.BROADCAST_ID },
        }),
      ),
    );
    deps.log('collector finished', { reason: r, ...counts, dropped: batcher.dropped });
    return r;
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
