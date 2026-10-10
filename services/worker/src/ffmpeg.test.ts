import { describe, expect, it } from 'vitest';
import { audioFilter, checkInput, ffmpegArgs, nextRotation, parseProbe, seconds } from './ffmpeg';

const p = { start: 1.5, end: 4, fps: 15, width: 480 };

describe('ffmpegArgs', () => {
  it('구간은 입력 앞 -ss와 -t로 (재인코딩이라 프레임 정확)', () => {
    const args = ffmpegArgs('gif', p, 'in.mp4', 'out.gif');
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-i') + 2)).toEqual([
      '-ss',
      '1.500',
      '-t',
      '2.500',
      '-i',
      'in.mp4',
    ]);
  });

  it('GIF는 팔레트 2단계, 무한 반복, 소리·메타데이터 없음', () => {
    const args = ffmpegArgs('gif', p, 'in.mp4', 'out.gif');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('palettegen');
    expect(filter).toContain('paletteuse');
    expect(filter).toContain('fps=15');
    expect(args).toEqual(expect.arrayContaining(['-an', '-loop', '0', '-map_metadata', '-1']));
    expect(args.at(-1)).toBe('out.gif');
  });

  it('원본보다 크게 키우지 않고 세로는 짝수로', () => {
    const args = ffmpegArgs('mp4', p, 'in.mp4', 'out.mp4');
    expect(args[args.indexOf('-vf') + 1]).toBe("fps=15,scale='min(480,iw)':-2:flags=lanczos");
  });

  it('세로까지 정하면 꽉 차게 맞춘 뒤 가운데를 잘라 정확한 크기로 (워치 화면)', () => {
    const args = ffmpegArgs('gif', { ...p, width: 480, height: 480 }, 'in.mp4', 'out.gif');
    expect(args[args.indexOf('-filter_complex') + 1]).toContain(
      'scale=480:480:force_original_aspect_ratio=increase:flags=lanczos,crop=480:480',
    );
  });

  it('WebP는 libwebp_anim, MP4는 H.264 yuv420p + faststart', () => {
    expect(ffmpegArgs('webp', p, 'i', 'o')).toEqual(expect.arrayContaining(['libwebp_anim']));
    expect(ffmpegArgs('mp4', p, 'i', 'o')).toEqual(
      expect.arrayContaining(['libx264', 'yuv420p', '+faststart']),
    );
  });

  it('시각은 밀리초까지', () => {
    expect(seconds(1 / 3)).toBe('0.333');
  });
});

describe('parseProbe · checkInput', () => {
  const mp4 = JSON.stringify({
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '10.0' },
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        avg_frame_rate: '30000/1001',
      },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  });

  it('필요한 값만 꺼낸다', () => {
    const probe = parseProbe(mp4);
    expect(probe?.duration).toBe(10);
    expect(probe?.video).toMatchObject({ codec: 'h264', width: 1920, height: 1080 });
    expect(probe?.video?.fps).toBeCloseTo(29.97, 2);
  });

  it('정상 영상은 통과', () => {
    expect(checkInput(parseProbe(mp4), p)).toBeNull();
  });

  it('영상이 아니거나 형식이 다르거나 구간이 길이를 넘으면 문구', () => {
    expect(checkInput(parseProbe('nope'), p)).toContain('영상을 읽을 수 없어요');
    const gif = JSON.stringify({
      format: { format_name: 'gif', duration: '3' },
      streams: [{ codec_type: 'video', width: 10, height: 10 }],
    });
    expect(checkInput(parseProbe(gif), p)).toBe('MP4 · MOV · WebM 영상만 만들 수 있어요.');
    expect(checkInput(parseProbe(mp4), { ...p, start: 12, end: 14 })).toContain(
      '영상 길이를 넘었어요',
    );
  });
});

