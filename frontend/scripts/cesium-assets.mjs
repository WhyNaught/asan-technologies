import { cp, mkdir } from 'node:fs/promises';
// Keep the official browser build, workers, widgets and assets on the same version.
await mkdir('public/cesium', { recursive: true });
await cp('node_modules/cesium/Build/Cesium', 'public/cesium', { recursive: true });
