import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Fetch } from '@fitcut/chzzk';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCollector, type Deps, type SocketLike } from './collector';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2' }));
const ssm = new SSMClient({ region: 'ap-northeast-2' });
const sqs = new SQSClient({ region: 'ap-northeast-2' });
const ddbMock = mockClient(ddb);
const ssmMock = mockClient(ssm);
const sqsMock = mockClient(sqs);

const T0 = Date.parse('2026-10-12T10:00:00Z');
const CH = 'ch1';
const BCAST = { PK: `CONN#chzzk#${CH}`, SK: 'BCAST#b1' };

class FakeSocket implements SocketLike {
  handlers = new Map<string, ((d?: unknown) => void)[]>();
  closed = false;
  on(event: string, cb: (d?: unknown) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
  }
  emit(event: string, data?: unknown) {
    for (const cb of this.handlers.get(event) ?? []) cb(data);
  }
  close() {
    this.closed = true;
  }
}

const ok = (content: unknown) =>
  new Response(JSON.stringify({ code: 200, message: null, content }), { status: 200 });

let now = T0;
let sockets: FakeSocket[] = [];
const fetchMock = vi.fn<Fetch>();
const logs: string[] = [];

function deps(over: Partial<Deps> = {}): Deps {
  return {
    env: {
      TABLE_NAME: 't',
      QUEUE_URL: 'https://sqs/q',
      TOKEN_PREFIX: '/fitcut/dev/streamer/',
      CHZZK_CLIENT_ID: 'cid',
      CHZZK_SECRET_PARAM: '/fitcut/dev/chzzk/client-secret',
      BROADCAST_ID: 'b1',
      CHANNEL_ID: CH,
    },
    ddb,
    ssm,
    sqs,
    fetch: fetchMock,
    connect: () => {
      const s = new FakeSocket();
      sockets.push(s);
      // 실제처럼 연결 직후 sessionKey를 준다
      queueMicrotask(() =>
        s.emit('SYSTEM', { type: 'connected', data: { sessionKey: `k${sockets.length}` } }),
      );
      return s;
    },
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      await new Promise((r) => setTimeout(r, 0));
    },
    limits: { maxMs: 8 * 3600_000, idleMs: 30 * 60_000, heartbeatMs: 30_000 },
    log: (msg) => logs.push(msg),
    ...over,
  };
}

const tokens = (expiresAt: string) =>
  JSON.stringify({ accessToken: 'at', refreshToken: 'rt', expiresAt });

/** heartbeat(ReturnValues ALL_NEW)를 n번째에 무엇으로 답할지 */
function heartbeats(script: (n: number) => Record<string, unknown> | 'gone') {
  let n = 0;
  ddbMock.on(UpdateCommand).callsFake((input: { ReturnValues?: string }) => {
    if (input.ReturnValues !== 'ALL_NEW') return {};
    n += 1;
    const r = script(n);
    if (r === 'gone') {
      const e = new Error('cond');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    }
    return { Attributes: r };
  });
}

beforeEach(() => {
  ddbMock.reset();
  ssmMock.reset();
  sqsMock.reset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url) =>
    String(url).endsWith('/open/v1/sessions/auth')
      ? ok({ url: 'https://ssio.example?auth=x' })
      : ok(null),
  );
  sockets = [];
  logs.length = 0;
  now = T0;
  ddbMock.on(GetCommand, { Key: BCAST }).resolves({ Item: { ...BCAST, status: 'starting' } });
  ssmMock
    .on(GetParameterCommand, { Name: `/fitcut/dev/streamer/chzzk/${CH}` })
    .resolves({ Parameter: { Value: tokens('2026-10-13T09:00:00Z') } });
  sqsMock.on(SendMessageCommand).resolves({});
});

const updates = () => ddbMock.commandCalls(UpdateCommand).map((c) => c.args[0].input);
const sentEvents = () =>
  sqsMock
    .commandCalls(SendMessageCommand)
    .flatMap(
      (c) => (JSON.parse(String(c.args[0].input.MessageBody)) as { events: unknown[] }).events,
    );

