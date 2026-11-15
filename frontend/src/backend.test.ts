import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchBackendSeries } from './backend.ts';
import { variables } from './registry.ts';

test('API adapter requests bounded area samples and returns a weighted dated series', async () => {
  const original=globalThis.fetch;let posted:Record<string,unknown>|undefined;
  globalThis.fetch=(async (input,init) => {
    if(String(input).endsWith('/data/variables'))return new Response(JSON.stringify({variables:[{id:'earth_skin_temperature'}]}),{status:200});
    posted=JSON.parse(String(init?.body));const query=posted as {coordinates:{latitude:number;longitude:number}[];variables:string[]};
    return new Response(JSON.stringify({data_mode:'nasa_power',locations:query.coordinates.map(coordinate=>({coordinate,series:query.variables.map(variable=>({variable,observations:Array.from({length:120},(_,i)=>({timestamp:new Date(Date.UTC(2015,i,1)).toISOString().slice(0,10),value:coordinate.latitude+i}))}))}))}),{status:200});
  }) as typeof fetch;
  try{
    const result=await fetchBackendSeries([variables.temperature],{name:'Test region',kind:'region',lon:0,lat:0,bounds:[-1,-1,1,1]});
    const rows=result.series.get('temperature')!,field=result.field.get('temperature')!;
    const sent=posted!.coordinates as {latitude:number;longitude:number}[];assert.equal(new Set(sent.map(c=>`${c.latitude},${c.longitude}`)).size,sent.length);assert.ok(sent.every(c=>Math.abs(c.latitude/0.5-Math.round(c.latitude/0.5))<1e-9));
    assert.equal(rows.length,120);assert.ok(Math.abs(rows[0].value)<1e-10);assert.ok(Math.abs(rows[119].value-119)<1e-10);
    assert.equal(field.length,120);assert.ok(field[0].length>=1);
  }finally{globalThis.fetch=original;}
});

test('worldwide sampling is spread across the globe and stays within the API limit', async () => {
  const { nativeCells } = await import('./backend.ts');
  const cells = nativeCells({name: 'Worldwide', kind: 'global', lon: 0, lat: 0});
  assert.ok(cells.length > 0 && cells.length <= 49);
  assert.ok(new Set(cells.map(c => c.lat)).size >= 6 && new Set(cells.map(c => c.lon)).size >= 6);
});

test('every catalogued variable is backed by a real data source', async () => {
  const { phenomena } = await import('./registry.ts');
  for (const p of phenomena) for (const v of p.variables) assert.ok(v.apiId && v.source, `${p.name} / ${v.name}`);
});

test('a drawn region is covered by a gap-free block of native cells', async () => {
  const { nativeCells } = await import('./backend.ts');
  const cells = nativeCells({name: 'Box', kind: 'region', lon: -83, lat: 36, bounds: [-90, 33, -76, 39]});
  assert.equal(cells.length, new Set(cells.map(c => c.lat)).size * new Set(cells.map(c => c.lon)).size);
});
