from concurrent.futures import ThreadPoolExecutor
from datetime import date

from fastapi import FastAPI, HTTPException, Response

from .models.queries import (
    AppEEARSQueryResponse,
    AppEEARSProductsResponse,
    AppEEARSRequest,
    Coordinate,
    LocationTimeSeries,
    Observation,
    Query,
    QueryResponse,
    VariableTimeSeries,
    VariablesResponse,
)

from .services.nasa_power import (
    NASA_POWER_PARAMETERS,
    fetch_monthly_parameters,
)
from .services.nasa_appeears import (
    APPEEARS_PRODUCTS,
    download_appeears_product,
    query_appeears_product,
)
from .models.queries import ModisMapRequest, ModisSeriesRequest
from .services import modis
from .services.noaa import fetch_oni, fetch_sst_series
from .models.queries import UrbanVariable
from .vars import VARIABLES


app = FastAPI(
    title="Urbanization Time-Series API",
    description=(
        "Query monthly NASA POWER or daily and 8-day NASA AppEEARS time series. "
        "Point-based surface-temperature downloads are also available as ZIP files."
    ),
    version="0.1.0",
)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"name": app.title, "status": "ok"}

@app.get("/data/variables")
def list_variables() -> VariablesResponse:
    return VariablesResponse(
        data_mode="mixed",
        variables=[
            {"id": variable, **metadata}
            for variable, metadata in VARIABLES.items()
        ],
    )

# Lists all AppEEARS products we offer.
@app.get("/data/appeears/products", response_model=AppEEARSProductsResponse)
def list_appeears_products() -> AppEEARSProductsResponse:
    return AppEEARSProductsResponse(
        products=list(APPEEARS_PRODUCTS.values()),
    )

# request from APPEEARS directly
@app.post("/data/appeears/request")
def request_appeears_data(query: AppEEARSRequest) -> Response:
    task_id, archive = download_appeears_product(query)
    return Response(
        content=archive,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="appeears_{query.product.value}_{task_id}.zip"'
            )
        },
    )


@app.post("/data/appeears/query", response_model=AppEEARSQueryResponse)
def query_appeears_data(query: AppEEARSRequest) -> AppEEARSQueryResponse:
    return query_appeears_product(query)


@app.post("/data/modis/map")
def modis_map(request: ModisMapRequest) -> dict:
    """1 km MODIS land surface temperature pixels around a point for one month."""
    return modis.map_for_month(request.coordinate.latitude, request.coordinate.longitude, request.month, request.half_width_km)


@app.post("/data/modis/series")
def modis_series(request: ModisSeriesRequest) -> dict[str, str]:
    """Start (or hit the cache for) a monthly area-mean MODIS series; poll /data/modis/series/{job_id}."""
    return {"job_id": modis.start_series_job(
        request.coordinate.latitude, request.coordinate.longitude, request.half_width_km, request.start_date, request.end_date)}


@app.get("/data/modis/series/{job_id}")
def modis_series_status(job_id: str) -> dict:
    return modis.job_status(job_id)


# Returns each month in the inclusive date range.
def _months_between(start_date: date, end_date: date) -> list[date]:
    months = []
    current = start_date
    while current <= end_date:
        months.append(current)
        next_month = current.month % 12 + 1
        next_year = current.year + (current.month == 12)
        current = date(next_year, next_month, 1)
    return months

# for testing
def _synthetic_value(
    coordinate: Coordinate, month: date
) -> float:
    longitude_component = abs(coordinate.longitude) % 40
    elapsed_months = (month.year - 2000) * 12 + month.month
    value = 2 + (abs(coordinate.latitude) * 0.37 + longitude_component * 0.23) % 70
    value += elapsed_months * 0.01

    return round(value, 2)

@app.post(
    "/data/query",
    response_model=QueryResponse,
)
def send_data_query(query: Query) -> QueryResponse:
    months = _months_between(query.start_date, query.end_date)
    nasa_power_parameters = [
        NASA_POWER_PARAMETERS[variable]
        for variable in query.variables
        if variable in NASA_POWER_PARAMETERS
    ]
    has_nasa_power_variables = bool(nasa_power_parameters)
    sources = {VARIABLES[variable]["source"] for variable in query.variables}
    if "synthetic" in sources:
        data_mode = "synthetic" if sources == {"synthetic"} else "mixed"
    elif sources == {"NASA POWER"}:
        data_mode = "nasa_power"
    else:
        data_mode = "observational"

    # NASA POWER is one HTTP call per point; fetch points in parallel.
    wants_sst = UrbanVariable.SEA_SURFACE_TEMPERATURE in query.variables
    with ThreadPoolExecutor(max_workers=8) as pool:
        if has_nasa_power_variables:
            power_by_point = list(pool.map(
                lambda c: fetch_monthly_parameters(c, months, nasa_power_parameters),
                query.coordinates,
            ))
        else:
            power_by_point = [{} for _ in query.coordinates]
        sst_by_point = (
            list(pool.map(lambda c: fetch_sst_series(c, months), query.coordinates))
            if wants_sst else [None for _ in query.coordinates]
        )
    oni = fetch_oni(months) if UrbanVariable.NINO34_INDEX in query.variables else {}
    if wants_sst and all(series is None for series in sst_by_point):
        raise HTTPException(status_code=404, detail="No ocean sea-surface-temperature data for this area. Choose an area over open water.")

    locations = []
    for coordinate, nasa_power_data, sst in zip(query.coordinates, power_by_point, sst_by_point):
        series = []
        for variable in query.variables:
            metadata = VARIABLES[variable]
            parameter = NASA_POWER_PARAMETERS.get(variable)
            if variable == UrbanVariable.SEA_SURFACE_TEMPERATURE:
                if sst is None:
                    continue  # land / sea-ice cell: no SST observation, omit rather than invent one
                values = sst
            elif variable == UrbanVariable.NINO34_INDEX:
                values = oni
            elif parameter is not None:
                values = nasa_power_data[parameter]
            else:
                values = {month: _synthetic_value(coordinate, month) for month in months}
            series.append(
                VariableTimeSeries(
                    variable=variable,
                    label=metadata["label"],
                    unit=metadata["unit"],
                    cadence=metadata["cadence"],
                    source=metadata["source"],
                    observations=[Observation(timestamp=month, value=values[month]) for month in months],
                )
            )
        locations.append(LocationTimeSeries(coordinate=coordinate, series=series))

    return QueryResponse(
        data_mode=data_mode,
        requested_period=(query.start_date, query.end_date),
        locations=locations,
    )