import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ECSClient } from '@aws-sdk/client-ecs';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  DeleteParameterCommand,
  GetParameterCommand,
  ParameterNotFound,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeHandler, readCookie } from './api';
import type { Fetch } from '@koicut/chzzk';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2' }));
const ssm = new SSMClient({ region: 'ap-northeast-2' });
const ddbMock = mockClient(ddb);
const ssmMock = mockClient(ssm);
const ecs = new ECSClient({ region: 'ap-northeast-2' });
const NOW = new Date('2026-10-12T09:00:00Z');
const NOW_S = NOW.getTime() / 1000;
const CHANNEL = '909501f048b44cf0d5c1d28aaaaaaaa1';

const fetchMock = vi.fn<Fetch>();
const handler = makeHandler({
  env: {
    TABLE_NAME: 't',
    ORIGIN_PARAM: '/fitcut/dev/origin-verify',
    CHZZK_CLIENT_ID: 'client-1',
    CHZZK_SECRET_PARAM: '/fitcut/dev/chzzk/client-secret',
    TOKEN_PREFIX: '/fitcut/dev/streamer/',
    REDIRECT_URI: 'https://fitcut.example/api/streamer/chzzk/callback',
    CLUSTER: 'cluster',
    TASK_FAMILY: 'fitcut-dev-collector',
    SUBNETS: 'subnet-a,subnet-b',
    SECURITY_GROUP: 'sg-1',
    RECORDINGS_BUCKET: 'rec',
    WORKER_QUEUE_URL: 'https://sqs/worker',
  },
  ddb,
  ssm,
  ecs,
  s3: new S3Client({ region: 'ap-northeast-2' }),
  sqs: new SQSClient({ region: 'ap-northeast-2' }),
  fetch: fetchMock,
  now: () => NOW,
});

function event(
  routeKey: string,
  opts: { cookies?: string[]; query?: Record<string, string>; origin?: string } = {},
): APIGatewayProxyEventV2 {
  return {
    routeKey,
    headers: { 'x-origin-verify': opts.origin ?? 'secret' },
    queryStringParameters: opts.query ?? {},
    ...(opts.cookies ? { cookies: opts.cookies } : {}),
  } as unknown as APIGatewayProxyEventV2;
}

const chzzk = (content: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { code: 200, message: null, content }
        : { code: status, message: 'INVALID_TOKEN' },
    ),
    {
      status,
    },
  );

beforeEach(() => {
  ddbMock.reset();
  ssmMock.reset();
  fetchMock.mockReset();
  ssmMock
    .on(GetParameterCommand, { Name: '/fitcut/dev/origin-verify' })
    .resolves({ Parameter: { Value: 'secret' } });
  ssmMock
    .on(GetParameterCommand, { Name: '/fitcut/dev/chzzk/client-secret' })
    .resolves({ Parameter: { Value: 'shh' } });
});

describe('readCookie', () => {
  it('payload 2.0 쿠키 배열에서 값을 찾는다', () => {
    expect(readCookie(['a=1', ' fitcut_s=abc=def'], 'fitcut_s')).toBe('abc=def');
    expect(readCookie(undefined, 'fitcut_s')).toBeUndefined();
  });
});

