/**
 * 스트리머 채널 연결 API (M5, docs/HIGHLIGHT.md, ADR-015·039).
 * - 치지직 OAuth로 연결하고, 우리 세션을 HttpOnly 쿠키로 준다 (세션 값은 해시만 저장)
 * - 플랫폼 토큰은 SSM SecureString(AWS 관리형 키 aws/ssm)에 채널마다 하나씩 둔다
 * - CloudFront를 거친 요청만 받는다 (오리진 확인 헤더, ADR-031)
 * GET    /api/streamer/chzzk/login    : 치지직 인증 화면으로 보낸다 (state는 쿠키 + DynamoDB에 10분)
 * GET    /api/streamer/chzzk/callback : 코드 → 토큰 → 채널 확인 → 저장 → /highlight로 돌아간다
 * GET    /api/streamer/me             : 연결된 채널 { connection: {...} | null }
 * POST   /api/streamer/logout         : 이 브라우저의 세션만 끝낸다 (연결은 유지)
 * DELETE /api/streamer/connection     : 연결 해제. 수집 중이면 멈추고, 플랫폼 토큰 폐기, 저장한 토큰·연결 정보 삭제
 * GET    /api/streamer/broadcasts            : 최근 방송 수집 기록 20개
 * POST   /api/streamer/broadcasts            : 수집 시작 (Fargate 수집기, ADR-040)
 * GET    /api/streamer/broadcasts/{id}       : 방송 하나와 분석 결과 (후보, 10초 단위 채팅 수)
 * POST   /api/streamer/broadcasts/{id}/stop  : 수집 종료 요청
 * POST·GET·DELETE /api/streamer/broadcasts/{id}/recording, …/recording/parts, …/recording/complete
 *        : 모드 B 녹화 파일 멀티파트 올리기 (recording.ts)
 * POST   /api/streamer/broadcasts/{id}/clips  : 녹화 파일에서 구간 클립 잡 만들기 (clips.ts)
 * POST   /api/streamer/broadcasts/{id}/loudness : 녹화 파일 소리 크기 → 분석 (모드 C·B, ADR-044)
 * POST   /api/streamer/broadcasts {source:'file'} : 채팅 없이 녹화 파일만 분석할 기록
 */
import { ECSClient } from '@aws-sdk/client-ecs';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
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
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BROADCAST_ID, BroadcastError, makeBroadcasts, type CollectorEnv } from './broadcasts';
import { makeClips } from './clips';
import { makeRecordings } from './recording';
import {
  authorizeUrl,
  currentUser,
  exchangeCode,
  revokeToken,
  type ChzzkTokens,
  type Fetch,
} from '@fitcut/chzzk';

export type Env = CollectorEnv & {
  /** 모드 B 녹화 파일 버킷 (ADR-042) */
  RECORDINGS_BUCKET: string;
  /** 워커 큐: 클립 잡 (ADR-043) */
  WORKER_QUEUE_URL: string;
  TABLE_NAME: string;
  ORIGIN_PARAM: string;
  CHZZK_CLIENT_ID: string;
  CHZZK_SECRET_PARAM: string;
  /** 스트리머 토큰 파라미터 경로 앞부분. 예: /fitcut/dev/streamer/ */
  TOKEN_PREFIX: string;
  /** 치지직 앱에 등록한 로그인 리디렉션 URL과 정확히 같아야 한다 */
  REDIRECT_URI: string;
};
export type Deps = {
  env: Env;
  ddb: DynamoDBDocumentClient;
  ssm: SSMClient;
  ecs: ECSClient;
  s3: S3Client;
  sqs: SQSClient;
  fetch: Fetch;
  now: () => Date;
};

export const SESSION_COOKIE = 'fitcut_s';
export const STATE_COOKIE = 'fitcut_oauth';
/** 세션 7일. 다시 연결하면 치지직 로그인 한 번으로 끝나므로 길게 두지 않는다 */
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const STATE_SECONDS = 10 * 60;
const CHANNEL_ID = /^[A-Za-z0-9_-]{1,64}$/;

type Connection = {
  platform: 'chzzk';
  channelId: string;
  channelName: string;
  connectedAt: string;
  scope?: string;
};
type Session = { platform: 'chzzk'; channelId: string };

const noStore = { 'cache-control': 'no-store' };
const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', ...noStore },
  body: JSON.stringify(body),
});
const error = (statusCode: number, code: string, message: string) =>
  json(statusCode, { error: { code, message } });
