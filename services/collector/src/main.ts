/**
 * Fargate 태스크 진입점. 하이라이트 API가 RunTask로 방송 하나에 하나씩 띄운다 (ADR-040).
 * 환경 변수는 태스크 정의(고정값)와 RunTask overrides(BROADCAST_ID, CHANNEL_ID)로 받는다.
 */
import { SOCKET_OPTIONS } from '@fitcut/chzzk';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import io from 'socket.io-client';
import { runCollector, type Env, type SocketLike } from './collector';
import { DEFAULT_LIMITS } from './rules';

const NAMES = [
  'TABLE_NAME',
  'QUEUE_URL',
  'ANALYSIS_QUEUE_URL',
  'TOKEN_PREFIX',
  'CHZZK_CLIENT_ID',
  'CHZZK_SECRET_PARAM',
  'BROADCAST_ID',
  'CHANNEL_ID',
] as const;

function readEnv(): Env {
  const missing = NAMES.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`env ${missing.join(', ')} required`);
  return Object.fromEntries(NAMES.map((n) => [n, process.env[n] as string])) as Env;
}

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ msg, ...extra }));

let env: Env;
try {
  env = readEnv();
} catch (e) {
  log('bad config', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
}
const minutes = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v * 60_000 : fallback;
};

runCollector({
  env,
  ddb: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  ssm: new SSMClient({}),
  sqs: new SQSClient({}),
  fetch: (input, init) => fetch(input, init),
  connect: (url) =>
    io(url, {
      ...SOCKET_OPTIONS,
      transports: [...SOCKET_OPTIONS.transports],
      // Node 24에는 브라우저식 WebSocket이 있어서, 그대로 두면 engine.io가 그것을 쓴다. 검증된 ws 패키지를 쓰게 한다
      forceNode: true,
    } as SocketIOClient.ConnectOpts) as unknown as SocketLike,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  limits: {
    maxMs: minutes('MAX_MINUTES', DEFAULT_LIMITS.maxMs),
    idleMs: minutes('IDLE_MINUTES', DEFAULT_LIMITS.idleMs),
    heartbeatMs: 30_000,
  },
  log,
})
  .then((reason) => {
    log('exit', { reason });
    process.exit(0);
  })
  .catch((e: unknown) => {
    log('crashed', { error: e instanceof Error ? e.stack : String(e) });
    process.exit(1);
  });
