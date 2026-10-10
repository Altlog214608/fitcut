/**
 * 워커 Lambda (컨테이너 이미지). SQS 메시지 하나 = 잡 하나.
 * 잡 API(POST /api/jobs)가 업로드를 확인하고 SQS({ jobId })에 넣는다 → 이 함수 (ADR-033).
 * 1) 잡을 processing으로 바꾼다 (이미 처리 중이거나 끝났으면 건너뛴다)
 * 2) 원본을 /tmp로 받아 ffprobe로 확인 (확장자를 믿지 않는다)
 * 3) ffmpeg로 만들고 결과를 outputs 버킷에 올린다
 * 4) 잡을 done(결과 위치·크기·처리 시간) 또는 failed(화면에 보일 이유)로 바꾼다
 * 입력 문제(형식·길이)는 다시 시도해도 같으므로 실패로 끝내고, 그 밖의 오류는 SQS가 다시 보내게 던진다.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  EXTENSION,
  MIME,
  checkInput,
  ffmpegArgs,
  ffprobeArgs,
  parseProbe,
  type OutputKind,
  type Params,
} from './ffmpeg';
import { run } from './run';

export type Env = {
  TABLE_NAME: string;
  UPLOADS_BUCKET: string;
  OUTPUTS_BUCKET: string;
  FFMPEG_PATH: string;
  FFPROBE_PATH: string;
  /** 사용 이벤트 큐 (없으면 이벤트를 보내지 않는다) */
  EVENTS_QUEUE_URL?: string;
  /** Lambda 메모리(MB). 잡 비용 추정에 쓴다 */
  AWS_LAMBDA_FUNCTION_MEMORY_SIZE?: string;
};

type Job = { id: string; status: string; kind: OutputKind; params: Params; inputKey: string };

/** 이보다 오래 processing이면 멈춘 것으로 본다 (Lambda 최대 실행 시간 15분보다 길게) */
const STALE_MS = 20 * 60 * 1000;

/** 입력 문제: 다시 시도해도 같다 */
class InputError extends Error {}

export type Deps = {
  env: Env;
  ddb: DynamoDBDocumentClient;
  s3: S3Client;
  sqs: SQSClient;
  /** 실행 (테스트에서 바꿔 끼운다) */
  exec: typeof run;
};

/** 서울 arm64 Lambda 단가(GB초, AWS Pricing API 2026-10-10). 잡 비용 추정용 (ADR-002) */
const PRICE_PER_GB_SECOND = 0.0000133334;

/** 남은 실행 시간(ms). 호출마다 새 context에서 읽어야 한다 */
export type Remaining = () => number;

/** 잡 API가 넣은 메시지에서 잡 ID를 꺼낸다 ({ "jobId": "<uuid>" }) */
export function jobIdFromMessage(body: string): string | null {
  try {
    const id = (JSON.parse(body) as { jobId?: unknown }).jobId;
    return typeof id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
      ? id
      : null;
  } catch {
    return null;
  }
}

