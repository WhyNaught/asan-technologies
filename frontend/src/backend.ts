import { grid, inside } from './data';
import type { Cell, Observation, StudyArea, Variable } from './types';

const apiBase = import.meta.env?.VITE_API_BASE_URL || '/api';
type ApiResponse = { data_mode: string; locations: { coordinate: { latitude: number; longitude: number }; series: { variable: string; source?: string; observations: { timestamp: string; value: number }[] }[] }[] };
// shortcut: each sample is one NASA POWER call server-side (fetched in parallel); raise if regions need denser maps.
const MAX_SAMPLES = 49;
// NASA POWER (MERRA-2) native grid: 0.5° latitude x 0.625° longitude. Sampling finer than this only repeats values.
const DLAT = 0.5, DLON = 0.625;
export function nativeCells(area: StudyArea): Omit<Cell, 'value'>[] {
  const snap = (c: Omit<Cell, 'value'>): [string, Omit<Cell, 'value'>] => {
    const lat = Math.max(-89.75, Math.min(89.75, Math.round(c.lat / DLAT) * DLAT)), lon = Math.round(c.lon / DLON) * DLON;
    return [`${lat},${lon}`, {lat, lon, bounds: [lon - DLON / 2, lat - DLAT / 2, lon + DLON / 2, lat + DLAT / 2]}];
  };
  // Every native cell overlapping the area (not a coarse 8x8 probe), so coverage has no holes.
  const unique = new Map<string, Omit<Cell, 'value'>>();
  if (area.kind === 'point') for (const c of grid(area)) unique.set(...snap(c));
  else if (area.kind === 'region') {
    const b = area.bounds!;
    for (let i = Math.floor(b[1] / DLAT); i <= Math.ceil(b[3] / DLAT); i++) for (let j = Math.floor(b[0] / DLON); j <= Math.ceil(b[2] / DLON); j++) {
      const lat = i * DLAT, lon = j * DLON; // cell centres sit on multiples of the grid step
      if (lat + DLAT / 2 < b[1] || lat - DLAT / 2 > b[3] || lon + DLON / 2 < b[0] || lon - DLON / 2 > b[2]) continue;
      if (!area.polygon || inside([lon, lat], area.polygon) || area.polygon.some(v => Math.abs(v[0] - lon) <= DLON / 2 && Math.abs(v[1] - lat) <= DLAT / 2)) unique.set(...snap({lon, lat, bounds: [0, 0, 0, 0]}));
    }
    if (!unique.size) for (const c of grid(area).slice(0, 1)) unique.set(...snap(c));
  } else for (const c of grid(area)) unique.set(...snap(c));
  if (unique.size <= MAX_SAMPLES) return [...unique.values()];
  // Large area: even 7x7 stratified sample over the bounds instead of a row-major stride (which would hit only a few columns).
  const b = area.kind === 'global' ? [-180, -85, 180, 85] : area.bounds!, n = Math.floor(Math.sqrt(MAX_SAMPLES)), cells: Omit<Cell, 'value'>[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const lon = b[0] + (x + 0.5) * (b[2] - b[0]) / n, lat = b[1] + (y + 0.5) * (b[3] - b[1]) / n;
    const dx = (b[2] - b[0]) / n, dy = (b[3] - b[1]) / n;
    // Each sample stands for its stratum, so the map tile covers the stratum; the data itself is one native cell inside it.
    if (!area.polygon || inside([lon, lat], area.polygon)) cells.push({lon, lat, bounds: [lon - dx / 2, lat - dy / 2, lon + dx / 2, lat + dy / 2]});
  }
  return [...new Map(cells.map(c => [snap(c)[0], {...snap(c)[1], bounds: c.bounds}] as const)).values()];
}
let catalog: Promise<Set<string>> | undefined;
async function availableVariables() {
  catalog ??= fetch(`${apiBase}/data/variables`, {signal: AbortSignal.timeout(10000)}).then(async response => {
    if (!response.ok) throw new Error(`ASAN variable catalogue returned ${response.status}.`);
    const body = await response.json() as {variables?: {id: string}[]};
    return new Set((body.variables || []).map(item => item.id));
  }).catch(error => {catalog=undefined;throw error;});
  return catalog;
}

export async function fetchBackendSeries(variables: Variable[], area: StudyArea, limit = 3): Promise<{ series: Map<string, Observation[]>; field: Map<string, Cell[][]>; sources: Map<string, string> }> {
  if (!variables.length || variables.length > limit || variables.some(v => !v.apiId)) throw new Error(`Select up to ${limit} variables supported by the connected API.`);
  const available=await availableVariables();
  if(variables.some(v=>!available.has(v.apiId!)))throw new Error('One or more selected variables are not available from the connected API.');
  const cells = nativeCells(area), samples = cells.length <= MAX_SAMPLES ? cells : Array.from({length: MAX_SAMPLES}, (_, i) => cells[Math.round(i * (cells.length - 1) / (MAX_SAMPLES - 1))]);
  const response = await fetch(`${apiBase}/data/query`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({coordinates: samples.map(c => ({latitude: c.lat, longitude: c.lon})), variables: variables.map(v => v.apiId), start_date: '2015-01-01', end_date: '2024-12-01'}),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'ASAN data API route was not found. Start the API server and check its URL.' : `ASAN data API returned ${response.status}.`);
  const result = await response.json() as ApiResponse;
  const series = new Map<string, Observation[]>(), field = new Map<string, Cell[][]>(), sources = new Map<string, string>();
  for (const variable of variables) {
    const records = result.locations.flatMap(location => {
      const data = location.series.find(item => item.variable === variable.apiId);
      const cell = cells.find(c => c.lon === location.coordinate.longitude && c.lat === location.coordinate.latitude);
      return data && cell ? [{cell, observations: data.observations}] : [];
    });
    sources.set(variable.id, result.locations[0]?.series.find(item => item.variable === variable.apiId)?.source || 'ASAN API');
    series.set(variable.id, Array.from({length: 120}, (_, i) => {
      const observations = records.map(record => ({value: record.observations[i]?.value, weight: Math.cos(record.cell.lat * Math.PI / 180)})).filter(item => Number.isFinite(item.value));
      const weight = observations.reduce((sum, item) => sum + item.weight, 0);
      return {date: new Date(Date.UTC(2015, i, 1)).toISOString().slice(0, 10), value: weight ? observations.reduce((sum, item) => sum + item.value! * item.weight, 0) / weight : NaN};
    }));
    field.set(variable.id, Array.from({length: 120}, (_, i) => records.map(record => ({...record.cell, value: record.observations[i]?.value ?? NaN}))));
  }
  return {series, field, sources};
}
