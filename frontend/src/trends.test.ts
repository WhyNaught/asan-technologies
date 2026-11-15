import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanTrends, cellTrends } from './trends.ts';

const dates = Array.from({length: 120}, (_, i) => new Date(Date.UTC(2015, i, 1)).toISOString().slice(0, 10));
const noise = (i: number) => Math.sin(i * 12.9898) * 0.3;
const series = (f: (i: number) => number) => dates.map((date, i) => ({date, value: f(i)}));

test('scanner ranks a real trend above noise and drops unusable series', () => {
  const entry = (id: string, rows: ReturnType<typeof series>) => ({id, name: id, unit: 'u', source: 's', rows});
  const out = scanTrends([entry('flat', series(noise)), entry('rising', series(i => i * 0.02 + noise(i))), entry('empty', series(() => NaN))], 0, 119, 0.05, false);
  assert.deepEqual(out.map(r => r.id), ['rising', 'flat']);
  assert.ok(out[0].significant && out[0].survivesCorrection && out[0].slope > 0);
  assert.ok(!out[1].significant);
});

test('per-cell trends show where the change is', () => {
  const field = dates.map((_, m) => [{lon: 0, lat: 0, bounds: [0, 0, 1, 1] as [number, number, number, number], value: m * 0.01 + noise(m)}, {lon: 1, lat: 0, bounds: [1, 0, 2, 1] as [number, number, number, number], value: -m * 0.01 + noise(m)}]);
  const [a, b] = cellTrends(field, 0, 119, dates, false);
  assert.ok(a.value > 0 && b.value < 0);
});
