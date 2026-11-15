from .models.queries import UrbanVariable

# All variables exposed by the monthly time-series endpoint.
VARIABLES = {
    UrbanVariable.EARTH_SKIN_TEMPERATURE: {
        "label": "Earth skin temperature",
        "unit": "°C",
        "cadence": "monthly",
        "description": "Monthly earth skin temperature from NASA POWER.",
        "source": "NASA POWER",
        "parameter": "TS",
    },
    UrbanVariable.AIR_TEMPERATURE: {
        "label": "Air temperature",
        "unit": "°C",
        "cadence": "monthly",
        "description": "Monthly mean air temperature at 2 meters from NASA POWER.",
        "source": "NASA POWER",
        "parameter": "T2M",
    },
    UrbanVariable.RELATIVE_HUMIDITY: {
        "label": "Relative humidity at 2 meters",
        "unit": "%",
        "cadence": "monthly",
        "description": "Monthly mean relative humidity at 2 meters from NASA POWER.",
        "source": "NASA POWER",
        "parameter": "RH2M",
    },
    UrbanVariable.DEW_POINT_TEMPERATURE: {
        "label": "Dew point temperature at 2 meters",
        "unit": "°C",
        "cadence": "monthly",
        "description": "Monthly mean dew/frost point temperature at 2 meters from NASA POWER.",
        "source": "NASA POWER",
        "parameter": "T2MDEW",
    },
    UrbanVariable.NIGHT_LIGHT_RADIANCE: {
        "label": "Night light radiance",
        "unit": "nW/cm²/sr",
        "cadence": "monthly",
        "description": "Synthetic monthly nighttime-light radiance example.",
        "source": "synthetic",
    },
}