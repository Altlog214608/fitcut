/** 관리자 개요: 여러 날의 집계를 기간 합계로 (순수 함수, docs/ADMIN.md 관리자 화면) */

export type DayStats = {
  day: string;
  sessions: number;
  tools: Record<string, { open: number; selected: number; exported: number; errors: number }>;
  devices: { deviceType: string; os: string; n: number }[];
  presets: { id: string; n: number }[];
  misses: { query: string; n: number }[];
  jobs: {
    type: string;
    ok: number;
    failed: number;
    p50Ms: number;
    p95Ms: number;
    costUsd: number;
  }[];
  errors: { code: string; n: number }[];
  links: { saved: number; blocked: number };
  cost: { totalUsd: number; services: { service: string; usd: number }[] } | null;
};

const add = <K extends string>(map: Map<K, number>, key: K, n: number) =>
  map.set(key, (map.get(key) ?? 0) + n);
const top = (map: Map<string, number>, n = 10) =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

export function summarize(days: readonly DayStats[]) {
  const tools = new Map<
    string,
    { open: number; selected: number; exported: number; errors: number }
  >();
  const presets = new Map<string, number>();
  const misses = new Map<string, number>();
  const errors = new Map<string, number>();
  const services = new Map<string, number>();
  const devices = new Map<string, number>();
  const jobs = new Map<string, { ok: number; failed: number; costUsd: number; p95Ms: number }>();
  let sessions = 0;
  let cost = 0;
  let links = 0;
  let blocked = 0;
  for (const d of days) {
    sessions += d.sessions;
    links += d.links.saved;
    blocked += d.links.blocked;
    for (const [name, t] of Object.entries(d.tools)) {
      const sum = tools.get(name) ?? { open: 0, selected: 0, exported: 0, errors: 0 };
      tools.set(name, {
        open: sum.open + t.open,
        selected: sum.selected + t.selected,
        exported: sum.exported + t.exported,
        errors: sum.errors + t.errors,
      });
    }
    for (const p of d.presets) add(presets, p.id, p.n);
    for (const m of d.misses) add(misses, m.query, m.n);
    for (const e of d.errors) add(errors, e.code, e.n);
    for (const x of d.devices) add(devices, `${x.deviceType} · ${x.os}`, x.n);
    for (const j of d.jobs) {
      const sum = jobs.get(j.type) ?? { ok: 0, failed: 0, costUsd: 0, p95Ms: 0 };
      // p95는 날마다 따로 계산된 값이라 기간 전체 p95가 아니다. 기간 중 가장 나빴던 날을 보여준다
      jobs.set(j.type, {
        ok: sum.ok + j.ok,
        failed: sum.failed + j.failed,
        costUsd: sum.costUsd + j.costUsd,
        p95Ms: Math.max(sum.p95Ms, j.p95Ms),
      });
    }
    if (d.cost) {
      cost += d.cost.totalUsd;
      for (const s of d.cost.services) add(services, s.service, s.usd);
    }
  }
  const jobList = [...jobs.entries()].map(([type, j]) => ({ type, ...j }));
  const ok = jobList.reduce((s, j) => s + j.ok, 0);
  const failed = jobList.reduce((s, j) => s + j.failed, 0);
  return {
    days: days.length,
    sessions,
    jobs: { ok, failed, successRate: ok + failed > 0 ? ok / (ok + failed) : null, list: jobList },
    costUsd: cost,
    services: top(services),
    tools: [...tools.entries()].sort((a, b) => b[1].open - a[1].open),
    presets: top(presets),
    misses: top(misses),
    errors: top(errors),
    devices: top(devices),
    links: { saved: links, blocked },
    daily: [...days]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({ day: d.day, sessions: d.sessions })),
  };
}

export const usd = (v: number) => `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
