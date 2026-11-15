import { grid } from './data';
import type { Cell, Observation, StudyArea, Variable } from './types';

const apiBase = import.meta.env?.VITE_API_BASE_URL || '/api';
type ApiResponse = { data_mode: 'synthetic'; locations: { coordinate: { latitude: number; longitude: number }; series: { variable: string; observations: { timestamp: string; value: number }[] }[] }[] };
let catalog: Promise<Set<string>> | undefined;
async function availableVariables() {
  catalog ??= fetch(`${apiBase}/data/variables`, {signal: AbortSignal.timeout(10000)}).then(async response => {
    if (!response.ok) throw new Error(`ASAN variable catalogue returned ${response.status}.`);
    const body = await response.json() as {variables?: {id: string}[]};
    return new Set((body.variables || []).map(item => item.id));
  }).catch(error => {catalog=undefined;throw error;});
  return catalog;
}

export async function fetchBackendSeries(variables: Variable[], area: StudyArea): Promise<{ series: Map<string, Observation[]>; field: Map<string, Cell[][]> }> {
  if (!variables.length || variables.length > 3 || variables.some(v => !v.apiId)) throw new Error('Select up to three variables supported by the connected API.');
  const available=await availableVariables();
  if(variables.some(v=>!available.has(v.apiId!)))throw new Error('One or more selected variables are not available from the connected API.');
  const cells = grid(area), samples = cells.length <= 50 ? cells : Array.from({length: 50}, (_, i) => cells[Math.round(i * (cells.length - 1) / 49)]);
  const response = await fetch(`${apiBase}/data/query`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({coordinates: samples.map(c => ({latitude: c.lat, longitude: c.lon})), variables: variables.map(v => v.apiId), start_date: '2015-01-01', end_date: '2024-12-01'}),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'ASAN data API route was not found. Start the API server and check its URL.' : `ASAN data API returned ${response.status}.`);
  const result = await response.json() as ApiResponse;
  if (result.data_mode !== 'synthetic') throw new Error('The API returned an unsupported data mode.');
  const series = new Map<string, Observation[]>(), field = new Map<string, Cell[][]>();
  for (const variable of variables) {
    const records = result.locations.flatMap(location => {
      const data = location.series.find(item => item.variable === variable.apiId);
      const cell = cells.find(c => c.lon === location.coordinate.longitude && c.lat === location.coordinate.latitude);
      return data && cell ? [{cell, observations: data.observations}] : [];
    });
    series.set(variable.id, Array.from({length: 120}, (_, i) => {
      const observations = records.map(record => ({value: record.observations[i]?.value, weight: Math.cos(record.cell.lat * Math.PI / 180)})).filter(item => Number.isFinite(item.value));
      const weight = observations.reduce((sum, item) => sum + item.weight, 0);
      return {date: new Date(Date.UTC(2015, i, 1)).toISOString().slice(0, 10), value: weight ? observations.reduce((sum, item) => sum + item.value! * item.weight, 0) / weight : NaN};
    }));
    field.set(variable.id, Array.from({length: 120}, (_, i) => records.map(record => ({...record.cell, value: record.observations[i]?.value ?? NaN}))));
  }
  return {series, field};
}
