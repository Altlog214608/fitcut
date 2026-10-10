/**
 * 잡 API Lambda (HTTP API, CloudFront /api/* 뒤). 흐름은 ADR-033.
 * - POST /api/uploads: 입력 검사 → 하루 업로드 할당량 → 업로드 기록 → S3 업로드 주소(presigned POST)
 *   화면은 영상을 고르자마자 올리고, 그동안 구간을 고른다.
 * - POST /api/jobs: 입력 검사 → 업로드가 끝났는지 확인 → 하루 잡 할당량 → 잡 기록 → 워커 큐에 넣기
 * - GET /api/jobs/{id}: 잡 상태 (끝났으면 내려받기 주소)
 * - POST /api/events: 사용 이벤트 묶음 → 허용한 이벤트·필드만 → 이벤트 큐 (docs/ADMIN.md)
 * CloudFront만 부를 수 있게 오리진 확인 헤더를 검사한다 (API Gateway 기본 주소로 바로 오는 요청은 거절).
 */
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { clientIp, ipHash, quotaExpiry, quotaKey } from './client';
import {
  downloadName,
  isLive,
  isUuid,
  jobKey,
  newJob,
  newUpload,
  publicJob,
  uploadKey,
  type JobItem,
  type UploadItem,
} from './jobs';
import { LIMITS } from './limits';
import { cleanEvent, MAX_EVENTS_PER_REQUEST, type JobEvent } from '@fitcut/shared';
import { parseCreateJob, parseCreateUpload } from './validate';

export type Env = {
  TABLE_NAME: string;
  UPLOADS_BUCKET: string;
  OUTPUTS_BUCKET: string;
  QUEUE_URL: string;
  EVENTS_QUEUE_URL: string;
  SALT_PARAM: string;
  ORIGIN_PARAM: string;
  DAILY_JOB_LIMIT: string;
  DAILY_UPLOAD_LIMIT: string;
};

