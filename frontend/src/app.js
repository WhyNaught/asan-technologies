import "./styles.css";

const regions = [
  { id: "lagos", name: "Lagos, Nigeria", short: "Lagos", lat: 6.52, lon: 3.38, tag: "coastal city" },
  { id: "phoenix", name: "Phoenix, Arizona", short: "Phoenix", lat: 33.45, lon: -112.07, tag: "heat hotspot" },
  { id: "amazon", name: "Amazon Basin", short: "Amazon", lat: -3.47, lon: -62.21, tag: "forest biome" },
  { id: "pacific", name: "Tropical Pacific", short: "Pacific", lat: 0, lon: -140, tag: "ocean basin" },
  { id: "great-barrier", name: "Great Barrier Reef", short: "Great Barrier Reef", lat: -18.3, lon: 147.7, tag: "reef system" }
];

const categories = [
  ["Atmosphere", ["Urban heat islands", "Heatwaves and humid heat", "Wildfire smoke transport", "Urban air pollution", "Dust storms", "Atmospheric rivers", "Monsoon shifts", "Tropical cyclones"]],
  ["Water", ["Persistent drought", "Flash drought", "River and urban flooding", "Groundwater depletion", "Shrinking lakes and reservoirs", "Snowpack and snowmelt", "Landslide conditions"]],
  ["Land & ecosystems", ["Crop and vegetation stress", "Shifting growing seasons", "Deforestation and regrowth", "Wildfire damage and recovery", "Land degradation", "Ecosystem productivity", "Changing solar and wind resources"]],
  ["Oceans & coasts", ["El Niño / La Niña", "Marine heatwaves", "Coral thermal stress", "Ocean currents and upwelling", "Phytoplankton blooms", "Sea-level rise", "Shoreline erosion"]],
  ["Cryosphere", ["Sea-ice changes", "Glacier and ice-sheet changes", "Permafrost changes", "Earth's energy balance", "Methane hotspots and plumes", "Land subsidence / uplift", "Ocean acidification"]]
];

const phenomena = categories.flatMap(([category, items]) => items.map((name, index) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name, category, index
})));

const variables = {
  "Urban heat islands": [
    { id: "temp", label: "Surface temperature", unit: "°C anomaly", color: "#ff9d66", value: "+2.4" },
    { id: "moisture", label: "Soil moisture", unit: "% anomaly", color: "#47d7ff", value: "−11.8" },
    { id: "vegetation", label: "Vegetation stress", unit: "NDVI anomaly", color: "#c5e86c", value: "−0.23" }
  ],
  "Persistent drought": [
    { id: "drought", label: "Drought intensity", unit: "SPEI index", color: "#ef8b5a", value: "−1.8" },
    { id: "rainfall", label: "Rainfall", unit: "% anomaly", color: "#5da9ff", value: "−28.4" },
    { id: "moisture", label: "Soil moisture", unit: "% anomaly", color: "#47d7ff", value: "−16.1" }
  ],
  "El Niño / La Niña": [
    { id: "sst", label: "Sea surface temperature", unit: "°C anomaly", color: "#ff7f66", value: "+1.7" },
    { id: "rainfall", label: "Rainfall", unit: "% anomaly", color: "#5da9ff", value: "+18.2" },
    { id: "wind", label: "Trade wind velocity", unit: "m/s anomaly", color: "#bb9cff", value: "−2.1" }
  ],
  "Marine heatwaves": [
    { id: "sst", label: "Sea surface temperature", unit: "°C anomaly", color: "#ff7f66", value: "+2.1" },
    { id: "stress", label: "Thermal stress", unit: "DHW", color: "#ffb061", value: "8.7" },
    { id: "chlorophyll", label: "Chlorophyll-a", unit: "% anomaly", color: "#b1e36c", value: "−19.4" }
  ]
};

const state = {
  phenomenon: "Urban heat islands",
  region: regions[0],
  variableIndex: 0,
  view: "global",
  dataMode: "history",
  dateIndex: 9,
  playing: false,
  speed: 1,
  query: "",
  showPhenomena: false,
  compare: false
};

const years = ["2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"];
const selectedVariable = () => (variables[state.phenomenon] || variables["Urban heat islands"])[state.variableIndex % (variables[state.phenomenon] || variables["Urban heat islands"]).length];
const selectedPhenomenon = () => phenomena.find((item) => item.name === state.phenomenon) || phenomena[0];
const seeded = (n) => Math.sin(n * 12.9898) * 43758.5453 - Math.floor(Math.sin(n * 12.9898) * 43758.5453);

