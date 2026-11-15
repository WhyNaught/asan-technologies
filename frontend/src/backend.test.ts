import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchBackendSeries } from './backend.ts';
import { variables } from './registry.ts';
import { adjustPeriodEndpoint } from './timeline.ts';

test('changing either study-period endpoint shifts the other endpoint to keep a valid range', () => {
  assert.deepEqual(adjustPeriodEndpoint(10,4,'start'),[10,12]);
  assert.deepEqual(adjustPeriodEndpoint(10,4,'end'),[2,4]);
  assert.deepEqual(adjustPeriodEndpoint(10,20,'start'),[10,20]);
  assert.throws(()=>adjustPeriodEndpoint(118,119,'start'),/at least two later months/);
});

test('API adapter requests bounded area samples and returns a weighted dated series', async () => {
  const original=globalThis.fetch;let posted:Record<string,unknown>|undefined;
  globalThis.fetch=(async (input,init) => {
    if(String(input).endsWith('/data/variables'))return new Response(JSON.stringify({variables:[{id:'earth_skin_temperature'}]}),{status:200});
    posted=JSON.parse(String(init?.body));const query=posted as {coordinates:{latitude:number;longitude:number}[];variables:string[]};
    return new Response(JSON.stringify({data_mode:'nasa_power',locations:query.coordinates.map(coordinate=>({coordinate,series:query.variables.map(variable=>({variable,observations:Array.from({length:120},(_,i)=>({timestamp:new Date(Date.UTC(2015,i,1)).toISOString().slice(0,10),value:coordinate.latitude+i}))}))}))}),{status:200});
  }) as typeof fetch;
  try{
    const result=await fetchBackendSeries([variables.temperature],{name:'Test region',kind:'region',lon:0,lat:0,bounds:[-1,-1,1,1]},3,{startDate:'2018-03-01',endDate:'2020-06-01'});
    const rows=result.series.get('temperature')!,field=result.field.get('temperature')!;
    const sent=posted!.coordinates as {latitude:number;longitude:number}[];assert.equal(new Set(sent.map(c=>`${c.latitude},${c.longitude}`)).size,sent.length);assert.ok(sent.every(c=>Math.abs(c.latitude/0.5-Math.round(c.latitude/0.5))<1e-9));
    assert.equal(posted!.start_date,'2018-03-01');assert.equal(posted!.end_date,'2020-06-01');
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

test('Giovanni requests an area-average series and does not fabricate map cells', async () => {
  const original=globalThis.fetch;let posted:Record<string,unknown>|undefined;
  globalThis.fetch=(async (input,init) => {
    assert.ok(String(input).endsWith('/data/giovanni/query'));
    posted=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      source:'NASA Giovanni',
      observations:[
        {timestamp:'2015-01-01',value:1.5},
        {timestamp:'2015-03-01',value:2.5},
      ],
    }),{status:200});
  }) as typeof fetch;
  try{
    const result=await fetchBackendSeries([variables.giovanniPrecipitation],{name:'Phoenix',kind:'region',lon:-112,lat:33,bounds:[-112.35,33.2,-111.8,33.75]},3,{startDate:'2018-03-01',endDate:'2020-06-01'});
    const rows=result.series.get('giovanni-precipitation')!;
    assert.deepEqual(posted!.bbox,[-112.35,33.2,-111.8,33.75]);
    assert.equal(posted!.dataset,variables.giovanniPrecipitation.apiId);
    assert.equal(posted!.start_date,'2018-03-01');
    assert.equal(posted!.end_date,'2020-06-01');
    assert.equal(rows[0].value,1.5);
    assert.ok(Number.isNaN(rows[1].value));
    assert.equal(rows[2].value,2.5);
    assert.equal(result.field.size,0);
    assert.equal(result.sources.get('giovanni-precipitation'),'NASA Giovanni');
  }finally{globalThis.fetch=original;}
});

test('Giovanni API errors preserve actionable recommendations', async () => {
  const original=globalThis.fetch;
  globalThis.fetch=(async () => new Response(JSON.stringify({
    detail:{
      message:'NASA Giovanni could not find matching data.',
      recommendations:['Try a shorter date range.','Choose a smaller area.'],
    },
  }),{status:502})) as typeof fetch;
  try{
    await assert.rejects(
      fetchBackendSeries([variables.giovanniPrecipitation],{name:'Phoenix',kind:'region',lon:-112,lat:33,bounds:[-112.35,33.2,-111.8,33.75]}),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message,'NASA Giovanni could not find matching data.');
        assert.deepEqual((error as Error & {recommendations?:string[]}).recommendations,[
          'Try a shorter date range.',
          'Choose a smaller area.',
        ]);
        return true;
      },
    );
  }finally{globalThis.fetch=original;}
});

test('a drawn region is covered by a gap-free block of native cells', async () => {
  const { nativeCells } = await import('./backend.ts');
  const cells = nativeCells({name: 'Box', kind: 'region', lon: -83, lat: 36, bounds: [-90, 33, -76, 39]});
  assert.equal(cells.length, new Set(cells.map(c => c.lat)).size * new Set(cells.map(c => c.lon)).size);
});
