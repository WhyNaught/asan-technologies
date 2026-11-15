import type * as Cesium from 'cesium';
export type Engine = typeof Cesium;
export const ionToken = import.meta.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || '';
export async function basemap(C: Engine, style: 'satellite' | 'map') {
  if (style === 'map') return new C.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/', maximumLevel: 19 });
  if (ionToken) return C.IonImageryProvider.fromAssetId(Number(import.meta.env.NEXT_PUBLIC_CESIUM_IMAGERY_ASSET_ID || 2));
  return new C.UrlTemplateImageryProvider({
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
    maximumLevel: 8, credit: new C.Credit('NASA GIBS · Blue Marble overview (≤500 m) · not historical imagery', true),
  });
}
export async function terrain(C: Engine) {
  return ionToken ? C.CesiumTerrainProvider.fromIonAssetId(1, { requestVertexNormals: true, requestWaterMask: true }) : new C.EllipsoidTerrainProvider();
}
export function loadCesium(): Promise<Engine> {
  (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = '/cesium/';
  return import('cesium').then(module => module as unknown as Engine);
}