function series(offset = 0) {
  return years.map((year, index) => ({
    year,
    value: 30 + Math.sin(index * 0.9 + offset) * 7 + index * 1.15 + seeded(index + offset) * 3
  }));
}

function appTemplate() {
  const variable = selectedVariable();
  const results = [...phenomena].filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(state.query.toLowerCase()));
  return `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand"><div class="brand-mark"><span></span><span></span><span></span></div><div><strong>ASAN</strong><small>EARTH SYSTEM INTELLIGENCE</small></div></div>
        <nav class="topnav" aria-label="Primary">
          ${["Explore", "Investigate", "Compare", "Discover"].map((item, index) => `<button class="${index === 0 ? "active" : ""}" data-nav="${item}">${item}</button>`).join("")}
        </nav>
        <div class="top-actions"><span class="live-dot"></span><span class="status-text">DEMO DATA / LIVE SIMULATION</span><button class="icon-btn" data-action="toggle-theme" aria-label="Toggle display density">◒</button><button class="avatar">A</button></div>
      </header>
      <main class="workspace">
        <aside class="left-rail">
          <div class="rail-scroll">
            <section class="search-wrap"><label for="search">FIND A SIGNAL</label><div class="search-box"><span>⌕</span><input id="search" placeholder="Region or phenomenon" value="${state.query}" /><kbd>⌘ K</kbd></div></section>
            <section class="rail-section"><div class="section-title"><span>EARTH SYSTEM</span><button class="chevron">⌃</button></div><div class="category-list">${categories.map(([category, items]) => `<button class="category-button ${category === selectedPhenomenon().category ? "selected" : ""}" data-category="${category}"><span class="category-dot dot-${category.split(" ")[0].toLowerCase()}"></span>${category}<span class="count">${items.length}</span></button>`).join("")}</div></section>
            <section class="rail-section"><div class="section-title"><span>ACTIVE PHENOMENON</span><span class="mini-status">01 / 36</span></div><button class="phenomenon-select" data-action="open-phenomena"><span class="phenomenon-icon">◈</span><span><strong>${state.phenomenon}</strong><small>${selectedPhenomenon().category} · ${state.view} scale</small></span><span>⌄</span></button></section>
            <section class="rail-section"><div class="section-title"><span>VISIBLE VARIABLES</span><button class="chevron">⌃</button></div><div class="variable-list">${(variables[state.phenomenon] || variables["Urban heat islands"]).map((item, index) => `<button class="variable-row ${index === state.variableIndex ? "active" : ""}" data-variable="${index}"><span class="check ${index === state.variableIndex ? "on" : ""}">✓</span><span class="var-swatch" style="background:${item.color}"></span><span>${item.label}</span><b>${item.unit}</b></button>`).join("")}</div></section>
            <section class="rail-section"><div class="section-title"><span>QUICK INVESTIGATIONS</span></div><div class="quick-list"><button data-preset="Heat → drought → fire"><span>↗</span>Heat → drought → fire</button><button data-preset="El Niño teleconnections"><span>◌</span>El Niño teleconnections</button><button data-preset="Coral thermal stress"><span>◇</span>Coral thermal stress</button></div></section>
          </div>
          <div class="rail-footer"><span class="sync-ring"></span><span>ADAPTER READY<br><b>NASA DATA CONNECTOR</b></span><span class="help">?</span></div>
        </aside>
        <section class="center-stage">
          <div class="stage-head"><div><div class="crumbs">EXPLORER <span>/</span> ${selectedPhenomenon().category.toUpperCase()}</div><h1>${state.phenomenon}</h1><p>Explore the pattern. Follow the evidence.</p></div><div class="stage-actions"><button class="view-toggle ${state.view === "global" ? "selected" : ""}" data-view="global">◉ Global</button><button class="view-toggle ${state.view === "local" ? "selected" : ""}" data-view="local">⌖ Local</button><button class="round-btn" data-action="toggle-compare">⇄</button></div></div>
          <div class="map-frame"><canvas id="globe" aria-label="Interactive synthetic Earth visualization"></canvas><div class="map-grid"></div><div class="map-label label-north">N 34° 12′ 08″</div><div class="map-label label-east">E 118° 14′ 37″</div><div class="map-hud"><span class="hud-pill"><i></i> ${state.dataMode.toUpperCase()}</span><span>◈ ${state.view.toUpperCase()} VIEW</span><span>◷ ${years[state.dateIndex]}</span></div><div class="map-controls"><button data-action="zoom-out">−</button><button data-action="reset-globe">◎</button><button data-action="zoom-in">+</button></div><div class="globe-tooltip"><span class="tooltip-line"></span><strong>${state.region.short}</strong><small>${variable.label} <b>${variable.value}</b></small></div><div class="legend"><span>LOW</span><div class="legend-bar"></div><span>HIGH</span><b>${variable.unit}</b></div></div>
          <div class="timeline-panel"><div class="timeline-top"><div><span class="eyebrow">TIME MACHINE</span><strong>${years[state.dateIndex]} <span>—</span> Present</strong></div><div class="timeline-mode">${["history", "latest", "forecast", "scenario"].map((mode) => `<button class="${state.dataMode === mode ? "active" : ""}" data-mode="${mode}">${mode}</button>`).join("")}</div><div class="timeline-controls"><button data-action="step-back">‹</button><button class="play-btn ${state.playing ? "playing" : ""}" data-action="toggle-play">${state.playing ? "Ⅱ" : "▶"}</button><button data-action="step-forward">›</button><button data-action="speed">${state.speed}×</button></div></div><div class="range-wrap"><span>2015</span><input type="range" min="0" max="10" value="${state.dateIndex}" id="timeline" /><span>2025</span><div class="event-markers"><i style="left:25%"></i><i style="left:58%"></i><i style="left:80%"></i></div></div><div class="event-row"><span>EVENT MARKERS</span><button data-action="jump-event">2020 · Western heat dome <span>→</span></button><button>2023 · El Niño onset <span>→</span></button><span class="timeline-note">Synthetic fixture · no interpolation shown as observation</span></div></div>
          <div class="chart-panel"><div class="panel-title"><div><span class="eyebrow">TREND DETECTIVE</span><h2>${variable.label} <small>${variable.unit}</small></h2></div><div class="chart-meta"><span class="trend-up">↗ +0.84 / decade</span><button class="text-btn" data-action="expand-chart">View analysis ↗</button></div></div><div class="chart-area"><svg id="trend-chart" viewBox="0 0 760 170" preserveAspectRatio="none" role="img" aria-label="Synthetic trend chart"></svg><div class="chart-axis"><span>2015</span><span>2017</span><span>2019</span><span>2021</span><span>2023</span><span>2025</span></div></div></div>
        </section>
        <aside class="right-inspector"><div class="inspector-head"><div><span class="eyebrow">LOCATION INSPECTOR</span><h2>${state.region.name}</h2><p>${state.region.tag} · ${state.view} scale</p></div><button class="close-btn">×</button></div><div class="inspector-tabs"><button class="active">Signal</button><button>Context</button><button>Evidence</button></div><section class="metric-hero"><div class="metric-label">${variable.label}<span>ⓘ</span></div><div class="metric-value">${variable.value}<small>${variable.unit}</small></div><div class="metric-delta"><span>↗ 18.6%</span> vs. 2015 baseline</div><div class="sparkline">${Array.from({ length: 24 }, (_, i) => `<i style="height:${25 + ((i * 13) % 46)}%"></i>`).join("")}</div></section><section class="inspector-section"><div class="section-title"><span>THE SIGNAL</span><span class="confidence">94% confidence</span></div><p class="insight-copy">The selected area is trending warmer than its baseline. Heat stress appears alongside declining soil moisture in this synthetic demonstration.</p><div class="significance"><span>↗</span><div><strong>Increasing over selected period</strong><small>Evidence of a trend at α = 0.05</small></div></div></section><section class="inspector-section"><div class="section-title"><span>ML INTELLIGENCE</span><button class="chevron">⌃</button></div><div class="ml-row"><span class="ml-icon violet">✦</span><div><strong>Anomaly detected</strong><small>2020 heat dome · score 0.91</small></div><button data-action="jump-event">→</button></div><div class="ml-row"><span class="ml-icon blue">↗</span><div><strong>Forecast explorer</strong><small>+2.7°C by 2030 · modeled demo</small></div><button>→</button></div><div class="ml-row"><span class="ml-icon green">◈</span><div><strong>Connected variables</strong><small>Soil moisture · vegetation stress</small></div><button>→</button></div></section><section class="inspector-section source"><div class="section-title"><span>DATA PROVENANCE</span><span class="demo-badge">DEMO</span></div><p>Deterministic synthetic fixture<br><b>Adapter: EarthSignalMock v0.4</b></p><button class="outline-btn" data-action="source">View methodology <span>↗</span></button></section></aside>
      </main>
      ${state.showPhenomena ? `<div class="modal-backdrop" data-action="close-phenomena"><div class="phenomena-modal" onclick="event.stopPropagation()"><div class="modal-head"><div><span class="eyebrow">PHENOMENON REGISTRY</span><h2>Choose a signal</h2></div><button class="close-btn" data-action="close-phenomena">×</button></div><div class="modal-search"><span>⌕</span><input id="phenomenon-search" placeholder="Search 36 phenomena" value="${state.query}" /></div><div class="phenomena-grid">${results.map((item) => `<button class="phenomenon-option ${item.name === state.phenomenon ? "selected" : ""}" data-phenomenon="${item.name}"><span class="option-glyph">${item.category === "Oceans & coasts" ? "◇" : item.category === "Water" ? "≈" : item.category === "Cryosphere" ? "✧" : item.category === "Land & ecosystems" ? "⌁" : "◌"}</span><span><strong>${item.name}</strong><small>${item.category}</small></span><span class="option-arrow">→</span></button>`).join("")}</div></div></div>` : ""}
    </div>`;
}

