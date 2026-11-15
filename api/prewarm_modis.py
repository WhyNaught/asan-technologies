"""Pre-compute the 10-year MODIS series for the demo cities so the demo is instant: python -m api.prewarm_modis"""
import math
from datetime import date

from .services import modis

# name: (lon, lat, bounds west/south/east/north) -- keep in sync with frontend/src/data.ts `places`
PLACES = {
    "Phoenix": (-112.07, 33.45, (-112.35, 33.2, -111.8, 33.75)),
    "Lagos": (3.38, 6.52, (3.15, 6.35, 3.65, 6.75)),
    "Toronto": (-79.38, 43.65, (-79.65, 43.5, -79.1, 43.85)),
    "London": (-0.12, 51.5, (-0.5, 51.3, 0.2, 51.7)),
    "Tokyo": (139.69, 35.68, (139.4, 35.5, 139.95, 35.9)),
}

if __name__ == "__main__":
    for name, (lon, lat, b) in PLACES.items():
        width_km = (b[2] - b[0]) * 111.32 * math.cos(math.radians(lat))
        half = math.ceil(max(width_km, (b[3] - b[1]) * 111.32) / 2) + 1  # same rule as frontend modisWindow()
        job = modis.job_status(modis.start_series_job(lat, lon, half, date(2015, 1, 1), date(2024, 12, 1)))
        print(name, "cached" if job["status"] == "done" else "computing", flush=True)
        while job["status"] == "running":
            import time; time.sleep(5)
        print(name, job["status"], flush=True)
