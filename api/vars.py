from .models.queries import UrbanVariable

# all variables we wish to expose to the user should be 
# declared here using the below format 
VARIABLES = {
    UrbanVariable.LAND_SURFACE_TEMPERATURE: {
        "label": "Land surface temperature",
        "unit": "°C",
        "cadence": "monthly",
        "description": "Synthetic monthly land surface temperature example.",
    },
    UrbanVariable.AIR_TEMPERATURE: {
        "label": "Air temperature",
        "unit": "°C",
        "cadence": "monthly",
        "description": "Synthetic monthly near-surface air temperature example.",
    },
    UrbanVariable.NIGHT_LIGHT_RADIANCE: {
        "label": "Night light radiance",
        "unit": "nW/cm²/sr",
        "cadence": "monthly",
        "description": "Synthetic monthly nighttime-light radiance example.",
    },
}