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
    assert.equal((posted!.coordinates as unknown[]).length,16);
    assert.equal(rows.length,120);assert.ok(Math.abs(rows[0].value)<1e-10);assert.ok(Math.abs(rows[119].value-119)<1e-10);
    assert.equal(field.length,120);assert.equal(field[0].length,16);
  }finally{globalThis.fetch=original;}
});
