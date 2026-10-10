import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { SQSEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jobIdFromMessage, makeHandler, type Deps } from './handler';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2' }));
const s3 = new S3Client({ region: 'ap-northeast-2' });
const ddbMock = mockClient(ddb);
const s3Mock = mockClient(s3);

const ID = '0b8f4c56-1d7e-4c3b-9a55-2f0d6c1e9a10';
const job = {
  id: ID,
  status: 'processing',
  kind: 'gif',
  params: { start: 0.5, end: 3, fps: 15, width: 480 },
  inputKey: 'in/7d2e9a41-5b6c-4f8d-8e1a-3c9b0f2d4e6a',
};
const mp4Probe = JSON.stringify({
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '4.0' },
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 640, height: 360, avg_frame_rate: '30/1' },
  ],
});

const message = JSON.stringify({ jobId: ID });

function event(body: string): SQSEvent {
  return { Records: [{ messageId: 'm1', body } as SQSEvent['Records'][number]] };
}

function handler(exec: Deps['exec']) {
  return makeHandler({
    env: {
      TABLE_NAME: 't',
      UPLOADS_BUCKET: 'up',
      OUTPUTS_BUCKET: 'out',
      FFMPEG_PATH: 'ffmpeg',
      FFPROBE_PATH: 'ffprobe',
    },
    ddb,
    s3,
    remainingMs: () => 600_000,
    exec,
  });
}

/** ffprobe는 정해진 JSON을, ffmpeg는 출력 파일(마지막 인자)을 만든다 */
const fakeExec =
  (probe: string): Deps['exec'] =>
  async (bin, args) => {
    if (bin === 'ffprobe') return { stdout: probe, ms: 5 };
    await writeFile(args.at(-1) ?? '', Buffer.alloc(2048));
    return { stdout: '', ms: 1234 };
  };

const updates = () => ddbMock.commandCalls(UpdateCommand).map((c) => c.args[0].input);

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  s3Mock.on(GetObjectCommand).callsFake(() => ({ Body: Readable.from([Buffer.from('video')]) }));
  s3Mock.on(PutObjectCommand).resolves({});
});

describe('jobIdFromMessage', () => {
  it('UUID 모양의 잡 ID만 꺼낸다', () => {
    expect(jobIdFromMessage(JSON.stringify({ jobId: ID }))).toBe(ID);
    expect(jobIdFromMessage(JSON.stringify({ jobId: '../x' }))).toBeNull();
    expect(jobIdFromMessage(JSON.stringify({ key: `in/${ID}` }))).toBeNull();
    expect(jobIdFromMessage('nope')).toBeNull();
  });
});

describe('워커', () => {
  it('받아서 만들고 결과를 올린 뒤 done으로 바꾼다', async () => {
    ddbMock.on(UpdateCommand).resolvesOnce({ Attributes: job }).resolves({});
    const res = await handler(fakeExec(mp4Probe))(event(message));
    expect(res.batchItemFailures).toEqual([]);
    const put = s3Mock.commandCalls(PutObjectCommand)[0]?.args[0].input;
    expect(put).toMatchObject({ Bucket: 'out', Key: `out/${ID}.gif`, ContentType: 'image/gif' });
    const done = updates().at(-1);
    expect(done?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({ ':v0': 'done', ':v1': `out/${ID}.gif`, ':v2': 2048, ':v3': 1234 }),
    );
  });

  it('이미 처리 중이거나 끝난 잡은 건너뛴다 (같은 메시지가 두 번 와도 한 번만)', async () => {
    const err = Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    ddbMock.on(UpdateCommand).rejects(err);
    const exec = vi.fn(fakeExec(mp4Probe));
    const res = await handler(exec)(event(message));
    expect(res.batchItemFailures).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });

  it('영상이 아니면 다시 시도하지 않고 이유와 함께 failed', async () => {
    ddbMock.on(UpdateCommand).resolvesOnce({ Attributes: job }).resolves({});
    const res = await handler(fakeExec('{}'))(event(message));
    expect(res.batchItemFailures).toEqual([]);
    expect(updates().at(-1)?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ':v0': 'failed',
        ':v1': expect.stringContaining('영상을 읽을 수 없어요'),
      }),
    );
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('ffmpeg가 실패하면 failed로 남기고 안내 문구', async () => {
    ddbMock.on(UpdateCommand).resolvesOnce({ Attributes: job }).resolves({});
    const exec: Deps['exec'] = async (bin) => {
      if (bin === 'ffprobe') return { stdout: mp4Probe, ms: 5 };
      throw new Error('ffmpeg exit 1');
    };
    await handler(exec)(event(message));
    expect(updates().at(-1)?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ':v0': 'failed',
        ':v1': '변환하지 못했어요. 잠시 후 다시 시도해 주세요.',
      }),
    );
  });

  it('잡을 잡는 단계에서 DynamoDB 오류면 SQS가 다시 보내게 실패로 돌려준다', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('throttled'));
    const res = await handler(fakeExec(mp4Probe))(event(message));
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }]);
  });
});
