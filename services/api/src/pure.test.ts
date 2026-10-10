import { describe, expect, it } from 'vitest';
import { clientIp, ipHash, quotaExpiry, quotaKey, seoulDay } from './client';
import { isUuid, newJob, newUpload, publicJob } from './jobs';
import { newLinkId, parseCreateLink } from './links';
import { parseCreateJob, parseCreateUpload } from './validate';

const UPLOAD_ID = '7d2e9a41-5b6c-4f8d-8e1a-3c9b0f2d4e6a';
const okUpload = { fileSize: 10_000_000, contentType: 'video/mp4' };
const ok = { uploadId: UPLOAD_ID, kind: 'gif', start: 1.5, end: 6.5 };

describe('parseCreateUpload', () => {
  it('크기와 형식을 확인한다', () => {
    expect(parseCreateUpload(okUpload)).toEqual({ ok: true, value: okUpload });
  });

  it.each([
    [{ ...okUpload, fileSize: 600 * 1024 * 1024 }, 'too_big'],
    [{ ...okUpload, fileSize: 1.5 }, 'bad_size'],
    [{ ...okUpload, fileSize: 0 }, 'bad_size'],
    [{ ...okUpload, contentType: 'image/gif' }, 'bad_type'],
    ['nope', 'bad_body'],
  ])('%j → %s', (body, code) => {
    const r = parseCreateUpload(body);
    expect(r.ok ? null : r.error.code).toBe(code);
  });
});

describe('parseCreateJob', () => {
  it('기본값을 채운다 (15fps, 가로 480)', () => {
    expect(parseCreateJob(ok)).toEqual({ ok: true, value: { ...ok, fps: 15, width: 480 } });
  });

  it.each([
    [{ ...ok, uploadId: '../in/x' }, 'bad_upload'],
    [{ ...ok, uploadId: undefined }, 'bad_upload'],
    [{ ...ok, kind: 'avi' }, 'bad_kind'],
    [{ ...ok, start: 5, end: 5 }, 'bad_range'],
    [{ ...ok, start: -1 }, 'bad_range'],
    [{ ...ok, start: 0, end: 30.5 }, 'too_long'],
    [{ ...ok, fps: 60 }, 'bad_fps'],
    [{ ...ok, width: 2000 }, 'bad_width'],
    [{ ...ok, height: 50 }, 'bad_height'],
    [{ ...ok, height: 480.5 }, 'bad_height'],
    ['nope', 'bad_body'],
  ])('%j → %s', (body, code) => {
    const r = parseCreateJob(body);
    expect(r.ok ? null : r.error.code).toBe(code);
  });

  it('세로를 정하면 그대로 넘긴다 (워치 화면처럼 정확한 크기)', () => {
    expect(parseCreateJob({ ...ok, width: 480, height: 480 })).toEqual({
      ok: true,
      value: { ...ok, fps: 15, width: 480, height: 480 },
    });
  });

  it('음성 옵션: 기본값, 범위, 아이폰 벨소리 30초', () => {
    const r = parseCreateJob({ ...ok, kind: 'mp3', start: 0, end: 20 });
    expect(r.ok && r.value.audio).toEqual({
      fadeIn: 0,
      fadeOut: 0,
      normalize: false,
      channels: 2,
      bitrate: 192,
    });
    const set = parseCreateJob({
      ...ok,
      kind: 'm4a',
      start: 0,
      end: 20,
      audio: { fadeIn: 1.5, fadeOut: 2, normalize: true, channels: 1, bitrate: 128 },
    });
    expect(set.ok && set.value.audio).toEqual({
      fadeIn: 1.5,
      fadeOut: 2,
      normalize: true,
      channels: 1,
      bitrate: 128,
    });
    const code = (body: unknown) => {
      const x = parseCreateJob(body);
      return x.ok ? null : x.error.code;
    };
    expect(code({ ...ok, kind: 'mp3', start: 0, end: 3, audio: { fadeIn: 2, fadeOut: 2 } })).toBe(
      'bad_fade',
    );
    expect(code({ ...ok, kind: 'mp3', start: 0, end: 30, audio: { bitrate: 500 } })).toBe(
      'bad_bitrate',
    );
    expect(code({ ...ok, kind: 'mp3', start: 0, end: 30, audio: { channels: 6 } })).toBe(
      'bad_channels',
    );
    const ringtone = parseCreateJob({ ...ok, kind: 'm4r', start: 0, end: 31 });
    expect(ringtone.ok ? '' : ringtone.error.message).toBe(
      '아이폰 벨소리는 30초까지예요. 구간을 30초 이하로 골라 주세요.',
    );
    expect(parseCreateJob({ ...ok, kind: 'mp3', start: 0, end: 600 }).ok).toBe(true);
  });

  it('세로로 돌리기: 방향은 필수, 반전은 다시 압축할 때만, 길이 3분·10분', () => {
    const r = parseCreateJob({ ...ok, kind: 'rotate', start: 0, end: 60, rotate: 90, flip: true });
    expect(r.ok && r.value).toMatchObject({ kind: 'rotate', rotate: 90, flip: true });
    const code = (body: unknown) => {
      const x = parseCreateJob(body);
      return x.ok ? null : x.error.code;
    };
    expect(code({ ...ok, kind: 'rotate', start: 0, end: 60, rotate: 45 })).toBe('bad_rotate');
    expect(code({ ...ok, kind: 'rotate-fast', start: 0, end: 60, rotate: 90, flip: true })).toBe(
      'bad_flip',
    );
    expect(code({ ...ok, kind: 'rotate', start: 0, end: 181, rotate: 90 })).toBe('too_long');
    expect(code({ ...ok, kind: 'rotate-fast', start: 0, end: 600, rotate: 270 })).toBeNull();
  });

  it('MP4는 3분까지', () => {
    expect(parseCreateJob({ ...ok, kind: 'mp4', start: 0, end: 180 }).ok).toBe(true);
    expect(parseCreateJob({ ...ok, kind: 'mp4', start: 0, end: 181 }).ok).toBe(false);
  });

  it('오류 문구는 고치는 방법을 말한다', () => {
    const r = parseCreateJob({ ...ok, start: 0, end: 40 });
    expect(r.ok ? '' : r.error.message).toBe('구간이 너무 길어요. 30초 이하로 골라 주세요.');
  });
});

