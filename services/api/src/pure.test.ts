import { describe, expect, it } from 'vitest';
import { clientIp, ipHash, quotaExpiry, quotaKey, seoulDay } from './client';
import { isJobId, newJob, publicJob } from './jobs';
import { parseCreateJob } from './validate';

const ok = { kind: 'gif', start: 1.5, end: 6.5, fileSize: 10_000_000, contentType: 'video/mp4' };

describe('parseCreateJob', () => {
  it('기본값을 채운다 (15fps, 가로 480)', () => {
    expect(parseCreateJob(ok)).toEqual({ ok: true, value: { ...ok, fps: 15, width: 480 } });
  });

  it.each([
    [{ ...ok, kind: 'avi' }, 'bad_kind'],
    [{ ...ok, start: 5, end: 5 }, 'bad_range'],
    [{ ...ok, start: -1 }, 'bad_range'],
    [{ ...ok, start: 0, end: 30.5 }, 'too_long'],
    [{ ...ok, fileSize: 600 * 1024 * 1024 }, 'too_big'],
    [{ ...ok, fileSize: 1.5 }, 'bad_size'],
    [{ ...ok, contentType: 'image/gif' }, 'bad_type'],
    [{ ...ok, fps: 60 }, 'bad_fps'],
    [{ ...ok, width: 2000 }, 'bad_width'],
    ['nope', 'bad_body'],
  ])('%j → %s', (body, code) => {
    const r = parseCreateJob(body);
    expect(r.ok ? null : r.error.code).toBe(code);
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

describe('잡 기록', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  const id = '0b8f4c56-1d7e-4c3b-9a55-2f0d6c1e9a10';

  it('원본 위치와 만료 시각(2일)을 정한다', () => {
    const job = newJob(id, { ...ok, kind: 'gif', fps: 15, width: 480 }, now);
    expect(job).toMatchObject({
      PK: `JOB#${id}`,
      SK: 'META',
      status: 'created',
      inputKey: `in/${id}`,
    });
    expect(job.ttl).toBe(now.getTime() / 1000 + 2 * 24 * 3600);
  });

  it('화면에는 내부 키를 보내지 않고, 만료된 기록은 없는 것으로 본다', () => {
    const job = newJob(id, { ...ok, kind: 'gif', fps: 15, width: 480 }, now);
    const shown = publicJob(job, now);
    expect(shown).not.toHaveProperty('PK');
    expect(shown).not.toHaveProperty('inputKey');
    expect(publicJob(job, new Date(job.ttl * 1000 + 1))).toBeNull();
  });

  it('잡 ID는 UUID 모양만', () => {
    expect(isJobId(id)).toBe(true);
    expect(isJobId('../../etc')).toBe(false);
    expect(isJobId(undefined)).toBe(false);
  });
});
