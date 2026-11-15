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

The Urban Heat Islands investigation uses `GET /data/variables` and `POST /data/query` from the connected API. The backend currently supports land surface temperature, air temperature, and night light radiance; it accepts up to three variables and 120 monthly dates. Area analyses sample up to 50 grid centers, request each point series, and compute cosine-latitude-weighted averages in the browser. Map samples use those same returned API observations. These are synthetic stub values, not NASA or other measured observations.

Drought, El Niño / La Niña, and vegetation-stress examples still use deterministic frontend demonstration data. Other catalogue entries are previews and do not claim measurements. The statistical functions are reusable and separate from the data adapter; reports and CSV downloads identify the data source and study-area sampling method.

## Cesium setup

Set `NEXT_PUBLIC_CESIUM_ION_TOKEN` in `frontend/.env.local` for permitted Cesium ion imagery and World Terrain. Restrict the public token to the app's domains and read-only assets. Without it, the client shows its clearly labeled low-resolution NASA tiled overview and ellipsoid terrain. Do not use the basemap as scientific data. Provider attribution remains visible.

`npm run build` copies Cesium workers/assets into `public/cesium` before the Vite production build.
