import { describe, expect, it } from 'vitest';
import {
  candidatesAt,
  foundScenes,
  replayEvents,
  sampleReplay,
  toReplay,
  trackDetections,
} from './replay';
import { analyze } from './score';

describe('replay', () => {
  it('예시 방송은 매번 같다', () => {
    expect(sampleReplay()).toEqual(sampleReplay());
    expect(sampleReplay(1).chat).not.toEqual(sampleReplay(2).chat);
  });

  it('초마다 개수 → 이벤트 → 초마다 개수가 같다', () => {
    const data = sampleReplay();
    const back = toReplay(replayEvents(data), data.durationSec);
    expect(back.chat).toEqual(data.chat);
    expect(back.reaction).toEqual(data.reaction);
    expect(back.subscription).toEqual(data.subscription);
    expect(back.donations).toEqual(data.donations);
  });

  it('toReplay는 채팅 본문을 남기지 않는다', () => {
    const r = toReplay(
      [
        { t: 0.2, type: 'chat', text: '안녕하세요' },
        { t: 0.5, type: 'chat', text: 'ㅋㅋㅋㅋ' },
        { t: 1.1, type: 'donation', amount: 3000 },
      ],
      2,
    );
    expect(r).toEqual({
      v: 1,
      kind: 'recorded',
      durationSec: 2,
      chat: [2, 0],
      reaction: [1, 0],
      subscription: [0, 0],
      donations: [[1, 3000]],
    });
  });

  it('예시 방송의 장면을 다 찾고, 상위 5개는 모두 장면이다', () => {
    const data = sampleReplay();
    const { candidates } = analyze(replayEvents(data), data.durationSec);
    const scenes = data.scenes ?? [];
    expect(foundScenes(scenes, candidates)).toHaveLength(scenes.length);
    const top5 = candidates.slice(0, 5);
    expect(top5.every((c) => foundScenes(scenes, [c]).length > 0)).toBe(true);
  });

  it('실시간으로 보면 장면이 지나고 30초 안에 감지한다', () => {
    const data = sampleReplay();
    const events = replayEvents(data);
    let detections = trackDetections([], [], 0);
    for (let t = 1; t <= data.durationSec; t++)
      detections = trackDetections(detections, candidatesAt(events, t), t);
    for (const s of data.scenes ?? []) {
      const d = detections.find((x) => Math.abs(x.peak - s.t) < 30);
      expect(d, s.label).toBeDefined();
      expect((d?.at ?? Infinity) - s.t, s.label).toBeLessThan(30);
    }
  });

  it('trackDetections는 피크가 조금 움직여도 처음 감지한 때를 지킨다', () => {
    const c = (peak: number) => ({
      rank: 1,
      start: peak - 15,
      end: peak + 10,
      peak,
      score: 3,
      counts: { chat: 1, reaction: 1, donation: 0, subscription: 0 },
    });
    const a = trackDetections([], [c(100)], 110);
    const b = trackDetections(a, [c(104), c(300)], 320);
    expect(b).toEqual([
      { peak: 100, at: 110 },
      { peak: 300, at: 320 },
    ]);
  });
});
