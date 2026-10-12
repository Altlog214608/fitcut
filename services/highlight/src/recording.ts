/**
 * 모드 B: 스트리머의 녹화 파일 올리기 (ADR-008·042). 수 GB라 멀티파트로 나눠 올리고, 끊기면 이어 올린다.
 * - 만들기: 크기·형식 확인 → CreateMultipartUpload → 방송 기록에 recording 상태
 * - 조각 주소: UploadPart 서명 주소(1시간)를 한 번에 최대 50개
 * - 이어 올리기: ListParts로 이미 올라간 조각을 알려준다
 * - 마치기: 서버가 ListParts로 조각을 다시 확인해 CompleteMultipartUpload → 크기 확인 (화면이 준 ETag를 믿지 않는다)
 * 파일 이름은 저장하지 않는다. 녹화 파일은 수명 주기로 2일 뒤 지워진다.
 */
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { GetCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { BroadcastError } from './broadcasts';

export const MAX_RECORDING_BYTES = 20 * 1024 ** 3;
/** 조각 32MiB: 20GB도 640개라 S3 한도(10,000개) 안이고, 끊겨도 다시 올릴 양이 작다 */
export const PART_BYTES = 32 * 1024 ** 2;
export const MAX_PRESIGN = 50;
const URL_SECONDS = 3600;

/** OBS 등 녹화 프로그램이 쓰는 형식. Windows 브라우저는 mkv의 형식을 비워 주기도 해서 확장자도 본다 */
const TYPES = /^(video|audio)\//;
const EXTENSIONS = /\.(mp4|mkv|mov|flv|webm|ts|m4a|mp3|wav|aac|ogg)$/i;

export type RecordingState = {
  key: string;
  uploadId?: string;
  size: number;
  partSize: number;
  partCount: number;
  contentType: string;
  status: 'uploading' | 'uploaded';
  createdAt: string;
};

export type RecordingDeps = {
  table: string;
  bucket: string;
  ddb: DynamoDBDocumentClient;
  s3: S3Client;
  now: () => Date;
};

const bcastKey = (channelId: string, id: string) => ({
  PK: `CONN#chzzk#${channelId}`,
  SK: `BCAST#${id}`,
});

export function partPlan(size: number) {
  return { partSize: PART_BYTES, partCount: Math.max(1, Math.ceil(size / PART_BYTES)) };
}

export function checkFile(input: { size?: unknown; contentType?: unknown; name?: unknown }) {
  const size = Number(input.size);
  const contentType = typeof input.contentType === 'string' ? input.contentType : '';
  const name = typeof input.name === 'string' ? input.name : '';
  if (!Number.isInteger(size) || size <= 0) {
    throw new BroadcastError(400, 'bad_size', '파일 크기를 알 수 없어요.');
  }
  if (size > MAX_RECORDING_BYTES) {
    throw new BroadcastError(413, 'too_large', '녹화 파일은 20GB까지 올릴 수 있어요.');
  }
  if (!TYPES.test(contentType) && !EXTENSIONS.test(name)) {
    throw new BroadcastError(415, 'bad_type', '영상이나 음성 녹화 파일만 올릴 수 있어요.');
  }
  return { size, contentType: TYPES.test(contentType) ? contentType : 'application/octet-stream' };
}

export function makeRecordings(deps: RecordingDeps) {
  const { ddb, s3, bucket, table } = deps;

  async function load(channelId: string, id: string) {
    const item = (
      await ddb.send(new GetCommand({ TableName: table, Key: bcastKey(channelId, id) }))
    ).Item as { status?: string; recording?: RecordingState } | undefined;
    if (!item) throw new BroadcastError(404, 'not_found', '방송 기록이 없어요.');
    return item;
  }

  async function save(channelId: string, id: string, recording: RecordingState | null) {
    await ddb.send(
      new UpdateCommand({
        TableName: table,
        Key: bcastKey(channelId, id),
        ...(recording
          ? {
              UpdateExpression: 'SET recording = :r',
              ExpressionAttributeValues: { ':r': recording },
            }
          : { UpdateExpression: 'REMOVE recording' }),
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }

  async function discard(r: RecordingState | undefined) {
    if (!r) return;
    try {
      if (r.status === 'uploading' && r.uploadId) {
        await s3.send(
          new AbortMultipartUploadCommand({ Bucket: bucket, Key: r.key, UploadId: r.uploadId }),
        );
      } else {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: r.key }));
      }
    } catch {
      // 이미 없으면 수명 주기가 지운 것이다
    }
  }

  async function uploadedParts(r: RecordingState) {
    const parts: { partNumber: number; size: number; etag: string }[] = [];
    let marker: string | undefined;
    do {
      const page = await s3.send(
        new ListPartsCommand({
          Bucket: bucket,
          Key: r.key,
          UploadId: r.uploadId,
          ...(marker ? { PartNumberMarker: marker } : {}),
        }),
      );
      for (const p of page.Parts ?? []) {
        if (p.PartNumber && p.ETag) {
          parts.push({ partNumber: p.PartNumber, size: p.Size ?? 0, etag: p.ETag });
        }
      }
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);
    return parts;
  }

  const view = (r: RecordingState) => ({
    status: r.status,
    size: r.size,
    partSize: r.partSize,
    partCount: r.partCount,
  });

  async function create(channelId: string, id: string, input: Record<string, unknown>) {
    const { size, contentType } = checkFile(input);
    const item = await load(channelId, id);
    if (item.status === 'starting' || item.status === 'collecting') {
      throw new BroadcastError(409, 'collecting', '수집이 끝난 뒤에 녹화 파일을 올릴 수 있어요.');
    }
    await discard(item.recording); // 한 방송에 녹화 파일 하나. 새로 올리면 이전 것을 지운다
    const key = `rec/${channelId}/${id}/${randomUUID()}`;
    const up = await s3.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    );
    const recording: RecordingState = {
      key,
      ...(up.UploadId ? { uploadId: up.UploadId } : {}),
      size,
      ...partPlan(size),
      contentType,
      status: 'uploading',
      createdAt: deps.now().toISOString(),
    };
    await save(channelId, id, recording);
    return view(recording);
  }

  async function status(channelId: string, id: string) {
    const r = (await load(channelId, id)).recording;
    if (!r) return { recording: null };
    if (r.status === 'uploaded') return { recording: view(r) };
    try {
      const parts = await uploadedParts(r);
      return { recording: { ...view(r), uploadedParts: parts.map((p) => p.partNumber) } };
    } catch {
      // 2일이 지나 수명 주기가 멀티파트를 정리했다
      await save(channelId, id, null);
      return { recording: null };
    }
  }

  async function presign(channelId: string, id: string, numbers: unknown) {
    const r = (await load(channelId, id)).recording;
    if (!r || r.status !== 'uploading' || !r.uploadId) {
      throw new BroadcastError(409, 'no_upload', '올리던 녹화 파일이 없어요. 다시 골라 주세요.');
    }
    const list = Array.isArray(numbers) ? numbers : [];
    if (
      !list.length ||
      list.length > MAX_PRESIGN ||
      !list.every((n) => Number.isInteger(n) && n >= 1 && n <= r.partCount)
    ) {
      throw new BroadcastError(400, 'bad_parts', '조각 번호가 올바르지 않아요.');
    }
    const urls = await Promise.all(
      (list as number[]).map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          s3,
          new UploadPartCommand({
            Bucket: bucket,
            Key: r.key,
            UploadId: r.uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: URL_SECONDS },
        ),
      })),
    );
    return { parts: urls };
  }

  async function complete(channelId: string, id: string) {
    const r = (await load(channelId, id)).recording;
    if (!r || r.status !== 'uploading' || !r.uploadId) {
      throw new BroadcastError(409, 'no_upload', '올리던 녹화 파일이 없어요. 다시 골라 주세요.');
    }
    const parts = (await uploadedParts(r)).sort((a, b) => a.partNumber - b.partNumber);
    const total = parts.reduce((s, p) => s + p.size, 0);
    if (parts.length !== r.partCount || total !== r.size) {
      throw new BroadcastError(409, 'incomplete', '아직 다 올라가지 않았어요. 이어서 올려 주세요.');
    }
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: r.key,
        UploadId: r.uploadId,
        MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }),
    );
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: r.key }));
    if (head.ContentLength !== r.size) {
      await discard({ ...r, status: 'uploaded' });
      await save(channelId, id, null);
      throw new BroadcastError(
        409,
        'size_mismatch',
        '올라간 파일 크기가 달라요. 다시 올려 주세요.',
      );
    }
    const uploaded: RecordingState = {
      key: r.key,
      size: r.size,
      partSize: r.partSize,
      partCount: r.partCount,
      contentType: r.contentType,
      status: 'uploaded',
      createdAt: r.createdAt,
    };
    await save(channelId, id, uploaded);
    return view(uploaded);
  }

  async function remove(channelId: string, id: string) {
    const item = await load(channelId, id);
    await discard(item.recording);
    if (item.recording) await save(channelId, id, null);
  }

  return { create, status, presign, complete, remove };
}
