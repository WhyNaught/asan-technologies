export type LayerKind = 'scalar' | 'raster' | 'anomaly' | 'heat' | 'polygon' | 'point' | 'vector' | 'temporal';
export interface Variable { id: string; name: string; unit: string; layer: LayerKind; global: boolean; domain: [number, number]; apiId: string; source: string }
export interface Phenomenon { id: string; name: string; category: string; description: string; why: string; variables: Variable[]; defaultVariable: string; scope: string; temporalResolution: 'monthly'; visualization: LayerKind; demo: boolean; featured: boolean }
export type Coordinate = [number, number];
export interface StudyArea { name: string; kind: 'point' | 'region' | 'global'; lon: number; lat: number; bounds?: [number, number, number, number]; polygon?: Coordinate[] }
export interface Observation { date: string; value: number }
export interface Cell { bounds: [number, number, number, number]; lon: number; lat: number; value: number }
export interface EnvironmentalLayer { id: string; resolutionKm: number; raster?: { rows: number; cols: number; bounds: [number, number, number, number] }; kind: LayerKind; unit: string; date: string; label: string; domain: [number, number]; opacity: number; visible: boolean; source: string; coverage: string; cells: Cell[]; rasterUrl?: string }
