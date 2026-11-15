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
    this.handler.setInputAction((event: {position: Cartesian2}) => this.click(event.position), C.ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction(() => this.finishPolygon(), C.ScreenSpaceEventType.RIGHT_CLICK);
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
  private click(position: Cartesian2) {
    const p = this.pick(position); if (!p) return;
    if (!this.drawing) return this.onSelect({name: `${p[1].toFixed(3)}°, ${p[0].toFixed(3)}°`, kind: 'point', lon: p[0], lat: p[1]});
    this.vertices.push(p);
    if (this.drawing === 'rectangle' && this.vertices.length === 2) {
      const [a, b] = this.vertices;
      if (Math.abs(a[0] - b[0]) > 180) { this.onStatus('Draw areas on one side of the date line; choose Worldwide for global scope.', true); this.cancelDraw(); return; }
      const bounds: [number, number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      if (bounds[2] - bounds[0] < 0.001 || bounds[3] - bounds[1] < 0.001) return;
      this.onSelect({name: 'Drawn rectangle', kind: 'region', lon: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2, bounds}); this.cancelDraw(); this.onDrawEnd();
    } else this.drawPreview();
  }
  draw(mode: 'rectangle' | 'polygon') { this.cancelDraw(); this.drawing = mode; this.element.classList.add('drawing'); }
  cancelDraw() { this.drawing = null; this.vertices = []; this.element.classList.remove('drawing'); if (this.preview) this.viewer.entities.remove(this.preview); this.preview = undefined; }
  finishPolygon() {
    if (this.drawing !== 'polygon' || this.vertices.length < 3) return;
    const xs = this.vertices.map(v => v[0]), ys = this.vertices.map(v => v[1]);
    const bounds: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    if (bounds[2] - bounds[0] > 180 || bounds[2] - bounds[0] < 0.001 || bounds[3] - bounds[1] < 0.001) { this.onStatus('Choose a nonzero polygon that does not cross the date line.', true); return; }
    this.onSelect({name: 'Drawn polygon', kind: 'region', lon: (bounds[0] + bounds[2]) / 2, lat: (bounds[1] + bounds[3]) / 2, bounds, polygon: [...this.vertices]}); this.cancelDraw(); this.onDrawEnd();
  }
  private drawPreview() {
    if (this.preview) this.viewer.entities.remove(this.preview);
    const positions = this.C.Cartesian3.fromDegreesArray(this.vertices.flat());
    if (positions.length === 1) this.preview = this.viewer.entities.add({position: positions[0], point: {pixelSize: 8, color: this.C.Color.WHITE}});
    else this.preview = this.viewer.entities.add({polyline: {positions, width: 2, material: this.C.Color.WHITE}});
    this.viewer.scene.requestRender();
  }
  select(area?: StudyArea) {
    for (const e of this.selected) this.viewer.entities.remove(e); this.selected = [];
    if (!area || area.kind === 'global') { this.viewer.scene.requestRender(); return; }
    const C = this.C, color = C.Color.fromCssColorString('#f0cb87');
    if (area.kind === 'point') this.selected.push(this.viewer.entities.add({position: C.Cartesian3.fromDegrees(area.lon, area.lat), point: {pixelSize: 10, color, outlineColor: C.Color.fromCssColorString('#182326'), outlineWidth: 3, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity}}));
    else {
      const b = area.bounds!, coords = area.polygon || [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
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
