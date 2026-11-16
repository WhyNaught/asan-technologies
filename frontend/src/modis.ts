// SI was at least partially used to write the code in this file
import type { Cell, Observation, StudyArea } from './types';

const apiBase = import.meta.env?.VITE_API_BASE_URL || '/api';
export const MODIS_NAME = 'NASA MODIS MOD11A2 (1 km)';
export interface ModisWindow { lat: number; lon: number; half: number }
export interface ModisMap { cells: Cell[]; raster: { rows: number; cols: number; bounds: [number, number, number, number] }; composite: string; cellKm: number; domain: [number, number] }

/** MODIS 1 km data is limited to ~100 km windows; the window is the square around the study area's centre. */
export function modisWindow(area: StudyArea): ModisWindow {
  if (area.kind === 'global') throw new Error('MODIS 1 km data covers areas up to about 100 km across. Choose a city-sized area.');
  if (area.kind === 'point') return { lat: area.lat, lon: area.lon, half: 3 };
  const b = area.bounds!, widthKm = (b[2] - b[0]) * 111.32 * Math.cos(area.lat * Math.PI / 180), heightKm = (b[3] - b[1]) * 111.32;
  const half = Math.ceil(Math.max(widthKm, heightKm) / 2) + 1;
  if (half > 50) throw new Error('MODIS 1 km data covers areas up to about 100 km across. Draw a smaller area or pick a city.');
  return { lat: area.lat, lon: area.lon, half };
}
const post = async <T>(path: string, body: unknown, timeout = 60000) => {
  const response = await fetch(`${apiBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`MODIS request failed (${response.status}).`);
  return await response.json() as T;
};

export async function fetchModisMap(win: ModisWindow, monthIso: string): Promise<ModisMap> {
  const r = await post<{ composite_date: string; cellsize_km: number; pixels: { west: number; east: number; south: number; north: number; value: number | null }[] }>(
    '/data/modis/map', { coordinate: { latitude: win.lat, longitude: win.lon }, half_width_km: win.half, month: monthIso }, 90000);
  const cols = Math.round(Math.sqrt(r.pixels.length)), rows = cols; // the service returns a square window
  const cells = r.pixels.map(p => ({ bounds: [p.west, p.south, p.east, p.north] as [number, number, number, number], lon: (p.west + p.east) / 2, lat: (p.south + p.north) / 2, value: p.value ?? NaN }));
  const values = cells.map(c => c.value).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) throw new Error('MODIS has no clear-sky pixels here for this month (cloud cover).');
  const q = (f: number) => values[Math.min(values.length - 1, Math.floor(f * values.length))];
  return {
    cells, raster: { rows, cols, bounds: [Math.min(...cells.map(c => c.bounds[0])), Math.min(...cells.map(c => c.bounds[1])), Math.max(...cells.map(c => c.bounds[2])), Math.max(...cells.map(c => c.bounds[3]))] },
    composite: r.composite_date, cellKm: r.cellsize_km, domain: [Math.floor(q(0.02)), Math.max(Math.ceil(q(0.98)), Math.floor(q(0.02)) + 1)],
  };
}

/** Monthly area-mean series. The first request for an area takes minutes server-side (NASA allows 10 composites per call), then it is cached. */
export async function fetchModisSeries(win: ModisWindow, dates: string[], onProgress: (done: number, total: number) => void): Promise<Observation[]> {
  const { job_id } = await post<{ job_id: string }>('/data/modis/series', { coordinate: { latitude: win.lat, longitude: win.lon }, half_width_km: win.half, start_date: dates[0], end_date: dates.at(-1) });
  const started = Date.now();
  for (;;) {
    const response = await fetch(`${apiBase}/data/modis/series/${job_id}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`MODIS job failed (${response.status}).`);
    const job = await response.json() as { status: string; done: number; total: number; detail?: string; observations?: { timestamp: string; value: number | null }[] };
    onProgress(job.done, job.total);
    if (job.status === 'error') throw new Error(job.detail || 'MODIS series failed.');
    if (job.status === 'done') {
      const byDate = new Map(job.observations!.map(o => [o.timestamp, o.value]));
      return dates.map(date => ({ date, value: byDate.get(date) ?? NaN }));
    }
    if (Date.now() - started > 15 * 60000) throw new Error('MODIS series timed out.');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
