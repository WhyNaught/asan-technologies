import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, correlate, forecastAutoregression, forecastLinearTrend, mannKendall, monthlyAnomalies, seasonalCycle } from './analysis.ts';

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

test('Mann-Kendall detects a monotonic trend and ignores a flat series', () => {
  const up = mannKendall(Array.from({length: 40}, (_, i) => i + (i % 3)));
  assert.ok(up.p < 0.001 && up.sen > 0.9);
  assert.equal(mannKendall(Array(20).fill(5)).p, 1);
});

test('seasonality test distinguishes a repeating monthly cycle from a flat series', () => {
  const rows = observations(0).map((row, i) => ({...row, value: i % 12}));
  const seasonal = seasonalCycle(rows);
  assert.ok(seasonal.p < 0.001);
  assert.equal(seasonal.amplitude, 11);
  assert.equal(seasonalCycle(observations(0)).p, 1);
});

test('linear forecast reports a future estimate and a prediction interval', () => {
  const rows = observations(0.2).map((row, i) => ({...row, value: row.value + Math.sin(i * 0.7)}));
  const prediction = forecastLinearTrend(rows, '2030-12-01');
  assert.ok(prediction.value > rows.at(-1)!.value);
  assert.ok(prediction.lower < prediction.value && prediction.value < prediction.upper);
  assert.ok(prediction.standardDeviation > 0);
});

test('autoregression uses lagged response and covariates, and tests the time trend', () => {
  const x = Array.from({length: 72}, (_, i) => ({
    date: new Date(Date.UTC(2015, i, 1)).toISOString().slice(0, 10),
    value: Math.sin(i * 0.6) + Math.cos(i * 0.13),
  }));
  const y: {date: string; value: number}[] = [];
  for (let i = 0; i < x.length; i++) {
    const previous = y[i - 1]?.value ?? 0;
    const predictor = x[i - 1]?.value ?? x[i].value;
    y.push({date: x[i].date, value: 0.65 * previous + 1.2 * predictor + 0.025 * i / 12});
  }
  const result = forecastAutoregression(y, [x], '2022-12-01');
  assert.ok(Math.abs(result.slope - 0.25) < 1e-6);
  assert.ok(result.p < 0.05);
  assert.ok(Number.isFinite(result.value));
  assert.ok(result.lower <= result.value && result.value <= result.upper);
  assert.equal(result.n, 71);
  assert.throws(() => forecastAutoregression(y, [x], '2020-12-01'));
  const withGap = x.filter((_, index) => index !== 30);
  assert.equal(forecastAutoregression(y, [withGap], '2022-12-01').n, 69);
});

for (let caseIndex = 0; caseIndex < 25; caseIndex++) {
  test(`linear trend analysis scenario ${caseIndex + 1}`, () => {
    const slope = (caseIndex % 2 ? 1 : -1) * (0.025 + caseIndex * 0.002);
    const intercept = caseIndex * 5 - 60;
    const missingEvery = caseIndex + 3;
    const rows = observations(slope).map((row, index) => ({
      ...row,
      value: index % missingEvery === 0
        ? Number.NaN
        : intercept + slope * (Date.parse(row.date) - Date.UTC(2015, 0, 1)) / (365.25 * 86400000),
    }));
    const result = analyze(rows);
    const missing = Math.ceil(rows.length / missingEvery);
    assert.ok(Math.abs(result.slope - slope * 10) < 1e-7);
    assert.ok(result.p < 0.001);
    assert.equal(result.n, rows.length - missing);
    assert.equal(result.missing, missing);
  });
}

for (let caseIndex = 0; caseIndex < 25; caseIndex++) {
  test(`seasonal cycle and anomaly baseline scenario ${caseIndex + 1}`, () => {
    const phase = caseIndex % 12, scale = caseIndex + 1, offset = caseIndex * 7;
    const rows = observations(0).map((row, index) => ({
      ...row,
      value: ((index + phase) % 12) * scale + offset,
    }));
    const cycle = seasonalCycle(rows);
    const anomalies = monthlyAnomalies(rows, 2015, 2024);
    assert.equal(cycle.months, 12);
    assert.equal(cycle.amplitude, 11 * scale);
    assert.ok(cycle.p < 0.001);
    assert.ok(anomalies.every(row => Math.abs(row.value) < 1e-10));
  });
}

for (let caseIndex = 0; caseIndex < 25; caseIndex++) {
  test(`linear forecast interval scenario ${caseIndex + 1}`, () => {
    const slope = (caseIndex % 2 ? 1 : -1) * (0.03 + caseIndex * 0.004);
    const intercept = caseIndex * 8 - 100;
    const rows = Array.from({length: 72}, (_, index) => {
      const date = new Date(Date.UTC(2015, index, 1)).toISOString().slice(0, 10);
      return {date, value: intercept + slope * (Date.parse(date) - Date.UTC(2015, 0, 1)) / (365.25 * 86400000)};
    });
    const targetDate = '2021-01-01';
    const prediction = forecastLinearTrend(rows, targetDate, [0.01, 0.05, 0.1][caseIndex % 3]);
    const expected = intercept + slope * (Date.parse(targetDate) - Date.UTC(2015, 0, 1)) / (365.25 * 86400000);
    assert.ok(Math.abs(prediction.value - expected) < 1e-7);
    assert.ok(Number.isFinite(prediction.standardDeviation) && prediction.standardDeviation >= 0);
    assert.ok(prediction.lower <= prediction.value && prediction.value <= prediction.upper);
  });
}

for (let caseIndex = 0; caseIndex < 25; caseIndex++) {
  test(`autoregression forecast scenario ${caseIndex + 1}`, () => {
    const rho = 0.2 + (caseIndex % 10) * 0.03;
    const predictorWeight = 0.2 + Math.floor(caseIndex / 10) * 0.1;
    const trendPerYear = 0.01 + caseIndex * 0.0004;
    const predictorRows = Array.from({length: 72}, (_, index) => ({
      date: new Date(Date.UTC(2015, index, 1)).toISOString().slice(0, 10),
      value: (0.7 + caseIndex * 0.01) * (Math.sin(index * 0.6) + Math.cos(index * 0.13)),
    }));
    const targetRows: {date: string; value: number}[] = [];
    for (let index = 0; index < predictorRows.length; index++) {
      const previousY = targetRows[index - 1]?.value ?? 0;
      const previousX = predictorRows[index - 1]?.value ?? predictorRows[index].value;
      targetRows.push({
        date: predictorRows[index].date,
        value: rho * previousY + predictorWeight * previousX + trendPerYear * index / 12,
      });
    }
    const prediction = forecastAutoregression(targetRows, [predictorRows], '2022-12-01');
    assert.ok(Math.abs(prediction.slope - trendPerYear * 10) < 1e-6);
    assert.ok(prediction.p < 0.05);
    assert.equal(prediction.n, 71);
    assert.ok(Number.isFinite(prediction.value));
    assert.ok(prediction.lower <= prediction.value && prediction.value <= prediction.upper);
  });
}
