import type { Viewer, ScreenSpaceEventHandler, Entity, Cartesian2, Cartesian3 } from 'cesium';
import { loadCesium, basemap, terrain, ionToken, type Engine } from './providers';
import { LayerRenderer } from './layers';
import type { Coordinate, EnvironmentalLayer, StudyArea } from './types';
export class EarthMap {
  C!: Engine; viewer!: Viewer; layers!: LayerRenderer;
  private handler?: ScreenSpaceEventHandler;
  private selected: Entity[] = [];
  private drawing: 'rectangle' | 'polygon' | null = null;
  private vertices: Coordinate[] = [];
  private preview?: Entity;
  private lastLayer?: EnvironmentalLayer;
  private tooClose = false;
  private style: 'satellite' | 'map' = 'satellite';
  constructor(private element: HTMLElement, private onSelect: (area: StudyArea) => void, private onStatus: (text: string, error?: boolean) => void, private onReadout: (text: string, scale: string) => void, private onDrawEnd: () => void) {}
  async initialize() {
    const C = this.C = await loadCesium();
    C.Ion.defaultAccessToken = ionToken;
    this.viewer = new C.Viewer(this.element, {
      baseLayer: false, baseLayerPicker: false, terrainProvider: new C.EllipsoidTerrainProvider(),
      animation: false, timeline: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      requestRenderMode: true, maximumRenderTimeChange: Infinity,
      contextOptions: { webgl: { alpha: false } },
    });
    const v = this.viewer;
    v.scene.backgroundColor = C.Color.fromCssColorString('#10191d');
    v.scene.globe.baseColor = C.Color.fromCssColorString('#263e47');
    v.scene.globe.enableLighting = false;
    v.scene.globe.maximumScreenSpaceError = 1.5;
    v.scene.screenSpaceCameraController.minimumZoomDistance = 100;
    v.scene.screenSpaceCameraController.maximumZoomDistance = 40000000;
    v.resolutionScale = Math.min(window.devicePixelRatio, 1.5);
    if (v.scene.skyBox) v.scene.skyBox.show = false;
    if (v.scene.sun) v.scene.sun.show = false; if (v.scene.moon) v.scene.moon.show = false;
    this.layers = new LayerRenderer(C, v);
    this.reset(false);
    v.scene.requestRender();
    const remove = v.scene.postRender.addEventListener(() => {
      if (v.scene.globe.tilesLoaded) { remove(); this.onStatus('Earth is ready'); }
    });
    this.handler = new C.ScreenSpaceEventHandler(v.scene.canvas);
    v.cesiumWidget.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    const T = C.ScreenSpaceEventType;
    this.handler.setInputAction((e: {position: Cartesian2}) => this.down(e.position), T.LEFT_DOWN);
    this.handler.setInputAction((e: {endPosition: Cartesian2}) => this.move(e.endPosition), T.MOUSE_MOVE);
    this.handler.setInputAction((e: {position: Cartesian2}) => this.up(e.position), T.LEFT_UP);
    this.handler.setInputAction((e: {position: Cartesian2}) => this.click(e.position), T.LEFT_CLICK);
    this.handler.setInputAction(() => this.finishPolygon(), T.LEFT_DOUBLE_CLICK);
    this.handler.setInputAction(() => this.finishPolygon(), T.RIGHT_CLICK);
    v.camera.moveEnd.addEventListener(() => this.readout());
    v.scene.renderError.addEventListener(() => this.onStatus('The 3D renderer stopped. Check WebGL support, then reload.', true));
    this.readout();
    const results = await Promise.allSettled([this.setStyle('satellite'), terrain(C)]);
    if (results[1].status === 'fulfilled') {
      v.terrainProvider = results[1].value;
      v.terrainProvider.errorEvent.addEventListener(() => this.onStatus('Terrain tiles failed. Check ion permissions and network access.', true));
    } else this.onStatus('World Terrain unavailable. Check ion assets:read access and allowed URLs. Ellipsoid terrain is active.', true);
    if (results[0].status === 'rejected') this.onStatus('Satellite imagery unavailable. Check your ion token and imagery asset. Select Map in settings for OpenStreetMap.', true);
    else if (results[1].status === 'fulfilled') this.onStatus(ionToken ? 'Satellite imagery · Cesium World Terrain' : 'NASA overview · add ion token for detailed imagery + 3D terrain');
    v.scene.requestRender();
  }
  async setStyle(style: 'satellite' | 'map') {
    const provider = await basemap(this.C, style);
    provider.errorEvent.addEventListener(() => this.onStatus('Map tiles could not load. Check provider access or select another map style.', true));
    this.viewer.imageryLayers.removeAll();
    this.viewer.imageryLayers.addImageryProvider(provider); this.style = style;
    this.viewer.scene.requestRender();
  }
  toggleStyle() { return this.setStyle(this.style === 'satellite' ? 'map' : 'satellite'); }
  private duration() { return matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.5; }
  reset(animate = true) {
    const options = {destination: this.C.Cartesian3.fromDegrees(-30, 22, 19000000), duration: animate ? this.duration() : 0};
    if (animate) this.viewer.camera.flyTo(options); else this.viewer.camera.setView(options);
  }
  flyTo(area: StudyArea) {
    if (area.kind === 'global') return this.reset();
    const destination = area.bounds ? this.C.Rectangle.fromDegrees(...area.bounds) : this.C.Cartesian3.fromDegrees(area.lon, area.lat, 100000);
    this.viewer.camera.flyTo({destination, duration: this.duration()});
  }
  zoom(direction: number) { this.viewer.camera.zoomIn(direction * this.viewer.camera.positionCartographic.height * 0.45); this.viewer.scene.requestRender(); this.readout(); }
  tilt() { this.viewer.camera.lookUp(this.C.Math.toRadians(15)); this.viewer.scene.requestRender(); }
  private pick(position: Cartesian2): Coordinate | undefined {
    const ray = this.viewer.camera.getPickRay(position);
    const world = ray && this.viewer.scene.globe.pick(ray, this.viewer.scene);
    if (!world) return;
    const c = this.C.Cartographic.fromCartesian(world);
    return [this.C.Math.toDegrees(c.longitude), this.C.Math.toDegrees(c.latitude)];
  }
  /** Live hint shown while drawing, e.g. "≈ 54 × 61 km". */
  onProgress: (text: string) => void = () => {};
  private draft: Entity[] = [];
  private corner?: Coordinate; private downAt?: Cartesian2; private cursor?: Coordinate;
  private click(position: Cartesian2) {
    const p = this.pick(position); if (!p) return;
    if (!this.drawing) return this.onSelect({name: `${p[1].toFixed(3)}°, ${p[0].toFixed(3)}°`, kind: 'point', lon: p[0], lat: p[1]});
    if (this.drawing !== 'polygon') return;
    if (this.vertices.length >= 3 && this.nearFirst(position)) return this.finishPolygon();
    this.vertices.push(p); this.cursor = p; this.renderDraft();
  }
  // Rectangle: press-drag-release, or click two opposite corners.
  private down(position: Cartesian2) { if (this.drawing === 'rectangle') { this.downAt = position; if (!this.vertices.length) this.corner = this.pick(position); this.cursor = this.corner; } }
  private move(position: Cartesian2) {
    if (!this.drawing) return;
    this.cursor = this.pick(position) ?? this.cursor; this.renderDraft();
  }
  private up(position: Cartesian2) {
    if (this.drawing !== 'rectangle' || !this.corner || !this.downAt) return;
    const end = this.pick(position) ?? this.cursor; if (!end) return; // released off the globe: use the last point on it
    const moved = Math.hypot(position.x - this.downAt.x, position.y - this.downAt.y) > 6;
    if (!moved && this.vertices.length === 0) { this.vertices = [this.corner]; this.onProgress('Click the opposite corner'); return; } // first of two clicks
    this.finishRectangle(this.vertices[0] ?? this.corner, end);
  }
  private finishRectangle(a: Coordinate, b: Coordinate) {
    if (Math.abs(a[0] - b[0]) > 180) { this.onStatus('Draw areas on one side of the date line; choose Worldwide for global scope.', true); this.cancelDraw(); return; }
    const bounds: [number, number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const [w, h] = dimsKm(bounds);
    if (w < 1 || h < 1) { this.onStatus('That box is too small. Drag a larger area.', true); this.vertices = []; this.corner = undefined; this.renderDraft(); return; }
    this.onSelect({name: `Drawn box (${fmtKm(w)} × ${fmtKm(h)})`, kind: 'region', lon: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2, bounds}); this.cancelDraw(); this.onDrawEnd();
  }
  draw(mode: 'rectangle' | 'polygon') {
    this.cancelDraw(); this.drawing = mode; this.element.classList.add('drawing');
    this.viewer.scene.screenSpaceCameraController.enableInputs = mode !== 'rectangle'; // drag draws instead of panning
    this.onProgress(mode === 'rectangle' ? 'Press and drag to draw a box' : 'Click to place the first point');
  }
  cancelDraw() {
    this.drawing = null; this.vertices = []; this.corner = undefined; this.downAt = undefined; this.cursor = undefined;
    this.element.classList.remove('drawing'); this.viewer.scene.screenSpaceCameraController.enableInputs = true; this.clearDraft();
  }
  undo() { this.vertices.pop(); if (!this.vertices.length) this.corner = undefined; this.renderDraft(); }
  private nearFirst(position: Cartesian2) {
    const first = this.vertices[0], pos = this.C.SceneTransforms.worldToWindowCoordinates(this.viewer.scene, this.C.Cartesian3.fromDegrees(first[0], first[1]));
    return !!pos && Math.hypot(pos.x - position.x, pos.y - position.y) < 14;
  }
  finishPolygon() {
    if (this.drawing !== 'polygon') return;
    // A double-click also fires two single clicks that add duplicate vertices; drop them.
    const v = this.vertices.filter((p, i) => i === 0 || p[0] !== this.vertices[i - 1][0] || p[1] !== this.vertices[i - 1][1]);
    if (v.length < 3) { this.onStatus('Add at least three points to close the shape.', true); return; }
    const xs = v.map(p => p[0]), ys = v.map(p => p[1]);
    const bounds: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const [w, h] = dimsKm(bounds);
    if (bounds[2] - bounds[0] > 180 || w < 1 || h < 1) { this.onStatus('Choose a larger shape that does not cross the date line.', true); return; }
    this.onSelect({name: `Drawn shape (≈ ${fmtArea(polygonKm2(v))})`, kind: 'region', lon: (bounds[0] + bounds[2]) / 2, lat: (bounds[1] + bounds[3]) / 2, bounds, polygon: [...v]}); this.cancelDraw(); this.onDrawEnd();
  }
  private clearDraft() { for (const e of this.draft) this.viewer.entities.remove(e); this.draft = []; this.viewer.scene.requestRender(); }
  private renderDraft() {
    const C = this.C, gold = C.Color.fromCssColorString('#f0cb87'), dark = C.Color.fromCssColorString('#182326');
    for (const e of this.draft) this.viewer.entities.remove(e); this.draft = [];
    const add = (o: object) => this.draft.push(this.viewer.entities.add(o as Entity));
    const dot = (p: Coordinate, size: number) => add({position: C.Cartesian3.fromDegrees(p[0], p[1]), point: {pixelSize: size, color: gold, outlineColor: dark, outlineWidth: 2, disableDepthTestDistance: Infinity}});
    if (this.drawing === 'rectangle') {
      const a = this.vertices[0] ?? (this.downAt ? this.corner : undefined), b = this.cursor;
      if (!a) { this.viewer.scene.requestRender(); return; }
      dot(a, 9);
      if (!b) return;
      const bounds: [number, number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      const ring: Coordinate[] = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]], [bounds[0], bounds[1]]];
      add({rectangle: {coordinates: C.Rectangle.fromDegrees(...bounds), material: gold.withAlpha(0.22), classificationType: C.ClassificationType.TERRAIN}});
      add({polyline: {positions: C.Cartesian3.fromDegreesArray(ring.flat()), width: 3, material: gold, clampToGround: true}});
      const [w, h] = dimsKm(bounds); this.onProgress(`≈ ${fmtKm(w)} × ${fmtKm(h)}${this.vertices.length ? ' · click to confirm' : ' · release to confirm'}`);
    } else if (this.drawing === 'polygon') {
      const pts = this.vertices; if (!pts.length) { this.viewer.scene.requestRender(); return; }
      const path = this.cursor ? [...pts, this.cursor] : pts;
      if (path.length >= 3) add({polygon: {hierarchy: C.Cartesian3.fromDegreesArray(path.flat()), material: gold.withAlpha(0.18), classificationType: C.ClassificationType.TERRAIN}});
      add({polyline: {positions: C.Cartesian3.fromDegreesArray([...path, ...(path.length >= 3 ? [pts[0]] : [])].flat()), width: 3, material: gold, clampToGround: true}});
      pts.forEach((p, i) => dot(p, i === 0 && pts.length >= 3 ? 14 : 9));
      this.onProgress(pts.length < 3 ? `${pts.length} point${pts.length === 1 ? '' : 's'} · add ${3 - pts.length} more` : `${pts.length} points · ≈ ${fmtArea(polygonKm2(pts))} · click the first point or double-click to finish`);
    }
    this.viewer.scene.requestRender();
  }
  select(area?: StudyArea) {
    for (const e of this.selected) this.viewer.entities.remove(e); this.selected = [];
    if (!area || area.kind === 'global') { this.viewer.scene.requestRender(); return; }
    const C = this.C, color = C.Color.fromCssColorString('#f0cb87');
    if (area.kind === 'point') this.selected.push(this.viewer.entities.add({position: C.Cartesian3.fromDegrees(area.lon, area.lat), point: {pixelSize: 10, color, outlineColor: C.Color.fromCssColorString('#182326'), outlineWidth: 3, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity}}));
    else {
      const b = area.bounds!, coords = area.polygon || [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
      this.selected.push(this.viewer.entities.add({polygon: {hierarchy: C.Cartesian3.fromDegreesArray(coords.flat()), material: color.withAlpha(0.12), classificationType: C.ClassificationType.TERRAIN}}));
      this.selected.push(this.viewer.entities.add({polyline: {positions: C.Cartesian3.fromDegreesArray([...coords, coords[0]].flat()), width: 3, material: color, clampToGround: true}}));
    }
    this.viewer.scene.requestRender();
  }
  renderLayer(layer?: EnvironmentalLayer) { this.lastLayer = layer; if (!layer) this.layers.clear(); else this.layers.render({...layer, visible: layer.visible && !this.tooClose}); }
  private readout() {
    const C = this.C, canvas = this.viewer.scene.canvas;
    const center = this.pick(new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    const left = this.pick(new C.Cartesian2(canvas.clientWidth / 2 - 40, canvas.clientHeight * 0.7));
    const right = this.pick(new C.Cartesian2(canvas.clientWidth / 2 + 40, canvas.clientHeight * 0.7));
    let scale = 'Scale unavailable';
    if (left && right) {
      const d = new C.EllipsoidGeodesic(C.Cartographic.fromDegrees(...left), C.Cartographic.fromDegrees(...right)).surfaceDistance;
      scale = d > 1000 ? `${Math.round(d / 1000).toLocaleString()} km` : `${Math.round(d)} m`;
    }
    this.onReadout(center ? `${Math.abs(center[1]).toFixed(2)}° ${center[1] >= 0 ? 'N' : 'S'}  ${Math.abs(center[0]).toFixed(2)}° ${center[0] >= 0 ? 'E' : 'W'}` : 'Earth view', scale);
    if (this.lastLayer?.cells.length) {
      const cell = this.lastLayer.cells[0];
      const close = this.viewer.camera.positionCartographic.height < Math.max(cell.bounds[2] - cell.bounds[0], cell.bounds[3] - cell.bounds[1]) * 111000 * 0.8;
      if (close !== this.tooClose) { this.tooClose = close; this.layers.render({...this.lastLayer, visible: this.lastLayer.visible && !close}); this.onStatus(close ? 'Measurement layer hidden at this zoom · grid is too coarse for street-level interpretation' : (ionToken ? 'Satellite imagery · Cesium World Terrain' : 'NASA overview · ellipsoid terrain')); }
    }
  }
  focus() { this.viewer.scene.canvas.focus(); }
  destroy() { this.handler?.destroy(); if (this.viewer && !this.viewer.isDestroyed()) this.viewer.destroy(); }
}

const KM = 111.32;
export function dimsKm(b: [number, number, number, number]): [number, number] { return [(b[2] - b[0]) * KM * Math.cos((b[1] + b[3]) / 2 * Math.PI / 180), (b[3] - b[1]) * KM]; }
export const fmtKm = (km: number) => km >= 10 ? `${Math.round(km).toLocaleString()} km` : `${km.toFixed(1)} km`;
export const fmtArea = (km2: number) => `${km2 >= 10 ? Math.round(km2).toLocaleString() : km2.toFixed(1)} km²`;
// Shoelace area on a local equirectangular projection; accurate to a few percent for study-sized shapes.
export function polygonKm2(v: Coordinate[]): number {
  const lat0 = v.reduce((a, p) => a + p[1], 0) / v.length, k = Math.cos(lat0 * Math.PI / 180);
  let sum = 0; for (let i = 0; i < v.length; i++) { const [x1, y1] = v[i], [x2, y2] = v[(i + 1) % v.length]; sum += x1 * k * y2 - x2 * k * y1; }
  return Math.abs(sum) / 2 * KM * KM;
}
