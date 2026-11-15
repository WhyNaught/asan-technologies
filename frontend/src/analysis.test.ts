import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, correlate, monthlyAnomalies } from './analysis.ts';

const observations = (slope: number) => Array.from({ length: 120 }, (_, i) => ({
  date: new Date(Date.UTC(2015, i, 1)).toISOString().slice(0, 10),
  value: 10 + slope * (Date.UTC(2015, i, 1) - Date.UTC(2015, 0, 1)) / (365.25 * 86400000),
}));
test('known elapsed-time trend has correct per-decade units and significance', () => {
  const result = analyze(observations(0.2));
  assert.ok(Math.abs(result.slope - 2) < 1e-9);
  assert.ok(result.p < 0.001);
  assert.ok(result.ci[0] <= 2 + 1e-9 && result.ci[1] >= 2 - 1e-9);
  assert.equal(result.n, 120);
});
test('constant series is not significant; missing values do not become zero', () => {
  const rows = observations(0); rows[12].value = NaN;
  const result = analyze(rows);
  assert.equal(result.slope, 0); assert.equal(result.p, 1);
  assert.equal(result.n, 119); assert.equal(result.missing, 1);
});
test('Student-t confidence interval and two-sided p match known reference', () => {
  const result = analyze([0, 1, 2, 3, 4].map((x, i) => ({ date: `${2000 + x}-01-01`, value: [1, 2, 1.3, 3.75, 2.25][i] })));
  assert.ok(Math.abs(result.slope - 4.2493) < 0.01);
  assert.ok(result.p > 0.25 && result.p < 0.27);
  assert.ok(result.ci[0] < 0 && result.ci[1] > 0);
});
test('monthly climatology removes a repeating seasonal cycle', () => {
  const rows = observations(0).map((r, i) => ({ ...r, value: i % 12 }));
  assert.ok(monthlyAnomalies(rows, 2015, 2024).every(r => r.value === 0));
});
test('correlation uses matching dates and returns a real coefficient', () => {
  const dates = ['2020-01-01','2020-02-01','2020-03-01','2020-04-01'];
  const r = correlate(dates.map((date, i) => ({date, value:i})), dates.map((date, i) => ({date, value:2*i+1})));
  assert.equal(r.r, 1); assert.equal(r.p, 0); assert.equal(r.n, 4);
});
test('reject insufficient dates and invalid significance thresholds', () => {
  assert.throws(() => analyze(observations(1).slice(0, 2)));
  assert.throws(() => analyze(observations(1), 0));
  assert.throws(() => analyze([{date: '2020-01-01', value: 1}, {date: '2020-01-01', value: 2}, {date: '2020-01-01', value: 3}]));
});
