import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkFile, makeRecordings, MAX_RECORDING_BYTES, PART_BYTES, partPlan } from './recording';

// 서명 주소는 로컬에서 만들기만 하므로 가짜 자격 증명으로 충분하다
const s3 = new S3Client({
  region: 'ap-northeast-2',
  credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2' }));
const s3Mock = mockClient(s3);
const ddbMock = mockClient(ddb);
const ID = '20261012090000-abcdef';
const r = makeRecordings({
  table: 't',
  bucket: 'rec',
  ddb,
  s3,
  now: () => new Date('2026-10-12T10:00:00Z'),
});

const SIZE = PART_BYTES * 2 + 100;
const uploading = {
  key: `rec/ch1/${ID}/u1`,
  uploadId: 'up1',
  size: SIZE,
  partSize: PART_BYTES,
  partCount: 3,
  contentType: 'video/mp4',
  status: 'uploading',
  createdAt: 'x',
};

const item = (extra: Record<string, unknown> = {}) =>
  ddbMock.on(GetCommand).resolves({ Item: { status: 'done', ...extra } });
const saved = () =>
  ddbMock.commandCalls(UpdateCommand).map((c) => c.args[0].input.ExpressionAttributeValues?.[':r']);

beforeEach(() => {
  s3Mock.reset();
  ddbMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
});

describe('checkFile·partPlan', () => {
  it('20GB까지, 영상·음성만 (형식이 비면 확장자로)', () => {
    expect(checkFile({ size: 10, contentType: 'video/mp4' })).toEqual({
      size: 10,
      contentType: 'video/mp4',
    });
    expect(checkFile({ size: 10, contentType: '', name: 'rec.mkv' }).contentType).toBe(
      'application/octet-stream',
    );
    expect(() => checkFile({ size: MAX_RECORDING_BYTES + 1, contentType: 'video/mp4' })).toThrow(
      '20GB',
    );
    expect(() => checkFile({ size: 10, contentType: 'image/png', name: 'a.png' })).toThrow(
      '영상이나 음성',
    );
    expect(() => checkFile({ size: 0, contentType: 'video/mp4' })).toThrow();
  });

  it('20GB도 조각 수 한도(10,000) 안', () => {
    expect(partPlan(MAX_RECORDING_BYTES).partCount).toBeLessThanOrEqual(10_000);
    expect(partPlan(SIZE)).toEqual({ partSize: PART_BYTES, partCount: 3 });
  });
});

describe('recordings', () => {
  it('만들기: 멀티파트를 시작하고, 파일 이름 없이 방송 기록에 상태를 남긴다', async () => {
    item();
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: 'up1' });
    const v = await r.create('ch1', ID, {
      size: SIZE,
      contentType: 'video/mp4',
      name: '내방송.mp4',
    });
    expect(v).toEqual({ status: 'uploading', size: SIZE, partSize: PART_BYTES, partCount: 3 });
    const create = s3Mock.commandCalls(CreateMultipartUploadCommand)[0]?.args[0].input;
    expect(create?.Key).toMatch(new RegExp(`^rec/ch1/${ID}/[0-9a-f-]{36}$`));
    expect(JSON.stringify(saved())).not.toContain('내방송');
  });

  it('수집 중인 방송에는 올릴 수 없다', async () => {
    item({ status: 'collecting' });
    await expect(r.create('ch1', ID, { size: 10, contentType: 'video/mp4' })).rejects.toMatchObject(
      {
        status: 409,
      },
    );
  });

  it('새로 올리면 이전에 올리던 것을 정리한다', async () => {
    item({ recording: uploading });
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: 'up2' });
    await r.create('ch1', ID, { size: 10, contentType: 'video/mp4' });
    expect(s3Mock.commandCalls(AbortMultipartUploadCommand)[0]?.args[0].input).toMatchObject({
      Key: uploading.key,
      UploadId: 'up1',
    });
  });

  it('조각 주소: 범위 밖 번호는 거절, 50개까지', async () => {
    item({ recording: uploading });
    const { parts } = await r.presign('ch1', ID, [1, 3]);
    expect(parts.map((p) => p.partNumber)).toEqual([1, 3]);
    expect(parts[0]?.url).toContain('partNumber=1');
    expect(parts[0]?.url).toContain('uploadId=up1');
    await expect(r.presign('ch1', ID, [4])).rejects.toMatchObject({ status: 400 });
    await expect(r.presign('ch1', ID, [])).rejects.toMatchObject({ status: 400 });
  });

  it('상태: 이미 올라간 조각 번호를 알려준다 (이어 올리기)', async () => {
    item({ recording: uploading });
    s3Mock
      .on(ListPartsCommand)
      .resolvesOnce({
        Parts: [{ PartNumber: 1, ETag: '"a"', Size: PART_BYTES }],
        IsTruncated: true,
        NextPartNumberMarker: '1',
      })
      .resolvesOnce({ Parts: [{ PartNumber: 3, ETag: '"c"', Size: 100 }], IsTruncated: false });
    expect(await r.status('ch1', ID)).toEqual({
      recording: {
        status: 'uploading',
        size: SIZE,
        partSize: PART_BYTES,
        partCount: 3,
        uploadedParts: [1, 3],
      },
    });
  });

  it('마치기: 조각이 모자라면 409, 다 있으면 서버가 확인한 ETag로 합치고 크기를 본다', async () => {
    item({ recording: uploading });
    s3Mock.on(ListPartsCommand).resolves({
      Parts: [
        { PartNumber: 2, ETag: '"b"', Size: PART_BYTES },
        { PartNumber: 1, ETag: '"a"', Size: PART_BYTES },
      ],
    });
    await expect(r.complete('ch1', ID)).rejects.toMatchObject({ status: 409, code: 'incomplete' });

    s3Mock.on(ListPartsCommand).resolves({
      Parts: [
        { PartNumber: 2, ETag: '"b"', Size: PART_BYTES },
        { PartNumber: 1, ETag: '"a"', Size: PART_BYTES },
        { PartNumber: 3, ETag: '"c"', Size: 100 },
      ],
    });
    s3Mock.on(CompleteMultipartUploadCommand).resolves({});
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: SIZE });
    const v = await r.complete('ch1', ID);
    expect(v.status).toBe('uploaded');
    const done = s3Mock.commandCalls(CompleteMultipartUploadCommand)[0]?.args[0].input;
    expect(done?.MultipartUpload?.Parts?.map((p) => p.PartNumber)).toEqual([1, 2, 3]);
    const last = saved().at(-1) as Record<string, unknown>;
    expect(last.status).toBe('uploaded');
    expect(last.uploadId).toBeUndefined();
  });

  it('지우기: 다 올라간 파일은 객체를 지운다', async () => {
    item({ recording: { ...uploading, status: 'uploaded' } });
    s3Mock.on(DeleteObjectCommand).resolves({});
    await r.remove('ch1', ID);
    expect(s3Mock.commandCalls(DeleteObjectCommand)[0]?.args[0].input.Key).toBe(uploading.key);
    expect(ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.UpdateExpression).toBe(
      'REMOVE recording',
    );
  });
});
