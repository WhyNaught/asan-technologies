import { dates, grid, inside } from './data';
import type { Cell, Observation, StudyArea, Variable } from './types';

const apiBase = import.meta.env?.VITE_API_BASE_URL || '/api';
type ApiResponse = { data_mode: string; locations: { coordinate: { latitude: number; longitude: number }; series: { variable: string; source?: string; observations: { timestamp: string; value: number }[] }[] }[] };
type GiovanniResponse = {observations: {timestamp: string; value: number}[]; source: string};
type RequestError = Error & { recommendations?: string[] };
type ErrorBody = { detail?: string | { message?: string; recommendations?: string[] } };
type DateRange = {startDate: string; endDate: string};
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
function giovanniBounds(area: StudyArea): [number, number, number, number] {
  if (area.kind === 'global') return [-180, -85, 180, 85];
  if (area.kind === 'region') return area.bounds!;
  const west = Math.max(-180, area.lon - 0.05), east = Math.min(180, area.lon + 0.05);
  const south = Math.max(-90, area.lat - 0.05), north = Math.min(90, area.lat + 0.05);
  return [west, south, east, north];
}
async function giovanniError(response: Response, fallback: string): Promise<RequestError> {
  let body: ErrorBody | undefined;
  try { body = await response.json() as ErrorBody; } catch { /* use the status fallback */ }
  const detail = body?.detail;
  const message = typeof detail === 'string' ? detail
    : detail?.message || fallback;
  const error = new Error(message) as RequestError;
  if (typeof detail === 'object' && Array.isArray(detail.recommendations)) {
    error.recommendations = detail.recommendations.filter((item): item is string => typeof item === 'string');
  }
  return error;
}
async function fetchGiovanniSeries(variables: Variable[], area: StudyArea, period: DateRange) {
  const results = await Promise.all(variables.map(async variable => {
    const response = await fetch(`${apiBase}/data/giovanni/query`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        dataset: variable.apiId,
        bbox: giovanniBounds(area),
        start_date: period.startDate,
        end_date: period.endDate,
      }),
      signal: AbortSignal.timeout(150000),
    });
    if (!response.ok) {
      throw await giovanniError(
        response,
        `NASA Giovanni returned ${response.status} for ${variable.name}.`,
      );
    }
    const result = await response.json() as GiovanniResponse;
    const byMonth = new Map(result.observations.map(row => [row.timestamp.slice(0, 7), row.value]));
    return {
      id: variable.id,
      source: result.source || variable.source,
      rows: dates.map(date => ({date, value: byMonth.get(date.slice(0, 7)) ?? NaN})),
    };
  }));
  return {
    series: new Map(results.map(result => [result.id, result.rows])),
    field: new Map<string, Cell[][]>(),
    sources: new Map(results.map(result => [result.id, result.source])),
  };
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

export async function fetchBackendSeries(
  variables: Variable[],
  area: StudyArea,
  limit = 3,
  period: DateRange = {startDate: dates[0], endDate: dates.at(-1)!},
): Promise<{ series: Map<string, Observation[]>; field: Map<string, Cell[][]>; sources: Map<string, string> }> {
  if (!variables.length || variables.length > limit || variables.some(v => !v.apiId)) throw new Error(`Select up to ${limit} variables supported by the connected API.`);
  const giovanni = variables.filter(variable => variable.provider === 'giovanni');
  if (giovanni.length) {
    const connected = variables.filter(variable => variable.provider !== 'giovanni');
    const parts = await Promise.all([
      giovanni.length ? fetchGiovanniSeries(giovanni, area, period) : Promise.resolve(undefined),
      connected.length ? fetchBackendSeries(connected, area, limit, period) : Promise.resolve(undefined),
    ]);
    const series = new Map<string, Observation[]>(), field = new Map<string, Cell[][]>(), sources = new Map<string, string>();
    for (const part of parts) if (part) {
      for (const [id, rows] of part.series) series.set(id, rows);
      for (const [id, cells] of part.field) field.set(id, cells);
      for (const [id, source] of part.sources) sources.set(id, source);
    }
    return {series, field, sources};
  }
  const available=await availableVariables();
  if(variables.some(v=>!available.has(v.apiId!)))throw new Error('One or more selected variables are not available from the connected API.');
  const cells = nativeCells(area), samples = cells.length <= MAX_SAMPLES ? cells : Array.from({length: MAX_SAMPLES}, (_, i) => cells[Math.round(i * (cells.length - 1) / (MAX_SAMPLES - 1))]);
  const response = await fetch(`${apiBase}/data/query`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({coordinates: samples.map(c => ({latitude: c.lat, longitude: c.lon})), variables: variables.map(v => v.apiId), start_date: period.startDate, end_date: period.endDate}),
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
