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
  // 회전 정보가 있으면 "150,"처럼 빈 칸이 붙는다
  return Number.parseInt(out.trim(), 10);
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

describe.skipIf(!enabled)('실제 ffmpeg로 음성 만들기 (F14)', () => {
  // 시험 영상(10초, 440Hz)에서 1.5~4초를 자른다
  const p = { start: 1.5, end: 4, fps: 15, width: 480 };

  function duration(file: string): number {
    const out = execFileSync(FFPROBE, ffprobeArgs(file)).toString();
    return parseProbe(out)?.duration ?? 0;
  }

  /** 음성을 모노 16비트로 풀어 구간별 세기(RMS)를 잰다 */
  function rms(file: string, from: number, to: number): number {
    const pcm = execFileSync(FFMPEG, [
      '-v',
      'error',
      '-i',
      file,
      '-ac',
      '1',
      '-ar',
      '8000',
      '-f',
      's16le',
      '-',
    ]);
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
    const a = Math.floor(from * 8000);
    const b = Math.floor(to * 8000);
    let sum = 0;
    for (let i = a; i < b; i++) sum += (samples[i] ?? 0) ** 2;
    return Math.sqrt(sum / Math.max(1, b - a));
  }

  it.each(['mp3', 'm4a', 'wav', 'm4r'] as const)('%s: 길이가 고른 구간과 0.05초 이내', (kind) => {
    const out = join(dir, `voice.${kind}`);
    execFileSync(FFMPEG, ffmpegArgs(kind, { ...p, bitrate: 128 }, input, out), {
      stdio: 'ignore',
    });
    expect(Math.abs(duration(out) - 2.5)).toBeLessThanOrEqual(0.05);
    const probe = parseProbe(execFileSync(FFPROBE, ffprobeArgs(out)).toString());
    expect(probe?.video).toBeNull();
    expect(probe?.audio?.channels).toBe(2);
  });

  it('페이드 인·아웃: 처음과 끝은 작고 가운데는 크다, 모노도 된다', () => {
    const out = join(dir, 'fade.mp3');
    execFileSync(
      FFMPEG,
      ffmpegArgs('mp3', { ...p, fadeIn: 1, fadeOut: 1, channels: 1 }, input, out),
      { stdio: 'ignore' },
    );
    const middle = rms(out, 1.1, 1.4);
    expect(rms(out, 0, 0.1)).toBeLessThan(middle * 0.2);
    expect(rms(out, 2.4, 2.5)).toBeLessThan(middle * 0.2);
    const probe = parseProbe(execFileSync(FFPROBE, ffprobeArgs(out)).toString());
    expect(probe?.audio?.channels).toBe(1);
  });

  it('음량 맞추기(loudnorm)를 켜도 길이는 그대로', () => {
    const out = join(dir, 'loud.m4a');
    execFileSync(FFMPEG, ffmpegArgs('m4a', { ...p, normalize: true }, input, out), {
      stdio: 'ignore',
    });
    expect(Math.abs(duration(out) - 2.5)).toBeLessThanOrEqual(0.05);
  });
});

describe.skipIf(!enabled)('실제 ffmpeg로 세로로 돌리기 (F21)', () => {
  let land = '';
  let phone = '';

  beforeAll(() => {
    land = join(dir, 'land.mp4');
    // 1920x1080 30fps 3초, 소리 포함
    execFileSync(FFMPEG, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1920x1080:rate=30:duration=3',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=3',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      land,
    ]);
    // 폰으로 세로로 찍은 영상처럼: 저장은 1920x1080, 회전 정보로 세로(1080x1920)로 보인다
    phone = join(dir, 'phone.mp4');
    execFileSync(FFMPEG, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-display_rotation:v:0',
      '-90',
      '-i',
      land,
      '-c',
      'copy',
      phone,
    ]);
  });

  const probe = (file: string) => parseProbe(execFileSync(FFPROBE, ffprobeArgs(file)).toString());
  /** 화면에 보이는 크기 (회전 정보를 반영해 푼 첫 프레임) */
  function shown(file: string): [number, number] {
    const out = join(dir, `shown-${Math.random().toString(36).slice(2)}.png`);
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', file, '-frames:v', '1', out]);
    const [w, h] = execFileSync(FFPROBE, [
      '-v',
      'error',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      out,
    ])
      .toString()
      .trim()
      .split(',')
      .map(Number);
    return [w ?? 0, h ?? 0];
  }
  function firstGray(file: string): Buffer {
    return execFileSync(FFMPEG, [
      '-v',
      'error',
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      'scale=18:32,format=gray',
      '-f',
      'rawvideo',
      '-',
    ]);
  }
  const src = (file: string) => ({
    rotation: probe(file)?.video?.rotation ?? 0,
    audioCodec: probe(file)?.audio?.codec ?? null,
  });
  const p = { start: 0, end: 3, fps: 30, width: 480, rotate: 90 as const };

  it('다시 압축: 1920x1080 → 1080x1920, 프레임 수·길이 그대로, 소리는 같은 코덱으로 복사', () => {
    const out = join(dir, 'rot.mp4');
    execFileSync(FFMPEG, ffmpegArgs('rotate', p, land, out, src(land)), { stdio: 'ignore' });
    const got = probe(out);
    expect([got?.video?.width, got?.video?.height]).toEqual([1080, 1920]);
    expect(Math.abs(frames(out) - frames(land))).toBeLessThanOrEqual(1);
    expect(Math.abs((got?.duration ?? 0) - (probe(land)?.duration ?? 0))).toBeLessThan(0.05);
    expect(got?.audio?.codec).toBe('aac');
    expect(got?.video?.rotation).toBe(0);
  });

  it('빠르게(회전 정보만): 다시 압축하지 않고 화면에는 1080x1920으로 보인다', () => {
    const out = join(dir, 'rot-fast.mp4');
    execFileSync(FFMPEG, ffmpegArgs('rotate-fast', p, land, out, src(land)), { stdio: 'ignore' });
    const got = probe(out);
    expect([got?.video?.width, got?.video?.height]).toEqual([1920, 1080]); // 저장된 그림은 그대로
    expect(shown(out)).toEqual([1080, 1920]);
    expect(frames(out)).toBe(frames(land));
  });

  it('회전 정보가 있는 폰 영상도 화면에 보이는 방향 기준으로 돈다 (두 방식 결과가 같다)', () => {
    expect(shown(phone)).toEqual([1080, 1920]); // 원래 세로로 보인다
    const enc = join(dir, 'phone-rot.mp4');
    const fast = join(dir, 'phone-rot-fast.mp4');
    execFileSync(FFMPEG, ffmpegArgs('rotate', p, phone, enc, src(phone)), { stdio: 'ignore' });
    execFileSync(FFMPEG, ffmpegArgs('rotate-fast', p, phone, fast, src(phone)), {
      stdio: 'ignore',
    });
    expect(shown(enc)).toEqual([1920, 1080]);
    expect(shown(fast)).toEqual([1920, 1080]);
    const a = firstGray(enc);
    const b = firstGray(fast);
    const d = a.reduce((sum, v, i) => sum + Math.abs(v - (b[i] ?? 0)), 0) / a.length;
    expect(d).toBeLessThan(8);
  });
});