function drawGlobe() {
  const canvas = document.querySelector("#globe");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height, cx = w * 0.53, cy = h * 0.51, radius = Math.min(w, h) * 0.36;
  const glow = ctx.createRadialGradient(cx - radius * .25, cy - radius * .3, radius * .1, cx, cy, radius * 1.15);
  glow.addColorStop(0, "#183a5f"); glow.addColorStop(.58, "#0b2745"); glow.addColorStop(1, "#07101d");
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = "rgba(102, 188, 220, .12)"; ctx.lineWidth = 1;
  for (let i = -4; i <= 4; i++) { const y = cy + i * radius / 5; ctx.beginPath(); ctx.ellipse(cx, y, radius * Math.sqrt(Math.max(.04, 1 - (i/5) ** 2)), radius * .17, 0, 0, Math.PI * 2); ctx.stroke(); }
  for (let i = -5; i <= 5; i++) { const x = cx + i * radius / 5; ctx.beginPath(); ctx.ellipse(x, cy, radius * .17, radius * Math.sqrt(Math.max(.04, 1 - (i/5) ** 2)), 0, 0, Math.PI * 2); ctx.stroke(); }
  const v = selectedVariable();
  const field = ctx.createRadialGradient(cx - radius * .18, cy + radius * .1, 0, cx, cy, radius);
  field.addColorStop(0, v.color + "b8"); field.addColorStop(.48, v.color + "35"); field.addColorStop(1, "transparent");
  ctx.fillStyle = field; ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  for (let i = 0; i < 38; i++) {
    const angle = seeded(i + state.dateIndex) * Math.PI * 2, dist = Math.sqrt(seeded(i * 3.1 + 4)) * radius * .9;
    const px = cx + Math.cos(angle) * dist, py = cy + Math.sin(angle) * dist * .65;
    const size = 2 + seeded(i + 8) * 5;
    ctx.fillStyle = v.color + (i % 3 === 0 ? "c8" : "68"); ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill();
  }
  regions.forEach((region, i) => {
    const px = cx + ((region.lon + 10) / 180) * radius * .62, py = cy - region.lat / 90 * radius * .82;
    ctx.fillStyle = i === regions.indexOf(state.region) ? "#fff" : "#71e5ff"; ctx.shadowColor = "#71e5ff"; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(px, py, i === regions.indexOf(state.region) ? 5 : 3, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  });
  ctx.restore();
  ctx.strokeStyle = "rgba(94, 210, 255, .33)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(115, 228, 255, .7)"; ctx.font = "10px ui-monospace"; ctx.fillText("EARTH OBSERVATORY / SYNTHETIC FIELD", 20, h - 24);
}

function drawChart() {
  const svg = document.querySelector("#trend-chart"); if (!svg) return;
  const points = series(state.variableIndex * 1.7), min = 15, max = 60;
  const line = points.map((p, i) => `${i * 76},${160 - (p.value - min) / (max - min) * 140}`).join(" ");
  const area = `${line} 760,160 0,160`;
  svg.innerHTML = `<defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${selectedVariable().color}" stop-opacity=".35"/><stop offset="1" stop-color="${selectedVariable().color}" stop-opacity="0"/></linearGradient></defs><path class="area" d="M ${area}" fill="url(#chartFill)"/><polyline class="trend-line" points="${line}" fill="none" stroke="${selectedVariable().color}" stroke-width="2.5"/><line class="baseline" x1="0" y1="93" x2="760" y2="93"/><circle cx="${state.dateIndex * 76}" cy="${160 - (points[state.dateIndex].value - min) / (max - min) * 140}" r="5" fill="#fff" stroke="${selectedVariable().color}" stroke-width="3"/>`;
}

function render() { document.querySelector("#app").innerHTML = appTemplate(); drawGlobe(); drawChart(); bindEvents(); }

function bindEvents() {
  document.querySelector("#search")?.addEventListener("input", (event) => { state.query = event.target.value; });
  document.querySelector("#search")?.addEventListener("keydown", (event) => { if (event.key === "Enter") { const found = regions.find((r) => r.name.toLowerCase().includes(state.query.toLowerCase())); if (found) { state.region = found; state.query = ""; render(); } else { state.showPhenomena = true; render(); document.querySelector("#phenomenon-search")?.focus(); } } });
  document.querySelector("#timeline")?.addEventListener("input", (event) => { state.dateIndex = Number(event.target.value); render(); });
  document.querySelectorAll("[data-variable]").forEach((el) => el.addEventListener("click", () => { state.variableIndex = Number(el.dataset.variable); render(); }));
  document.querySelectorAll("[data-view]").forEach((el) => el.addEventListener("click", () => { state.view = el.dataset.view; render(); }));
  document.querySelectorAll("[data-mode]").forEach((el) => el.addEventListener("click", () => { state.dataMode = el.dataset.mode; render(); }));
  document.querySelectorAll("[data-phenomenon]").forEach((el) => el.addEventListener("click", () => { state.phenomenon = el.dataset.phenomenon; state.variableIndex = 0; state.showPhenomena = false; state.query = ""; render(); }));
  document.querySelectorAll("[data-preset]").forEach((el) => el.addEventListener("click", () => { if (el.dataset.preset.includes("El Niño")) state.phenomenon = "El Niño / La Niña"; else if (el.dataset.preset.includes("Coral")) state.phenomenon = "Coral thermal stress"; else state.phenomenon = "Urban heat islands"; state.variableIndex = 0; render(); }));
  document.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", () => {
    const action = el.dataset.action;
    if (action === "open-phenomena") state.showPhenomena = true;
    if (action === "close-phenomena") state.showPhenomena = false;
    if (action === "toggle-compare") state.compare = !state.compare;
    if (action === "toggle-play") { state.playing = !state.playing; if (state.playing) { state.timer = setInterval(() => { state.dateIndex = state.dateIndex >= 10 ? 0 : state.dateIndex + 1; render(); }, 900 / state.speed); } else clearInterval(state.timer); }
    if (action === "step-back") state.dateIndex = Math.max(0, state.dateIndex - 1);
    if (action === "step-forward") state.dateIndex = Math.min(10, state.dateIndex + 1);
    if (action === "speed") { state.speed = state.speed >= 4 ? .5 : state.speed * 2; if (state.playing) { clearInterval(state.timer); state.playing = false; } }
    if (action === "jump-event") state.dateIndex = 5;
    if (action === "reset-globe") state.region = regions[0];
    if (action === "source") alert("Synthetic demo fixture. Real NASA observations can be connected through the EarthSignalAdapter interface without changing visualization components.");
    render();
  }));
  document.querySelector("#phenomenon-search")?.addEventListener("input", (event) => { state.query = event.target.value; render(); document.querySelector(".phenomena-modal #phenomenon-search")?.focus(); });
  const canvas = document.querySelector("#globe");
  let dragging = false;
  canvas?.addEventListener("pointerdown", (event) => { dragging = true; canvas.setPointerCapture?.(event.pointerId); });
  canvas?.addEventListener("pointerup", () => { dragging = false; });
  canvas?.addEventListener("pointermove", (event) => { if (dragging) { document.querySelector(".globe-tooltip").style.transform = `translate(${Math.max(-20, Math.min(20, event.movementX))}px, ${Math.max(-20, Math.min(20, event.movementY))}px)`; } });
  window.addEventListener("resize", drawGlobe, { once: true });
}

render();
