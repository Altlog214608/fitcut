import { describe, expect, it } from 'vitest';
import { END, START, UNTAGGED, periodOf, replaceSection, reportOf, toMarkdown } from './costReport';

const g = (component: string, service: string, amount: string) => ({
  Keys: [`Component$${component}`, service],
  Metrics: { UnblendedCost: { Amount: amount } },
});

describe('reportOf', () => {
  it('구성 요소별로 합치고 비싼 순, 태그 없음은 맨 아래', () => {
    const r = reportOf('2026-10', '2026-10-14', [
      g('', 'AWS Cost Explorer', '0.05'),
      g('worker', 'AWS Lambda', '0.02'),
      g('worker', 'Amazon EC2 Container Registry (ECR)', '0.01'),
      g('web', 'Amazon CloudFront', '0.001'),
      g('api', 'AWS Lambda', '0'),
    ]);
    expect(r.components.map((c) => c.name)).toEqual(['worker', 'web', UNTAGGED]);
    expect(r.components[0]).toMatchObject({ usd: 0.03 });
    expect(r.components[0]?.services[0]).toEqual({ service: 'AWS Lambda', usd: 0.02 });
    expect(r.totalUsd).toBe(0.081);
  });
});

describe('periodOf', () => {
  it('지난달은 다음 달 1일까지, 이번 달은 오늘까지', () => {
    expect(periodOf('2026-09', '2026-10-14')).toEqual({ start: '2026-09-01', end: '2026-10-01' });
    expect(periodOf('2026-10', '2026-10-14')).toEqual({ start: '2026-10-01', end: '2026-10-14' });
    expect(periodOf('2026-12', '2027-02-01')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });

  it('잘못된 월과 아직 오지 않은 달은 거절', () => {
    expect(() => periodOf('2026-13', '2026-10-14')).toThrow();
    expect(() => periodOf('2026-11', '2026-10-14')).toThrow();
    expect(() => periodOf('2026-10', '2026-10-01')).toThrow();
  });
});

describe('toMarkdown, replaceSection', () => {
  it('표를 만들어 표시 사이만 바꾼다', () => {
    const md = toMarkdown(
      reportOf('2026-10', '2026-10-14', [
        g('worker', 'AWS Lambda', '0.004'),
        g('web', 'Amazon S3', '1.5'),
      ]),
    );
    expect(md).toContain('2026-10-01 ~ 2026-10-13');
    expect(md).toContain('| web | $1.50 | Amazon S3 $1.50 |');
    expect(md).toContain('| worker | $0.0040 |');
    const doc = `앞\n${START}\n옛 표\n${END}\n뒤`;
    expect(replaceSection(doc, md)).toBe(`앞\n${START}\n${md}\n${END}\n뒤`);
    expect(() => replaceSection('표시 없음', md)).toThrow();
  });
});