describe('streamer api', () => {
  it('CloudFront를 거치지 않은 요청은 막는다', async () => {
    const r = await handler(event('GET /api/streamer/me', { origin: 'nope' }));
    expect(r.statusCode).toBe(403);
  });

  it('login: state를 저장하고 쿠키와 함께 치지직 인증 화면으로 보낸다', async () => {
    const r = await handler(event('GET /api/streamer/chzzk/login'));
    expect(r.statusCode).toBe(302);
    const location = new URL(String(r.headers?.location));
    expect(location.origin + location.pathname).toBe('https://chzzk.naver.com/account-interlock');
    expect(location.searchParams.get('clientId')).toBe('client-1');
    expect(location.searchParams.get('redirectUri')).toBe(
      'https://fitcut.example/api/streamer/chzzk/callback',
    );
    const state = location.searchParams.get('state') ?? '';
    expect(state.length).toBeGreaterThan(20);
    expect(r.cookies?.[0]).toContain(`fitcut_oauth=${state}`);
    expect(r.cookies?.[0]).toContain('HttpOnly');
    const put = ddbMock.commandCalls(PutCommand)[0]?.args[0].input;
    expect(put?.Item).toEqual({ PK: `OAUTH#${state}`, SK: 'META', ttl: NOW_S + 600 });
  });

  describe('callback', () => {
    const ok = () => {
      ddbMock.on(DeleteCommand).resolves({ Attributes: { ttl: NOW_S + 300 } });
      fetchMock
        .mockResolvedValueOnce(
          chzzk({ accessToken: 'at', refreshToken: 'rt', tokenType: 'Bearer', expiresIn: '86400' }),
        )
        .mockResolvedValueOnce(chzzk({ channelId: CHANNEL, channelName: '테스트채널' }));
    };

    it('토큰을 SSM에 암호화해 두고, 연결 정보와 세션을 만든다', async () => {
      ok();
      const r = await handler(
        event('GET /api/streamer/chzzk/callback', {
          query: { code: 'c1', state: 'st' },
          cookies: ['fitcut_oauth=st'],
        }),
      );
      expect(r.statusCode).toBe(302);
      expect(r.headers?.location).toBe('/highlight?connected=chzzk');

      const [tokenCall, userCall] = fetchMock.mock.calls;
      expect(tokenCall?.[0]).toBe('https://openapi.chzzk.naver.com/auth/v1/token');
      expect(JSON.parse(String(tokenCall?.[1]?.body))).toEqual({
        grantType: 'authorization_code',
        clientId: 'client-1',
        clientSecret: 'shh',
        code: 'c1',
        state: 'st',
      });
      expect(userCall?.[0]).toBe('https://openapi.chzzk.naver.com/open/v1/users/me');
      expect((userCall?.[1]?.headers as Record<string, string>).authorization).toBe('Bearer at');

      const put = ssmMock.commandCalls(PutParameterCommand)[0]?.args[0].input;
      expect(put?.Name).toBe(`/fitcut/dev/streamer/chzzk/${CHANNEL}`);
      expect(put?.Type).toBe('SecureString');
      expect(JSON.parse(put?.Value ?? '')).toEqual({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: '2026-10-13T09:00:00.000Z',
      });

      const items = ddbMock.commandCalls(PutCommand).map((c) => c.args[0].input.Item);
      const conn = items.find((i) => i?.PK === `CONN#chzzk#${CHANNEL}`);
      expect(conn).toMatchObject({ channelName: '테스트채널', platform: 'chzzk' });
      // 토큰은 DynamoDB에 두지 않는다
      expect(JSON.stringify(items)).not.toContain('"rt"');
      const sess = items.find((i) => String(i?.PK).startsWith('SESS#'));
      expect(sess).toMatchObject({ channelId: CHANNEL, ttl: NOW_S + 7 * 86400 });

      const sessionCookie = r.cookies?.find((c) => c.startsWith('fitcut_s='));
      expect(sessionCookie).toContain('Path=/api/streamer');
      expect(sessionCookie).toContain('HttpOnly');
      expect(sessionCookie).toContain('Secure');
      // 쿠키 값 그대로가 아니라 해시를 키로 쓴다
      const raw = sessionCookie?.split(';')[0]?.split('=')[1] ?? '';
      expect(String(sess?.PK)).not.toContain(raw);
    });

    it('쿠키의 state와 다르면 거절한다 (다른 브라우저가 시작한 로그인)', async () => {
      ok();
      const r = await handler(
        event('GET /api/streamer/chzzk/callback', {
          query: { code: 'c1', state: 'st' },
          cookies: ['fitcut_oauth=other'],
        }),
      );
      expect(r.headers?.location).toBe('/highlight?error=state');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('이미 쓴 state는 거절한다', async () => {
      ddbMock.on(DeleteCommand).resolves({});
      const r = await handler(
        event('GET /api/streamer/chzzk/callback', {
          query: { code: 'c1', state: 'st' },
          cookies: ['fitcut_oauth=st'],
        }),
      );
      expect(r.headers?.location).toBe('/highlight?error=state');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('코드 없이 돌아오면(동의 안 함) 안내한다', async () => {
      ddbMock.on(DeleteCommand).resolves({ Attributes: { ttl: NOW_S + 300 } });
      const r = await handler(
        event('GET /api/streamer/chzzk/callback', {
          query: { state: 'st' },
          cookies: ['fitcut_oauth=st'],
        }),
      );
      expect(r.headers?.location).toBe('/highlight?error=denied');
    });

    it('치지직이 실패하면 아무것도 저장하지 않는다', async () => {
      ddbMock.on(DeleteCommand).resolves({ Attributes: { ttl: NOW_S + 300 } });
      fetchMock.mockResolvedValueOnce(chzzk(null, 401));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const r = await handler(
        event('GET /api/streamer/chzzk/callback', {
          query: { code: 'c1', state: 'st' },
          cookies: ['fitcut_oauth=st'],
        }),
      );
      expect(r.headers?.location).toBe('/highlight?error=chzzk');
      expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });
  });

  describe('me', () => {
    /** 세션(SESS#)은 살아 있고, 연결 정보(CONN#)는 주어진 값 */
    const getItems = (conn: Record<string, unknown> | undefined) =>
      ddbMock
        .on(GetCommand)
        .callsFake((input: { Key: { PK: string } }) =>
          input.Key.PK.startsWith('SESS#')
            ? { Item: { channelId: CHANNEL, platform: 'chzzk', ttl: NOW_S + 100 } }
            : conn
              ? { Item: { PK: input.Key.PK, SK: 'META', ...conn } }
              : {},
        );
    it('세션이 없으면 connection: null', async () => {
      const r = await handler(event('GET /api/streamer/me'));
      expect(JSON.parse(String(r.body))).toEqual({ connection: null });
    });

    it('만료된 세션은 없는 것으로 본다', async () => {
      ddbMock
        .on(GetCommand)
        .resolves({ Item: { channelId: CHANNEL, platform: 'chzzk', ttl: NOW_S - 1 } });
      const r = await handler(event('GET /api/streamer/me', { cookies: ['fitcut_s=raw'] }));
      expect(JSON.parse(String(r.body))).toEqual({ connection: null });
    });

    it('연결된 채널을 돌려준다', async () => {
      getItems({
        platform: 'chzzk',
        channelId: CHANNEL,
        channelName: '테스트채널',
        connectedAt: NOW.toISOString(),
      });
      const r = await handler(event('GET /api/streamer/me', { cookies: ['fitcut_s=raw'] }));
      expect(JSON.parse(String(r.body))).toEqual({
        connection: {
          platform: 'chzzk',
          channelId: CHANNEL,
          channelName: '테스트채널',
          connectedAt: NOW.toISOString(),
        },
      });
    });

    it('연결이 해제된 채널의 세션은 쿠키를 지운다', async () => {
      getItems(undefined);
      const r = await handler(event('GET /api/streamer/me', { cookies: ['fitcut_s=raw'] }));
      expect(JSON.parse(String(r.body))).toEqual({ connection: null });
      expect(r.cookies?.[0]).toContain('Max-Age=0');
    });
  });

  describe('disconnect', () => {
    const withSession = () =>
      ddbMock
        .on(GetCommand)
        .resolves({ Item: { channelId: CHANNEL, platform: 'chzzk', ttl: NOW_S + 100 } });

    it('세션이 없으면 401', async () => {
      const r = await handler(event('DELETE /api/streamer/connection'));
      expect(r.statusCode).toBe(401);
    });

    it('플랫폼 토큰을 폐기하고 저장한 토큰·연결·세션을 지운다', async () => {
      withSession();
      ssmMock.on(GetParameterCommand, { Name: `/fitcut/dev/streamer/chzzk/${CHANNEL}` }).resolves({
        Parameter: { Value: JSON.stringify({ accessToken: 'at', refreshToken: 'rt' }) },
      });
      fetchMock.mockResolvedValueOnce(chzzk(null));
      const r = await handler(
        event('DELETE /api/streamer/connection', { cookies: ['fitcut_s=raw'] }),
      );
      expect(r.statusCode).toBe(204);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://openapi.chzzk.naver.com/auth/v1/token/revoke',
      );
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
        token: 'rt',
        tokenTypeHint: 'refresh_token',
      });
      expect(ssmMock.commandCalls(DeleteParameterCommand)[0]?.args[0].input.Name).toBe(
        `/fitcut/dev/streamer/chzzk/${CHANNEL}`,
      );
      const deleted = ddbMock.commandCalls(DeleteCommand).map((c) => c.args[0].input.Key?.PK);
      expect(deleted).toContain(`CONN#chzzk#${CHANNEL}`);
      expect(deleted.some((k) => String(k).startsWith('SESS#'))).toBe(true);
      expect(r.cookies?.[0]).toContain('Max-Age=0');
    });

    it('플랫폼 폐기가 실패해도 우리 쪽은 지운다', async () => {
      withSession();
      ssmMock
        .on(GetParameterCommand, { Name: `/fitcut/dev/streamer/chzzk/${CHANNEL}` })
        .resolves({ Parameter: { Value: JSON.stringify({ refreshToken: 'rt' }) } });
      fetchMock.mockResolvedValueOnce(chzzk(null, 401));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = await handler(
        event('DELETE /api/streamer/connection', { cookies: ['fitcut_s=raw'] }),
      );
      expect(r.statusCode).toBe(204);
      expect(ssmMock.commandCalls(DeleteParameterCommand)).toHaveLength(1);
    });

    it('토큰 파라미터가 이미 없어도 연결 정보는 지운다', async () => {
      withSession();
      ssmMock
        .on(GetParameterCommand, { Name: `/fitcut/dev/streamer/chzzk/${CHANNEL}` })
        .rejects(new ParameterNotFound({ message: 'nope', $metadata: {} }));
      const r = await handler(
        event('DELETE /api/streamer/connection', { cookies: ['fitcut_s=raw'] }),
      );
      expect(r.statusCode).toBe(204);
      const deleted = ddbMock.commandCalls(DeleteCommand).map((c) => c.args[0].input.Key?.PK);
      expect(deleted).toContain(`CONN#chzzk#${CHANNEL}`);
    });
  });

  it('logout은 세션만 지운다', async () => {
    const r = await handler(event('POST /api/streamer/logout', { cookies: ['fitcut_s=raw'] }));
    expect(r.statusCode).toBe(204);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1);
    expect(ssmMock.commandCalls(DeleteParameterCommand)).toHaveLength(0);
  });

  describe('broadcasts', () => {
    it('세션이 없으면 401', async () => {
      const r = await handler(event('POST /api/streamer/broadcasts'));
      expect(r.statusCode).toBe(401);
    });

    it('잘못된 방송 ID는 404', async () => {
      ddbMock
        .on(GetCommand)
        .resolves({ Item: { channelId: CHANNEL, platform: 'chzzk', ttl: NOW_S + 100 } });
      const r = await handler({
        ...event('POST /api/streamer/broadcasts/{id}/stop', { cookies: ['fitcut_s=raw'] }),
        pathParameters: { id: '../x' },
      } as unknown as APIGatewayProxyEventV2);
      expect(r.statusCode).toBe(404);
    });
  });
});
