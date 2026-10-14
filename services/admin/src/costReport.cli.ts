/**
 * 태그별 월 비용 리포트를 로컬에서 만든다 (ADR-047). Cost Explorer 호출 1번 = $0.01.
 *
 *   $env:AWS_PROFILE="fitcut"; pnpm --filter @fitcut/admin cost:report            # 이번 달, 화면에만
 *   $env:AWS_PROFILE="fitcut"; pnpm --filter @fitcut/admin cost:report 2026-10 --write   # README 표 갱신
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { periodOf, replaceSection, reportOf, toMarkdown, type CeGroup } from './costReport';

const args = process.argv.slice(2);
const write = args.includes('--write');
const today = new Date().toISOString().slice(0, 10);
const month = args.find((a) => !a.startsWith('--')) ?? today.slice(0, 7);
const { start, end } = periodOf(month, today);

const ce = new CostExplorerClient({ region: 'us-east-1' });
const groups: CeGroup[] = [];
let token: string | undefined;
do {
  const r = await ce.send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: start, End: end },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      // 크레딧·환불·세금을 빼고 실제 사용분만 본다
      Filter: { Dimensions: { Key: 'RECORD_TYPE', Values: ['Usage'] } },
      GroupBy: [
        { Type: 'TAG', Key: 'Component' },
        { Type: 'DIMENSION', Key: 'SERVICE' },
      ],
      NextPageToken: token,
    }),
  );
  for (const t of r.ResultsByTime ?? []) groups.push(...(t.Groups ?? []));
  token = r.NextPageToken;
} while (token);

const md = toMarkdown(reportOf(month, end, groups));
console.log(md);

if (write) {
  const readme = new URL('../../../README.md', import.meta.url);
  writeFileSync(readme, replaceSection(readFileSync(readme, 'utf8'), md));
  console.log('\nREADME.md 표를 갱신했어요.');
}
