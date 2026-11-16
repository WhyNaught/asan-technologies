// SI was at least partially used to write the code in this file
import jStat from 'jstat';
import type { Observation } from './types';
const YEAR = 365.25 * 86400000;
export function analyze(rows: Observation[], alpha = 0.05) {
  if (!(alpha > 0 && alpha < 1)) throw new Error('Significance threshold must be between 0 and 1.');
  const data = rows.filter(r => Number.isFinite(r.value) && Number.isFinite(Date.parse(r.date))).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
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
  const mk = mannKendall(data.map(r => r.value));
  return { mk, slope: slopeYear * 10, slopeYear, intercept, start, p, ci: [(slopeYear - margin) * 10, (slopeYear + margin) * 10] as [number, number], significant: p < alpha, alpha, n: data.length, missing: rows.length - data.length };
}
export function seasonalCycle(rows: Observation[]) {
  const groups: number[][] = Array.from({length: 12}, () => []);
  for (const row of rows) {
    if (Number.isFinite(row.value) && Number.isFinite(Date.parse(row.date))) {
      groups[new Date(row.date).getUTCMonth()].push(row.value);
    }
  }
  const active = groups.filter(group => group.length), count = active.reduce((sum, group) => sum + group.length, 0);
  if (active.length < 2 || count <= active.length) return {amplitude: 0, p: 1, months: active.length};
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const grandMean = mean(active.flat()), groupMeans = active.map(mean);
  const between = active.reduce((sum, group, index) => sum + group.length * (groupMeans[index] - grandMean) ** 2, 0);
  const within = active.reduce((sum, group, index) => sum + group.reduce((part, value) => part + (value - groupMeans[index]) ** 2, 0), 0);
  const dfBetween = active.length - 1, dfWithin = count - active.length;
  const f = within === 0 ? (between === 0 ? 0 : Infinity) : (between / dfBetween) / (within / dfWithin);
  const p = Number.isFinite(f) ? 1 - jStat.centralF.cdf(f, dfBetween, dfWithin) : 0;
  return {amplitude: Math.max(...groupMeans) - Math.min(...groupMeans), p, months: active.length};
}

export function forecastLinearTrend(rows: Observation[], targetDate: string, alpha = 0.05) {
  const result = analyze(rows, alpha), valid = rows.filter(row => Number.isFinite(row.value)).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const target = Date.parse(targetDate), last = Date.parse(valid.at(-1)!.date);
  if (!Number.isFinite(target) || target <= last) throw new Error('Forecast date must be after the last observation.');
  const years = (target - result.start) / YEAR;
  const value = result.intercept + result.slopeYear * years;
  const sigma = Math.sqrt(valid.reduce((sum, row) => {
    const elapsed = (Date.parse(row.date) - result.start) / YEAR;
    return sum + (row.value - result.intercept - result.slopeYear * elapsed) ** 2;
  }, 0) / (result.n - 2));
  const meanX = valid.reduce((sum, row) => sum + (Date.parse(row.date) - result.start) / YEAR, 0) / result.n;
  const sxx = valid.reduce((sum, row) => {
    const elapsed = (Date.parse(row.date) - result.start) / YEAR;
    return sum + (elapsed - meanX) ** 2;
  }, 0);
  const leverage = 1 / result.n + (years - meanX) ** 2 / sxx;
  const standardDeviation = sigma * Math.sqrt(1 + leverage);
  const critical = jStat.studentt.inv(0.975, result.n - 2);
  return {value, lower: value - critical * standardDeviation, upper: value + critical * standardDeviation, standardDeviation, slope: result.slope, p: result.p, n: result.n};
}

type RegressionRow = {date: string; value: number; predictors: number[]; previousValue: number; previousPredictors: number[]};
function invert(matrix: number[][]): number[][] {
  const size = matrix.length, rows = matrix.map((row, i) => [...row, ...Array.from({length: size}, (_, j) => Number(i === j))]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-10) throw new Error('The selected variables are too strongly correlated to fit a stable regression.');
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    rows[column] = rows[column].map(value => value / divisor);
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      rows[row] = rows[row].map((value, index) => value - factor * rows[column][index]);
    }
  }
  return rows.map(row => row.slice(size));
}
function dot(left: number[], right: number[]) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}
function monthNumber(value: string) {
  const date = new Date(value);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}
function twoSidedP(t: number, df: number) {
  return Math.min(1, Math.max(0, 2 * jStat.studentt.cdf(-Math.abs(t), df)));
}

