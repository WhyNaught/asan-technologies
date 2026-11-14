# Asan Earth System Intelligence

The browser app in this folder is a Vite-powered, dependency-light frontend demo. It intentionally keeps the existing `api/` placeholder untouched.

## Run

```bash
npm install
npm run dev
```

## Mock data adapter

The current UI uses deterministic fixtures declared in `src/app.js`: a bounded set of supported regions, 36 phenomenon registry entries, variable metadata, timeline states, and seeded trend values. Visualization components consume those values through the same state paths that a future `EarthSignalAdapter` can replace with NASA observations and model outputs.

All values are labeled as synthetic demo data in the UI. No external API key or backend is required.
