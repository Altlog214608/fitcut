/**
 * 실제 ffmpeg로 만들어 보는 시험. ffmpeg가 PATH에 있을 때만 돈다 (워커 이미지 빌드 후 CI에서도 돈다).
 * 시험 영상은 ffmpeg testsrc로 만든다: 30fps, 프레임마다 번호가 다른 그림.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ffmpegArgs, ffprobeArgs, parseProbe } from './ffmpeg';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

function has(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const enabled = has(FFMPEG) && has(FFPROBE);
let dir = '';
let input = '';

beforeAll(() => {
  if (!enabled) return;
  dir = mkdtempSync(join(tmpdir(), 'fitcut-worker-'));
  input = join(dir, 'in.mp4');
  // 10초, 1280x720, 30fps 시험 영상 (소리 포함)
  execFileSync(FFMPEG, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=30:duration=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=10',
    '-c:v',
    'libx264',
    '-g',
    '300',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    input,
  ]);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function probe(file: string) {
  return parseProbe(execFileSync(FFPROBE, ffprobeArgs(file)).toString());
}

function frames(file: string): number {
  const out = execFileSync(FFPROBE, [
    '-v',
    'error',
    '-count_frames',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=nb_read_frames',
    '-of',
    'csv=p=0',
    file,
  ]).toString();
  return Number(out.trim());
}

/** 애니메이션 WebP는 ffprobe가 크기를 못 읽는다. RIFF 머리의 VP8X 캔버스 크기와 ANMF 조각 수를 읽는다 */
function webpInfo(file: string) {
  const b = readFileSync(file);
  let width = 0;
  let height = 0;
  let count = 0;
  for (let at = 12; at + 8 <= b.length;) {
    const id = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'VP8X') {
      width = 1 + b.readUIntLE(at + 8 + 4, 3);
      height = 1 + b.readUIntLE(at + 8 + 7, 3);
    }
    if (id === 'ANMF') count++;
    at += 8 + size + (size % 2);
  }
  return { width, height, frames: count };
}

function info(kind: string, file: string) {
  if (kind === 'webp') return webpInfo(file);
  const v = probe(file)?.video;
  return { width: v?.width, height: v?.height, frames: frames(file) };
}

describe.skipIf(!enabled)('실제 ffmpeg로 만들기', () => {
  // 키프레임은 0초에만 있다(-g 300). 1.5초부터 잘라도 정확히 1.5초부터 시작해야 한다
  const p = { start: 1.5, end: 4, fps: 15, width: 480 };

  it.each(['gif', 'webp', 'mp4'] as const)('%s: 2.5초 x 15fps = 약 38프레임, 가로 480', (kind) => {
    const out = join(dir, `out.${kind}`);
    execFileSync(FFMPEG, ffmpegArgs(kind, p, input, out), { stdio: 'ignore' });
    expect(statSync(out).size).toBeGreaterThan(1000);
    const got = info(kind, out);
    expect([got.width, got.height]).toEqual([480, 270]);
    // ±1프레임 (WebP는 같은 그림이 이어지면 조각을 합칠 수 있어 상한만 본다)
    if (kind === 'webp') expect(got.frames).toBeLessThanOrEqual(39);
    else expect(Math.abs(got.frames - 2.5 * 15)).toBeLessThanOrEqual(1.5);
  });

  it.each([
    ['gif', 480, 480],
    ['mp4', 416, 496],
  ] as const)('%s: 세로를 정하면 정확히 %sx%s (워치 화면)', (kind, width, height) => {
    const out = join(dir, `watch-${width}.${kind}`);
    execFileSync(FFMPEG, ffmpegArgs(kind, { ...p, width, height }, input, out), {
      stdio: 'ignore',
    });
    const got = info(kind, out);
    expect([got.width, got.height]).toEqual([width, height]);
  });

  /** 영상의 한 프레임을 32x18 회색 픽셀로 (비교용) */
  function gray(file: string, filter: string): Buffer {
    return execFileSync(FFMPEG, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-vf',
      `${filter},scale=32:18,format=gray`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-',
    ]);
  }

  const diff = (a: Buffer, b: Buffer) =>
    a.reduce((sum, v, i) => sum + Math.abs(v - (b[i] ?? 0)), 0) / a.length;

  it('키프레임이 0초에만 있어도 정확히 1.5초 프레임부터 시작한다 (MP4)', () => {
    const out = join(dir, 'out.mp4');
    const first = gray(out, 'null');
    const at15 = gray(input, String.raw`select=eq(n\,45)`); // 30fps x 1.5초
    const at10 = gray(input, String.raw`select=eq(n\,30)`); // 1.0초 (틀렸을 때와 비교)
    expect(diff(first, at15)).toBeLessThan(diff(first, at10) / 3);
  });

  it('MP4에는 소리가 없다', () => {
    const out = join(dir, 'out.mp4');
    const streams = execFileSync(FFPROBE, [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      out,
    ]).toString();
    expect(streams.trim()).toBe('video');
  });
});