describe('clientIp', () => {
  it.each([
    ['203.0.113.7:51234', '203.0.113.7'],
    ['[2001:db8::1]:443', '2001:db8::1'],
    ['2001:db8::1', '2001:db8::1'],
  ])('%s → %s', (viewer, ip) => {
    expect(clientIp(viewer, '10.0.0.1')).toBe(ip);
  });

  it('CloudFront 헤더가 없으면 API Gateway가 본 주소', () => {
    expect(clientIp(undefined, '10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('ipHash · 할당량 키', () => {
  it('같은 IP·솔트는 같은 해시, 솔트가 다르면 다른 해시, 원본 IP는 남지 않는다', () => {
    const a = ipHash('203.0.113.7', 'salt-a');
    expect(a).toHaveLength(32);
    expect(ipHash('203.0.113.7', 'salt-a')).toBe(a);
    expect(ipHash('203.0.113.7', 'salt-b')).not.toBe(a);
    expect(a).not.toContain('203');
  });

  it('하루는 서울 자정에 바뀐다', () => {
    expect(seoulDay(new Date('2026-10-10T14:59:59Z'))).toBe('20261010');
    expect(seoulDay(new Date('2026-10-10T15:00:00Z'))).toBe('20261011');
    expect(quotaKey('abc', new Date('2026-10-10T15:00:00Z'))).toEqual({
      PK: 'QUOTA#abc#20261011',
      SK: 'COUNT',
    });
  });

  it('할당량 기록은 그날 서울 자정이 지나고 하루 뒤에 지워도 된다', () => {
    // 2026-10-10 서울 날 → 끝은 2026-10-10T15:00Z, 그 하루 뒤
    expect(quotaExpiry(new Date('2026-10-10T03:00:00Z'))).toBe(Date.UTC(2026, 9, 11, 15) / 1000);
  });
});

describe('업로드·잡 기록', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  const id = '0b8f4c56-1d7e-4c3b-9a55-2f0d6c1e9a10';
  const upload = newUpload(UPLOAD_ID, okUpload, now);
  const input = { ...ok, kind: 'gif' as const, fps: 15, width: 480 };

  it('업로드는 원본 위치를 정하고 1일 뒤 만료된다 (버킷 수명 주기와 같게)', () => {
    expect(upload).toMatchObject({
      PK: `UPLOAD#${UPLOAD_ID}`,
      SK: 'META',
      inputKey: `in/${UPLOAD_ID}`,
    });
    expect(upload.ttl).toBe(now.getTime() / 1000 + 24 * 3600);
  });

  it('잡은 올린 영상을 원본으로 쓰고 queued로 시작해 2일 뒤 만료된다', () => {
    const job = newJob(id, input, upload, now);
    expect(job).toMatchObject({
      PK: `JOB#${id}`,
      SK: 'META',
      status: 'queued',
      uploadId: UPLOAD_ID,
      inputKey: `in/${UPLOAD_ID}`,
      fileSize: 10_000_000,
    });
    expect(job.ttl).toBe(now.getTime() / 1000 + 2 * 24 * 3600);
  });

  it('화면에는 내부 키를 보내지 않고, 만료된 기록은 없는 것으로 본다', () => {
    const job = newJob(id, input, upload, now);
    const shown = publicJob(job, now);
    expect(shown).not.toHaveProperty('PK');
    expect(shown).not.toHaveProperty('inputKey');
    expect(shown).not.toHaveProperty('uploadId');
    expect(publicJob(job, new Date(job.ttl * 1000 + 1))).toBeNull();
  });

  it('ID는 UUID 모양만', () => {
    expect(isUuid(id)).toBe(true);
    expect(isUuid('../../etc')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe('링크 구간 검사', () => {
  it('ID는 8자 영문·숫자', () => {
    expect(newLinkId(new Uint8Array([0, 1, 2, 61, 62, 255, 10, 35]))).toMatch(/^[A-Za-z0-9]{8}$/);
  });

  it.each([
    [{ videoId: 'dQw4w9WgXcQ', start: 0, end: 10 }, null],
    [{ videoId: 'short', start: 0, end: 10 }, 'bad_video'],
    [{ videoId: 'dQw4w9WgXcQ', start: 5, end: 5 }, 'bad_range'],
    [{ videoId: 'dQw4w9WgXcQ', start: 0, end: 3 * 3600 + 1 }, 'too_long'],
  ])('%j → %s', (body, code) => {
    const r = parseCreateLink(body);
    expect(r.ok ? null : r.code).toBe(code);
  });
});
