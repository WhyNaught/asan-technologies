import type { Observation } from './types';
import { analyze } from './analysis';
export const number = (n: number, digits = 2) => Number.isFinite(n) ? n.toLocaleString('en', {maximumFractionDigits: digits, minimumFractionDigits: digits}) : '—';
export const signed = (n: number) => `${n > 0 ? '+' : ''}${number(n)}`;
export const dateLabel = (date: string) => new Date(date).toLocaleDateString('en', {month: 'short', year: 'numeric', timeZone: 'UTC'});
export function renderChart(host: HTMLElement, rows: Observation[], unit: string, date: string, comparison?: {rows: Observation[]; name: string}, seasonal = false) {
  const w = 1100, h = 260, left = 64, right = 24, top = 20, bottom = 38;
  const data = [...rows, ...(comparison?.rows || [])].filter(r => Number.isFinite(r.value));
  if (!data.length) { host.innerHTML = '<p>No valid observations in this period.</p>'; return; }
  const minT = Date.parse(rows[0].date), maxT = Date.parse(rows.at(-1)!.date);
  const min = Math.min(...data.map(r => r.value)), max = Math.max(...data.map(r => r.value)), pad = Math.max((max - min) * 0.15, 0.1);
  const x = (date: string) => left + (Date.parse(date) - minT) / Math.max(1, maxT - minT) * (w - left - right);
  const y = (value: number) => h - bottom - (value - min + pad) / (max - min + pad * 2) * (h - top - bottom);
  const path = (items: Observation[]) => { let pen = false; return items.map(r => { if (!Number.isFinite(r.value)) {pen = false; return '';} const result = `${pen ? 'L' : 'M'}${x(r.date).toFixed(2)},${y(r.value).toFixed(2)}`; pen = true; return result; }).join(' '); };
  const result = analyze(rows);
  const fit = (date: string) => result.intercept + result.slopeYear * (Date.parse(date) - result.start) / (365.25 * 86400000);
  const ticks = Array.from({length: 5}, (_, i) => min - pad + i * (max - min + pad * 2) / 4);
  const xTicks = Array.from({length: 5}, (_, i) => rows[Math.round(i * (rows.length - 1) / 4)]);
  host.innerHTML = `<div class="chart-key"><span><i></i>${seasonal ? 'Monthly anomaly' : 'Synthetic observations'}</span><span><i class="dashed"></i>Linear trend</span>${comparison ? '<span><i class="compare-key"></i>Comparison</span>' : ''}<span class="chart-unit">${unit}</span></div>
  <div class="plot-wrap"><svg class="series-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Time series from ${dateLabel(rows[0].date)} to ${dateLabel(rows.at(-1)!.date)}, ${unit}. ${rows.filter(r => !Number.isFinite(r.value)).length} missing observations shown as gaps.">
    ${ticks.map(value => `<line class="grid-line" x1="${left}" x2="${w - right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${number(value, Math.abs(value) < 1 ? 2 : 1)}</text>`).join('')}
    ${xTicks.map(r => `<text x="${x(r.date)}" y="${h - 8}" text-anchor="middle">${dateLabel(r.date)}</text>`).join('')}
    <path class="observation-line" d="${path(rows)}"/>
    <path class="trend-line" d="M${x(rows[0].date)},${y(fit(rows[0].date))} L${x(rows.at(-1)!.date)},${y(fit(rows.at(-1)!.date))}"/>
    ${comparison ? `<path class="comparison-line" d="${path(comparison.rows)}"/>` : ''}
    ${rows.filter(r => !Number.isFinite(r.value)).map(r => `<path class="missing-mark" d="M${x(r.date) - 3},${h - bottom + 4} l6,6 m-6,0 l6,-6"/>`).join('')}
    <line class="date-cursor" x1="${x(date)}" x2="${x(date)}" y1="${top}" y2="${h - bottom}"/>
    <line class="hover-cursor" hidden y1="${top}" y2="${h - bottom}"/>
    <rect class="chart-hit" x="${left}" y="${top}" width="${w - left - right}" height="${h - top - bottom}" fill="transparent"/>
  </svg><output class="chart-tooltip" hidden></output></div>`;
  const svg = host.querySelector('svg')!, tooltip = host.querySelector<HTMLOutputElement>('output')!, cursor = host.querySelector<SVGLineElement>('.hover-cursor')!;
  const hover = (event: PointerEvent) => {
    const rect = svg.getBoundingClientRect(), local = (event.clientX - rect.left) / rect.width * w;
    const index = Math.max(0, Math.min(rows.length - 1, Math.round((local - left) / (w - left - right) * (rows.length - 1))));
    const r = rows[index]; cursor.removeAttribute('hidden'); cursor.setAttribute('x1', String(x(r.date))); cursor.setAttribute('x2', String(x(r.date)));
    tooltip.hidden = false; tooltip.textContent = `${dateLabel(r.date)} · ${Number.isFinite(r.value) ? number(r.value) + ' ' + unit : 'Missing observation'}`;
    tooltip.style.left = `${Math.max(8, Math.min(rect.width - 230, event.clientX - rect.left + 12))}px`;
  };
  svg.addEventListener('pointermove', hover);
  svg.addEventListener('pointerleave', () => {tooltip.hidden = true; cursor.setAttribute('hidden', '');});
}
