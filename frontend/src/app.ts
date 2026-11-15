import './styles.css';
import { phenomena, categories, variables as allVariables } from './registry';
import { places, dates } from './data';
import { analyze, correlate, monthlyAnomalies } from './analysis';
import { renderChart, number, signed, dateLabel } from './chart';
import { EarthMap } from './map';
import { ionToken } from './providers';
import { palette } from './layers';
import { adjustPeriodEndpoint, advance, setPeriod, type TimelineState } from './timeline';
import { icon } from './icons';
import { glossary, methodNote, caution } from './glossary';
import { startTour, stopTour, type TourStep } from './tour';
import { fetchBackendSeries } from './backend';
import { scanTrends, cellTrends, type TrendResult } from './trends';
import { fetchModisMap, fetchModisSeries, modisWindow, MODIS_NAME, type ModisMap } from './modis';
import type { Phenomenon, StudyArea, Variable, Observation, EnvironmentalLayer } from './types';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
const button = (action: string, symbol: string, label: string) => `<button class="icon-button" data-action="${action}" aria-label="${label}" title="${label}">${icon(symbol)}</button>`;
const timeline: TimelineState = {start: 0, end: 119, index: 119, playing: false, speed: 1, step: 1};
let phenomenon: Phenomenon | undefined, variable: Variable | undefined, area: StudyArea | undefined;
let selectedVariables: string[] = [];
let variablesOpen = false;
let ready = false, analysisOpen = false, expanded = false, anomalies = true, alpha = 0.05, opacity = 0.65;
const hiddenLayers = new Set<string>();
let trendMap = false, trendCache: {field: unknown; key: string; cells: import('./types').Cell[]} | undefined;
let scanId = 0, scan: {status: 'idle' | 'loading' | 'done' | 'error'; area?: StudyArea; period: string; results: TrendResult[]; field: Map<string, import('./types').Cell[][]>; sources: Map<string, string>; error: string; warning?: string} = {status: 'idle', period: '', results: [], field: new Map(), sources: new Map(), error: ''};
let modisMaps = new Map<number, ModisMap>(), modisInflight = new Set<number>(), modisPending = '', modisError = '';
const isModis = (v?: Variable) => v?.apiId === 'modis_lst';
const isGiovanni = (v?: Variable) => v?.provider === 'giovanni';
let backendSources = new Map<string, string>();
let dataLoading = false, dataError = '', dataErrorRecommendations: string[] = [], backendFields = new Map<string, import('./types').Cell[][]>(), requestId = 0;
let compare = false, compareMode = 'region', comparePlace = 1, compareVariable = '', compareStart = 0, compareEnd = 59;
let paletteMode: 'all' | 'phenomena' = 'all', category = '', query = '', remote: StudyArea[] = [], catalogueOpen = false;
let playTimer: ReturnType<typeof setInterval> | undefined;
let drawMode: 'rectangle' | 'polygon' | null = null;
const seriesCache = new Map<string, Observation[]>();

$('#app').innerHTML = `
  <main class="explorer" aria-label="Earth System Explorer">
    <div id="earth" aria-label="Interactive 3D Earth. Drag to orbit, scroll to zoom, middle-drag to tilt. Click to sample." tabindex="0"></div>
    <header class="topbar">
      <a class="wordmark" href="/" aria-label="ASAN home">ASAN<span>Earth System Explorer</span></a>
      <button class="search-trigger" data-action="search">${icon('search')}<span>Search any place or phenomenon</span><kbd>Ctrl K</kbd></button>
      <nav aria-label="Map settings">${button('settings', 'settings', 'Map settings')}</nav>
    </header>
    <div class="investigation" id="investigation"></div>
    <div class="map-toolbar" role="toolbar" aria-label="Map controls">
      ${button('zoom-in', 'plus', 'Zoom in')}${button('zoom-out', 'minus', 'Zoom out')}<span class="toolbar-divider"></span>
      ${button('reset', 'globe', 'Reset Earth view')}${button('tilt', 'tilt', 'Tilt view')}<span class="toolbar-divider"></span>
      ${button('style', 'layers', 'Switch satellite / map')}${button('draw', 'area', 'Select study area')}
    </div>
    <div id="draw-instructions" class="draw-instructions surface" hidden></div>
    <div id="welcome" class="welcome"><strong>Explore a changing Earth</strong><span>Choose a phenomenon or search for a place to begin.</span><button class="primary" data-action="tour">Take the 2-minute guided tour</button></div>
    <aside id="tour" class="tour surface" role="dialog" aria-label="Guided tour" aria-live="polite" hidden></aside>
    <div id="legend" class="legend surface" hidden></div><div id="timeline" class="timeline surface" hidden></div>
    <div class="map-footer"><button id="provider-status" class="provider-status" data-action="settings">Loading Earth…</button><span id="coordinate-readout"></span><span class="scale"><span id="scale-readout"></span><i></i></span></div>
    <section id="analysis" class="analysis-sheet" aria-label="Trend analysis workspace" hidden></section>
    <div id="toast" class="toast surface" role="status" hidden></div>
    <dialog id="palette" class="command-palette" aria-label="Search places and phenomena"></dialog>
    <dialog id="trends" class="settings-dialog trends-dialog" aria-labelledby="trends-title"></dialog>
    <dialog id="settings" class="settings-dialog" aria-labelledby="settings-title"></dialog>
  </main>`;

