# Asan: An Interactive Earth Systems Data Analysis Tool

## Urbanization time-series API

The initial API contract accepts multiple coordinates, a selection of urbanization
variables, and a month-bounded date range. It currently returns **synthetic example
values** to demonstrate the response format; these values are not observations and
must not be used for analysis. Real data providers are not connected yet.

Run the API from the repository root:

```bash
python -m pip install -r api/requirements.txt
uvicorn api.main:app --reload
```

Interactive API documentation is available at `http://127.0.0.1:8000/docs`.

`GET /data/variables` lists supported variables. `POST /data/query` accepts:

```json
{
  "coordinates": [
    { "latitude": 40.7128, "longitude": -74.006 },
    { "latitude": 34.0522, "longitude": -118.2437 }
  ],
  "variables": [
    "land_surface_temperature",
    "air_temperature",
    "night_light_radiance"
  ],
  "start_date": "2024-01-01",
  "end_date": "2024-03-01"
}
```

Dates must be the first day of a month, and the inclusive period is limited to 120
months. Coordinates must be unique and within valid latitude/longitude ranges. Each
returned series includes its variable identifier, label, unit, cadence, source, and
timestamped observations. The top-level `data_mode` and each series' `source` are
`synthetic` until measured datasets are integrated.