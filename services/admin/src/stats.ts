/**
 * 일별 집계 (순수 함수, docs/ADMIN.md). 쿼리 문장, Athena 결과 표 → 숫자, 하루 기록 모양.
 * 쿼리는 그날 파티션(dt)만 읽어 스캔량을 줄인다. 날짜는 서울 기준.
 */

/** 서울 기준 어제 YYYY-MM-DD */
export function seoulYesterday(now: Date): string {
  const seoul = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  seoul.setUTCDate(seoul.getUTCDate() - 1);
  return seoul.toISOString().slice(0, 10);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (d: string) => DAY.test(d);

/** 집계에 쓰는 쿼리들. 이름은 결과를 담을 자리 */
export function queries(table: string, dt: string): Record<string, string> {
  if (!isDay(dt)) throw new Error(`bad day ${dt}`);
  const day = `FROM ${table} WHERE dt = '${dt}'`;
  return {
    sessions: `SELECT count(DISTINCT sessionid) AS n ${day} AND source = 'web'`,
    tools: `SELECT name, coalesce(tool, '') AS tool, count(*) AS n ${day} AND source = 'web' GROUP BY 1, 2`,
    devices: `SELECT devicetype, os, count(*) AS n ${day} AND name = 'session_start' GROUP BY 1, 2`,
    presets: `SELECT presetid, count(*) AS n ${day} AND name = 'preset_selected' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
    misses: `SELECT lower(query) AS query, count(*) AS n ${day} AND name = 'preset_search_miss' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
    jobs: `SELECT type, count_if(name = 'job_succeeded') AS ok, count_if(name = 'job_failed') AS failed, approx_percentile(processingms, 0.5) AS p50, approx_percentile(processingms, 0.95) AS p95, sum(estcostusd) AS cost ${day} AND name IN ('job_succeeded', 'job_failed') GROUP BY 1`,
    errors: `SELECT coalesce(errorcode, code) AS code, count(*) AS n ${day} AND name IN ('error_shown', 'job_failed') GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
    links: `SELECT name, count(*) AS n ${day} AND name IN ('link_saved', 'link_embed_blocked') GROUP BY 1`,
  };
}

export type Row = Record<string, string>;

/** Athena GetQueryResults의 행(첫 행이 머리글)을 객체로 */
export type ResultRow = { Data?: { VarCharValue?: string | undefined }[] | undefined };

export function rowsOf(result: readonly ResultRow[]): Row[] {
  const [head, ...rest] = result;
  const names = (head?.Data ?? []).map((d) => d.VarCharValue ?? '');
  return rest.map((r) =>
    Object.fromEntries(names.map((n, i) => [n, r.Data?.[i]?.VarCharValue ?? ''])),
  );
}

const num = (v: string | undefined) => (v === undefined || v === '' ? 0 : Number(v));

export type CostLine = { service: string; usd: number };

export type DayStats = {
  day: string;
  sessions: number;
  /** 도구별: 열기, 파일 선택, 저장 */
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
  cost: { totalUsd: number; services: CostLine[] } | null;
};

export function assemble(day: string, r: Record<string, Row[]>, cost: DayStats['cost']): DayStats {
  const tools: DayStats['tools'] = {};
  for (const row of r.tools ?? []) {
    if (!row.tool) continue;
    const t = (tools[row.tool] ??= { open: 0, selected: 0, exported: 0, errors: 0 });
    const n = num(row.n);
    if (row.name === 'tool_open') t.open += n;
    else if (row.name === 'file_selected') t.selected += n;
    else if (row.name === 'export_done') t.exported += n;
    else if (row.name === 'error_shown') t.errors += n;
  }
  const links = { saved: 0, blocked: 0 };
  for (const row of r.links ?? []) {
    if (row.name === 'link_saved') links.saved = num(row.n);
    if (row.name === 'link_embed_blocked') links.blocked = num(row.n);
  }
  return {
    day,
    sessions: num(r.sessions?.[0]?.n),
    tools,
    devices: (r.devices ?? []).map((x) => ({
      deviceType: x.devicetype ?? '',
      os: x.os ?? '',
      n: num(x.n),
    })),
    presets: (r.presets ?? []).map((x) => ({ id: x.presetid ?? '', n: num(x.n) })),
    misses: (r.misses ?? []).map((x) => ({ query: x.query ?? '', n: num(x.n) })),
    jobs: (r.jobs ?? []).map((x) => ({
      type: x.type ?? '',
      ok: num(x.ok),
      failed: num(x.failed),
      p50Ms: Math.round(num(x.p50)),
      p95Ms: Math.round(num(x.p95)),
      costUsd: Number(num(x.cost).toFixed(6)),
    })),
    errors: (r.errors ?? []).map((x) => ({ code: x.code ?? '', n: num(x.n) })),
    links,
    cost,
  };
}

/** Cost Explorer 결과 → 서비스별 비용 (0인 것은 뺀다) */
export function costOf(
  groups: readonly {
    Keys?: string[] | undefined;
    Metrics?: Record<string, { Amount?: string | undefined }> | undefined;
  }[],
) {
  const services = groups
    .map((g) => ({
      service: g.Keys?.[0] ?? '',
      usd: Number(g.Metrics?.UnblendedCost?.Amount ?? 0),
    }))
    .filter((s) => s.usd > 0)
    .sort((a, b) => b.usd - a.usd);
  const totalUsd = Number(services.reduce((sum, s) => sum + s.usd, 0).toFixed(6));
  return { totalUsd, services };
}
