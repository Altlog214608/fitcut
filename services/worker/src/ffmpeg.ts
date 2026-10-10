/**
 * ffmpeg·ffprobe 인자 만들기 (순수 함수). 실행은 run.ts가 한다.
 * - 구간은 재인코딩으로 자른다: -ss를 입력 앞에 두면 빠르게 찾아가고, 재인코딩할 때는 정확히 그 시각부터
 *   시작한다(accurate_seek 기본값). 키프레임 위치에 밀리지 않는다 (FEATURES F3 수용 기준).
 * - 가로 폭만 정하고 세로는 비율대로, 짝수로 맞춘다(-2). 원본보다 크게 키우지 않는다.
 */
export type OutputKind = 'gif' | 'webp' | 'mp4';

export type Params = { start: number; end: number; fps: number; width: number };

export const EXTENSION: Record<OutputKind, string> = { gif: 'gif', webp: 'webp', mp4: 'mp4' };
export const MIME: Record<OutputKind, string> = {
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
};

/** 초를 ffmpeg 시각 문자열로 (밀리초까지) */
export function seconds(value: number): string {
  return (Math.round(value * 1000) / 1000).toFixed(3);
}

/** 원본보다 키우지 않고 가로를 맞춘다. 세로는 비율대로 짝수 */
function scale(width: number): string {
  return `scale='min(${width},iw)':-2:flags=lanczos`;
}

export function ffmpegArgs(kind: OutputKind, p: Params, input: string, output: string): string[] {
  const head = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-ss',
    seconds(p.start),
    '-t',
    seconds(p.end - p.start),
    '-i',
    input,
    '-an',
    '-map_metadata',
    '-1',
  ];
  const base = `fps=${p.fps},${scale(p.width)}`;
  switch (kind) {
    case 'gif':
      // 팔레트 2단계: 구간에서 색을 뽑아 쓰면 기본 팔레트보다 훨씬 깨끗하다
      return [
        ...head,
        '-filter_complex',
        `${base},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
        '-loop',
        '0',
        output,
      ];
    case 'webp':
      return [
        ...head,
        '-vf',
        base,
        '-c:v',
        'libwebp_anim',
        '-lossless',
        '0',
        '-q:v',
        '75',
        '-compression_level',
        '4',
        '-loop',
        '0',
        output,
      ];
    case 'mp4':
      return [
        ...head,
        '-vf',
        base,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        output,
      ];
  }
}

export function ffprobeArgs(input: string): string[] {
  return [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_entries',
    'format=format_name,duration:stream=codec_type,codec_name,width,height,avg_frame_rate',
    input,
  ];
}

export type Probe = {
  format: string;
  duration: number;
  video: { codec: string; width: number; height: number; fps: number } | null;
};

function rate(value: string | undefined): number {
  const [n, d] = (value ?? '0/1').split('/').map(Number);
  return n && d ? n / d : 0;
}

/** ffprobe JSON에서 필요한 것만 꺼낸다. 형식을 알 수 없으면 null */
export function parseProbe(json: string): Probe | null {
  let data: {
    format?: { format_name?: string; duration?: string };
    streams?: {
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
    }[];
  };
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const duration = Number(data.format?.duration);
  if (!data.format?.format_name || !Number.isFinite(duration)) return null;
  const v = data.streams?.find((s) => s.codec_type === 'video');
  return {
    format: data.format.format_name,
    duration,
    video:
      v && v.width && v.height
        ? {
            codec: v.codec_name ?? '',
            width: v.width,
            height: v.height,
            fps: rate(v.avg_frame_rate),
          }
        : null,
  };
}

/** 확장자를 믿지 않고 실제 내용으로 확인한다. 실패하면 화면에 보일 문구 */
export function checkInput(probe: Probe | null, p: Params): string | null {
  if (!probe || !probe.video)
    return '영상을 읽을 수 없어요. MP4 · MOV · WebM 파일인지 확인해 주세요.';
  const allowed = ['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm'];
  if (!allowed.includes(probe.format)) return 'MP4 · MOV · WebM 영상만 만들 수 있어요.';
  if (p.start >= probe.duration) return '구간이 영상 길이를 넘었어요. 구간을 다시 골라 주세요.';
  return null;
}
