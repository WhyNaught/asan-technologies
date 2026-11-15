import type { Cell, Coordinate, DataAdapter, StudyArea, Variable } from './types';
export const places: StudyArea[] = [
  { name: 'Phoenix, Arizona', kind: 'region', lon: -112.07, lat: 33.45, bounds: [-112.35, 33.2, -111.8, 33.75] },
  { name: 'Lagos, Nigeria', kind: 'region', lon: 3.38, lat: 6.52, bounds: [3.15, 6.35, 3.65, 6.75] },
  { name: 'Amazon Basin', kind: 'region', lon: -62.21, lat: -3.47, bounds: [-68, -8, -56, 1] },
  { name: 'Tropical Pacific', kind: 'region', lon: -140, lat: 0, bounds: [-170, -5, -120, 5] },
  { name: 'Great Barrier Reef', kind: 'region', lon: 147.7, lat: -18.3, bounds: [145, -22, 152, -15] },
  { name: 'Toronto, Canada', kind: 'region', lon: -79.38, lat: 43.65, bounds: [-79.65, 43.5, -79.1, 43.85] },
  { name: 'London, United Kingdom', kind: 'region', lon: -0.12, lat: 51.5, bounds: [-0.5, 51.3, 0.2, 51.7] },
  { name: 'Tokyo, Japan', kind: 'region', lon: 139.69, lat: 35.68, bounds: [139.4, 35.5, 139.95, 35.9] },
  { name: 'California, United States', kind: 'region', lon: -119.5, lat: 37, bounds: [-124, 32.5, -114.2, 42] },
];
export function inside(point: Coordinate, polygon: Coordinate[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}
export function grid(area: StudyArea): Omit<Cell, 'value'>[] {
  if (area.kind === 'point') return [{ lon: area.lon, lat: area.lat, bounds: [area.lon - 0.025, area.lat - 0.025, area.lon + 0.025, area.lat + 0.025] }];
  const b = area.kind === 'global' ? [-180, -85, 180, 85] : area.bounds!;
  const count = area.kind === 'global' ? 24 : 8, cells: Omit<Cell, 'value'>[] = [];
  for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) {
    const dx = (b[2] - b[0]) / count, dy = (b[3] - b[1]) / count;
    const west = b[0] + x * dx, south = b[1] + y * dy, lon = west + dx / 2, lat = south + dy / 2;
    if (!area.polygon || inside([lon, lat], area.polygon)) cells.push({lon, lat, bounds: [west, south, west + dx, south + dy]});
  }
  return cells;
}
function sample(v: Variable, lon: number, lat: number, index: number) {
  const t = index / 12, season = Math.sin((index % 12) / 12 * 2 * Math.PI - lat / 45), spatial = Math.sin(lon * 0.12) * Math.cos(lat * 0.15);
  const noise = 0.17 * Math.sin(index * 2.399 + lon) + 0.11 * Math.cos(index * 1.71 + lat);
  const enso = Math.sin(index / 8) + 0.5 * Math.cos(index / 15);
  switch (v.id) {
    case 'temperature': return 28 - Math.abs(lat) * 0.12 + 7 * season + 0.065 * t + spatial * 3 + noise;
    case 'air': return 23 - Math.abs(lat) * 0.12 + 5 * season + 0.035 * t + spatial + noise;
    case 'vegetation': return Math.max(0, Math.min(1, 0.55 + 0.15 * season - 0.004 * t + spatial * 0.08 + noise * 0.04));
    case 'vegetation-anomaly': return 0.04 * season - 0.004 * t + spatial * 0.04 + noise * 0.04;
    case 'albedo': return 0.22 + spatial * 0.04 + 0.001 * t + noise * 0.01;
    case 'built': return Math.max(0, Math.min(100, 45 + spatial * 25 + 0.8 * t + noise));
    case 'drought': return -0.05 * t + 0.5 * season + spatial * 0.5 + noise;
    case 'moisture': return Math.max(0, 0.25 - 0.002 * t + 0.06 * season + spatial * 0.03 + noise * 0.02);
    case 'sst': return enso + 0.025 * t + spatial * 0.3 + noise * 0.2;
    case 'precipitation': return enso * 25 * Math.cos(lat / 30) + season * 15 + spatial * 10 + 0.3 * t + noise * 5;
    case 'wind': return -enso * 1.3 + spatial + noise;
    default: return NaN;
  }
}
export const dates = Array.from({length: 120}, (_, i) => new Date(Date.UTC(2015, i, 1)).toISOString().slice(0, 10));
export const mockAdapter: DataAdapter = {
  status: 'Synthetic demonstration · deterministic geographic field',
  field(variable, area, date) {
    const i = dates.indexOf(date);
    if (i < 0) return [];
    return grid(area).map(c => ({...c, value: sample(variable, c.lon, c.lat, i)}));
  },
  series(variable, area) {
    return dates.map((date, index) => {
      const cells = this.field(variable, area, date);
      const weight = cells.reduce((s, c) => s + Math.cos(c.lat * Math.PI / 180), 0);
      const value = cells.reduce((s, c) => s + c.value * Math.cos(c.lat * Math.PI / 180), 0) / weight;
      return {date, value: index > 0 && index % 47 === 0 ? NaN : value};
    });
  },
};