/** ARX model: current Y uses lagged Y, lagged covariates, and elapsed time. */
export function forecastAutoregression(targetRows: Observation[], predictorRows: Observation[][], targetDate: string, alpha = 0.05) {
  if (!(alpha > 0 && alpha < 1)) throw new Error('Significance threshold must be between 0 and 1.');
  if (!predictorRows.length) throw new Error('Select at least one predictor for autoregression.');
  const targetByDate = new Map(targetRows.filter(row => Number.isFinite(row.value)).map(row => [row.date, row.value]));
  const predictorByDate = predictorRows.map(rows => new Map(rows.filter(row => Number.isFinite(row.value)).map(row => [row.date, row.value])));
  const dates = [...targetByDate.keys()].filter(date => predictorByDate.every(values => values.has(date))).sort();
  const aligned: RegressionRow[] = [];
  for (const date of dates) {
    const previousDate = new Date(Date.parse(date));
    previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
    const previousKey = previousDate.toISOString().slice(0, 10);
    if (!targetByDate.has(previousKey) || predictorByDate.some(values => !values.has(previousKey))) continue;
    aligned.push({
      date,
      value: targetByDate.get(date)!,
      predictors: predictorByDate.map(values => values.get(date)!),
      previousValue: targetByDate.get(previousKey)!,
      previousPredictors: predictorByDate.map(values => values.get(previousKey)!),
    });
  }
  const last = aligned.at(-1);
  if (!last || !Number.isFinite(Date.parse(targetDate)) || monthNumber(targetDate) <= monthNumber(last.date)) {
    throw new Error('Forecast date must be after the last complete monthly observation.');
  }
  const startMonth = monthNumber(aligned[0].date), timeIndex = predictorRows.length + 2;
  const design = (row: RegressionRow) => [1, row.previousValue, ...row.previousPredictors, (monthNumber(row.date) - startMonth) / 12];
  const matrix = aligned.map(design), values = aligned.map(row => row.value), columns = matrix[0].length;
  const degreesOfFreedom = matrix.length - columns;
  if (degreesOfFreedom < 2) throw new Error('More complete monthly observations are needed for autoregression.');
  const crossProduct = Array.from({length: columns}, (_, i) => Array.from({length: columns}, (_, j) => matrix.reduce((sum, row) => sum + row[i] * row[j], 0)));
  const inverse = invert(crossProduct), right = Array.from({length: columns}, (_, i) => matrix.reduce((sum, row, index) => sum + row[i] * values[index], 0));
  const coefficients = inverse.map(row => dot(row, right));
  const residuals = matrix.map((row, index) => values[index] - dot(row, coefficients));
  const sigmaSquared = residuals.reduce((sum, residual) => sum + residual ** 2, 0) / degreesOfFreedom;
  const standardError = Math.sqrt(sigmaSquared * inverse[timeIndex][timeIndex]);
  const slope = coefficients[timeIndex] * 10, p = standardError < 1e-12 ? (Math.abs(slope) < 1e-12 ? 1 : 0) : twoSidedP(coefficients[timeIndex] / standardError, degreesOfFreedom);

  let forecast = last.value, variance = 0, predictors = last.predictors;
  const targetMonth = monthNumber(targetDate), critical = jStat.studentt.inv(0.975, degreesOfFreedom);
  for (let month = monthNumber(last.date) + 1; month <= targetMonth; month++) {
    const x = [1, forecast, ...predictors, (month - startMonth) / 12];
    forecast = dot(x, coefficients);
    const leverage = dot(x, inverse.map(row => dot(row, x)));
    variance = coefficients[1] ** 2 * variance + sigmaSquared * (1 + leverage);
  }
  const standardDeviation = Math.sqrt(variance);
  return {value: forecast, lower: forecast - critical * standardDeviation, upper: forecast + critical * standardDeviation, standardDeviation, slope, p, n: matrix.length, df: degreesOfFreedom};
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

// Mann-Kendall (tie-corrected, continuity-corrected) with Sen's slope per decade; non-parametric, robust to outliers.
export function mannKendall(values: number[]) {
  const n = values.length;
  let s = 0; const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) { s += Math.sign(values[j] - values[i]); slopes.push((values[j] - values[i]) / (j - i)); }
  const ties = new Map<number, number>(); for (const v of values) ties.set(v, (ties.get(v) || 0) + 1);
  const variance = (n * (n - 1) * (2 * n + 5) - [...ties.values()].reduce((a, t) => a + t * (t - 1) * (2 * t + 5), 0)) / 18;
  const z = variance <= 0 ? 0 : s === 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(variance);
  slopes.sort((a, b) => a - b);
  const mid = slopes.length >> 1, sen = slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
  return { s, z, tau: s / (n * (n - 1) / 2), p: 2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1)), sen };
}
