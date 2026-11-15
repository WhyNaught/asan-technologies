from concurrent.futures import ThreadPoolExecutor
from datetime import date

from fastapi import FastAPI, Response

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
    has_synthetic_variables = any(
        variable not in NASA_POWER_PARAMETERS for variable in query.variables
    )
    if has_nasa_power_variables and has_synthetic_variables:
        data_mode = "mixed"
    elif has_nasa_power_variables:
        data_mode = "nasa_power"
    else:
        data_mode = "synthetic"

    # NASA POWER is one HTTP call per point; fetch points in parallel.
    if has_nasa_power_variables:
        with ThreadPoolExecutor(max_workers=8) as pool:
            power_by_point = list(pool.map(
                lambda c: fetch_monthly_parameters(c, months, nasa_power_parameters),
                query.coordinates,
            ))
    else:
        power_by_point = [{} for _ in query.coordinates]

    locations = []
    for coordinate, nasa_power_data in zip(query.coordinates, power_by_point):
        series = []
        for variable in query.variables:
            metadata = VARIABLES[variable]
            parameter = NASA_POWER_PARAMETERS.get(variable)
            series.append(
                VariableTimeSeries(
                    variable=variable,
                    label=metadata["label"],
                    unit=metadata["unit"],
                    cadence=metadata["cadence"],
                    source=metadata["source"],
                    observations=[
                        Observation(
                            timestamp=month,
                            value=(
                                nasa_power_data[parameter][month]
                                if parameter is not None
                                else _synthetic_value(coordinate, month)
                            ),
                        )
                        for month in months
                    ],
                )
            )
        locations.append(LocationTimeSeries(coordinate=coordinate, series=series))

    return QueryResponse(
        data_mode=data_mode,
        requested_period=(query.start_date, query.end_date),
        locations=locations,
    )