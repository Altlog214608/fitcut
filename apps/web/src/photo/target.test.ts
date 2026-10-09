import { VISIBLE_PRESETS } from '@fitcut/presets';
import { describe, expect, it } from 'vitest';
import {
  isTargetList,
  pushRecent,
  QUICK_PICK_IDS,
  quickPicks,
  resolveTarget,
  type Target,
} from './target';

describe('resolveTarget', () => {
  it('프리셋 화면의 크기와 모양', () => {
    const r = resolveTarget(
      { kind: 'preset', presetId: 'samsung-galaxy-watch9-44mm', role: 'main' },
      VISIBLE_PRESETS,
    );
    expect(r?.size).toEqual({ width: 480, height: 480 });
    expect(r?.shape).toBe('circle');
    expect(r?.label).toBe('Galaxy Watch9 44mm');
  });

  it('화면이 여러 개인 기기는 이름에 화면을 붙인다', () => {
    const r = resolveTarget(
      { kind: 'preset', presetId: 'samsung-galaxy-z-flip8', role: 'cover' },
      VISIBLE_PRESETS,
    );
    expect(r?.size).toEqual({ width: 948, height: 1048 });
    expect(r?.label).toBe('Galaxy Z Flip8 커버 화면');
  });

  it('직접 입력은 1~8000 정수만', () => {
    expect(resolveTarget({ kind: 'custom', width: 1080, height: 1920 }, [])?.size).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(resolveTarget({ kind: 'custom', width: 0, height: 1920 }, [])).toBeNull();
    expect(resolveTarget({ kind: 'custom', width: 9000, height: 10 }, [])).toBeNull();
    expect(resolveTarget({ kind: 'custom', width: 10.5, height: 10 }, [])).toBeNull();
  });

  it('없는 프리셋은 null', () => {
    expect(resolveTarget({ kind: 'preset', presetId: 'nope', role: 'main' }, VISIBLE_PRESETS)).toBe(
      null,
    );
  });
});

describe('pushRecent', () => {
  const a: Target = { kind: 'preset', presetId: 'a', role: 'main' };
  const b: Target = { kind: 'custom', width: 1, height: 2 };

  it('맨 앞에 넣고 중복은 뺀다', () => {
    expect(pushRecent([a, b], b)).toEqual([b, a]);
  });

  it('최대 개수를 넘지 않는다', () => {
    const many = Array.from({ length: 10 }, (_, i): Target => ({
      kind: 'custom',
      width: i + 1,
      height: 1,
    }));
    expect(pushRecent(many, a, 6)).toHaveLength(6);
  });
});

describe('isTargetList', () => {
  it('저장된 값이 깨져 있으면 거른다', () => {
    expect(isTargetList([{ kind: 'preset', presetId: 'x', role: 'main' }])).toBe(true);
    expect(isTargetList([{ kind: 'preset' }])).toBe(false);
    expect(isTargetList('nope')).toBe(false);
  });
});

describe('quickPicks', () => {
  it('빠른 선택 기기가 모두 보이는 프리셋에 있다 (데이터가 바뀌면 이 테스트가 알려준다)', () => {
    expect(quickPicks(VISIBLE_PRESETS).map((p) => p.id)).toEqual(QUICK_PICK_IDS);
  });
});