const map = new EarthMap($('#earth'), selectArea, (text, error) => {
  $('#provider-status').textContent = text; $('#provider-status').classList.toggle('error', !!error);
}, (text, scale) => { $('#coordinate-readout').textContent = text; $('#scale-readout').textContent = scale; }, () => {drawMode = null; $('#draw-instructions').hidden = true;});
$('#earth').addEventListener('transitionend',event=>{if(event.propertyName==='right'&&ready){map.viewer.cesiumWidget.resize();map.viewer.scene.requestRender();}});
map.initialize().then(() => {ready = true; $('#earth canvas')?.setAttribute('tabindex', '0'); if (area) {map.select(area); map.flyTo(area);} updateLayer();}).catch(error => {
  $('#provider-status').textContent = 'Earth could not load · open setup'; $('#provider-status').classList.add('error');
  $('#welcome').innerHTML = `<h1>Earth couldn’t load.</h1><p>${escape(error.message || 'Check your network and WebGL support.')}</p><button class="primary" data-action="settings">Map setup</button>`;
});
function toast(message: string) {const el = $('#toast'); el.textContent = message; el.hidden = false; window.setTimeout(() => {el.hidden = true;}, 5500);}
function selectedRows(v = variable!, a = area!, start = timeline.start, end = timeline.end) {
  const key = JSON.stringify([v.id, a]); let rows = seriesCache.get(key);
  if (!rows) rows = dates.map(date => ({date, value: NaN})); // not loaded yet: shown as gaps, never invented
  if (anomalies) rows = monthlyAnomalies(rows, 2015, 2024);
  return rows.slice(start, end + 1);
}
let dataPromise: Promise<void> = Promise.resolve();
function refreshBackendData() { return dataPromise = loadBackendData(); }
async function loadBackendData() {
  const current=++requestId;
  dataLoading=false;dataError='';dataErrorRecommendations=[];backendFields=new Map();modisMaps=new Map();modisInflight=new Set();modisPending='';modisError='';
  if(!phenomenon||!area||!selectedVariables.length)return;
  const selected=selectedVariables.map(id=>phenomenon!.variables.find(v=>v.id===id)!), regular=selected.filter(v=>!isModis(v)), modis=selected.find(isModis);
  if(modis)void loadModis(current,modis);
  if(!regular.length){renderControls();updateLayer();renderAnalysis();return;}
  dataLoading=true;renderControls();updateLayer();renderAnalysis();
  try{
    const period={startDate:dates[timeline.start],endDate:dates[timeline.end]};
    const result=await fetchBackendSeries(regular,area,3,period);
    if(current!==requestId)return;
    for(const [id,rows] of result.series)seriesCache.set(JSON.stringify([id,area]),rows);
    backendFields=result.field;for(const [id,name] of result.sources)backendSources.set(id,name);dataLoading=false;dataError='';dataErrorRecommendations=[];
  }catch(error){
    if(current!==requestId)return;
    for(const v of regular)seriesCache.delete(JSON.stringify([v.id,area]));
    dataLoading=false;dataError=(error as Error).message;
    const recommendations=error&&typeof error==='object'&&'recommendations' in error
      ? error.recommendations : undefined;
    dataErrorRecommendations=Array.isArray(recommendations)
      ? recommendations.filter((item):item is string=>typeof item==='string') : [];
    toast(`Data unavailable: ${dataError}`);
  }
  renderControls();updateLayer();renderAnalysis();
}
// MODIS: the 1 km map for the current date loads first (~20 s); the 10-year area-mean series follows (minutes the first time, then cached by the API).
async function loadModis(current:number,v:Variable){
  const target=area!;
  try{
    const win=modisWindow(target);backendSources.set(v.id,MODIS_NAME);modisPending='starting…';renderControls();renderAnalysis();
    void ensureModisMap(current);
    const rows=await fetchModisSeries(win,dates,(done,total)=>{if(current!==requestId)return;modisPending=total?`${done}/${total} NASA requests`:'starting…';const note=document.querySelector('#modis-status');if(note)note.textContent=`MODIS 1 km series: ${modisPending}`;});
    if(current!==requestId)return;
    seriesCache.set(JSON.stringify([v.id,target]),rows);modisPending='';
  }catch(error){
    if(current!==requestId)return;
    modisPending='';modisError=(error as Error).message;toast(`MODIS unavailable: ${modisError}`);
  }
  renderControls();updateLayer();renderAnalysis();
}
async function ensureModisMap(current=requestId){
  const index=timeline.index;
  if(!area||modisMaps.has(index)||modisInflight.has(index)||!selectedVariables.some(id=>isModis(phenomenon?.variables.find(v=>v.id===id))))return;
  modisInflight.add(index);
  try{
    const map=await fetchModisMap(modisWindow(area),dates[index]);
    if(current!==requestId)return;
    modisMaps.set(index,map);
  }catch(error){if(current===requestId&&!modisError){modisError=(error as Error).message;toast(`MODIS unavailable: ${modisError}`);}}
  finally{modisInflight.delete(index);}
  if(current===requestId&&index===timeline.index)updateLayer();
}
function areaLabel(a: StudyArea) {return a.kind === 'point' ? 'Point / grid-cell sample' : a.kind === 'global' ? 'Global spatial average (85°S–85°N)' : 'Area-weighted study-region mean';}
function selectArea(next: StudyArea) {
  if (next.kind === 'global' && !variable?.global) {toast('This variable supports a point or a selected region.'); return;}
  area = next; if (ready) map.select(area); renderControls(); updateLayer(); renderAnalysis();void refreshBackendData();
}
function selectPhenomenon(id: string) {
  phenomenon = phenomena.find(p => p.id === id)!; variable = phenomenon.variables[0]; selectedVariables = [variable.id];variablesOpen=false;
  if (area?.kind === 'global' && !variable.global) area = undefined;
  if (!phenomenon.demo || !area) analysisOpen = false;
  compareVariable = ''; hiddenLayers.clear(); $('#welcome').hidden = true;
  renderControls(); updateLayer(); renderAnalysis();void refreshBackendData();
}
function renderControls() {
  $('#investigation').innerHTML = `<button class="phenomenon-trigger surface" data-action="phenomena">${icon('globe')}<span>${phenomenon ? escape(phenomenon.name) : 'Explore a phenomenon'}</span>${icon('chevron')}</button>
    ${phenomenon&&area?`<button class="study-summary" data-action="edit-study">${escape(phenomenon.name)} · ${escape(area.name)} <span>Edit study</span></button>`:''}
    ${phenomenon ? `<div class="context surface"><p class="investigation-description">${escape(phenomenon.description)}</p><div class="step-heading"><span>Study area</span><button data-action="search">${area ? 'Change' : 'Search'}</button></div>
      <div class="region-row"><button class="region-chip" data-action="search">${icon('pin')}<span>${area ? escape(area.name) : 'Choose a place'}</span></button></div>
      <span class="sample-type">${area ? areaLabel(area) : 'Pick how to define the place you want to investigate'}</span>
      <div class="area-tools" role="group" aria-label="Choose a study area"><button data-action="search">${icon('pin')}<span>Search a place</span></button><button data-action="draw" ${drawMode==='rectangle'?'aria-pressed="true"':''}>${icon('area')}<span>Draw a box</span></button><button data-action="polygon" ${drawMode==='polygon'?'aria-pressed="true"':''}>${icon('shape')}<span>Draw a shape</span></button>${variable!.global ? `<button data-action="global">${icon('globe')}<span>Worldwide</span></button>` : ''}</div>
      ${area?'':`<div class="suggested-areas"><span>Quick picks</span>${places.slice(0,4).map(p=>`<button data-place="${escape(p.name)}">${escape(p.name.split(',')[0])}</button>`).join('')}</div>`}
      <details class="variable-picker"><summary>Variables <span>${selectedVariables.length} selected</span></summary><div class="variable-options">${phenomenon.variables.map(v=>{const unavailable=false,limit=selectedVariables.length>=3&&!selectedVariables.includes(v.id);return `<label class="${unavailable?'unavailable-variable':''}"><input type="checkbox" name="variables" value="${v.id}" ${selectedVariables.includes(v.id)?'checked':''} ${unavailable||limit?'disabled':''}>${v.name}<span>${escape(v.source)}</span></label>`}).join('')}</div></details>
      <div class="step-heading period-heading"><span>Study period</span><button data-action="period">${dates[timeline.start].slice(0,7)} – ${dates[timeline.end].slice(0,7)} ${icon('chevron')}</button></div>
      ${dataLoading?'<p class="data-status" role="status">Requesting monthly series from ASAN API…</p>':dataError?`<div class="data-status error" role="alert"><p>${escape(dataError)}</p>${dataErrorRecommendations.length?`<strong>What to try next</strong><ul>${dataErrorRecommendations.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`:''}<button data-action="retry-data">Retry</button></div>`:''}
      <button class="scan-action" data-action="scan" ${!area?'disabled':''}>${icon('search')}<span>Find trends in this area</span></button>
      ${phenomenon.demo ? `<button class="primary analyze-action" data-action="analyze" ${!area||dataLoading||!!dataError ? 'disabled' : ''}>Analyze ${selectedVariables.length} variable${selectedVariables.length===1?'':'s'} ${icon('arrow')}</button>` : '<p class="unsupported">Catalogue preview · data not connected yet. Try a highlighted demonstration.</p>'}</div>` : area ? `<button class="standalone-region surface" data-action="search">${icon('pin')}${escape(area.name)}</button>` : ''}`;
  const picker=$<HTMLDetailsElement>('.variable-picker');if(picker)picker.open=variablesOpen;
  $('#timeline').hidden = true; renderTimeline();
}
function eventLabel() {
  if(phenomenon?.name==='El Niño / La Niña'){const oni=backendFields.get('oni')?.[timeline.index]?.[0]?.value;if(Number.isFinite(oni))return oni!>=0.5?`El Niño (ONI ${signed(oni!)} °C)`:oni!<=-0.5?`La Niña (ONI ${signed(oni!)} °C)`:`Neutral (ONI ${signed(oni!)} °C)`;}
  return 'Basemap imagery is not historical';
}
function renderTimeline() {
  if (!phenomenon?.demo) return;
  $('#timeline').innerHTML = `<div class="timeline-main">${button('play', timeline.playing ? 'pause' : 'play', timeline.playing ? 'Pause playback' : 'Play historical dates')}<output class="current-date">${dateLabel(dates[timeline.index])}</output><input id="time-scrubber" aria-label="Selected observation date" type="range" min="${timeline.start}" max="${timeline.end}" value="${timeline.index}" step="1"><button class="period-trigger" data-action="period">${dates[timeline.start].slice(0,4)}–${dates[timeline.end].slice(0,4)}${icon('chevron')}</button><select id="playback-speed" aria-label="Playback speed">${[1,2,4].map(s=>`<option value="${s}" ${timeline.speed===s?'selected':''}>${s}×</option>`).join('')}</select></div><div class="timeline-meta"><span>${variable?escape(backendSources.get(variable.id)||variable.source):''}</span><span class="event-label">${eventLabel()}</span></div>`;
}
function updateDate() {
  for(const el of document.querySelectorAll('.current-date'))el.textContent=dateLabel(dates[timeline.index]);
  for(const el of document.querySelectorAll<HTMLInputElement>('#time-scrubber,#analysis-time'))el.value=String(timeline.index);
  const event=$('.event-label');if(event)event.textContent=eventLabel();
  updateLayer(); if (analysisOpen) drawChart();
}
const tick=(n:number)=>Number.isInteger(n)?n:Number(n.toPrecision(2));
function cellKmOf(cells:{bounds:[number,number,number,number];lat:number}[]){const b=cells[0].bounds;return Math.max((b[2]-b[0])*Math.cos(cells[0].lat*Math.PI/180),b[3]-b[1])*111;}
/** Layers bottom-to-top: coarse NASA POWER / NOAA context first, MODIS 1 km detail on top. */
function buildLayers(): EnvironmentalLayer[] {
  if(!phenomenon||!variable||!area||dataLoading||dataError)return [];
  const selected=selectedVariables.map(id=>phenomenon!.variables.find(v=>v.id===id)!);
  const context=isModis(variable)?selected.find(v=>!isModis(v)&&!isGiovanni(v)&&backendFields.has(v.id)):isGiovanni(variable)?undefined:variable;
  const layers:EnvironmentalLayer[]=[];
  if(context&&backendFields.get(context.id)?.[timeline.index]?.length){
    let cells=backendFields.get(context.id)![timeline.index],domain=context.domain,unit=context.unit,label=context.name,period:string|undefined;
    if(trendMap){
      const field=backendFields.get(context.id)!,key=`${context.id}|${timeline.start}|${timeline.end}|${anomalies}`;
      if(trendCache?.field!==field||trendCache.key!==key)trendCache={field,key,cells:cellTrends(field,timeline.start,timeline.end,dates,anomalies)};
      cells=trendCache.cells;const m=Math.max(1e-9,...cells.map(c=>Math.abs(c.value)).filter(Number.isFinite));
      domain=[-m,m];unit=`${context.unit}/decade`;label=`${context.name} · trend`;period=`${dateLabel(dates[timeline.start])} – ${dateLabel(dates[timeline.end])}`;
    }
    layers.push({period,id:context.id,resolutionKm:cellKmOf(cells),kind:trendMap?'anomaly':context.layer,unit,label,date:dates[timeline.index],domain,opacity,visible:!hiddenLayers.has(context.id),source:backendSources.get(context.id)||context.source,coverage:area.name,cells});
  }
  const modis=selected.find(isModis),m=modis&&modisMaps.get(timeline.index);
  if(modis&&m)layers.push({id:modis.id,resolutionKm:m.cellKm,raster:m.raster,kind:'raster',unit:modis.unit,label:modis.name,date:m.composite,domain:m.domain,opacity,visible:!hiddenLayers.has(modis.id),source:MODIS_NAME,coverage:area.name,cells:m.cells});
  return layers;
}
function updateLayer() {
  const host = $('#legend'); if (!ready) return;
  if (!phenomenon?.demo || !variable || !area) {host.hidden = true; map.renderLayers([]); return;}
  void ensureModisMap();
  const layers=buildLayers();
  map.renderLayers(layers);
  if(!layers.length){
    if(isGiovanni(variable)){
      host.hidden=false;
      host.innerHTML=`<div class="legend-title">Area-averaged series</div><p class="legend-note">${escape(variable.name)} is averaged over the selected bounding box by NASA Giovanni. Giovanni does not provide per-cell values to this map layer, so the basemap is context only.</p>`;
      return;
    }
    host.hidden=true;if(!dataLoading&&!dataError&&!selectedVariables.some(id=>isModis(phenomenon!.variables.find(v=>v.id===id)))&&backendFields.size)toast('No sample points fall inside this area. Draw a wider study area.');return;
  }
  host.hidden=false;
  const rows=[...layers].reverse().map((l,i)=>{
    const colors=palette(l.kind,l.unit,l.source),tier=l.source.includes('MODIS')?'detail':'context',km=l.resolutionKm<1?number(l.resolutionKm,1):Math.round(l.resolutionKm);
    return `<li class="legend-layer tier-${tier}"><div class="legend-heading"><span class="tier-badge" style="background:linear-gradient(90deg,${colors[0]},${colors.at(-1)})" aria-hidden="true"></span><strong>${escape(l.label)}</strong><label class="visibility-toggle"><input type="checkbox" data-layer="${l.id}" ${l.visible?'checked':''} aria-label="Show ${escape(l.label)}"> Show</label></div>
      <div class="color-scale" style="background:linear-gradient(90deg,${colors.join(',')})"></div><div class="legend-values"><span>${tick(l.domain[0])}</span><span>${escape(l.unit)}</span><span>${tick(l.domain[1])}</span></div>
      <div class="legend-note">${tier==='detail'?'Detail':'Context'} · ${escape(l.source)} · ${l.period||dateLabel(l.date)} · ~${km} km cells${i===0&&layers.length>1?' · on top':''}</div></li>`}).join('');
  host.innerHTML=`<div class="legend-title">Layers <span>${layers.length>1?'top shown first':''}</span></div><ul class="legend-layers">${rows}</ul>${selectedVariables.some(id=>!isModis(phenomenon!.variables.find(v=>v.id===id)))&&backendFields.size?`<label class="trend-toggle"><input type="checkbox" id="trend-map" ${trendMap?'checked':''}> Map the trend per decade <small>(where is it changing?)</small></label>`:''}<details><summary>Layer details</summary><p>${escape(area.name)} · ${areaLabel(area)}. Colour shows the data source, not the variable: <b>blue–green</b> = NASA POWER / NOAA model and analysis grids, <b>purple–yellow</b> = NASA MODIS 1 km satellite pixels.</p><label>Opacity <input id="layer-opacity" type="range" min="0" max="1" step="0.05" value="${opacity}"></label></details>`;
}
function periodControls(start=timeline.start,end=timeline.end,prefix='') {
  return `<div class="period-controls" data-prefix="${prefix}"><label>From <input type="month" class="period-start" aria-label="${prefix?'Comparison start':'Study start'} month" min="2015-01" max="2024-12" value="${dates[start].slice(0,7)}"></label><label>To <input type="month" class="period-end" aria-label="${prefix?'Comparison end':'Study end'} month" min="2015-01" max="2024-12" value="${dates[end].slice(0,7)}"></label></div>`;
}
function comparisonData() {
  if (!compare || !area || !variable) return;
  if(compareMode==='variable'){const v=phenomenon!.variables.find(v=>v.id===compareVariable&&selectedVariables.includes(v.id)&&v.id!==variable!.id);if(v)return{rows:selectedRows(v),name:v.name,variable:v};return;}
  return {rows:selectedRows(variable,area,compareStart,compareEnd),name:`${dateLabel(dates[compareStart])}–${dateLabel(dates[compareEnd])}`,variable};
}
function renderAnalysis() {
  const host=$('#analysis');host.hidden=!analysisOpen;
  $('.explorer').classList.toggle('analyzing',analysisOpen);$('.explorer').classList.toggle('expanded',expanded&&analysisOpen);
  if(ready)requestAnimationFrame(()=>{map.viewer.cesiumWidget.resize();map.viewer.scene.requestRender();});
  if(!analysisOpen||!phenomenon?.demo||!area||!variable)return;
  if(dataLoading){host.innerHTML='<div class="analysis-header"><h2>Loading study data</h2><p>Requesting the selected variables for this area and period.</p></div>';return;}
  if(isModis(variable)&&(modisPending||modisError)){host.innerHTML=`<div class="analysis-header"><div><h2>${escape(variable.name)}</h2><p id="modis-status" role="status">${modisError?escape(modisError):'MODIS 1 km series: '+escape(modisPending)}</p></div><div class="sheet-actions">${button('close-analysis','close','Close analysis')}</div></div><div class="analysis-scroll"><div class="analysis-variable-tabs" aria-label="Map layer"><span>Variable · map layer</span>${selectedVariables.map(id=>{const v=phenomenon!.variables.find(item=>item.id===id)!;return `<button data-active-variable="${v.id}" aria-pressed="${v.id===variable!.id}">${v.name}</button>`}).join('')}</div>${modisError?'':'<p class="definition">NASA limits MODIS requests, so the first time you analyse an area the 10-year series takes a couple of minutes to assemble; after that it is cached. The map layer appears as soon as the first month arrives. You can switch to the other variables meanwhile.</p>'}</div>`;return;}
  const rows=selectedRows();let result:ReturnType<typeof analyze>;
  try{result=analyze(rows,alpha);}catch(e){host.innerHTML=`<div class="analysis-header"><h2>Not enough observations</h2>${button('close-analysis','close','Close analysis')}</div><p>${escape((e as Error).message)}</p>`;return;}
  const other=comparisonData(),otherStats=other&&analyze(other.rows,alpha);
  const decade=`${signed(result.slope)} ${escape(variable.unit)} per decade (95% CI ${signed(result.ci[0])} to ${signed(result.ci[1])})`,mkSig=result.mk.p<alpha;
  const summary=result.significant&&mkSig?`<strong>Clear trend:</strong> ${escape(variable.name)} ${result.slope>0?'rose':'fell'} by about ${decade}. Both tests agree this is unlikely to be chance.`:result.significant!==mkSig?`<strong>Mixed evidence:</strong> the t-test and Mann-Kendall test disagree (${decade}), so treat this trend with caution.`:`<strong>No statistically clear trend</strong> (${decade}). A longer record, or a different region, might reveal one.`;
  host.innerHTML=`<div class="sheet-handle"></div><div class="analysis-header"><div><h2>${variable.name}${anomalies?' · seasonal anomalies':''}</h2><p>${escape(area.name)} · ${areaLabel(area)} · ${escape(backendSources.get(variable.id)||'loading')}</p></div><div class="sheet-actions">${button('expand-analysis','expand',expanded?'Reduce analysis workspace':'Expand analysis workspace')}${button('close-analysis','close','Close analysis')}</div></div>
  <div class="analysis-scroll"><div class="analysis-options">${periodControls()}<label class="anomaly-control"><input type="checkbox" id="anomalies" ${anomalies?'checked':''}> Seasonal anomalies</label><button class="text-button" data-action="compare">${icon('compare')}${compare?'Comparing series':'Add comparison'}</button></div>
  ${compare?`<div class="comparison-controls"><label>Compare with <select id="compare-mode">${['period','variable'].filter(m=>m!=='variable'||selectedVariables.length>1).map(m=>`<option value="${m}" ${compareMode===m?'selected':''}>${m==='region'?'Two regions':m==='period'?'Two periods':'Related variables'}</option>`).join('')}</select></label>${compareMode==='region'?`<label>With <select id="compare-place">${places.map((p,i)=>`<option value="${i}" ${i===comparePlace?'selected':''}>${p.name}</option>`).join('')}</select></label>`:compareMode==='period'?periodControls(compareStart,compareEnd,'compare'):`<label>With <select id="compare-variable">${phenomenon!.variables.filter(v=>selectedVariables.includes(v.id)&&v.id!==variable!.id).map(v=>`<option value="${v.id}" ${v.id===other?.variable.id?'selected':''}>${v.name}</option>`).join('')}</select></label>`}${button('remove-compare','close','Remove comparison')}</div>`:''}
  <div class="analysis-variable-tabs" aria-label="${isGiovanni(variable)?'Area-averaged series':'Map layer'}"><span>${isGiovanni(variable)?'Area-averaged series':'Variable · map layer'}</span>${selectedVariables.map(id=>{const v=phenomenon!.variables.find(item=>item.id===id)!;return `<button data-active-variable="${v.id}" aria-pressed="${v.id===variable!.id}">${v.name}</button>`}).join('')}</div>${isGiovanni(variable)?'<p class="definition">NASA Giovanni averages the data over the selected bounding box. The map is shown for geographic context only; these results are not per-pixel measurements. Aerosol optical depth is a column proxy, not a surface PM2.5 measurement. Giovanni does not provide soil pH, mineral composition, rainwater pH, or acid deposition in this integration.</p>':''}<p class="interpretation">${summary} </p>${glossary[variable.id]?`<p class="definition"><b>What is this?</b> ${escape(glossary[variable.id])}</p>`:''}${caution[variable.id]?`<p class="definition caution"><b>Caution.</b> ${escape(caution[variable.id])}</p>`:''}<p class="definition"><b>Reading the tests.</b> ${escape(methodNote)}</p><div id="chart" class="chart"></div><div class="chart-date-control">${button('play',timeline.playing?'pause':'play',timeline.playing?'Pause playback':'Play historical dates')}<output class="current-date">${dateLabel(dates[timeline.index])}</output><input id="analysis-time" type="range" min="${timeline.start}" max="${timeline.end}" value="${timeline.index}" aria-label="Analysis observation date"></div>
  <div class="metrics"><div><span>${variable.name} · Trend</span><strong>${signed(result.slope)} <small>${variable.unit} / decade</small></strong></div><div><span>Statistical significance</span><strong>p ${result.p<.001?'&lt; 0.001':'= '+number(result.p,3)}</strong><small>${result.significant?'Significant':'Not significant'} at α = ${alpha} · t-test</small></div><div><span>Mann-Kendall (non-parametric)</span><strong>p ${result.mk.p<.001?'&lt; 0.001':'= '+number(result.mk.p,3)}</strong><small>τ = ${number(result.mk.tau,2)} · Sen slope ${signed(result.mk.sen*120)} ${variable.unit}/decade · ${result.mk.p<alpha?'Significant':'Not significant'}</small></div><div><span>95% confidence interval</span><strong>${signed(result.ci[0])} to ${signed(result.ci[1])}</strong><small>${variable.unit} / decade</small></div><div><span>Coverage</span><strong>${rows[0].date.slice(0,4)}–${rows.at(-1)!.date.slice(0,4)}</strong><small>${result.n} monthly observations · ${result.missing} missing</small></div></div>
  ${other&&otherStats?`<p class="comparison-summary"><strong>${escape(other.name)}</strong>: ${signed(otherStats.slope)} ${other.variable.unit}/decade. The trends ${Math.sign(result.slope)===Math.sign(otherStats.slope)?'have the same direction':'have opposite directions'}. Different displayed slopes do not establish a statistically significant difference.${compareMode==='period'?' Periods align by elapsed month.':''}${other.variable.unit!==variable.unit?' The chart uses standardized values for comparable axes; slopes retain original units.':''}</p>`:''}
  <details class="analysis-more"><summary>Correlations & downloads</summary><div id="correlations"></div><div class="report-actions"><button class="text-button" data-action="report">Download scientific report</button><button class="text-button" data-action="csv">Download observations (CSV)</button></div></details><details class="methodology"><summary>How was this calculated?</summary><div class="method-content"><p>Ordinary least squares regresses values against actual elapsed years (365.25 days). Slope × 10 gives units per decade. A two-sided Student-t test of zero slope uses n − 2 degrees of freedom. The 95% confidence interval is slope ± t<sub>0.975</sub> × standard error. Missing values are excluded, never replaced with zero.</p><p>${anomalies?'Seasonal anomalies subtract each calendar month’s 2015–2024 mean, calculated over the complete baseline before filtering the study period.':'Seasonality is retained. Enable seasonal anomalies to subtract each calendar month’s 2015–2024 baseline mean.'} The climatology is estimated from the same demonstration series and may influence trend estimates.</p><p>Study period: ${dateLabel(rows[0].date)}–${dateLabel(rows.at(-1)!.date)}. ${area.kind==='point'?'This is a point/grid-cell sample, not a regional average.':'NASA/NOAA native-grid cells (up to 49, evenly sampled for large areas) inside the study region are weighted by cosine of latitude; polygon edges use center inclusion.'} Global coverage excludes polar caps beyond 85°.</p><p>The test assumes independent, normally distributed errors with constant variance. Temporal autocorrelation and seasonality may understate uncertainty. A trend does not establish causation.</p><label>Significance threshold <select id="alpha">${[.01,.05,.1].map(a=>`<option value="${a}" ${alpha===a?'selected':''}>${a}</option>`).join('')}</select></label><p>${escape(phenomenon.why)}</p></div></details></div>`;
  drawChart();
}
function drawChart() {
  if(!analysisOpen||!area||!variable||!$('#chart'))return;
  let rows=selectedRows(),other=comparisonData(),unit=anomalies?`${variable.unit} anomaly`:variable.unit;
  if(other&&other.variable.unit!==variable.unit){
    const standardize=(data:Observation[])=>{const valid=data.filter(r=>Number.isFinite(r.value)),mean=valid.reduce((s,r)=>s+r.value,0)/valid.length,sd=Math.sqrt(valid.reduce((s,r)=>s+(r.value-mean)**2,0)/valid.length);return data.map(r=>({...r,value:(r.value-mean)/(sd||1)}));};
    rows=standardize(rows);other={...other,rows:standardize(other.rows)};unit='Standard deviations';
  }
  const comparisonRows=other?.rows.map((r,i)=>({...r,date:compareMode==='period'?(rows[i]?.date||''):r.date})).filter(r=>r.date&&Date.parse(r.date)<=Date.parse(rows.at(-1)!.date));
  renderChart($('#chart'),rows,unit,dates[timeline.index],other&&comparisonRows?{rows:comparisonRows,name:other.name}:undefined,anomalies,backendFields.has(variable.id)?(backendSources.get(variable.id)||'ASAN API')+' observations':'Observations');
  const pairs=selectedVariables.flatMap((id,i)=>selectedVariables.slice(i+1).map(otherId=>[id,otherId]));
  $('#correlations').innerHTML=pairs.length?`<h3>Pairwise Pearson correlation</h3>${pairs.map(([left,right])=>{const a=phenomenon!.variables.find(v=>v.id===left)!,b=phenomenon!.variables.find(v=>v.id===right)!,r=correlate(selectedRows(a),selectedRows(b));return `<p><strong>${escape(a.name)} ↔ ${escape(b.name)}</strong> · Pearson r = ${number(r.r,2)} · p ${r.p<.001?'< 0.001':'= '+number(r.p,3)} · ${r.n} matching months</p>`}).join('')}<small>Descriptive association only; shared trends, seasonality, and autocorrelation can inflate correlation. This is not a causal or adjusted analysis.</small>`:'<p>Select at least two variables to compare their time series.</p>';
}
function download(kind:'report'|'csv') {
  if(!area||!phenomenon)return;
  const chosen=selectedVariables.map(id=>phenomenon!.variables.find(v=>v.id===id)!).filter(Boolean);
  const observations=chosen.map(v=>({v,rows:selectedRows(v),stats:analyze(selectedRows(v),alpha)}));
  const spatialMethod=chosen.map(v=>isGiovanni(v)?`${v.name}: monthly series averaged over Giovanni's selected bounding box; no grid-cell values.`:area!.kind==='point'?'Point/grid-cell sample; not a regional mean.':'Area mean from cosine-latitude weighted sampled grid-cell centers.').join(' ');
  const content=kind==='csv'
    ? ['date,variable,value,unit,study_area,observation_type',...dates.slice(timeline.start,timeline.end+1).flatMap((date,i)=>observations.map(({v,rows})=>`${date},"${v.name.replaceAll('"','""')}",${Number.isFinite(rows[i]?.value)?rows[i].value:''},"${v.unit}","${area!.name.replaceAll('"','""')}",${area!.kind}`))].join('\n')
    : `<!doctype html><meta charset="utf-8"><title>ASAN scientific summary</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:850px;margin:48px auto;padding:0 24px;color:#263235}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}small{color:#65706e}</style><h1>${escape(phenomenon.name)} · Trend summary</h1><p>${escape(area.name)} · ${areaLabel(area)} · ${dates[timeline.start]} to ${dates[timeline.end]}</p><p><b>Data sources:</b> ${chosen.map(v=>escape(v.name)+' ('+escape(backendSources.get(v.id)||v.source)+')').join(', ')}. All values are real NASA/NOAA data served by the ASAN API.</p><table><thead><tr><th>Variable</th><th>Trend / decade</th><th>p-value (t-test)</th><th>Mann-Kendall p</th><th>95% CI</th><th>Observations</th></tr></thead><tbody>${observations.map(({v,rows,stats})=>`<tr><td>${escape(v.name)} (${escape(v.unit)})</td><td>${signed(stats.slope)}</td><td>${number(stats.p,4)}</td><td>${number(stats.mk.p,4)}</td><td>${signed(stats.ci[0])} to ${signed(stats.ci[1])}</td><td>${stats.n} of ${rows.length}</td></tr>`).join('')}</tbody></table>${chosen.length>1?`<h2>Pairwise Pearson correlation</h2>${chosen.flatMap((a,i)=>chosen.slice(i+1).map(b=>{const c=correlate(selectedRows(a),selectedRows(b));return `<p>${escape(a.name)} and ${escape(b.name)}: r = ${number(c.r,3)}, p = ${number(c.p,4)} (n = ${c.n}). Association does not establish causation.</p>`})).join('')}`:''}<h2>Methods and limitations</h2>${chosen.filter(v=>caution[v.id]).map(v=>`<p><b>Caution (${escape(v.name)}):</b> ${escape(caution[v.id])}</p>`).join('')}<p>Linear least-squares regression against elapsed time; slopes are expressed per decade. Two-sided Student t test of zero slope with n − 2 degrees of freedom; confidence interval is 95%. Missing values are excluded. ${spatialMethod} The test assumes independent errors; temporal autocorrelation can understate uncertainty. ${anomalies?'Monthly anomalies use the 2015–2024 calendar-month baseline.':'Seasonality has not been removed.'} Correlations are unadjusted and descriptive.</p><small>Generated by ASAN Earth System Explorer · ${new Date().toISOString()}</small>`;
  const url=URL.createObjectURL(new Blob([content],{type:kind==='csv'?'text/csv':'text/html'})),link=document.createElement('a');link.href=url;link.download=`asan-${phenomenon.id}-${kind}.${kind==='csv'?'csv':'html'}`;link.click();URL.revokeObjectURL(url);
}
async function runScan() {
  if (!area) { toast('Choose a study area first.'); return; }
  const target = area, id = ++scanId, dialog = $<HTMLDialogElement>('#trends');
  scan = {status: 'loading', area: target, period: `${dateLabel(dates[timeline.start])} – ${dateLabel(dates[timeline.end])}`, results: [], field: new Map(), sources: new Map(), error: ''};
  renderScan(); if (!dialog.open) dialog.showModal();
  const list = Object.values(allVariables), power = list.filter(v => v.source === 'NASA POWER'), sst = list.filter(v => v.apiId === 'sea_surface_temperature'), giovanni = list.filter(v => v.provider === 'giovanni');
  try {
    // One query carries every POWER variable; Giovanni runs one area-average workflow per dataset.
    const period={startDate:dates[timeline.start],endDate:dates[timeline.end]};
    const [p, o, g] = await Promise.allSettled([fetchBackendSeries(power, target, 16, period), fetchBackendSeries(sst, target, 16, period), fetchBackendSeries(giovanni, target, 3, period)]);
    if (id !== scanId) return;
    if (p.status === 'rejected') throw p.reason;
    const parts = [p.value, ...(o.status === 'fulfilled' ? [o.value] : []), ...(g.status === 'fulfilled' ? [g.value] : [])], used = [...power, ...(o.status === 'fulfilled' ? sst : []), ...(g.status === 'fulfilled' ? giovanni : [])];
    if(g.status==='rejected')scan.warning=`NASA Giovanni variables were not included: ${(g.reason as Error).message}`;
    for (const part of parts) { for (const [k, v] of part.field) scan.field.set(k, v); for (const [k, v] of part.sources) scan.sources.set(k, v); for (const [k, rows] of part.series) seriesCache.set(JSON.stringify([k, target]), rows); }
    scan.results = scanTrends(used.map(v => ({id: v.id, name: v.name, unit: v.unit, source: scan.sources.get(v.id) || v.source, rows: seriesCache.get(JSON.stringify([v.id, target]))!})), timeline.start, timeline.end, alpha, anomalies);
    scan.status = 'done';
  } catch (error) { if (id !== scanId) return; scan.status = 'error'; scan.error = (error as Error).message; }
  renderScan();
}
function renderScan() {
  const d = $<HTMLDialogElement>('#trends'), n = scan.results.length, hits = scan.results.filter(r => r.significant).length;
  const row = (r: TrendResult) => `<button class="trend-row ${r.significant ? (r.slope > 0 ? 'up' : 'down') : 'flat'}" data-scan-variable="${r.id}"><span class="trend-name"><strong>${escape(r.name)}</strong><small>${escape(r.source)}</small></span><span class="trend-slope">${r.slope > 0 ? '▲' : '▼'} ${signed(r.slope)} <small>${escape(r.unit)}/decade</small></span><span class="trend-p"><small>Mann-Kendall p</small>${r.pMK < .001 ? '&lt; 0.001' : number(r.pMK, 3)}</span><span class="trend-verdict">${r.significant ? (r.slope > 0 ? 'Rising' : 'Falling') + (r.survivesCorrection ? ' ★' : '') : 'No clear trend'}</span></button>`;
  d.innerHTML = `<div class="dialog-heading"><h2 id="trends-title">Trend scanner</h2>${button('close-trends', 'close', 'Close trend scanner')}</div><div class="settings-content">${scan.status === 'loading' ? '<p role="status">Testing every variable for this area against NASA and NOAA data. Giovanni area-average analyses can take up to a couple of minutes.</p>' : scan.status === 'error' ? `<p class="form-error" role="alert">${escape(scan.error)}</p>` : `<p><strong>${escape(scan.area?.name || '')}</strong> · ${escape(scan.period)}${anomalies ? ' · seasonal cycle removed' : ''}<br>${hits ? `<b>${hits} of ${n}</b> variables show a statistically significant trend (both tests, α = ${alpha}).` : `No variable shows a significant trend (α = ${alpha}) in this period.`} Click one to open its analysis.</p>${scan.warning?`<p class="form-error" role="status">${escape(scan.warning)}</p>`:''}<div class="trend-list">${scan.results.map(row).join('')}</div><p class="definition">Ranked by strength of evidence. Testing ${n} variables at once, about ${number(n * alpha, 1)} would look significant by pure chance; ★ marks trends that still pass after a Bonferroni correction (p &lt; ${number(alpha / Math.max(1, n), 4)}). Ten years is short, so treat results as leads to investigate, not conclusions.</p>`}</div>`;
}
function openScanResult(id: string) {
  const v = Object.values(allVariables).find(x => x.id === id);
  if (!v || !area || scan.area !== area) { toast('The study area changed. Run the scan again.'); return; }
  $<HTMLDialogElement>('#trends').close();
  phenomenon = phenomena.find(p => p.variables.some(x => x.id === id) && p.id === phenomenon?.id) || phenomena.find(p => p.variables.some(x => x.id === id))!;
  requestId++; selectedVariables = [id]; variable = v; compare = false; hiddenLayers.clear(); dataLoading = false; dataError = ''; dataErrorRecommendations = [];
  backendFields = scan.field; for (const [k, name] of scan.sources) backendSources.set(k, name);
  $('#welcome').hidden = true; renderControls(); updateLayer(); openAnalysis();
}
function openAnalysis() {
  if(!phenomenon?.demo||!area){toast('Choose a demonstration phenomenon and study location first.');return;}
  analysisOpen=true;$('#welcome').hidden=true;renderAnalysis();$('#analysis h2').setAttribute('tabindex','-1');$('#analysis h2').focus({preventScroll:true});
}
function closeAnalysis(){analysisOpen=false;renderAnalysis();if(ready)map.focus();}
function openPalette(mode:'all'|'phenomena') {
  paletteMode=mode;query='';category='';remote=[];catalogueOpen=false;const dialog=$<HTMLDialogElement>('#palette');
  dialog.innerHTML=`<div class="palette-head">${icon('search')}<input id="palette-search" aria-label="Search places and phenomena" placeholder="${mode==='all'?'Search a place or phenomenon…':'Find a phenomenon…'}" autocomplete="off">${button('close-palette','close','Close search')}</div><div id="palette-body"></div>`;
  renderPaletteResults();dialog.showModal();$('#palette-search').focus();
}
function renderPaletteResults() {
  const q=query.toLowerCase(),results=phenomena.filter(p=>`${p.name} ${p.category} ${p.description}`.toLowerCase().includes(q)&&(!category||category===p.category)),demos=results.filter(p=>p.demo),catalogue=results.filter(p=>!p.demo),showCatalogue=!!q||!!category||catalogueOpen;
  const locations=[...places.filter(p=>p.name.toLowerCase().includes(q)),...remote];
  $('#palette-body').innerHTML=`${paletteMode==='all'?`<div class="search-section"><h3>${query?'Places':'Suggested study areas'}</h3>${locations.slice(0,6).map(p=>`<button class="search-result" data-place="${escape(p.name)}">${icon('pin')}<span><strong>${escape(p.name)}</strong><small>${p.kind==='point'?'Point sample':'Study rectangle'} · fly to location</small></span>${icon('arrow')}</button>`).join('')}${query?'<button class="geocode-button text-button" data-action="geocode">Search more places worldwide</button><span id="geocode-status" role="status"></span>':''}</div>`:''}
  <div class="palette-category" aria-label="Phenomenon categories"><button data-category="" class="${!category?'selected':''}">All phenomena</button>${categories.map(c=>`<button data-category="${c}" class="${category===c?'selected':''}">${c}</button>`).join('')}</div><div class="search-section"><h3>Ready to investigate</h3>${demos.map(p=>`<button class="search-result" data-phenomenon="${p.id}"><span class="result-symbol">${icon('chart')}</span><span><strong>${p.name}</strong><small>${p.description}</small></span><span class="result-status">${[...new Set(p.variables.map(x=>x.source))].join(' · ')}</span></button>`).join('')||'<p class="empty-results">No matching demonstrations.</p>'}</div>${showCatalogue?`<div class="search-section catalogue-preview"><h3>Catalogue preview · data not connected</h3>${catalogue.map(p=>`<button class="search-result" data-phenomenon="${p.id}"><span class="result-symbol">${icon('globe')}</span><span><strong>${p.name}</strong><small>${p.description}</small></span><span class="result-status">Preview only</span></button>`).join('')||'<p class="empty-results">No catalogue matches.</p>'}</div>`:`<button class="browse-catalogue" data-action="browse-catalogue">Browse ${phenomena.length-demos.length} more phenomena</button>`}`;
}
async function geocode() {
  if(query.trim().length<2||!$('#geocode-status'))return;
  $('#geocode-status').textContent='Searching…';const currentQuery=query;
  try{
    const response=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=6&language=en&format=json`,{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Place search unavailable. Try a suggested area or click the map.');
    const data=await response.json() as {results?:{name:string;country?:string;latitude:number;longitude:number}[]};
    if(currentQuery!==query)return;
    remote=(data.results||[]).filter(p=>Number.isFinite(p.longitude)&&Number.isFinite(p.latitude)).map(p=>({name:`${p.name}${p.country?', '+p.country:''}`,lat:p.latitude,lon:p.longitude,kind:'point'}));
    renderPaletteResults();$('#geocode-status').textContent=remote.length?'Search: Open-Meteo / GeoNames':'No places found. Click the map to choose coordinates.';
  }catch(e){if(currentQuery===query&&$('#geocode-status'))$('#geocode-status').textContent=(e as Error).message;}
}
function settings(periodOnly=false) {
  const dialog=$<HTMLDialogElement>('#settings');
  dialog.innerHTML=`<div class="dialog-heading"><h2 id="settings-title">${periodOnly?'Study period':'Map & exploration'}</h2>${button('close-settings','close','Close settings')}</div><div class="settings-content"><h3>Time range</h3>${periodControls()}<div id="period-error" class="form-error" role="status"></div><label>Playback steps<select id="playback-step"><option value="1" ${timeline.step===1?'selected':''}>Monthly</option><option value="12" ${timeline.step===12?'selected':''}>Annual</option></select></label><button class="text-button" data-action="reset-time">${icon('reset')}Reset to start of period</button>${periodOnly?'':`<h3>Basemap</h3><div class="settings-buttons"><button data-action="satellite">Satellite</button><button data-action="clean-map">Clean map</button></div><p class="imagery-note">Imagery is context only, not scientific data. Credits: Cesium ion / NASA GIBS / OpenStreetMap contributors.</p><h3>Map navigation</h3><p>Drag to rotate or pan. Scroll or pinch to zoom. Middle-drag / Ctrl-drag to tilt. Use the toolbar to zoom, tilt, reset, and select a study area.</p><p>Ctrl/⌘ K opens search. Escape closes the top overlay or cancels drawing. Polygon: click vertices, then Finish or right-click.</p>`}</div>`;
  dialog.showModal();
}
function changePeriod(control:HTMLElement, changedInput:HTMLInputElement) {
  const a=control.querySelector<HTMLInputElement>('.period-start')!,b=control.querySelector<HTMLInputElement>('.period-end')!;
  let start=dates.findIndex(d=>d.startsWith(a.value)&&a.value!==''),end=dates.findIndex(d=>d.startsWith(b.value)&&b.value!=='');
  try{
    [start,end]=adjustPeriodEndpoint(start,end,changedInput.classList.contains('period-start')?'start':'end');
    if(control.dataset.prefix){const temp={...timeline};setPeriod(temp,start,end);compareStart=start;compareEnd=end;}
    else{
      setPeriod(timeline,start,end);
      a.value=dates[start].slice(0,7);b.value=dates[end].slice(0,7);
      void refreshBackendData();
    }
    renderControls();updateLayer();renderAnalysis();const err=$('#period-error');if(err)err.textContent='';
  }
  catch(e){const message=(e as Error).message,err=$('#period-error');if(err)err.textContent=message;else toast(message);}
}
function updatePlayback(){if(playTimer)clearInterval(playTimer);if(timeline.playing)playTimer=setInterval(()=>{timeline.index=advance(timeline);updateDate();},1000/timeline.speed);renderTimeline();for(const el of document.querySelectorAll<HTMLButtonElement>('#analysis [data-action=play]')){el.innerHTML=icon(timeline.playing?'pause':'play');el.setAttribute('aria-label',timeline.playing?'Pause playback':'Play historical dates');}}
function toast_clear(){$('#toast').hidden=true;}
function startDraw(mode:'rectangle'|'polygon') {
  stopTour();
  if(!ready)return;drawMode=mode;map.draw(mode);const host=$('#draw-instructions');host.hidden=false;
  host.innerHTML=`<div class="draw-head"><strong>${mode==='rectangle'?'Draw a box':'Draw a shape'}</strong><output id="draw-progress" aria-live="polite"></output></div><p>${mode==='rectangle'?'Press, drag and release on the map. Prefer clicking? Click one corner, then the opposite one.':'Click to place points around your area. Drag the map to pan between points.'}</p><div class="draw-buttons">${mode==='polygon'?'<button data-action="undo-draw">Undo point</button><button class="done" data-action="finish-polygon">Finish shape</button>':'<button data-action="polygon">Switch to shape</button>'}<button data-action="cancel-draw">Cancel <kbd>Esc</kbd></button></div>`;
  map.onProgress=text=>{const out=document.querySelector('#draw-progress');if(out)out.textContent=text;};map.onProgress(mode==='rectangle'?'Press and drag to draw a box':'Click to place the first point');
  toast_clear();
}
document.addEventListener('click',async event=>{
  const target=(event.target as Element).closest<HTMLElement>('button,[data-action]');if(!target)return;
  if(target.dataset.scanVariable){openScanResult(target.dataset.scanVariable);return;}
  if(target.dataset.phenomenon){selectPhenomenon(target.dataset.phenomenon);$<HTMLDialogElement>('#palette').close();return;}
  if(target.dataset.activeVariable){variable=phenomenon!.variables.find(v=>v.id===target.dataset.activeVariable)!;updateLayer();renderAnalysis();return;}
  if(target.dataset.category!==undefined){category=target.dataset.category;catalogueOpen=!!category;renderPaletteResults();return;}
  if(target.dataset.place){const next=[...places,...remote].find(p=>p.name===target.dataset.place)!;selectArea(next);if(ready)map.flyTo(next);$<HTMLDialogElement>('#palette').close();return;}
  if(target.dataset.demo!==undefined){const idx=Number(target.dataset.demo),names=['Urban heat islands','Persistent drought','El Niño / La Niña'];selectPhenomenon(phenomena.find(p=>p.name===names[idx])!.id);selectArea(places[[0,2,3][idx]]);if(ready)map.flyTo(area!);return;}
  try{switch(target.dataset.action){
    case 'scan':void runScan();break;case 'close-trends':$<HTMLDialogElement>('#trends').close();break;case 'tour':runTour();break;case 'search':openPalette('all');break;case 'phenomena':openPalette('phenomena');break;case 'close-palette':$<HTMLDialogElement>('#palette').close();break;case 'geocode':await geocode();break;case 'browse-catalogue':catalogueOpen=true;renderPaletteResults();break;
    case 'settings':settings();break;case 'period':settings(true);break;case 'close-settings':$<HTMLDialogElement>('#settings').close();break;case 'retry-data':void refreshBackendData();break;case 'edit-study':$('.explorer').classList.toggle('editing-study');break;
    case 'zoom-in':if(ready)map.zoom(1);break;case 'zoom-out':if(ready)map.zoom(-1);break;case 'reset':if(ready)map.reset();break;case 'tilt':if(ready)map.tilt();break;
    case 'style':if(ready)await map.toggleStyle();break;case 'satellite':if(ready)await map.setStyle('satellite');break;case 'clean-map':if(ready)await map.setStyle('map');break;
    case 'global':selectArea({name:'Worldwide',kind:'global',lon:0,lat:0});if(ready)map.reset();break;
    case 'draw':startDraw('rectangle');break;case 'undo-draw':map.undo();break;case 'polygon':startDraw('polygon');break;case 'finish-polygon':map.finishPolygon();break;
    case 'cancel-draw':if(ready)map.cancelDraw();drawMode=null;$('#draw-instructions').hidden=true;break;
    case 'analyze':openAnalysis();break;case 'report':download('report');break;case 'csv':download('csv');break;case 'close-analysis':closeAnalysis();$('.explorer').classList.remove('editing-study');break;case 'expand-analysis':expanded=!expanded;renderAnalysis();break;case 'explore':closeAnalysis();break;
    case 'compare':if(!area||!phenomenon?.demo){toast('Start an investigation to compare regions, periods, or variables.');break;}compare=true;compareMode='period';openAnalysis();break;case 'remove-compare':compare=false;renderAnalysis();break;
    case 'play':timeline.playing=!timeline.playing;updatePlayback();break;case 'reset-time':timeline.index=timeline.start;updateDate();break;
  }}catch(e){toast((e as Error).message||'Map provider unavailable. Check credentials in settings.');}
});
document.addEventListener('input',event=>{
  const el=event.target as HTMLInputElement;
  if(el.id==='palette-search'){query=el.value;remote=[];renderPaletteResults();}
  if(el.id==='time-scrubber'||el.id==='analysis-time'){timeline.index=Number(el.value);updateDate();}
  if(el.id==='layer-opacity'){opacity=Number(el.value);updateLayer();}
});
document.addEventListener('change',event=>{
  const el=event.target as HTMLInputElement;
  if(el.name==='variables'){
    variablesOpen=true;
    selectedVariables=Array.from(document.querySelectorAll<HTMLInputElement>('input[name=variables]:checked')).map(x=>x.value);
    variable=phenomenon!.variables.find(v=>v.id===variable?.id && selectedVariables.includes(v.id)) || phenomenon!.variables.find(v=>v.id===selectedVariables[0]) || phenomenon!.variables[0];
    if(!selectedVariables.length)selectedVariables=[variable.id];
    renderControls();updateLayer();renderAnalysis();void refreshBackendData();return;
  }
  if(el.matches('.period-start,.period-end')){changePeriod(el.closest<HTMLElement>('.period-controls')!,el);return;}
  if(el.dataset.layer){el.checked?hiddenLayers.delete(el.dataset.layer):hiddenLayers.add(el.dataset.layer);updateLayer();return;}
  if(el.id==='trend-map'){trendMap=el.checked;updateLayer();return;}
  switch(el.id){
    case 'variable':variable=phenomenon!.variables.find(v=>v.id===el.value)!;if(area?.kind==='global'&&!variable.global){area=undefined;analysisOpen=false;}compareVariable='';renderControls();updateLayer();renderAnalysis();break;
    case 'anomalies':anomalies=el.checked;renderAnalysis();break;case 'alpha':alpha=Number(el.value);renderAnalysis();$('#analysis .methodology').setAttribute('open','');break;
    case 'playback-step-placeholder':break;case 'playback-speed':timeline.speed=Number(el.value);updatePlayback();break;case 'playback-step':timeline.step=Number(el.value) as 1|12;renderTimeline();break;
    case 'compare-mode':compareMode=el.value;renderAnalysis();break;case 'compare-place':comparePlace=Number(el.value);renderAnalysis();break;case 'compare-variable':compareVariable=el.value;renderAnalysis();break;
  }
});
document.addEventListener('keydown',event=>{
  const typing=(event.target as HTMLElement).closest?.('input,textarea,select');
  if(drawMode==='polygon'&&!typing){if(event.key==='Enter'){event.preventDefault();map.finishPolygon();}if(event.key==='Backspace'||(event.ctrlKey&&event.key==='z')){event.preventDefault();map.undo();}}
  if((event.ctrlKey||event.metaKey)&&event.key==='k'){event.preventDefault();if(!$<HTMLDialogElement>('#palette').open)openPalette('all');}
  if(event.key==='Enter'&&(event.target as HTMLElement).id==='palette-search'){event.preventDefault();void geocode();}
  if(event.key==='Escape'&&!$<HTMLDialogElement>('#palette').open&&!$<HTMLDialogElement>('#settings').open){if(drawMode){map.cancelDraw();drawMode=null;$('#draw-instructions').hidden=true;}else if(analysisOpen)closeAnalysis();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&timeline.playing){timeline.playing=false;updatePlayback();}});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
{let resizeTimer:number|undefined;window.addEventListener('resize',()=>{window.clearTimeout(resizeTimer);resizeTimer=window.setTimeout(()=>{if(analysisOpen&&phenomenon&&area&&variable)drawChart();},150);});}
window.addEventListener('pagehide',()=>{if(playTimer)clearInterval(playTimer);map.destroy();});
function runTour() {
  const phoenix = places[0], vars = ['modis-lst', 'temperature', 'dew-point'];
  const stats = () => { try { return analyze(selectedRows()); } catch { return undefined; } };
  const steps: TourStep[] = [
    { title: 'You are an Earth system detective', body: () => '<p>Satellites and NASA models record our planet every month. Your job: pick a place, pick a clue (a measured variable), and decide whether it is <b>really changing</b> — or just wobbling randomly.</p><p>We will investigate: <b>is Phoenix, Arizona — one of the fastest-growing cities in the US — getting hotter?</b></p>',
      run: () => { analysisOpen = false; compare = false; selectPhenomenon('urban-heat-islands'); selectArea(phoenix); if (ready) map.flyTo(phoenix); } },
    { title: 'Choose your clues', body: () => '<p>We picked three variables: <b>MODIS land surface temperature</b> (NASA satellite, 1 km pixels), <b>earth skin temperature</b> and <b>dew point</b> (NASA POWER model, ~55 km cells).</p><p>On the map, <b>purple–yellow</b> pixels are MODIS and <b>blue–green</b> cells are NASA POWER — colour tells you the data source. The legend lists layers coarse-to-fine; tick a layer off to compare.</p>',
      run: async () => { selectedVariables = vars; variable = phenomenon!.variables.find(v => v.id === 'temperature')!; renderControls(); await refreshBackendData(); updateLayer(); } },
    { title: 'Remove the seasons', body: () => '<p>Summer is always hotter than winter — that huge wave hides any slow change. <b>Seasonal anomalies</b> subtract each month’s normal value, so what is left is how unusual each month was. The dashed line is the best straight-line trend through them.</p>',
      run: () => { anomalies = true; openAnalysis(); } },
    { title: 'Is the trend real?', body: () => { const r = stats(); if (!r) return '<p>Not enough data.</p>'; return `<p>Skin temperature in Phoenix changed by <b>${signed(r.slope)} °C per decade</b> (95% confidence: ${signed(r.ci[0])} to ${signed(r.ci[1])}).</p><p>t-test p = <b>${number(r.p, 3)}</b>; Mann-Kendall p = <b>${number(r.mk.p, 3)}</b>. ${r.significant && r.mk.p < r.alpha ? 'Both are below 0.05, so this is a <b>significant</b> trend.' : 'Both are above 0.05, so we <b>cannot rule out random variation</b> — a finding in itself. Ten years is short; climate trends often need longer records.'}</p>`; },
      run: () => { anomalies = true; renderAnalysis(); } },
    { title: 'Cross-check with satellite data', body: () => { const r = stats(); return `<p>Now <b>MODIS</b>, an independent satellite measurement: ${r ? `${signed(r.slope)} °C per decade, Mann-Kendall p = ${number(r.mk.p, 3)}` : 'not enough data'}.</p><p>Do the two sources agree? If not, ask why — <b>Terra’s orbit drifted earlier after ~2020</b>, which cools its daytime readings, so a falling MODIS trend may be a sensor artefact. Good detectives check their instruments.</p>`; },
      run: async () => { variable = phenomenon!.variables.find(v => v.id === 'modis-lst')!; for (let i = 0; i < 40 && modisPending; i++) await new Promise(r => setTimeout(r, 500)); updateLayer(); renderAnalysis(); } },
    { title: 'Now it’s your case', body: () => '<p>Try <b>Lagos</b>, <b>Tokyo</b> or <b>Toronto</b> (search any place or draw your own area), switch variables, change the study period, then download the CSV or report to share your evidence.</p>',
      run: () => { variable = phenomenon!.variables.find(v => v.id === 'temperature')!; updateLayer(); renderAnalysis(); } },
  ];
  startTour(steps);
}
renderControls();
