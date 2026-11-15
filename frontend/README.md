# ASAN Earth System Explorer

The Vite/TypeScript client uses Cesium for the globe and a small feature-based frontend under `src/`.

## Run the API and frontend

From the repository root, start the synthetic FastAPI service:

```powershell
python -m pip install -r api/requirements.txt
python -m uvicorn api.main:app --reload --port 8001
```

In a second terminal:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8001`. Override with `ASAN_API_ORIGIN` for a different local API host. For a deployed frontend, set `VITE_API_BASE_URL` to the deployed API origin and set `ASAN_FRONTEND_ORIGINS` on the API to the frontend origin(s).

## Data and analysis

There is **no synthetic data** in the app. Every variable comes from the connected ASAN API (`GET /data/variables`, `POST /data/query`), which serves:

- **NASA POWER** (MERRA-2 / CERES / GPM-corrected): skin, air and max temperature, humidity, dew point, precipitation, root-zone and surface soil wetness, evapotranspiration, solar and longwave irradiance, wind speed, albedo. Monthly, 2015–2024.
- **NOAA HadISST** (via ERDDAP): sea surface temperature, 1° grid, ocean cells only.
- **NOAA CPC**: Oceanic Niño Index (Niño 3.4), a global index.

Study areas are sampled on the provider's native grid (0.5° × 0.625°); areas needing more than 49 cells (large boxes, Worldwide) use an even 7 × 7 stratified sample, and results are cosine-latitude weighted in the browser. Trends use least-squares regression (t-test, 95% CI) plus the non-parametric Mann-Kendall test with Sen's slope; seasonal anomalies are on by default. Monthly values are autocorrelated, so p-values are indicative. POWER's temperature, humidity and soil variables are modeled reanalysis, not raw satellite retrievals.

Phenomena without a connected real dataset (vegetation/NDVI, sea ice, sea level, aerosols, …) were removed from the catalogue rather than faked; see GitHub issue #3.

## Cesium setup

Set `NEXT_PUBLIC_CESIUM_ION_TOKEN` in `frontend/.env.local` for permitted Cesium ion imagery and World Terrain. Restrict the public token to the app's domains and read-only assets. Without it, the client shows its clearly labeled low-resolution NASA tiled overview and ellipsoid terrain. Do not use the basemap as scientific data. Provider attribution remains visible.

`npm run build` copies Cesium workers/assets into `public/cesium` before the Vite production build.
