import { describe, expect, it } from 'vitest';
import { checkInput, ffmpegArgs, parseProbe, seconds } from './ffmpeg';

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
