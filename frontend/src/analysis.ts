import jStat from 'jstat';
import type { Observation } from './types';
const YEAR = 365.25 * 86400000;
export function analyze(rows: Observation[], alpha = 0.05) {
  if (!(alpha > 0 && alpha < 1)) throw new Error('Significance threshold must be between 0 and 1.');
  const data = rows.filter(r => Number.isFinite(r.value) && Number.isFinite(Date.parse(r.date)));
  if (data.length < 3) throw new Error('At least three valid observations are required.');
  const start = Math.min(...data.map(r => Date.parse(r.date)));
  const x = data.map(r => (Date.parse(r.date) - start) / YEAR);
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = data.reduce((s, r) => s + r.value, 0) / x.length;
  const sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0);
  if (!sxx) throw new Error('Observations must span more than one date.');
  const slopeYear = data.reduce((s, r, i) => s + (x[i] - mx) * (r.value - my), 0) / sxx;
  const intercept = my - slopeYear * mx;
  const residuals = data.map((r, i) => r.value - intercept - slopeYear * x[i]);
  const se = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / (data.length - 2) / sxx);
  const p = se < 1e-12 ? (Math.abs(slopeYear) < 1e-12 ? 1 : 0) : Math.min(1, Math.max(0, 2 * jStat.studentt.cdf(-Math.abs(slopeYear / se), data.length - 2)));
  const margin = jStat.studentt.inv(0.975, data.length - 2) * se;
  return { slope: slopeYear * 10, slopeYear, intercept, start, p, ci: [(slopeYear - margin) * 10, (slopeYear + margin) * 10] as [number, number], significant: p < alpha, alpha, n: data.length, missing: rows.length - data.length };
}
export function monthlyAnomalies(rows: Observation[], baselineStart: number, baselineEnd: number): Observation[] {
  const months: number[][] = Array.from({length: 12}, () => []);
  for (const r of rows) {
    const date = new Date(r.date), year = date.getUTCFullYear();
    if (year >= baselineStart && year <= baselineEnd && Number.isFinite(r.value)) months[date.getUTCMonth()].push(r.value);
  }
  const means = months.map(m => m.length ? m.reduce((a, b) => a + b, 0) / m.length : NaN);
  return rows.map(r => ({...r, value: r.value - means[new Date(r.date).getUTCMonth()]}));
}
export function correlate(left: Observation[], right: Observation[]) {
  const byDate = new Map(right.filter(r => Number.isFinite(r.value)).map(r => [r.date, r.value]));
  const pairs = left.filter(r => Number.isFinite(r.value) && byDate.has(r.date)).map(r => [r.value, byDate.get(r.date)!]);
  if (pairs.length < 3) throw new Error('At least three matching observations are required for correlation.');
  const mean = (i: number) => pairs.reduce((s, p) => s + p[i], 0) / pairs.length;
  const mx = mean(0), my = mean(1), xx = pairs.reduce((s, p) => s + (p[0] - mx) ** 2, 0), yy = pairs.reduce((s, p) => s + (p[1] - my) ** 2, 0);
  if (!xx || !yy) throw new Error('Correlation is undefined for a constant series.');
  const r = Math.max(-1, Math.min(1, pairs.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / Math.sqrt(xx * yy)));
  const t = Math.abs(r) === 1 ? Infinity : Math.abs(r) * Math.sqrt((pairs.length - 2) / (1 - r * r));
  return { r, p: Number.isFinite(t) ? 2 * jStat.studentt.cdf(-t, pairs.length - 2) : 0, n: pairs.length };
}
