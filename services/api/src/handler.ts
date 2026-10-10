/**
 * 잡 API Lambda (HTTP API, CloudFront /api/* 뒤).
 * - POST /api/jobs: 입력 검사 → IP 해시별 하루 할당량 → 잡 기록 → S3 업로드 주소(presigned POST)
 * - GET /api/jobs/{id}: 잡 상태
 * CloudFront만 부를 수 있게 오리진 확인 헤더를 검사한다 (API Gateway 기본 주소로 바로 오는 요청은 거절).
 */
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { clientIp, ipHash, quotaExpiry, quotaKey } from './client';
import { isJobId, jobKey, newJob, publicJob, type JobItem } from './jobs';
import { LIMITS } from './limits';
import { parseCreateJob } from './validate';

export type Env = {
  TABLE_NAME: string;
  UPLOADS_BUCKET: string;
  SALT_PARAM: string;
  ORIGIN_PARAM: string;
  DAILY_JOB_LIMIT: string;
};

type Deps = {
  env: Env;
  ddb: DynamoDBDocumentClient;
  s3: S3Client;
  ssm: SSMClient;
  now: () => Date;
  newId: () => string;
};

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

const error = (statusCode: number, code: string, message: string) =>
  json(statusCode, { error: { code, message } });

function sameSecret(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function makeHandler(deps: Deps) {
  const { env, ddb, s3, ssm } = deps;
  // 비밀값은 콜드 스타트에 한 번만 읽는다
  let secrets: Promise<{ salt: string; origin: string }> | null = null;
  const loadSecrets = () =>
    (secrets ??= ssm
      .send(
        new GetParametersCommand({
          Names: [env.SALT_PARAM, env.ORIGIN_PARAM],
          WithDecryption: true,
        }),
      )
      .then((r) => {
        const value = (name: string) => r.Parameters?.find((p) => p.Name === name)?.Value;
        const salt = value(env.SALT_PARAM);
        const origin = value(env.ORIGIN_PARAM);
        if (!salt || !origin) throw new Error('missing secrets');
        return { salt, origin };
      })
      .catch((e: unknown) => {
        secrets = null;
        throw e;
      }));

  async function createJob(event: APIGatewayProxyEventV2, salt: string) {
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '');
    } catch {
      return error(400, 'bad_body', '요청 형식이 올바르지 않아요.');
    }
    const parsed = parseCreateJob(body);
    if (!parsed.ok) return error(400, parsed.error.code, parsed.error.message);

    const now = deps.now();
    const ip = clientIp(
      event.headers['cloudfront-viewer-address'],
      event.requestContext.http.sourceIp,
    );
    const limit = Number(env.DAILY_JOB_LIMIT);
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.TABLE_NAME,
          Key: quotaKey(ipHash(ip, salt), now),
          UpdateExpression: 'ADD #c :one SET #t = if_not_exists(#t, :ttl)',
          ConditionExpression: 'attribute_not_exists(#c) OR #c < :limit',
          ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
          ExpressionAttributeValues: { ':one': 1, ':limit': limit, ':ttl': quotaExpiry(now) },
        }),
      );
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) {
        return error(
          429,
          'daily_limit',
          `오늘은 ${limit}번까지 만들 수 있어요. 내일 다시 이용해 주세요.`,
        );
      }
      throw e;
    }

    const job = newJob(deps.newId(), parsed.value, now);
    await ddb.send(
      new PutCommand({
        TableName: env.TABLE_NAME,
        Item: job,
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    const upload = await createPresignedPost(s3, {
      Bucket: env.UPLOADS_BUCKET,
      Key: job.inputKey,
      Conditions: [
        ['content-length-range', 1, LIMITS.maxUploadBytes],
        ['eq', '$Content-Type', job.contentType],
      ],
      Fields: { 'Content-Type': job.contentType },
      Expires: LIMITS.uploadUrlSeconds,
    });
    return json(201, { job: publicJob(job, now), upload });
  }

  async function getJob(id: string | undefined) {
    if (!isJobId(id)) return error(404, 'not_found', '작업을 찾을 수 없어요.');
    const r = await ddb.send(new GetCommand({ TableName: env.TABLE_NAME, Key: jobKey(id) }));
    const job = publicJob(r.Item as JobItem | undefined, deps.now());
    return job ? json(200, { job }) : error(404, 'not_found', '작업을 찾을 수 없어요.');
  }

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const { salt, origin } = await loadSecrets();
    if (!sameSecret(event.headers['x-origin-verify'], origin)) {
      return error(403, 'forbidden', '허용되지 않은 요청이에요.');
    }
    switch (event.routeKey) {
      case 'POST /api/jobs':
        return createJob(event, salt);
      case 'GET /api/jobs/{id}':
        return getJob(event.pathParameters?.id);
      default:
        return error(404, 'not_found', '없는 주소예요.');
    }
  };
}

function env(): Env {
  const names = [
    'TABLE_NAME',
    'UPLOADS_BUCKET',
    'SALT_PARAM',
    'ORIGIN_PARAM',
    'DAILY_JOB_LIMIT',
  ] as const;
  const out = {} as Env;
  for (const name of names) {
    const value = process.env[name];
    if (!value) throw new Error(`env ${name} is required`);
    out[name] = value;
  }
  return out;
}

// Lambda 진입점. 테스트는 makeHandler에 가짜 의존성을 넣어 부른다.
let real: ReturnType<typeof makeHandler> | null = null;
export const handler = (event: APIGatewayProxyEventV2) => {
  real ??= makeHandler({
    env: env(),
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    }),
    s3: new S3Client({}),
    ssm: new SSMClient({}),
    now: () => new Date(),
    newId: () => randomUUID(),
  });
  return real(event);
};