describe('음성 (F14)', () => {
  const a = { start: 10, end: 20, fps: 15, width: 480 };

  it('영상·자막을 빼고 코덱·비트레이트·채널을 정한다', () => {
    const mp3 = ffmpegArgs('mp3', { ...a, bitrate: 128, channels: 1 }, 'in', 'out.mp3');
    expect(mp3).toEqual(expect.arrayContaining(['-vn', 'libmp3lame', '128k', '-ac', '1']));
    expect(ffmpegArgs('wav', a, 'in', 'o')).toEqual(expect.arrayContaining(['pcm_s16le']));
    const m4r = ffmpegArgs('m4r', a, 'in', 'o.m4r');
    expect(m4r).toEqual(expect.arrayContaining(['aac', '-f', 'mp4', '192k']));
  });

  it('필터: 음량 맞추기 → 페이드 인 → 페이드 아웃 (구간 끝에서 거꾸로)', () => {
    expect(audioFilter({ ...a, normalize: true, fadeIn: 1.5, fadeOut: 2 })).toBe(
      'loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=1.500,afade=t=out:st=8.000:d=2.000',
    );
    expect(audioFilter(a)).toBeNull();
  });

  it('음성은 소리만 있으면 된다 (MP3·WAV도), 소리가 없으면 이유를 알려준다', () => {
    const mp3 = JSON.stringify({
      format: { format_name: 'mp3', duration: '30' },
      streams: [{ codec_type: 'audio', codec_name: 'mp3', channels: 2 }],
    });
    expect(checkInput(parseProbe(mp3), a, 'mp3')).toBeNull();
    const silent = JSON.stringify({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '30' },
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 10, height: 10 }],
    });
    expect(checkInput(parseProbe(silent), a, 'm4a')).toContain('소리가 없어요');
    expect(checkInput(parseProbe(mp3), a, 'gif')).toContain('영상을 읽을 수 없어요');
  });
});

describe('세로로 돌리기 (F21)', () => {
  const r = { start: 0, end: 10, fps: 30, width: 480 };

  it('회전 정보: 보이는 방향에서 시계 방향으로 더 돈다 (display_rotation은 반시계)', () => {
    expect(nextRotation(0, 90)).toBe(-90);
    expect(nextRotation(-90, 90)).toBe(180);
    expect(nextRotation(-90, 270)).toBe(0);
    expect(nextRotation(90, 180)).toBe(-90);
  });

  it('다시 압축: 돌리고(반전) 프레임 시각 그대로, 고품질 H.264, 소리는 복사하거나 AAC로', () => {
    const args = ffmpegArgs('rotate', { ...r, rotate: 90, flip: true }, 'in', 'out', {
      rotation: 0,
      audioCodec: 'pcm_s16le',
    });
    expect(args[args.indexOf('-vf') + 1]).toBe('transpose=1,hflip');
    expect(args).toEqual(expect.arrayContaining(['passthrough', '-crf', '18', 'aac']));
    expect(args).not.toContain('-ss');
    const left = ffmpegArgs('rotate', { ...r, rotate: 270 }, 'in', 'out', {
      rotation: 0,
      audioCodec: 'aac',
    });
    expect(left[left.indexOf('-vf') + 1]).toBe('transpose=2');
    expect(left[left.indexOf('-c:a') + 1]).toBe('copy');
  });

  it('빠르게: 다시 압축하지 않고 회전 정보만', () => {
    const args = ffmpegArgs('rotate-fast', { ...r, rotate: 90 }, 'in', 'out', {
      rotation: -90,
      audioCodec: null,
    });
    expect(args.slice(3, 5)).toEqual(['-display_rotation:v:0', '180']);
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args).not.toContain('-c:a');
  });

  it('너무 길거나 크면 이유와 다른 방법을 알려준다', () => {
    const probe = (duration: number, width = 1920, height = 1080, fps = '30/1') =>
      parseProbe(
        JSON.stringify({
          format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(duration) },
          streams: [
            { codec_type: 'video', codec_name: 'h264', width, height, avg_frame_rate: fps },
          ],
        }),
      );
    expect(checkInput(probe(170), r, 'rotate')).toBeNull();
    expect(checkInput(probe(200), r, 'rotate')).toContain('3분까지');
    expect(checkInput(probe(120, 3840, 2160, '60/1'), r, 'rotate')).toContain('빠르게');
    expect(checkInput(probe(500), r, 'rotate-fast')).toBeNull();
    expect(checkInput(probe(700), r, 'rotate-fast')).toContain('10분');
  });
});
