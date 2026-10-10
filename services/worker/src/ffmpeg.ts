/**
 * ffmpeg·ffprobe 인자 만들기 (순수 함수). 실행은 run.ts가 한다.
 * - 구간은 재인코딩으로 자른다: -ss를 입력 앞에 두면 빠르게 찾아가고, 재인코딩할 때는 정확히 그 시각부터
 *   시작한다(accurate_seek 기본값). 키프레임 위치에 밀리지 않는다 (FEATURES F3 수용 기준).
 * - 보통은 가로 폭만 정하고 세로는 비율대로, 짝수로 맞춘다(-2). 원본보다 크게 키우지 않는다.
 * - 세로까지 정하면(워치 화면 등) 그 크기에 꽉 차게 키우거나 줄인 뒤 가운데를 잘라 정확히 맞춘다.
 */
export type OutputKind = 'gif' | 'webp' | 'mp4' | 'mp3' | 'm4a' | 'wav' | 'm4r';

const AUDIO: readonly OutputKind[] = ['mp3', 'm4a', 'wav', 'm4r'];
export const isAudio = (kind: OutputKind) => AUDIO.includes(kind);

export type Params = {
  start: number;
  end: number;
  fps: number;
  width: number;
  height?: number;
  /** 음성 (F14): 페이드 인·아웃(초), 음량 맞추기, 채널 수, 비트레이트(kbps) */
  fadeIn?: number;
  fadeOut?: number;
  normalize?: boolean;
  channels?: 1 | 2;
  bitrate?: number;
};

export const EXTENSION: Record<OutputKind, string> = {
  gif: 'gif',
  webp: 'webp',
  mp4: 'mp4',
  mp3: 'mp3',
  m4a: 'm4a',
  wav: 'wav',
  m4r: 'm4r',
};
export const MIME: Record<OutputKind, string> = {
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  m4r: 'audio/x-m4r',
};

/**
 * 음성 필터: 음량 맞추기(EBU R128 loudnorm, -16 LUFS) → 페이드 인·아웃.
 * -ss를 입력 앞에 두면 구간 시작이 0초가 되므로 페이드 시각도 0부터 잰다.
 */
export function audioFilter(p: Params): string | null {
  const dur = p.end - p.start;
  const parts: string[] = [];
  if (p.normalize) parts.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  if (p.fadeIn && p.fadeIn > 0) parts.push(`afade=t=in:st=0:d=${seconds(p.fadeIn)}`);
  if (p.fadeOut && p.fadeOut > 0) {
    parts.push(`afade=t=out:st=${seconds(Math.max(0, dur - p.fadeOut))}:d=${seconds(p.fadeOut)}`);
  }
  return parts.length > 0 ? parts.join(',') : null;
}

function audioArgs(kind: OutputKind, p: Params, input: string, output: string): string[] {
  const filter = audioFilter(p);
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
    '-vn',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    ...(filter ? ['-af', filter] : []),
    '-ac',
    String(p.channels ?? 2),
    // loudnorm은 내부에서 192kHz로 올린다. 결과는 흔한 44.1kHz로
    '-ar',
    '44100',
  ];
  const kbps = `${p.bitrate ?? 192}k`;
  switch (kind) {
    case 'mp3':
      return [...head, '-c:a', 'libmp3lame', '-b:a', kbps, '-f', 'mp3', output];
    case 'wav':
      return [...head, '-c:a', 'pcm_s16le', '-f', 'wav', output];
    default:
      // m4a와 m4r(아이폰 벨소리)는 같은 AAC in MP4. 확장자만 다르다
      return [...head, '-c:a', 'aac', '-b:a', kbps, '-movflags', '+faststart', '-f', 'mp4', output];
  }
}

/** 초를 ffmpeg 시각 문자열로 (밀리초까지) */
export function seconds(value: number): string {
  return (Math.round(value * 1000) / 1000).toFixed(3);
}

/** 원본보다 키우지 않고 가로를 맞춘다. 세로는 비율대로 짝수. 세로를 정하면 꽉 차게 맞춰 가운데를 자른다 */
function scale(width: number, height?: number): string {
  if (height) {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`;
  }
  return `scale='min(${width},iw)':-2:flags=lanczos`;
}

export function ffmpegArgs(kind: OutputKind, p: Params, input: string, output: string): string[] {
  if (isAudio(kind)) return audioArgs(kind, p, input, output);
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
  const base = `fps=${p.fps},${scale(p.width, p.height)}`;
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
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

export function ffprobeArgs(input: string): string[] {
  return [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_entries',
    'format=format_name,duration:stream=codec_type,codec_name,width,height,avg_frame_rate,channels',
    input,
  ];
}

export type Probe = {
  format: string;
  duration: number;
  video: { codec: string; width: number; height: number; fps: number } | null;
  audio: { codec: string; channels: number } | null;
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
      channels?: number;
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
  const a = data.streams?.find((s) => s.codec_type === 'audio');
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
    audio: a ? { codec: a.codec_name ?? '', channels: a.channels ?? 0 } : null,
  };
}

/** 확장자를 믿지 않고 실제 내용으로 확인한다. 실패하면 화면에 보일 문구 */
export function checkInput(
  probe: Probe | null,
  p: Params,
  kind: OutputKind = 'gif',
): string | null {
  if (isAudio(kind)) {
    if (!probe) return '파일을 읽을 수 없어요. 영상이나 음성 파일인지 확인해 주세요.';
    if (!probe.audio) return '이 파일에는 소리가 없어요. 소리가 있는 파일을 골라 주세요.';
    const allowedAudio = ['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm', 'mp3', 'wav'];
    if (!allowedAudio.includes(probe.format)) {
      return 'MP4 · MOV · WebM · MP3 · M4A · WAV 파일만 쓸 수 있어요.';
    }
    if (p.start >= probe.duration) return '구간이 파일 길이를 넘었어요. 구간을 다시 골라 주세요.';
    return null;
  }
  if (!probe || !probe.video)
    return '영상을 읽을 수 없어요. MP4 · MOV · WebM 파일인지 확인해 주세요.';
  const allowed = ['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm'];
  if (!allowed.includes(probe.format)) return 'MP4 · MOV · WebM 영상만 만들 수 있어요.';
  if (p.start >= probe.duration) return '구간이 영상 길이를 넘었어요. 구간을 다시 골라 주세요.';
  return null;
}
