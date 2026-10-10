import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, contentTypeOf, createJob, pollDelay } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contentTypeOf', () => {
  it.each([
    [{ name: 'a.mp4', type: 'video/mp4' }, 'video/mp4'],
    [{ name: 'a.MOV', type: '' }, 'video/quicktime'],
    [{ name: 'clip.webm', type: '' }, 'video/webm'],
    [{ name: 'a.avi', type: 'video/x-msvideo' }, null],
  ])('%j → %s', (file, type) => {
    expect(contentTypeOf(file)).toBe(type);
  });
});

describe('API 오류', () => {
  it('서버가 준 문구를 그대로 보여준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'daily_limit', message: '오늘은 20번까지 만들 수 있어요.' } },
          { status: 429 },
        ),
      ),
    );
    const error = await createJob({
      uploadId: 'x',
      kind: 'gif',
      start: 0,
      end: 1,
      fps: 15,
      width: 480,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'daily_limit',
      status: 429,
      message: '오늘은 20번까지 만들 수 있어요.',
    });
  });

  it('연결이 끊기면 연결을 확인하라고 안내한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(
      createJob({ uploadId: 'x', kind: 'gif', start: 0, end: 1, fps: 15, width: 480 }),
    ).rejects.toMatchObject({ code: 'network', message: expect.stringContaining('인터넷 연결') });
  });
});

describe('pollDelay', () => {
  it('처음엔 1초, 길어지면 4초까지 늘린다', () => {
    expect(pollDelay(0)).toBe(1000);
    expect(pollDelay(5)).toBe(3000);
    expect(pollDelay(50)).toBe(4000);
  });
});