const redirect = (location: string, cookies: string[] = []): APIGatewayProxyStructuredResultV2 => ({
  statusCode: 302,
  headers: { location, ...noStore },
  cookies,
});

const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const sameSecret = (a: string | undefined, b: string) => {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** JSON 본문. 없거나 깨졌으면 빈 객체 (각 함수가 값을 다시 검사한다) */
export function parseBody(body: string | undefined): Record<string, unknown> {
  if (!body) return {};
  try {
    const v: unknown = JSON.parse(body);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function cookie(name: string, value: string, path: string, maxAge: number): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

/** payload 2.0은 쿠키를 "이름=값" 배열로 준다 */
export function readCookie(cookies: string[] | undefined, name: string): string | undefined {
  for (const c of cookies ?? []) {
    const i = c.indexOf('=');
    if (i > 0 && c.slice(0, i).trim() === name) return c.slice(i + 1).trim();
  }
  return undefined;
}

const sessionKey = (raw: string) => ({ PK: `SESS#${hash(raw)}`, SK: 'META' });
const stateKey = (state: string) => ({ PK: `OAUTH#${state}`, SK: 'META' });
const connKey = (channelId: string) => ({ PK: `CONN#chzzk#${channelId}`, SK: 'META' });

export function makeHandler(deps: Deps) {
  const { env, ddb, ssm } = deps;
  const broadcasts = makeBroadcasts({ env, ddb, ecs: deps.ecs, now: deps.now });
  const clips = makeClips({
    table: env.TABLE_NAME,
    queueUrl: env.WORKER_QUEUE_URL,
    ddb,
    sqs: deps.sqs,
    now: deps.now,
  });
  const recordings = makeRecordings({
    table: env.TABLE_NAME,
    bucket: env.RECORDINGS_BUCKET,
    ddb,
    s3: deps.s3,
    now: deps.now,
  });

  const cache = new Map<string, Promise<string>>();
  const secret = (name: string) => {
    let p = cache.get(name);
    if (!p) {
      p = ssm
        .send(new GetParameterCommand({ Name: name, WithDecryption: true }))
        .then((r) => {
          const v = r.Parameter?.Value;
          if (!v) throw new Error(`missing parameter ${name}`);
          return v;
        })
        .catch((e: unknown) => {
          cache.delete(name);
          throw e;
        });
      cache.set(name, p);
    }
    return p;
  };
  const client = async () => ({
    clientId: env.CHZZK_CLIENT_ID,
    clientSecret: await secret(env.CHZZK_SECRET_PARAM),
  });
  const tokenParam = (channelId: string) => `${env.TOKEN_PREFIX}chzzk/${channelId}`;
  const epoch = (seconds: number) => Math.floor(deps.now().getTime() / 1000) + seconds;

  async function session(event: APIGatewayProxyEventV2): Promise<Session | null> {
    const raw = readCookie(event.cookies, SESSION_COOKIE);
    if (!raw) return null;
    const r = await ddb.send(new GetCommand({ TableName: env.TABLE_NAME, Key: sessionKey(raw) }));
    const item = r.Item as (Session & { ttl: number }) | undefined;
    // TTL 삭제는 늦게 일어날 수 있어서 만료를 직접 본다
    if (!item || item.ttl <= epoch(0)) return null;
    return { platform: item.platform, channelId: item.channelId };
  }

  async function login(): Promise<APIGatewayProxyStructuredResultV2> {
    const state = randomBytes(24).toString('base64url');
    await ddb.send(
      new PutCommand({
        TableName: env.TABLE_NAME,
        Item: { ...stateKey(state), ttl: epoch(STATE_SECONDS) },
      }),
    );
    return redirect(authorizeUrl(env.CHZZK_CLIENT_ID, env.REDIRECT_URI, state), [
      cookie(STATE_COOKIE, state, '/api/streamer/chzzk', STATE_SECONDS),
    ]);
  }

  async function callback(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const q = event.queryStringParameters ?? {};
    const clearState = cookie(STATE_COOKIE, '', '/api/streamer/chzzk', 0);
    const back = (error: string) => redirect(`/highlight?error=${error}`, [clearState]);
    const state = q.state ?? '';
    // 이 브라우저가 시작한 로그인인지(쿠키), 아직 안 쓴 state인지(DynamoDB, 한 번만 지운다) 둘 다 본다
    if (!state || !sameSecret(readCookie(event.cookies, STATE_COOKIE), state)) return back('state');
    const used = await ddb.send(
      new DeleteCommand({
        TableName: env.TABLE_NAME,
        Key: stateKey(state),
        ReturnValues: 'ALL_OLD',
      }),
    );
    const stateItem = used.Attributes as { ttl: number } | undefined;
    if (!stateItem || stateItem.ttl <= epoch(0)) return back('state');
    if (!q.code) return back('denied');

    let tokens: ChzzkTokens;
    let channelId: string;
    let channelName: string;
    try {
      tokens = await exchangeCode(deps.fetch, await client(), q.code, state, deps.now());
      ({ channelId, channelName } = await currentUser(deps.fetch, tokens.accessToken));
    } catch (e) {
      console.error('chzzk connect failed', e instanceof Error ? e.message : e);
      return back('chzzk');
    }
    if (!CHANNEL_ID.test(channelId)) return back('chzzk');

    await ssm.send(
      new PutParameterCommand({
        Name: tokenParam(channelId),
        Type: 'SecureString',
        Value: JSON.stringify(tokens),
        Overwrite: true,
      }),
    );
    const connection: Connection = {
      platform: 'chzzk',
      channelId,
      channelName,
      connectedAt: deps.now().toISOString(),
      ...(tokens.scope ? { scope: tokens.scope } : {}),
    };
    await ddb.send(
      new PutCommand({ TableName: env.TABLE_NAME, Item: { ...connKey(channelId), ...connection } }),
    );
    const raw = randomBytes(32).toString('base64url');
    await ddb.send(
      new PutCommand({
        TableName: env.TABLE_NAME,
        Item: { ...sessionKey(raw), platform: 'chzzk', channelId, ttl: epoch(SESSION_SECONDS) },
      }),
    );
    return redirect('/highlight?connected=chzzk', [
      clearState,
      cookie(SESSION_COOKIE, raw, '/api/streamer', SESSION_SECONDS),
    ]);
  }

  async function connectionOf(s: Session): Promise<Connection | null> {
    const r = await ddb.send(
      new GetCommand({ TableName: env.TABLE_NAME, Key: connKey(s.channelId) }),
    );
    const item = r.Item as Connection | undefined;
    if (!item) return null;
    return {
      platform: item.platform,
      channelId: item.channelId,
      channelName: item.channelName,
      connectedAt: item.connectedAt,
    };
  }

  async function endSession(event: APIGatewayProxyEventV2) {
    const raw = readCookie(event.cookies, SESSION_COOKIE);
    if (raw) await ddb.send(new DeleteCommand({ TableName: env.TABLE_NAME, Key: sessionKey(raw) }));
  }
  const clearSession = cookie(SESSION_COOKIE, '', '/api/streamer', 0);

  async function disconnect(
    event: APIGatewayProxyEventV2,
    s: Session,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    await broadcasts.stopActive(s.channelId);
    const name = tokenParam(s.channelId);
    try {
      const r = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
      const tokens = JSON.parse(r.Parameter?.Value ?? '{}') as Partial<ChzzkTokens>;
      // 플랫폼 쪽 권한도 끊는다. 실패해도(이미 만료 등) 우리 쪽 삭제는 계속한다
      if (tokens.refreshToken) {
        await revokeToken(deps.fetch, await client(), tokens.refreshToken, 'refresh_token').catch(
          (e: unknown) => console.warn('chzzk revoke failed', e instanceof Error ? e.message : e),
        );
      }
      await ssm.send(new DeleteParameterCommand({ Name: name }));
    } catch (e) {
      if (!(e instanceof ParameterNotFound)) throw e;
    }
    await ddb.send(new DeleteCommand({ TableName: env.TABLE_NAME, Key: connKey(s.channelId) }));
    // 다른 브라우저의 세션은 연결 정보가 없어서 /me에서 끊긴 것으로 보인다
    await endSession(event);
    return { statusCode: 204, headers: noStore, cookies: [clearSession] };
  }

  async function recording(
    event: APIGatewayProxyEventV2,
    channelId: string,
    id: string,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const body = parseBody(event.body);
    switch (event.routeKey) {
      case 'POST /api/streamer/broadcasts/{id}/recording':
        return json(201, { recording: await recordings.create(channelId, id, body) });
      case 'GET /api/streamer/broadcasts/{id}/recording':
        return json(200, await recordings.status(channelId, id));
      case 'POST /api/streamer/broadcasts/{id}/recording/parts':
        return json(200, await recordings.presign(channelId, id, body.partNumbers));
      case 'POST /api/streamer/broadcasts/{id}/recording/complete':
        return json(200, { recording: await recordings.complete(channelId, id) });
      default:
        await recordings.remove(channelId, id);
        return { statusCode: 204, headers: noStore };
    }
  }

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    if (!sameSecret(event.headers['x-origin-verify'], await secret(env.ORIGIN_PARAM))) {
      return error(403, 'forbidden', '허용되지 않은 요청이에요.');
    }
    switch (event.routeKey) {
      case 'GET /api/streamer/chzzk/login':
        return login();
      case 'GET /api/streamer/chzzk/callback':
        return callback(event);
      case 'GET /api/streamer/me': {
        const s = await session(event);
        const connection = s ? await connectionOf(s) : null;
        return connection
          ? json(200, { connection })
          : { ...json(200, { connection: null }), ...(s ? { cookies: [clearSession] } : {}) };
      }
      case 'POST /api/streamer/logout':
        await endSession(event);
        return { statusCode: 204, headers: noStore, cookies: [clearSession] };
      case 'DELETE /api/streamer/connection': {
        const s = await session(event);
        if (!s) return error(401, 'no_session', '채널 연결을 다시 해 주세요.');
        return disconnect(event, s);
      }
      case 'GET /api/streamer/broadcasts':
      case 'POST /api/streamer/broadcasts':
      case 'GET /api/streamer/broadcasts/{id}':
      case 'POST /api/streamer/broadcasts/{id}/stop':
      case 'POST /api/streamer/broadcasts/{id}/recording':
      case 'GET /api/streamer/broadcasts/{id}/recording':
      case 'POST /api/streamer/broadcasts/{id}/recording/parts':
      case 'POST /api/streamer/broadcasts/{id}/recording/complete':
      case 'DELETE /api/streamer/broadcasts/{id}/recording':
      case 'POST /api/streamer/broadcasts/{id}/clips':
      case 'POST /api/streamer/broadcasts/{id}/loudness': {
        const s = await session(event);
        if (!s) return error(401, 'no_session', '채널 연결을 다시 해 주세요.');
        try {
          if (event.routeKey === 'GET /api/streamer/broadcasts') {
            return json(200, { broadcasts: await broadcasts.list(s.channelId) });
          }
          if (event.routeKey === 'POST /api/streamer/broadcasts') {
            // { source: 'file' }이면 채팅 없이 녹화 파일만 분석할 기록 (모드 C)
            const broadcast =
              parseBody(event.body).source === 'file'
                ? await broadcasts.createFile(s.channelId)
                : await broadcasts.start(s.channelId);
            return json(201, { broadcast });
          }
          const id = event.pathParameters?.id ?? '';
          if (!BROADCAST_ID.test(id)) return error(404, 'not_found', '방송 기록이 없어요.');
          if (event.routeKey.includes('/recording')) return recording(event, s.channelId, id);
          if (event.routeKey.endsWith('/clips')) {
            return json(201, await clips.create(s.channelId, id, parseBody(event.body)));
          }
          if (event.routeKey.endsWith('/loudness')) {
            return json(201, await clips.loudness(s.channelId, id, parseBody(event.body)));
          }
          if (event.routeKey.startsWith('GET')) {
            return json(200, { broadcast: await broadcasts.detail(s.channelId, id) });
          }
          return json(200, { broadcast: await broadcasts.stop(s.channelId, id) });
        } catch (e) {
          if (e instanceof BroadcastError) return error(e.status, e.code, e.message);
          throw e;
        }
      }
      default:
        return error(404, 'not_found', '없는 주소예요.');
    }
  };
}

let real: ReturnType<typeof makeHandler> | null = null;

const ENV_NAMES = [
  'TABLE_NAME',
  'ORIGIN_PARAM',
  'CHZZK_CLIENT_ID',
  'CHZZK_SECRET_PARAM',
  'TOKEN_PREFIX',
  'REDIRECT_URI',
  'CLUSTER',
  'TASK_FAMILY',
  'SUBNETS',
  'SECURITY_GROUP',
  'RECORDINGS_BUCKET',
  'WORKER_QUEUE_URL',
] as const;

export const handler = (event: APIGatewayProxyEventV2) => {
  const missing = ENV_NAMES.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`env ${missing.join(', ')} required`);
  const env = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n] as string])) as Env;
  real ??= makeHandler({
    env,
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    ssm: new SSMClient({}),
    ecs: new ECSClient({}),
    s3: new S3Client({}),
    sqs: new SQSClient({}),
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
  });
  return real(event);
};
