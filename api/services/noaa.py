"""Real ocean observations from NOAA: HadISST sea surface temperature (ERDDAP) and the CPC Oceanic Niño Index."""
from __future__ import annotations

from datetime import date
from functools import lru_cache
from math import floor

import httpx
from fastapi import HTTPException

from ..config import API_TIMEOUT
from ..models.queries import Coordinate
from ..utils.request import call_external_endpoint

ERDDAP_HADISST_URL = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdHadISST.json"
ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
# ONI rows are 3-month seasons named by their initials; DJF is centred on January.
_SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]


def _cell_centre(value: float, limit: float) -> float:
    # HadISST is a 1-degree grid with cell centres at x.5.
    return min(limit, max(-limit, floor(value) + 0.5))

# general data fetch is cached
@lru_cache(maxsize=512)
def _sst_cached(lat: float, lon: float, start: date, end: date) -> tuple[tuple[date, float], ...]:
    query = (
        f"sst[({start.year}-{start.month:02d}-01):1:({end.year}-{end.month:02d}-28)]"
        f"[({lat}):1:({lat})][({lon}):1:({lon})]"
    )
    try:
        payload = call_external_endpoint(f"{ERDDAP_HADISST_URL}?{query}")
        rows = payload["table"]["rows"]
    except HTTPException as exc:
        if exc.status_code == 502:
            return ()  # ERDDAP answers 404 for cells outside its coverage; treat as no data
        raise
    except (KeyError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="NOAA returned an invalid SST response") from exc
    result = []
    for time_str, _lat, _lon, value in rows:
        if isinstance(value, (int, float)) and value > -90:
            result.append((date(int(time_str[:4]), int(time_str[5:7]), 1), float(value)))
    return tuple(result)

# general data from NOAA not related to ONI 
def fetch_sst_series(coordinate: Coordinate, months: list[date]) -> dict[date, float] | None:
    """Monthly SST for the HadISST cell containing the point, or None over land / sea ice / missing data."""
    data = dict(_sst_cached(_cell_centre(coordinate.latitude, 89.5), _cell_centre(coordinate.longitude, 179.5), months[0], months[-1]))
    if any(month not in data for month in months):
        return None
    return {month: data[month] for month in months}


# cache the table that we fetch from NOAA
# prevents us from re-fetching the same data
@lru_cache(maxsize=1)
def _oni_table() -> dict[tuple[int, int], float]:
    try:
        text = httpx.get(ONI_URL, timeout=API_TIMEOUT).raise_for_status().text
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach NOAA CPC for the Oceanic Niño Index") from exc
    table: dict[tuple[int, int], float] = {}
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) == 4 and parts[0] in _SEASONS:
            centre = _SEASONS.index(parts[0]) + 1  # DJF is centred on January of its listed year
            year = int(parts[1])
            table[(year, centre)] = float(parts[3])
    return table

# we fetch from NOAA specifically for Oceanic Nino Index 
def fetch_oni(months: list[date]) -> dict[date, float]:
    table = _oni_table()
    missing = [m for m in months if (m.year, m.month) not in table]
    if missing:
        raise HTTPException(status_code=502, detail=f"NOAA CPC has no Oceanic Niño Index for {missing[0]:%Y-%m}")
    return {m: table[(m.year, m.month)] for m in months}
