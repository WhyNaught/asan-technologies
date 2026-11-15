# Earth Explorer Implementation Plan

The user's detailed brief authorizes direct implementation. Retain the existing Vite app rather than introduce a second application or a framework migration.

Design: Earth fills the viewport; an off-white search strip, one floating phenomenon control, right map tools, and contextual timeline form the instrument. A warm, restrained ochre is the only UI accent. Analysis opens a bottom sheet. No sidebars. Preserve all 36 names and clearly separate synthetic measurements from geographic imagery.

- [ ] Replace Three.js with browser-only Cesium, copy its official production assets, configure ion imagery and World Terrain. Without credentials use explicitly labeled NASA tiled overview imagery and ellipsoid terrain. Report errors; retain credits.
- [ ] Add typed registry, geographic selection and deterministic adapter. Only supported variables receive measurements. Use bounded geographic grids with actual coordinate registration.
- [ ] Test then implement elapsed-time OLS, Student-t p-values/confidence intervals, monthly anomalies, missing data, and configuration validation.
- [ ] Build compact search, phenomenon palette, variable controls, rectangle/polygon selection, timeline playback, analysis chart and intentional comparison.
- [ ] Run tests, type check and production build; inspect desktop/mobile in a browser, fix observed failures. Document credential and uncertainty limits.

File boundaries: providers.ts (basemap/terrain), map.ts (Cesium lifecycle/camera/selection), layers.ts (geographic renderers), registry.ts (phenomena/variables), data.ts (adapter), analysis.ts (pure statistics), chart.ts (SVG interactions), timeline.ts (time state), app.ts/styles.css (UI). Tests exercise domain logic independently of Cesium.

Risks: ion asset entitlement varies by account; no credentials are available for verifying authorized streaming terrain. Uncorrected temporal autocorrelation can understate OLS uncertainty. Region averages use latitude-weighted synthetic cells, never point data relabeled as an area mean.
