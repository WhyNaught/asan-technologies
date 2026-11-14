# Asan: An Interactive Earth Systems Data Analysis Tool

## Urbanization time-series API

The API accepts multiple coordinates, a selection of urbanization variables, and a
month-bounded date range. Air temperature (`T2M`), relative humidity (`RH2M`),
dew-point temperature (`T2MDEW`), and earth skin temperature (`TS`) are fetched from
NASA POWER's monthly point API. The existing `land_surface_temperature` variable maps
to NASA POWER's `TS` parameter. Night-light radiance currently returns **synthetic
example values**; it is not an observation and must not be used for analysis.

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
    "air_temperature",
    "relative_humidity",
    "dew_point_temperature",
    "land_surface_temperature",
    "night_light_radiance"
  ],
  "start_date": "2024-01-01",
  "end_date": "2024-03-01"
}
```

Dates must be the first day of a month, and the inclusive period is limited to 120
months. Coordinates must be unique and within valid latitude/longitude ranges. Each
returned series includes its variable identifier, label, unit, cadence, source, and
timestamped observations. NASA POWER-only queries use `data_mode: "nasa_power"` and
series source `"NASA POWER"`. Queries combining NASA POWER and synthetic variables
use `data_mode: "mixed"`; queries containing only synthetic variables use
`data_mode: "synthetic"`. POWER parameters are fetched together in one request per
coordinate. NASA POWER reports monthly data through the previous year, so recent or
otherwise unavailable months can result in a provider error.