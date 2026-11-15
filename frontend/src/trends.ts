import { analyze, monthlyAnomalies } from './analysis';
import type { Cell, Observation } from './types';

export interface TrendEntry { id: string; name: string; unit: string; source: string; rows: Observation[] }
export interface TrendResult extends TrendEntry { slope: number; tau: number; pT: number; pMK: number; significant: boolean; survivesCorrection: boolean }

/** Tests every series, then ranks: significant first (both tests agree), strongest Mann-Kendall evidence next. Series too short or constant are dropped. */
export function scanTrends(entries: TrendEntry[], start: number, end: number, alpha = 0.05, anomalies = true): TrendResult[] {
  const out: Omit<TrendResult, 'survivesCorrection'>[] = [];
  for (const e of entries) {
    try {
      const rows = (anomalies ? monthlyAnomalies(e.rows, 2015, 2024) : e.rows).slice(start, end + 1), r = analyze(rows, alpha);
      out.push({ ...e, slope: r.slope, tau: r.mk.tau, pT: r.p, pMK: r.mk.p, significant: r.significant && r.mk.p < alpha });
    } catch { /* not enough valid observations: leave it out rather than guess */ }
  }
  // Bonferroni: testing n variables at once makes ~n*alpha false alarms by chance, so also flag those that survive alpha/n.
  return out.map(r => ({ ...r, survivesCorrection: r.significant && Math.max(r.pT, r.pMK) < alpha / out.length }))
    .sort((a, b) => Number(b.significant) - Number(a.significant) || a.pMK - b.pMK);
}

/** Linear trend per decade for every grid cell: where the change is happening. Cells without enough data become NaN. */
export function cellTrends(field: Cell[][], start: number, end: number, dates: string[], anomalies = true): Cell[] {
  return (field[0] ?? []).map((cell, i) => {
    const rows = field.map((month, m) => ({ date: dates[m], value: month[i]?.value ?? NaN }));
    try { return { ...cell, value: analyze((anomalies ? monthlyAnomalies(rows, 2015, 2024) : rows).slice(start, end + 1)).slope }; } catch { return { ...cell, value: NaN }; }
  });
}
