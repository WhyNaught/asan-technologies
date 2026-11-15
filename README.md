# Asan: An Interactive Earth Systems Data Analysis Tool

## Urbanization time-series API

The API accepts coordinates, monthly urbanization variables, and a month-bounded
date range. Air temperature (`T2M`), relative humidity (`RH2M`), dew-point
temperature (`T2MDEW`), and earth skin temperature (`TS`) are fetched from NASA
POWER. Night-light radiance currently returns **synthetic example values**; it is
not an observation and must not be used for analysis.

Run the API from the repository root:

```bash
python -m pip install -r api/requirements.txt
cp .env.template .env
uvicorn api.main:app --reload
```

Set `APPEEARS_USERNAME` and `APPEEARS_PASSWORD` in `.env` to your NASA Earthdata
Login credentials. The API reads them on the server and does not send them to
clients. Keep `.env` private; it is excluded from Git.

Interactive API documentation is available at `http://127.0.0.1:8000/docs`.

### NASA AppEEARS surface-temperature downloads

`GET /data/appeears/products` lists the point-request products currently available
through AppEEARS:

| Product | Resolution | Cadence | Platform |
|---|---|---|---|
| `MOD11A1` | 1 km | Daily | Terra |
| `MYD11A1` | 1 km | Daily | Aqua |
| `MOD11A2` | 1 km | 8-day composite | Terra |

These requests use collection `.061` and include both daytime and nighttime LST
layers. AppEEARS currently returns 404 for `MOD11C3` collection `.006` and `.061`,
so it is not offered as a request option.

AppEEARS requests use the separate `POST /data/appeears/query` endpoint. Select
one product, and provide any inclusive date range:

```json
{
  "coordinates": [
    { "latitude": 40.7128, "longitude": -74.006 },
    { "latitude": 34.0522, "longitude": -118.2437 }
  ],
  "product": "MOD11A1",
  "start_date": "2024-01-01",
  "end_date": "2024-01-31"
}
```

AppEEARS requests submit a point task, wait up to 10 minutes for completion, and
return normalized JSON with separate daytime and nighttime series. AppEEARS
Kelvin values are converted to °C; fill values are returned as `null`. Responses
include the selected product and cadence (`daily` or `8-day`).

AppEEARS observations include the actual product cadence; for `MOD11A2`, that is
an 8-day composite, not daily observations. The inclusive date range may be up to
120 months and supports up to 50 unique coordinates. AppEEARS enforces its own
product coverage and availability limits.

The query response includes separate daytime and nighttime series for each point:

```json
{
  "data_mode": "nasa_appeears",
  "requested_period": ["2024-01-01", "2024-01-31"],
  "locations": [
    {
      "coordinate": { "latitude": 40.7128, "longitude": -74.006 },
      "series": [
        {
          "variable": "daytime_surface_temperature",
          "label": "Daytime surface temperature",
          "layer": "LST_Day_1km",
          "product": "MOD11A1",
          "unit": "°C",
          "cadence": "daily",
          "source": "NASA APPEEARS",
          "observations": [{ "timestamp": "2024-01-01", "value": 26.85 }]
        }
      ]
    }
  ]
}
```

`POST /data/appeears/request` remains available for users who want the original
AppEEARS task bundle as a ZIP rather than normalized JSON.

### NASA POWER monthly time-series

`GET /data/variables` lists supported monthly NASA POWER variables.
`POST /data/query` accepts NASA POWER variables:

```json
{
  "coordinates": [{ "latitude": 40.7128, "longitude": -74.006 }],
  "variables": [
    "air_temperature",
    "relative_humidity",
    "dew_point_temperature",
    "earth_skin_temperature",
    "night_light_radiance"
  ],
  "start_date": "2024-01-01",
  "end_date": "2024-03-01"
}
```

Dates must be the first day of a month. The inclusive period is limited to 120
months. Coordinates must be unique and within valid latitude/longitude ranges.
NASA POWER parameters are fetched together in one request per coordinate. NASA
POWER reports monthly data through the previous year, so recent or otherwise
unavailable months can result in a provider error.
