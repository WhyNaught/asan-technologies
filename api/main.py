from datetime import date
from math import sin, tau

from fastapi import FastAPI

from .models.queries import (
    Coordinate,
    LocationTimeSeries,
    Observation,
    Query,
    QueryResponse,
    UrbanVariable,
    VariableTimeSeries,
    VariablesResponse,
)

from .vars import VARIABLES


app = FastAPI(
    title="Urbanization Time-Series API",
    description=(
        "Query monthly urbanization-related time series. The current implementation "
        "returns synthetic example values, not measured environmental data."
    ),
    version="0.1.0",
)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"name": app.title, "status": "ok"}

# lists all available variables for a user to select 
@app.get("/data/variables")
def list_variables() -> VariablesResponse:
    return VariablesResponse(
        data_mode="synthetic",
        variables=[
            {"id": variable, **metadata}
            for variable, metadata in VARIABLES.items()
        ],
    )

# helper method to get a list of all the months in between two dates 
def _months_between(start_date: date, end_date: date) -> list[date]:
    months = []
    current = start_date
    while current <= end_date:
        months.append(current)
        next_month = current.month % 12 + 1
        next_year = current.year + (current.month == 12)
        current = date(next_year, next_month, 1)
    return months

# function that allows us to mock the data we need 
# we pretend we have cyclical 
def _synthetic_value(
    variable: UrbanVariable, coordinate: Coordinate, month: date
) -> float:
    seasonal_cycle = sin(tau * (month.month - 1) / 12)
    hemisphere_adjustment = -1 if coordinate.latitude < 0 else 1
    latitude_fraction = abs(coordinate.latitude) / 90

    if variable == UrbanVariable.LAND_SURFACE_TEMPERATURE:
        value = 24 + 8 * seasonal_cycle * hemisphere_adjustment + 4 * latitude_fraction
    elif variable == UrbanVariable.AIR_TEMPERATURE:
        value = 17 + 10 * seasonal_cycle * hemisphere_adjustment + 3 * latitude_fraction
    else:
        longitude_component = abs(coordinate.longitude) % 40
        elapsed_months = (month.year - 2000) * 12 + month.month
        value = 2 + (abs(coordinate.latitude) * 0.37 + longitude_component * 0.23) % 70
        value += elapsed_months * 0.01

    return round(value, 2)

# actually sends the data query to the backend 
@app.post("/data/query", response_model=QueryResponse)
def send_data_query(query: Query) -> QueryResponse:
    months = _months_between(query.start_date, query.end_date)
    locations = []
    for coordinate in query.coordinates:
        series = []
        for variable in query.variables:
            metadata = VARIABLES[variable]
            series.append(
                VariableTimeSeries(
                    variable=variable,
                    label=metadata["label"],
                    unit=metadata["unit"],
                    cadence=metadata["cadence"],
                    source="synthetic",
                    observations=[
                        Observation(
                            timestamp=month,
                            value=_synthetic_value(variable, coordinate, month),
                        )
                        for month in months
                    ],
                )
            )
        locations.append(LocationTimeSeries(coordinate=coordinate, series=series))

    return QueryResponse(
        data_mode="synthetic",
        requested_period=(query.start_date, query.end_date),
        locations=locations,
    )