describe('runCollector', () => {
  it('starting이 아닌 방송은 바로 끝낸다 (중복 실행 방지)', async () => {
    ddbMock.on(GetCommand, { Key: BCAST }).resolves({ Item: { ...BCAST, status: 'done' } });
    expect(await runCollector(deps())).toBe('not_starting');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('구독하고 이벤트를 SQS로 보내며, 종료 요청을 받으면 구독 취소 후 done으로 남긴다', async () => {
    heartbeats((n) => {
      if (n === 1) {
        const s = sockets[0];
        if (!s) throw new Error('no socket');
        s.emit('CHAT', {
          channelId: CH,
          content: 'ㅋㅋ',
          profile: { nickname: '닉' },
          messageTime: T0 + 1000,
        });
        s.emit(
          'DONATION',
          JSON.stringify({ channelId: CH, payAmount: '5000', donatorNickname: '닉2' }),
        );
        s.emit('SUBSCRIPTION', { channelId: CH, tierNo: 1, month: 2 });
        s.emit('CHAT', { channelId: 'other', content: 'x' });
        return {};
      }
      return { stopRequested: true };
    });

    expect(await runCollector(deps())).toBe('requested');

    const calls = fetchMock.mock.calls.map(
      ([u, i]) => `${i?.method} ${String(u).replace('https://openapi.chzzk.naver.com', '')}`,
    );
    expect(calls).toContain('GET /open/v1/sessions/auth');
    for (const kind of ['chat', 'donation', 'subscription']) {
      expect(calls).toContain(`POST /open/v1/sessions/events/subscribe/${kind}?sessionKey=k1`);
      expect(calls).toContain(`POST /open/v1/sessions/events/unsubscribe/${kind}?sessionKey=k1`);
    }
    expect(sockets[0]?.closed).toBe(true);

    const events = sentEvents();
    expect(events).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain('닉');

    const last = updates().find((u) => u.ExpressionAttributeValues?.[':r']);
    expect(last?.ExpressionAttributeValues).toMatchObject({
      ':s': 'done',
      ':r': 'requested',
      ':c': 1,
      ':d': 1,
      ':u': 1,
    });
    // 채널의 수집 중 표시를 푼다
    expect(updates().some((u) => u.UpdateExpression === 'REMOVE activeBroadcastId')).toBe(true);
  });

  it('이벤트가 30분 없으면 idle로 끝낸다', async () => {
    heartbeats(() => ({}));
    expect(await runCollector(deps())).toBe('idle');
    // 30초 간격 → 60번째 확인에서 끝난다
    expect(now - T0).toBe(30 * 60_000);
  });

  it('최대 실행 시간을 넘으면 끝낸다', async () => {
    heartbeats(() => {
      sockets[0]?.emit('CHAT', { channelId: CH, content: 'ㅋ' });
      return {};
    });
    const r = await runCollector(
      deps({ limits: { maxMs: 5 * 60_000, idleMs: 30 * 60_000, heartbeatMs: 30_000 } }),
    );
    expect(r).toBe('max_duration');
  });

  it('권한이 회수되면 failed(revoked)로 남긴다', async () => {
    heartbeats((n) => {
      if (n === 1)
        sockets[0]?.emit('SYSTEM', { type: 'revoked', data: { eventType: 'CHAT', channelId: CH } });
      return {};
    });
    expect(await runCollector(deps())).toBe('revoked');
    const last = updates().find((u) => u.ExpressionAttributeValues?.[':r']);
    expect(last?.ExpressionAttributeValues?.[':s']).toBe('failed');
  });

  it('소켓이 끊기면 새 세션으로 다시 연결한다', async () => {
    heartbeats((n) => {
      if (n === 1) sockets[0]?.emit('disconnect');
      return n >= 3 ? { stopRequested: true } : {};
    });
    expect(await runCollector(deps())).toBe('requested');
    expect(sockets).toHaveLength(2);
    const calls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(calls.some((u) => u.includes('subscribe/chat?sessionKey=k2'))).toBe(true);
  });

  it('계속 연결에 실패하면 disconnected로 끝낸다', async () => {
    heartbeats(() => ({}));
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }));
    expect(await runCollector(deps())).toBe('disconnected');
  });

  it('방송 기록이 지워졌으면(연결 해제) 멈춘다', async () => {
    heartbeats(() => 'gone');
    expect(await runCollector(deps())).toBe('gone');
  });

  it('토큰이 곧 만료되면 갱신하고 바로 저장한다 (리프레시 토큰은 일회용)', async () => {
    ssmMock
      .on(GetParameterCommand, { Name: `/fitcut/dev/streamer/chzzk/${CH}` })
      .resolves({ Parameter: { Value: tokens('2026-10-12T12:00:00Z') } })
      .on(GetParameterCommand, { Name: '/fitcut/dev/chzzk/client-secret' })
      .resolves({ Parameter: { Value: 'shh' } });
    ddbMock
      .on(GetCommand, { Key: { PK: `CONN#chzzk#${CH}`, SK: 'META' } })
      .resolves({ Item: { channelId: CH } });
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith('/auth/v1/token')) {
        return ok({
          accessToken: 'at2',
          refreshToken: 'rt2',
          tokenType: 'Bearer',
          expiresIn: '86400',
        });
      }
      return u.endsWith('/open/v1/sessions/auth') ? ok({ url: 'https://ssio.example' }) : ok(null);
    });
    heartbeats(() => ({ stopRequested: true }));
    expect(await runCollector(deps())).toBe('requested');
    const put = ssmMock.commandCalls(PutParameterCommand)[0]?.args[0].input;
    expect(JSON.parse(put?.Value ?? '{}')).toMatchObject({
      accessToken: 'at2',
      refreshToken: 'rt2',
    });
    const session = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith('/open/v1/sessions/auth'),
    );
    expect((session?.[1]?.headers as Record<string, string>).authorization).toBe('Bearer at2');
  });

  it('토큰이 없으면(연결 해제됨) failed(token)', async () => {
    ssmMock
      .on(GetParameterCommand, { Name: `/fitcut/dev/streamer/chzzk/${CH}` })
      .rejects(new Error('ParameterNotFound'));
    expect(await runCollector(deps())).toBe('token');
    const last = updates().find((u) => u.ExpressionAttributeValues?.[':r']);
    expect(last?.ExpressionAttributeValues?.[':s']).toBe('failed');
  });
});
