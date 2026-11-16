// SI was at least partially used to write the code in this file
import type { Viewer, Entity } from 'cesium';
import type { Engine } from './providers';
import type { EnvironmentalLayer } from './types';
export const sequential = ['#fff0b4', '#fbc66b', '#ed884a', '#c34435', '#7e2636'];
export const diverging = ['#795233', '#c6a26a', '#f3eedb', '#84b4ae', '#2d7779'];
export const vegetation = ['#894a49', '#cc9d82', '#f3eedb', '#a2bb91', '#466c4a'];
// Colour encodes the data source: teal-to-navy for coarse NASA POWER / NOAA context, plasma for 1 km MODIS detail.
export const contextRamp = ['#e8f5ee', '#a6dbb8', '#4fb3a3', '#2a7ea6', '#1b3f73'];
export const detailRamp = ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'];
export const trendRamp = ['#2166ac', '#92c5de', '#f7f7f7', '#f4a582', '#b2182b'];
export function palette(kind: string, unit: string, source = '') { return unit.endsWith('/decade') ? trendRamp : source.includes('MODIS') ? detailRamp : unit.includes('NDVI') ? vegetation : kind === 'anomaly' || kind === 'temporal' ? diverging : contextRamp; }
export function colorFor(value: number, domain: [number, number], colors: string[]) {
  const t = Math.max(0, Math.min(0.9999, (value - domain[0]) / (domain[1] - domain[0])));
  return colors[Math.floor(t * colors.length)];
}
export class LayerRenderer {
  private entities: Entity[] = [];
  constructor(private C: Engine, private viewer: Viewer) {}
  clear() { for (const e of this.entities) this.viewer.entities.remove(e); this.entities = []; }
  /** Draws layers bottom-to-top (coarse context first, fine detail last). */
  render(layers: EnvironmentalLayer[]) {
    this.clear();
    layers.forEach((layer, order) => { if (layer.visible) this.draw(layer, order); });
    this.viewer.scene.requestRender();
  }
  private draw(layer: EnvironmentalLayer, order: number) {
    const C = this.C, colors = palette(layer.kind, layer.unit, layer.source);
    const ground = { classificationType: C.ClassificationType.TERRAIN, zIndex: order };
    if (layer.raster) {
      const { rows, cols, bounds } = layer.raster, canvas = document.createElement('canvas');
      canvas.width = cols; canvas.height = rows;
      const ctx = canvas.getContext('2d')!;
      layer.cells.forEach((cell, i) => {
        if (!Number.isFinite(cell.value)) return;
        ctx.fillStyle = colorAt(cell.value, layer.domain, colors); ctx.fillRect(i % cols, Math.floor(i / cols), 1, 1);
      });
      this.entities.push(this.viewer.entities.add({ rectangle: { coordinates: C.Rectangle.fromDegrees(...bounds), material: new C.ImageMaterialProperty({ image: canvas.toDataURL(), transparent: true, color: C.Color.WHITE.withAlpha(layer.opacity) }), ...ground } }));
      return;
    }
    for (const cell of layer.cells) {
      if (!Number.isFinite(cell.value)) continue;
      const color = C.Color.fromCssColorString(colorFor(cell.value, layer.domain, colors)).withAlpha(layer.opacity);
      this.entities.push(this.viewer.entities.add({ rectangle: { coordinates: C.Rectangle.fromDegrees(...cell.bounds), material: color, outline: false, ...ground } }));
    }
  }
}
/** Continuous colour from a ramp (interpolated), for raster pixels. */
export function colorAt(value: number, domain: [number, number], colors: string[]) {
  const t = Math.max(0, Math.min(1, (value - domain[0]) / (domain[1] - domain[0]))) * (colors.length - 1), i = Math.min(colors.length - 2, Math.floor(t)), f = t - i;
  const a = colors[i].match(/\w\w/g)!.map(h => parseInt(h, 16)), b = colors[i + 1].match(/\w\w/g)!.map(h => parseInt(h, 16));
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}
