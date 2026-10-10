/**
 * 요청한 사람의 IP와 하루 할당량 키 (순수 함수).
 * 원본 IP는 저장하지 않고 솔트를 넣은 HMAC 해시로만 쓴다 (CLAUDE.md 개인정보 원칙).
 */
import { createHmac } from 'node:crypto';

/**
 * CloudFront가 붙이는 CloudFront-Viewer-Address("1.2.3.4:5678", "[2001:db8::1]:443")에서 IP를 꺼낸다.
 * API는 CloudFront를 거쳐서만 받는다(오리진 확인 헤더). 없으면 API Gateway가 본 주소를 쓴다.
 */
export function clientIp(viewerAddress: string | undefined, sourceIp: string): string {
  if (!viewerAddress) return sourceIp;
  const v = viewerAddress.trim();
  if (v.startsWith('[')) {
    const close = v.indexOf(']');
    return close > 0 ? v.slice(1, close) : sourceIp;
  }
  const colon = v.lastIndexOf(':');
  // IPv4:포트. 콜론이 여러 개면 포트 없는 IPv6로 본다
  if (colon > 0 && v.indexOf(':') === colon) return v.slice(0, colon);
  return v || sourceIp;
}

export function ipHash(ip: string, salt: string): string {
  return createHmac('sha256', salt).update(ip).digest('hex').slice(0, 32);
}

/** 서울 시간 기준 날짜 yyyymmdd. 하루 할당량은 서울 자정에 바뀐다 */
export function seoulDay(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');
}

/** 할당량 기록이 지워져도 되는 시각(초): 그 날이 끝나고 하루 뒤 */
export function quotaExpiry(now: Date): number {
  const day = seoulDay(now);
  const nextSeoulMidnightUtc =
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) + 1) -
    9 * 60 * 60 * 1000;
  return Math.floor(nextSeoulMidnightUtc / 1000) + 24 * 60 * 60;
}

export function quotaKey(hash: string, now: Date) {
  return { PK: `QUOTA#${hash}#${seoulDay(now)}`, SK: 'COUNT' };
}
