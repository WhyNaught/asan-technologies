from datetime import date
from math import isfinite
from typing import Any

from fastapi import HTTPException

from ..models.queries import Coordinate, UrbanVariable
from ..utils.request import call_external_endpoint


NASA_POWER_MONTHLY_URL = (
    "https://power.larc.nasa.gov/api/temporal/monthly/point"
)

# any new variables we want from NASA POWER api should be added here 
NASA_POWER_PARAMETERS = {
    UrbanVariable.LAND_SURFACE_TEMPERATURE: "TS",
    UrbanVariable.AIR_TEMPERATURE: "T2M",
    UrbanVariable.RELATIVE_HUMIDITY: "RH2M",
    UrbanVariable.DEW_POINT_TEMPERATURE: "T2MDEW",
}

# get the actual monthly params from NASA
# TODO: extend this to support more than just monthly params for Badr 
def fetch_monthly_parameters(
    coordinate: Coordinate,
    months: list[date],
    parameters: list[str],
) -> dict[str, dict[date, float]]:
    provider_data = call_external_endpoint(
        NASA_POWER_MONTHLY_URL,
        params={
            "parameters": ",".join(parameters),
            "community": "SB",
            "longitude": coordinate.longitude,
            "latitude": coordinate.latitude,
            "start": months[0].year,
            "end": months[-1].year,
            "format": "JSON",
        },
    )

    try:
        parameter_data = provider_data["properties"]["parameter"]
    except (KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=502, detail="NASA POWER returned an invalid parameter response"
        ) from exc
    if not isinstance(parameter_data, dict):
        raise HTTPException(
            status_code=502, detail="NASA POWER returned an invalid parameter response"
        )

    observations_by_parameter: dict[str, dict[date, float]] = {}
    for parameter in parameters:
        values = parameter_data.get(parameter)
        if not isinstance(values, dict):
            raise HTTPException(
                status_code=502,
                detail=f"NASA POWER did not return valid {parameter} data",
            )
        observations: dict[date, float] = {}
        for month in months:
            key = month.strftime("%Y%m")
            value: Any = values.get(key)
            if (
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not isfinite(value)
                or value == -999
            ):
                raise HTTPException(
                    status_code=502,
                    detail=f"NASA POWER did not return valid {parameter} data for {key}",
                )
            observations[month] = float(value)
        observations_by_parameter[parameter] = observations

    # return every parameter requested by the user 
    return observations_by_parameter
