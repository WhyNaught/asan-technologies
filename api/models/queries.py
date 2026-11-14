from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


# enum of valid variables, add more as needed
class UrbanVariable(str, Enum):
    LAND_SURFACE_TEMPERATURE = "land_surface_temperature"
    AIR_TEMPERATURE = "air_temperature"
    RELATIVE_HUMIDITY = "relative_humidity"
    DEW_POINT_TEMPERATURE = "dew_point_temperature"
    NIGHT_LIGHT_RADIANCE = "night_light_radiance"


# coordinate wrapper class 
class Coordinate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


# query class for sending a request for a time series
# provide a list of coords, a list of variables ur looking at
# and the start and end date you want 
class Query(BaseModel):
    model_config = ConfigDict(extra="forbid")

    coordinates: list[Coordinate] = Field(min_length=1, max_length=50)
    variables: list[UrbanVariable] = Field(min_length=1, max_length=5)
    start_date: date
    end_date: date

    # model validation logic, make sure that all object fields 
    # make sense and are within reason 
    @model_validator(mode="after")
    def validate_query(self) -> "Query":
        if self.start_date.day != 1 or self.end_date.day != 1:
            raise ValueError("start_date and end_date must be the first day of a month")
        if self.start_date > self.end_date:
            raise ValueError("start_date must be on or before end_date")

        month_count = (
            (self.end_date.year - self.start_date.year) * 12
            + self.end_date.month
            - self.start_date.month
            + 1
        )
        if month_count > 120:
            raise ValueError("The requested period cannot exceed 120 months")

        if len(set(self.variables)) != len(self.variables):
            raise ValueError("variables must not contain duplicates")

        coordinate_pairs = {
            (coordinate.latitude, coordinate.longitude)
            for coordinate in self.coordinates
        }
        if len(coordinate_pairs) != len(self.coordinates):
            raise ValueError("coordinates must not contain duplicates")

        return self


# a point in the return list in the time series 
class Observation(BaseModel):
    timestamp: date
    value: float

# wrapper class for the time series returned 
class VariableTimeSeries(BaseModel):
    variable: UrbanVariable
    label: str
    unit: str
    cadence: Literal["monthly"]
    source: Literal["synthetic", "NASA POWER"]
    observations: list[Observation]

# a list of all variable time series for a given coordinate 
class LocationTimeSeries(BaseModel):
    coordinate: Coordinate
    series: list[VariableTimeSeries]


# query response class 
class QueryResponse(BaseModel):
    data_mode: Literal["synthetic", "nasa_power", "mixed"]
    requested_period: tuple[date, date]
    locations: list[LocationTimeSeries]


# wrapper object for a variable 
# make sure any that we expose to the user follow this format 
class VariableMetadata(BaseModel):
    id: UrbanVariable
    label: str
    unit: str
    cadence: Literal["monthly"]
    description: str
    source: Literal["synthetic", "NASA POWER"]
    parameter: str | None = None


class VariablesResponse(BaseModel):
    data_mode: Literal["mixed"]
    variables: list[VariableMetadata]
