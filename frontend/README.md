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

The Urban Heat Islands investigation uses `GET /data/variables` and `POST /data/query` from the connected API. Earth skin temperature, air temperature, relative humidity and dew point are real monthly NASA POWER (MERRA-2 / CERES-derived, modeled) values for 2015–2024; night light radiance is still a labelled synthetic stub. Area analyses sample up to 16 grid centers (POWER's native grid is ~0.5°, so small cities share cells), request each point series in parallel, and compute cosine-latitude-weighted averages in the browser. Trends use least-squares regression (t-test, 95% CI) plus the non-parametric Mann-Kendall test and Sen's slope; seasonal anomalies are on by default so the annual cycle does not mask the trend. Monthly values are autocorrelated, so p-values are indicative, not definitive.

Drought, El Niño / La Niña, and vegetation-stress examples still use deterministic frontend demonstration data. Other catalogue entries are previews and do not claim measurements. The statistical functions are reusable and separate from the data adapter; reports and CSV downloads identify the data source and study-area sampling method.

## Cesium setup

Set `NEXT_PUBLIC_CESIUM_ION_TOKEN` in `frontend/.env.local` for permitted Cesium ion imagery and World Terrain. Restrict the public token to the app's domains and read-only assets. Without it, the client shows its clearly labeled low-resolution NASA tiled overview and ellipsoid terrain. Do not use the basemap as scientific data. Provider attribution remains visible.

`npm run build` copies Cesium workers/assets into `public/cesium` before the Vite production build.
