/**
 * 파형 (FEATURES F14: 썸네일 대신 파형). 브라우저에서 음성을 풀어 구간마다 가장 큰 세기를 0~1로.
 * 큰 파일은 메모리를 많이 써서 풀지 않는다 (파형 없이도 구간은 고를 수 있다).
 */

/** 이보다 큰 파일은 파형을 그리지 않는다 */
export const WAVEFORM_MAX_BYTES = 150 * 1024 * 1024;

/** 채널들을 합쳐 buckets개 구간의 최대 세기 (0~1). 가장 큰 값이 1이 되게 맞춘다 */
export function peaks(channels: readonly Float32Array[], buckets: number): number[] {
  const length = channels[0]?.length ?? 0;
  if (length === 0 || buckets <= 0) return [];
  const out = new Array<number>(buckets).fill(0);
  const size = length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size);
    const to = Math.max(from + 1, Math.floor((b + 1) * size));
    let max = 0;
    for (const ch of channels) {
      for (let i = from; i < to && i < length; i++) {
        const v = Math.abs(ch[i] ?? 0);
        if (v > max) max = v;
      }
    }
    out[b] = max;
  }
  const top = Math.max(...out);
  return top > 0 ? out.map((v) => v / top) : out;
}

/** 파일을 풀어 파형을 만든다. 못 풀면 null (재생은 될 수 있다) */
export async function waveformOf(file: Blob, buckets: number): Promise<number[] | null> {
  if (file.size > WAVEFORM_MAX_BYTES) return null;
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
      audio.getChannelData(i),
    );
    return peaks(channels, buckets);
  } catch {
    return null;
  } finally {
    void ctx.close();
  }
}
