import { describe, expect, it } from 'vitest';
import { cleanEvent, sizeBucket } from './events';

const common = { sessionId: 's-1', appVersion: 'abc1234', ts: Date.UTC(2026, 9, 10) };

describe('cleanEvent', () => {
  it('허용한 필드만 남긴다', () => {
    expect(
      cleanEvent({
        ...common,
        name: 'file_selected',
        tool: 'photo',
        kind: 'image',
        mime: 'image/jpeg',
        sizeBucket: '1-10MB',
        width: 4032,
        height: 3024,
        fileName: '내사진.jpg',
        ip: '203.0.113.7',
      }),
    ).toEqual({
      ...common,
      name: 'file_selected',
      tool: 'photo',
      kind: 'image',
      mime: 'image/jpeg',
      sizeBucket: '1-10MB',
      width: 4032,
      height: 3024,
    });
  });

  it('모르는 이벤트, 서버 전용 이벤트, 공통 값이 없는 이벤트는 버린다', () => {
    expect(cleanEvent({ ...common, name: 'hack' })).toBeNull();
    expect(cleanEvent({ ...common, name: 'job_succeeded', jobId: 'x' })).toBeNull();
    expect(cleanEvent({ name: 'tool_open', tool: 'gif' })).toBeNull();
    expect(cleanEvent({ ...common, name: '__proto__' })).toBeNull();
    expect(cleanEvent('nope')).toBeNull();
  });

  it('정해진 값이 아니거나 범위를 벗어난 값은 그 필드만 버린다', () => {
    expect(
      cleanEvent({
        ...common,
        name: 'export_done',
        tool: 'gif',
        format: 'bmp',
        width: -1,
        sizeBytes: 10,
      }),
    ).toEqual({ ...common, name: 'export_done', tool: 'gif', sizeBytes: 10 });
  });

  it('긴 글자는 자른다 (기기 검색어 40자)', () => {
    const e = cleanEvent({ ...common, name: 'preset_search_miss', query: 'x'.repeat(100) });
    expect(e?.query).toHaveLength(40);
  });
});

describe('sizeBucket', () => {
  it.each([
    [500_000, '<1MB'],
    [5 * 1024 * 1024, '1-10MB'],
    [90 * 1024 * 1024, '50-200MB'],
    [400 * 1024 * 1024, '200MB+'],
  ])('%s → %s', (bytes, bucket) => {
    expect(sizeBucket(bytes)).toBe(bucket);
  });
});