export function makeHandler(deps: Deps) {
  const { env, ddb, s3 } = deps;
  const key = (id: string) => ({ PK: `JOB#${id}`, SK: 'META' });

  async function claim(id: string): Promise<Job | null> {
    try {
      const r = await ddb.send(
        new UpdateCommand({
          TableName: env.TABLE_NAME,
          Key: key(id),
          UpdateExpression: 'SET #s = :processing, startedAt = :now',
          // 처리 중에 Lambda가 강제로 끝나면 processing에 멈춘다. 오래된 processing은 다시 잡는다
          ConditionExpression:
            'attribute_exists(PK) AND (#s = :queued OR (#s = :processing AND startedAt < :stale))',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':processing': 'processing',
            ':queued': 'queued',
            ':now': new Date().toISOString(),
            ':stale': new Date(Date.now() - STALE_MS).toISOString(),
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return (r.Attributes as Job | undefined) ?? null;
    } catch (e) {
      // 없는 잡이거나 이미 처리 중·완료: 같은 메시지가 두 번 와도 한 번만 만든다
      if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return null;
      throw e;
    }
  }

  async function finish(id: string, fields: Record<string, unknown>) {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets = Object.entries(fields).map(([k, v], i) => {
      names[`#k${i}`] = k;
      values[`:v${i}`] = v;
      return `#k${i} = :v${i}`;
    });
    await ddb.send(
      new UpdateCommand({
        TableName: env.TABLE_NAME,
        Key: key(id),
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  /** 사용 이벤트(job_succeeded·job_failed). 실패해도 잡은 그대로 둔다 */
  async function emit(event: Record<string, unknown>) {
    if (!env.EVENTS_QUEUE_URL) return;
    const receivedAt = Date.now();
    try {
      await deps.sqs.send(
        new SendMessageCommand({
          QueueUrl: env.EVENTS_QUEUE_URL,
          MessageBody: JSON.stringify({
            events: [{ ...event, ts: receivedAt, source: 'server', receivedAt }],
          }),
        }),
      );
    } catch (e) {
      console.error(JSON.stringify({ msg: 'event send failed', error: String(e) }));
    }
  }

  function jobEvent(job: Job, startedMs: number, ok: boolean, errorCode?: string) {
    const processingMs = Date.now() - startedMs;
    const memoryGb = Number(env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE ?? 2048) / 1024;
    return emit({
      name: ok ? 'job_succeeded' : 'job_failed',
      jobId: job.id,
      type: job.kind,
      durationSec: job.params.end - job.params.start,
      worker: 'lambda',
      processingMs,
      estCostUsd: Number(((processingMs / 1000) * memoryGb * PRICE_PER_GB_SECOND).toFixed(6)),
      ...(errorCode ? { errorCode } : {}),
    });
  }

  async function process(id: string, remainingMs: Remaining) {
    const startedMs = Date.now();
    const job = await claim(id);
    if (!job) return;
    const dir = await mkdtemp(join(tmpdir(), 'job-'));
    const input = join(dir, 'in');
    const output = join(dir, `out.${EXTENSION[job.kind]}`);
    try {
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: env.UPLOADS_BUCKET, Key: job.inputKey }),
      );
      await pipeline(obj.Body as Readable, createWriteStream(input));

      const probe = await deps.exec(env.FFPROBE_PATH, ffprobeArgs(input), 60_000).catch(() => null);
      const parsed = probe ? parseProbe(probe.stdout) : null;
      const problem = checkInput(parsed, job.params, job.kind);
      if (problem) throw new InputError(problem);
      const src = {
        rotation: parsed?.video?.rotation ?? 0,
        audioCodec: parsed?.audio?.codec ?? null,
      };

      // Lambda가 끝나기 20초 전에는 멈춰서 실패를 기록할 시간을 남긴다
      const made = await deps.exec(
        env.FFMPEG_PATH,
        ffmpegArgs(job.kind, job.params, input, output, src),
        Math.max(10_000, remainingMs() - 20_000),
      );
      const { size } = await stat(output);
      const outputKey = `out/${id}.${EXTENSION[job.kind]}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: env.OUTPUTS_BUCKET,
          Key: outputKey,
          Body: createReadStream(output),
          ContentLength: size,
          ContentType: MIME[job.kind],
        }),
      );
      await finish(id, {
        status: 'done',
        outputKey,
        outputBytes: size,
        ffmpegMs: made.ms,
        finishedAt: new Date().toISOString(),
      });
      await jobEvent(job, startedMs, true);
    } catch (e) {
      if (e instanceof InputError) {
        await finish(id, {
          status: 'failed',
          error: e.message,
          finishedAt: new Date().toISOString(),
        });
        await jobEvent(job, startedMs, false, 'input');
        return;
      }
      console.error(JSON.stringify({ msg: 'job failed', id, error: String(e) }));
      await finish(id, {
        status: 'failed',
        error: '변환하지 못했어요. 잠시 후 다시 시도해 주세요.',
        finishedAt: new Date().toISOString(),
      });
      await jobEvent(job, startedMs, false, 'ffmpeg');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // 남은 시간은 호출마다 받는다. 첫 호출의 context를 붙잡아 두면 오래 살아 있는 컨테이너에서
  // 남은 시간이 음수가 되어 ffmpeg가 10초 만에 멈춘다 (2026-10-10 측정 중 발견)
  return async (event: SQSEvent, remainingMs: Remaining): Promise<SQSBatchResponse> => {
    const failures: SQSBatchResponse['batchItemFailures'] = [];
    for (const record of event.Records) {
      const id = jobIdFromMessage(record.body);
      if (!id) continue; // 우리가 만든 메시지가 아니면 버린다
      try {
        await process(id, remainingMs);
      } catch (e) {
        console.error(JSON.stringify({ msg: 'retry later', id, error: String(e) }));
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

function env(): Env {
  const names = [
    'TABLE_NAME',
    'UPLOADS_BUCKET',
    'OUTPUTS_BUCKET',
    'FFMPEG_PATH',
    'FFPROBE_PATH',
  ] as const;
  const out: Env = {
    ...(process.env.EVENTS_QUEUE_URL ? { EVENTS_QUEUE_URL: process.env.EVENTS_QUEUE_URL } : {}),
    ...(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE
      ? { AWS_LAMBDA_FUNCTION_MEMORY_SIZE: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE }
      : {}),
  } as Env;
  for (const name of names) {
    const value = process.env[name];
    if (!value) throw new Error(`env ${name} is required`);
    out[name] = value;
  }
  return out;
}

let real: ReturnType<typeof makeHandler> | null = null;
export const handler = (event: SQSEvent, context: { getRemainingTimeInMillis: () => number }) => {
  real ??= makeHandler({
    env: env(),
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    }),
    s3: new S3Client({}),
    sqs: new SQSClient({}),
    exec: run,
  });
  return real(event, () => context.getRemainingTimeInMillis());
};