type Deps = {
  env: Env;
  ddb: DynamoDBDocumentClient;
  s3: S3Client;
  sqs: SQSClient;
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

function readBody(event: APIGatewayProxyEventV2): { ok: true; body: unknown } | { ok: false } {
  try {
    return { ok: true, body: JSON.parse(event.body ?? '') };
  } catch {
    return { ok: false };
  }
}

const isNotFound = (e: unknown) => {
  const name = (e as { name?: string }).name;
  return name === 'NotFound' || name === 'NoSuchKey';
};

export function makeHandler(deps: Deps) {
  const { env, ddb, s3, sqs, ssm } = deps;
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

  /**
   * IP 해시별 하루 할당량을 하나 쓴다. 넘으면 false.
   * 같은 기록에 잡 수(count)와 업로드 수(uploads)를 따로 센다.
   */
  async function useQuota(
    event: APIGatewayProxyEventV2,
    salt: string,
    counter: 'count' | 'uploads',
    limit: number,
  ): Promise<boolean> {
    const now = deps.now();
    const ip = clientIp(
      event.headers['cloudfront-viewer-address'],
      event.requestContext.http.sourceIp,
    );
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.TABLE_NAME,
          Key: quotaKey(ipHash(ip, salt), now),
          UpdateExpression: 'ADD #c :one SET #t = if_not_exists(#t, :ttl)',
          ConditionExpression: 'attribute_not_exists(#c) OR #c < :limit',
          ExpressionAttributeNames: { '#c': counter, '#t': 'ttl' },
          ExpressionAttributeValues: { ':one': 1, ':limit': limit, ':ttl': quotaExpiry(now) },
        }),
      );
      return true;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false;
      throw e;
    }
  }

  async function createUpload(event: APIGatewayProxyEventV2, salt: string) {
    const read = readBody(event);
    if (!read.ok) return error(400, 'bad_body', '요청 형식이 올바르지 않아요.');
    const parsed = parseCreateUpload(read.body);
    if (!parsed.ok) return error(400, parsed.error.code, parsed.error.message);

    const limit = Number(env.DAILY_UPLOAD_LIMIT);
    if (!(await useQuota(event, salt, 'uploads', limit))) {
      return error(
        429,
        'daily_upload_limit',
        `오늘은 영상을 ${limit}번까지 올릴 수 있어요. 내일 다시 이용해 주세요.`,
      );
    }

    const now = deps.now();
    const upload = newUpload(deps.newId(), parsed.value, now);
    await ddb.send(
      new PutCommand({
        TableName: env.TABLE_NAME,
        Item: upload,
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    const post = await createPresignedPost(s3, {
      Bucket: env.UPLOADS_BUCKET,
      Key: upload.inputKey,
      Conditions: [
        ['content-length-range', 1, LIMITS.maxUploadBytes],
        ['eq', '$Content-Type', upload.contentType],
      ],
      Fields: { 'Content-Type': upload.contentType },
      Expires: LIMITS.uploadUrlSeconds,
    });
    return json(201, { upload: { id: upload.id, url: post.url, fields: post.fields } });
  }

  async function createJob(event: APIGatewayProxyEventV2, salt: string) {
    const read = readBody(event);
    if (!read.ok) return error(400, 'bad_body', '요청 형식이 올바르지 않아요.');
    const parsed = parseCreateJob(read.body);
    if (!parsed.ok) return error(400, parsed.error.code, parsed.error.message);

    const now = deps.now();
    const r = await ddb.send(
      new GetCommand({ TableName: env.TABLE_NAME, Key: uploadKey(parsed.value.uploadId) }),
    );
    const upload = r.Item as UploadItem | undefined;
    if (!upload || !isLive(upload, now)) {
      return error(404, 'upload_not_found', '올린 영상을 찾을 수 없어요. 영상을 다시 골라 주세요.');
    }
    // 업로드가 끝났는지 확인한다. 화면은 업로드가 끝난 뒤에 부르지만, 끝나기 전에 잡을 만들면
    // 워커가 원본 없이 돌게 된다
    try {
      await s3.send(new HeadObjectCommand({ Bucket: env.UPLOADS_BUCKET, Key: upload.inputKey }));
    } catch (e) {
      if (!isNotFound(e)) throw e;
      return error(
        409,
        'not_uploaded',
        '영상이 아직 다 올라가지 않았어요. 잠시 후 다시 시도해 주세요.',
      );
    }

    const limit = Number(env.DAILY_JOB_LIMIT);
    if (!(await useQuota(event, salt, 'count', limit))) {
      return error(
        429,
        'daily_limit',
        `오늘은 ${limit}번까지 만들 수 있어요. 내일 다시 이용해 주세요.`,
      );
    }

    const job = newJob(deps.newId(), parsed.value, upload, now);
    await ddb.send(
      new PutCommand({
        TableName: env.TABLE_NAME,
        Item: job,
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    try {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: env.QUEUE_URL,
          MessageBody: JSON.stringify({ jobId: job.id }),
        }),
      );
    } catch (e) {
      // 큐에 못 넣은 잡이 queued로 남지 않게 실패로 바꿔 둔다
      await ddb.send(
        new UpdateCommand({
          TableName: env.TABLE_NAME,
          Key: jobKey(job.id),
          UpdateExpression: 'SET #s = :failed, #e = :message',
          ExpressionAttributeNames: { '#s': 'status', '#e': 'error' },
          ExpressionAttributeValues: {
            ':failed': 'failed',
            ':message': '변환을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
          },
        }),
      );
      throw e;
    }
    await emit([
      {
        name: 'job_created',
        ts: now.getTime(),
        jobId: job.id,
        type: job.kind,
        inputSize: job.fileSize,
        durationSec: job.params.end - job.params.start,
      },
    ]);
    return json(201, { job: publicJob(job, now) });
  }

  /** 서버 잡 이벤트를 이벤트 큐에 넣는다. 실패해도 잡 흐름은 막지 않는다 */
  async function emit(events: JobEvent[]) {
    const receivedAt = deps.now().getTime();
    try {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: env.EVENTS_QUEUE_URL,
          MessageBody: JSON.stringify({
            events: events.map((e) => ({ ...e, source: 'server', receivedAt })),
          }),
        }),
      );
    } catch (e) {
      console.error(JSON.stringify({ msg: 'event send failed', error: String(e) }));
    }
  }

  async function postEvents(event: APIGatewayProxyEventV2) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString()
      : (event.body ?? '');
    if (raw.length > 16 * 1024) return error(413, 'too_large', '요청이 너무 커요.');
    const read = (() => {
      try {
        return JSON.parse(raw) as { events?: unknown };
      } catch {
        return null;
      }
    })();
    if (!read || !Array.isArray(read.events)) {
      return error(400, 'bad_body', '요청 형식이 올바르지 않아요.');
    }
    const events = read.events
      .slice(0, MAX_EVENTS_PER_REQUEST)
      .map(cleanEvent)
      .filter((e) => e !== null);
    if (events.length > 0) {
      const receivedAt = deps.now().getTime();
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: env.EVENTS_QUEUE_URL,
          MessageBody: JSON.stringify({
            events: events.map((e) => ({ ...e, source: 'web', receivedAt })),
          }),
        }),
      );
    }
    return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  }

  async function getJob(id: string | undefined) {
    if (!isUuid(id)) return error(404, 'not_found', '작업을 찾을 수 없어요.');
    const r = await ddb.send(new GetCommand({ TableName: env.TABLE_NAME, Key: jobKey(id) }));
    const item = r.Item as JobItem | undefined;
    const job = publicJob(item, deps.now());
    if (!job || !item) return error(404, 'not_found', '작업을 찾을 수 없어요.');
    if (job.status !== 'done' || !item.outputKey) return json(200, { job });
    // 결과는 outputs 버킷에서 짧은 서명 주소로 내려받는다 (버킷은 비공개, 1일 후 지워짐)
    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: env.OUTPUTS_BUCKET,
        Key: item.outputKey,
        ResponseContentDisposition: `attachment; filename="${downloadName(item)}"`,
      }),
      { expiresIn: LIMITS.downloadUrlSeconds },
    );
    return json(200, { job: { ...job, downloadUrl } });
  }

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const { salt, origin } = await loadSecrets();
    if (!sameSecret(event.headers['x-origin-verify'], origin)) {
      return error(403, 'forbidden', '허용되지 않은 요청이에요.');
    }
    switch (event.routeKey) {
      case 'POST /api/uploads':
        return createUpload(event, salt);
      case 'POST /api/jobs':
        return createJob(event, salt);
      case 'POST /api/events':
        return postEvents(event);
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
    'OUTPUTS_BUCKET',
    'QUEUE_URL',
    'EVENTS_QUEUE_URL',
    'SALT_PARAM',
    'ORIGIN_PARAM',
    'DAILY_JOB_LIMIT',
    'DAILY_UPLOAD_LIMIT',
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
    sqs: new SQSClient({}),
    ssm: new SSMClient({}),
    now: () => new Date(),
    newId: () => randomUUID(),
  });
  return real(event);
};
