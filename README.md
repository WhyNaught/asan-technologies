# ASAN Earth System Explorer

The Vite/TypeScript client uses Cesium for the globe and a small feature-based frontend under `/frontend/src/`.

## Run the API and frontend

From the repository root, start the synthetic FastAPI service:

```bash
python -m pip install -r api/requirements.txt
python -m uvicorn api.main:app --reload --port 8001
```

In a second terminal:

```bash
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
- **NASA Giovanni**: GPM IMERG version 07 precipitation and MODIS Aqua version 6.1 monthly aerosol optical depth as area-averaged time series. Giovanni uses the selected area's bounding box; it does not supply per-cell values to the map. Its CSV downloads require NASA Earthdata Login credentials configured on the API as `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`; the API loads these from the repository-root `.env` or its process environment at startup, so restart the API after changing them. On failures, the API returns the provider error and tailored suggestions in the response. Aerosol optical depth is a column proxy, not surface PM2.5. Dataset coverage varies, so some date/area requests may have no data.

NASA POWER and NOAA study areas are sampled on the provider's native grid (0.5° × 0.625°); areas needing more than 49 cells (large boxes, Worldwide) use an even 7 × 7 stratified sample, and results are cosine-latitude weighted in the browser. Giovanni time series are averaged by NASA over the selected bounding box. Trends use least-squares regression (t-test, 95% CI) plus the non-parametric Mann-Kendall test with Sen's slope; seasonal anomalies are on by default. Monthly values are autocorrelated, so p-values are indicative. POWER's temperature, humidity and soil variables are modeled reanalysis, not raw satellite retrievals.

Direct PM2.5, acid deposition/rainwater pH, soil pH, and mineral-composition datasets are not included. Giovanni's aerosol optical depth is not a substitute for PM2.5, and the available Giovanni integration does not provide gridded map values. Phenomena without an appropriate connected dataset were removed from the catalogue rather than faked; see GitHub issue #3.

## Finding trends

- **Find trends in this area** tests every variable (13 NASA POWER, plus NOAA SST over ocean) for the chosen area and period, then ranks them by Mann-Kendall evidence. A trend counts as significant only if the t-test and Mann-Kendall both pass; ★ marks those that survive a Bonferroni correction for testing many variables.
- **Map the trend per decade** (legend toggle) colours each grid cell by its own linear trend, showing where the change is happening.
- **MODIS 1 km** land surface temperature (ORNL DAAC service, no credentials) adds city-scale detail; the first 10-year series for a new place takes about 2 minutes server-side and is then cached in `api/.cache` (`python -m api.prewarm_modis` pre-computes the demo cities).

## Cesium setup

Set `NEXT_PUBLIC_CESIUM_ION_TOKEN` in `frontend/.env.local` for permitted Cesium ion imagery and World Terrain. Restrict the public token to the app's domains and read-only assets. Without it, the client shows its clearly labeled low-resolution NASA tiled overview and ellipsoid terrain. Do not use the basemap as scientific data. Provider attribution remains visible.

`npm run build` copies Cesium workers/assets into `public/cesium` before the Vite production build.
