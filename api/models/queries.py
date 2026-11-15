from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class UrbanVariable(str, Enum):
    EARTH_SKIN_TEMPERATURE = "earth_skin_temperature"
    AIR_TEMPERATURE = "air_temperature"
    RELATIVE_HUMIDITY = "relative_humidity"
    DEW_POINT_TEMPERATURE = "dew_point_temperature"
    NIGHT_LIGHT_RADIANCE = "night_light_radiance"
    MAX_AIR_TEMPERATURE = "max_air_temperature"
    PRECIPITATION = "precipitation"
    ROOT_ZONE_SOIL_WETNESS = "root_zone_soil_wetness"
    SURFACE_SOIL_WETNESS = "surface_soil_wetness"
    EVAPOTRANSPIRATION = "evapotranspiration"
    SOLAR_IRRADIANCE = "solar_irradiance"
    LONGWAVE_IRRADIANCE = "longwave_irradiance"
    WIND_SPEED = "wind_speed"
    SURFACE_ALBEDO = "surface_albedo"
    SEA_SURFACE_TEMPERATURE = "sea_surface_temperature"
    NINO34_INDEX = "nino34_index"


class AppEEARSProduct(str, Enum):
    MOD11A1 = "MOD11A1"
    MYD11A1 = "MYD11A1"
    MOD11A2 = "MOD11A2"


class Coordinate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class Query(BaseModel):
    model_config = ConfigDict(extra="forbid")

    coordinates: list[Coordinate] = Field(min_length=1, max_length=50)
    variables: list[UrbanVariable] = Field(min_length=1, max_length=16)
    start_date: date
    end_date: date

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


class AppEEARSRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    coordinates: list[Coordinate] = Field(min_length=1, max_length=50)
    product: AppEEARSProduct
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def validate_request(self) -> "AppEEARSRequest":
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

        coordinate_pairs = {
            (coordinate.latitude, coordinate.longitude)
            for coordinate in self.coordinates
        }
        if len(coordinate_pairs) != len(self.coordinates):
            raise ValueError("coordinates must not contain duplicates")

        return self


class AppEEARSProductMetadata(BaseModel):
    id: AppEEARSProduct
    product_id: str
    platform: str
    resolution: str
    cadence: Literal["daily", "8-day"]
    layers: list[str]


class AppEEARSProductsResponse(BaseModel):
    products: list[AppEEARSProductMetadata]


class AppEEARSObservation(BaseModel):
    timestamp: date
    value: float | None


class AppEEARSVariableTimeSeries(BaseModel):
    variable: Literal[
        "daytime_surface_temperature",
        "nighttime_surface_temperature",
    ]
    label: str
    layer: str
    unit: Literal["°C"]
    cadence: Literal["daily", "8-day"]
    source: Literal["NASA APPEEARS"]
    observations: list[AppEEARSObservation]


class AppEEARSLocationTimeSeries(BaseModel):
    coordinate: Coordinate
    series: list[AppEEARSVariableTimeSeries]


class AppEEARSQueryResponse(BaseModel):
    data_mode: Literal["nasa_appeears"] = "nasa_appeears"
    product: AppEEARSProduct
    cadence: Literal["daily", "8-day"]
    requested_period: tuple[date, date]
    locations: list[AppEEARSLocationTimeSeries]


class Observation(BaseModel):
    timestamp: date
    value: float

class VariableTimeSeries(BaseModel):
    variable: UrbanVariable
    label: str
    unit: str
    cadence: Literal["monthly"]
    source: Literal["synthetic", "NASA POWER", "NOAA HadISST", "NOAA CPC ONI"]
    observations: list[Observation]

class LocationTimeSeries(BaseModel):
    coordinate: Coordinate
    series: list[VariableTimeSeries]


class QueryResponse(BaseModel):
    data_mode: Literal["synthetic", "nasa_power", "mixed", "observational"]
    requested_period: tuple[date, date]
    locations: list[LocationTimeSeries]


class VariableMetadata(BaseModel):
    id: UrbanVariable
    label: str
    unit: str
    cadence: Literal["monthly"]
    description: str
    source: Literal["synthetic", "NASA POWER", "NOAA HadISST", "NOAA CPC ONI"]
    parameter: str | None = None


class VariablesResponse(BaseModel):
    data_mode: Literal["mixed"]
    variables: list[VariableMetadata]


class ModisMapRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    coordinate: Coordinate
    half_width_km: int = Field(ge=0, le=50)
    month: date

    @model_validator(mode="after")
    def validate_month(self) -> "ModisMapRequest":
        if self.month.day != 1:
            raise ValueError("month must be the first day of a month")
        return self


class ModisSeriesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    coordinate: Coordinate
    half_width_km: int = Field(ge=0, le=50)
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def validate_range(self) -> "ModisSeriesRequest":
        if self.start_date.day != 1 or self.end_date.day != 1 or self.start_date > self.end_date:
            raise ValueError("start_date and end_date must be month starts with start_date <= end_date")
        if (self.end_date.year - self.start_date.year) * 12 + self.end_date.month - self.start_date.month + 1 > 120:
            raise ValueError("The requested period cannot exceed 120 months")
        return self
