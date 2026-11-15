import type { Viewer, Entity } from 'cesium';
import type { Engine } from './providers';
import type { EnvironmentalLayer } from './types';
export const sequential = ['#fff0b4', '#fbc66b', '#ed884a', '#c34435', '#7e2636'];
export const diverging = ['#795233', '#c6a26a', '#f3eedb', '#84b4ae', '#2d7779'];
export const vegetation = ['#894a49', '#cc9d82', '#f3eedb', '#a2bb91', '#466c4a'];
export function palette(kind: string, unit: string) { return unit.includes('NDVI') ? vegetation : kind === 'anomaly' || kind === 'temporal' ? diverging : sequential; }
export function colorFor(value: number, domain: [number, number], colors: string[]) {
  const t = Math.max(0, Math.min(0.9999, (value - domain[0]) / (domain[1] - domain[0])));
  return colors[Math.floor(t * colors.length)];
}
export class LayerRenderer {
  private entities: Entity[] = [];
  constructor(private C: Engine, private viewer: Viewer) {}
  clear() { for (const e of this.entities) this.viewer.entities.remove(e); this.entities = []; }
  render(layer: EnvironmentalLayer) {
    this.clear();
    if (!layer.visible) { this.viewer.scene.requestRender(); return; }
    const C = this.C, colors = palette(layer.kind, layer.unit);
    if (layer.kind === 'raster') {
      if (layer.rasterUrl && layer.cells[0]) this.entities.push(this.viewer.entities.add({ rectangle: { coordinates: C.Rectangle.fromDegrees(...layer.cells[0].bounds), material: new C.ImageMaterialProperty({ image: layer.rasterUrl, transparent: true, color: C.Color.WHITE.withAlpha(layer.opacity) }) } }));
      return;
    }
    for (const cell of layer.cells) {
      if (!Number.isFinite(cell.value)) continue;
      const color = C.Color.fromCssColorString(colorFor(cell.value, layer.domain, colors)).withAlpha(layer.opacity);
      const position = C.Cartesian3.fromDegrees(cell.lon, cell.lat, 50);
      if (layer.kind === 'point') {
        this.entities.push(this.viewer.entities.add({ position, point: { pixelSize: 7, color, outlineColor: C.Color.WHITE, outlineWidth: 1, heightReference: C.HeightReference.CLAMP_TO_GROUND } }));
      } else if (layer.kind === 'vector') {
        const direction = cell.value < 0 ? -1 : 1, length = (cell.bounds[2] - cell.bounds[0]) * 0.7;
        this.entities.push(this.viewer.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArray([cell.lon - length / 2 * direction, cell.lat, cell.lon + length / 2 * direction, cell.lat + length * 0.15]), width: 6, material: new C.PolylineArrowMaterialProperty(color), clampToGround: false } }));
      } else {
        this.entities.push(this.viewer.entities.add({ rectangle: { coordinates: C.Rectangle.fromDegrees(...cell.bounds), material: color, outline: false, height: 0 } }));
      }
    }
    this.viewer.scene.requestRender();
  }
}
