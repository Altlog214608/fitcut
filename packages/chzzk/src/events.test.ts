import { describe, expect, it } from 'vitest';
import { MAX_TEXT, normalize, parseSystem } from './events';

const ctx = {
  broadcastId: 'b1',
  channelId: 'ch1',
  startedAt: Date.parse('2026-10-12T10:00:00Z'),
  receivedAt: Date.parse('2026-10-12T10:01:00.500Z'),
};

describe('normalize', () => {
  it('채팅: 내용과 메시지 시각만 남기고 닉네임·작성자는 버린다', () => {
    const e = normalize(
      'CHAT',
      {
        channelId: 'ch1',
        senderChannelId: 'viewer-9',
        chatChannelId: 'cc',
        profile: { nickname: '시청자', badges: [], verifiedMark: false },
        userRoleCode: 'common_user',
        content: 'ㅋㅋㅋㅋ',
        emojis: { a: 'https://x' },
        messageTime: Date.parse('2026-10-12T10:00:30.250Z'),
      },
      ctx,
    );
    expect(e).toEqual({
      broadcastId: 'b1',
      t: 30.25,
      at: Date.parse('2026-10-12T10:00:30.250Z'),
      type: 'chat',
      text: 'ㅋㅋㅋㅋ',
    });
    expect(JSON.stringify(e)).not.toContain('시청자');
    expect(JSON.stringify(e)).not.toContain('viewer-9');
  });

  it('JSON 문자열로 와도 읽는다', () => {
    const e = normalize('CHAT', JSON.stringify({ channelId: 'ch1', content: 'hi' }), ctx);
    expect(e?.text).toBe('hi');
    expect(e?.at).toBe(ctx.receivedAt);
  });

  it('긴 채팅은 자른다', () => {
    const e = normalize('CHAT', { channelId: 'ch1', content: 'a'.repeat(1000) }, ctx);
    expect(e?.text).toHaveLength(MAX_TEXT);
  });

  it('다른 채널 이벤트는 버린다', () => {
    expect(normalize('CHAT', { channelId: 'other', content: 'x' }, ctx)).toBeNull();
  });

  it('후원: 금액은 숫자로, 후원자 정보는 버린다', () => {
    const e = normalize(
      'DONATION',
      {
        donationType: 'CHAT',
        channelId: 'ch1',
        donatorChannelId: 'd1',
        donatorNickname: '후원자',
        payAmount: '1000',
        donationText: '화이팅',
      },
      ctx,
    );
    expect(e).toEqual({
      broadcastId: 'b1',
      t: 60.5,
      at: ctx.receivedAt,
      type: 'donation',
      donationType: 'CHAT',
      amount: 1000,
      text: '화이팅',
    });
  });

  it('구독: 티어와 개월 수만', () => {
    const e = normalize(
      'SUBSCRIPTION',
      { channelId: 'ch1', subscriberNickname: '구독자', tierNo: 2, tierName: 'x', month: 3 },
      ctx,
    );
    expect(e).toMatchObject({ type: 'subscription', tier: 2, months: 3 });
    expect(JSON.stringify(e)).not.toContain('구독자');
  });

  it('수집 시작 전 시각은 0초로', () => {
    const e = normalize(
      'CHAT',
      { channelId: 'ch1', content: 'x', messageTime: ctx.startedAt - 5000 },
      ctx,
    );
    expect(e?.t).toBe(0);
  });
});

describe('parseSystem', () => {
  it('연결 완료에서 sessionKey를 꺼낸다', () => {
    expect(parseSystem({ type: 'connected', data: { sessionKey: 'k1' } })).toEqual({
      type: 'connected',
      sessionKey: 'k1',
    });
    expect(parseSystem(JSON.stringify({ type: 'connected', data: { sessionKey: 'k1' } }))).toEqual({
      type: 'connected',
      sessionKey: 'k1',
    });
  });

  it('권한 회수를 알아본다', () => {
    expect(parseSystem({ type: 'revoked', data: { eventType: 'CHAT', channelId: 'ch1' } })).toEqual(
      {
        type: 'revoked',
        eventType: 'CHAT',
        channelId: 'ch1',
      },
    );
  });

  it('모르는 메시지는 null', () => {
    expect(parseSystem({ type: 'x', data: {} })).toBeNull();
    expect(parseSystem('not json')).toBeNull();
  });
});
