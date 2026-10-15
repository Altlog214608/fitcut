/**
 * 태그별 월 비용 리포트 (ROADMAP M7, ADR-047).
 * Cost Explorer를 Component 태그 × 서비스로 한 번만 불러(호출당 $0.01) 표로 만든다.
 * 사용 금액은 크레딧을 빼기 전 값이다. 무료 플랜 크레딧이 있으면 실제 청구액은 0일 수 있다.
 */

export type CeGroup = {
  Keys?: string[] | undefined;
  Metrics?: Record<string, { Amount?: string | undefined }> | undefined;
};

export type CostReport = {
  month: string;
  /** 집계 끝 날짜 (포함하지 않음). 이번 달이면 오늘 */
  end: string;
  totalUsd: number;
  components: { name: string; usd: number; services: { service: string; usd: number }[] }[];
};

/** 태그 없이 생긴 비용 (bootstrap, Cost Explorer API, 태그를 받지 않는 요금 등) */
export const UNTAGGED = '태그 없음';

const round = (n: number) => Number(n.toFixed(6));

/** 'Component$worker' → 'worker', 'Component$' → 태그 없음 */
function componentOf(key: string | undefined) {
  const value = key?.split('$')[1] ?? '';
  return value === '' ? UNTAGGED : value;
}

/** GroupBy [TAG Component, DIMENSION SERVICE] 결과 → 구성 요소별 비용 (0인 것은 뺀다) */
export function reportOf(month: string, end: string, groups: readonly CeGroup[]): CostReport {
  const byComponent = new Map<string, Map<string, number>>();
  for (const g of groups) {
    const usd = Number(g.Metrics?.UnblendedCost?.Amount ?? 0);
    if (!(usd > 0)) continue;
    const name = componentOf(g.Keys?.[0]);
    const service = g.Keys?.[1] ?? '';
    const services = byComponent.get(name) ?? new Map<string, number>();
    services.set(service, (services.get(service) ?? 0) + usd);
    byComponent.set(name, services);
  }
  const components = [...byComponent].map(([name, services]) => {
    const list = [...services]
      .map(([service, usd]) => ({ service, usd: round(usd) }))
      .sort((a, b) => b.usd - a.usd);
    return { name, usd: round(list.reduce((s, x) => s + x.usd, 0)), services: list };
  });
  // 태그 없음은 맨 아래, 나머지는 비싼 순
  components.sort(
    (a, b) => Number(a.name === UNTAGGED) - Number(b.name === UNTAGGED) || b.usd - a.usd,
  );
  return {
    month,
    end,
    totalUsd: round(components.reduce((s, c) => s + c.usd, 0)),
    components,
  };
}

/** 'YYYY-MM' 달의 Cost Explorer 기간. 이번 달이면 오늘까지 (End는 포함하지 않는 날짜) */
export function periodOf(month: string, today: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`월 형식은 YYYY-MM이에요: ${month}`);
  const start = `${month}-01`;
  const next = new Date(`${start}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const nextStart = next.toISOString().slice(0, 10);
  const end = today < nextStart ? today : nextStart;
  if (end <= start) throw new Error(`${month}은 아직 시작하지 않았어요`);
  return { start, end };
}

/** 이 프로젝트는 금액이 작아서 1센트 아래는 소수점 넷째 자리까지 보여준다 */
const usd = (n: number) =>
  n === 0 ? '$0' : n < 0.0001 ? '< $0.0001' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;

/** README에 넣을 표 */
export function toMarkdown(r: CostReport) {
  const lastDay = new Date(`${r.end}T00:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const range = `${r.month}-01 ~ ${lastDay.toISOString().slice(0, 10)}`;
  const lines = [
    `${range} 사용 금액 (UTC 기준, 크레딧 적용 전): **${usd(r.totalUsd)}**`,
    '',
    '| 구성 요소 (Component 태그) | 비용 | 주요 서비스 |',
    '| --- | --- | --- |',
    ...r.components.map((c) => {
      const top = c.services
        .slice(0, 3)
        .map((s) => `${s.service} ${usd(s.usd)}`)
        .join(', ');
      return `| ${c.name} | ${usd(c.usd)} | ${top} |`;
    }),
  ];
  if (r.components.length === 0) lines.push('| (비용 없음) | $0 | |');
  return lines.join('\n');
}

export const START = '<!-- cost-report:start -->';
export const END = '<!-- cost-report:end -->';

/** README의 표시 사이만 바꾼다 */
export function replaceSection(doc: string, body: string) {
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error(`README에 ${START} … ${END} 표시가 없어요`);
  return `${doc.slice(0, a + START.length)}\n${body}\n${doc.slice(b)}`;
}
