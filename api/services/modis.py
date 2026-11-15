"""Real 1 km MODIS land surface temperature (MOD11A2, 8-day, daytime) via NASA's ORNL DAAC MODIS web service.

No credentials needed. Limits of the service: at most 10 composites per request, windows up to ~100 km, ~15 s per call.
"""
from __future__ import annotations

import json
import math
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException

BASE = "https://modis.ornl.gov/rst/api/v1/MOD11A2"
BAND = "LST_Day_1km"
EARTH_RADIUS_M = 6371007.181  # MODIS sinusoidal sphere
MAX_PER_REQUEST = 10
MAX_HALF_WIDTH_KM = 50
CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"
SOURCE = "NASA MODIS MOD11A2 (1 km)"


def _get(path: str, params: dict[str, Any]) -> dict[str, Any]:
    last: Exception | None = None
    for attempt in range(3):
        try:
            response = httpx.get(f"{BASE}/{path}", params=params, headers={"Accept": "application/json"}, timeout=90)
            if response.status_code == 400:
                raise HTTPException(status_code=422, detail=f"MODIS service rejected the request: {response.text[:200]}")
            response.raise_for_status()
            return response.json()
        except HTTPException:
            raise
        except (httpx.HTTPError, ValueError) as exc:  # network error, 5xx, bad JSON
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise HTTPException(status_code=502, detail="NASA MODIS service is unavailable right now") from last


@lru_cache(maxsize=1)
def composite_dates() -> tuple[tuple[str, date], ...]:
    """All MOD11A2 composites as (modis_date, calendar_date); the schedule is global."""
    data = _get("dates", {"latitude": 33.45, "longitude": -112.07})
    return tuple((d["modis_date"], date.fromisoformat(d["calendar_date"])) for d in data["dates"])


def _to_celsius(raw: int) -> float | None:
    return None if raw in (0, 65535) else raw * 0.02 - 273.15  # 0 = fill (cloud / no retrieval)


def _pixel_centres(block: dict[str, Any]) -> list[dict[str, float]]:
    """Lat/lon bounds of each pixel in the returned window (sinusoidal grid -> degrees)."""
    cell, nrows, ncols = float(block["cellsize"]), int(block["nrows"]), int(block["ncols"])
    xll, yll = float(block["xllcorner"]), float(block["yllcorner"])
    out = []
    for r in range(nrows):
        for c in range(ncols):
            y0, x0 = yll + (nrows - r - 1) * cell, xll + c * cell
            lat_s, lat_n = math.degrees(y0 / EARTH_RADIUS_M), math.degrees((y0 + cell) / EARTH_RADIUS_M)
            cos = max(0.01, math.cos(math.radians((lat_s + lat_n) / 2)))
            out.append({
                "west": math.degrees(x0 / (EARTH_RADIUS_M * cos)), "east": math.degrees((x0 + cell) / (EARTH_RADIUS_M * cos)),
                "south": lat_s, "north": lat_n,
            })
    return out


def _subset(lat: float, lon: float, first: str, last: str, half_km: int) -> dict[str, Any]:
    return _get("subset", {
        "latitude": lat, "longitude": lon, "band": BAND, "startDate": first, "endDate": last,
        "kmAboveBelow": half_km, "kmLeftRight": half_km,
    })


def _check_half_width(half_km: int) -> None:
    if not 0 <= half_km <= MAX_HALF_WIDTH_KM:
        raise HTTPException(status_code=422, detail=f"MODIS windows are limited to {2 * MAX_HALF_WIDTH_KM} km; choose a city-sized area")


def map_for_month(lat: float, lon: float, month: date, half_km: int) -> dict[str, Any]:
    """The 1 km daytime LST pixels around a point for the 8-day composite nearest the middle of `month`."""
    _check_half_width(half_km)
    middle = date(month.year, month.month, 16)
    modis_date, calendar = min(composite_dates(), key=lambda d: abs((d[1] - middle).days))
    if abs((calendar - middle).days) > 12:
        raise HTTPException(status_code=404, detail="No MODIS composite exists for that month")
    block = _subset(lat, lon, modis_date, modis_date, half_km)
    pixels = _pixel_centres(block)
    values = block["subset"][0]["data"]
    return {
        "composite_date": calendar, "cellsize_km": float(block["cellsize"]) / 1000, "unit": "°C", "source": SOURCE,
        "pixels": [{**p, "value": _to_celsius(int(v))} for p, v in zip(pixels, values)],
    }


# ---- monthly area-mean series (slow on first call: ~46 requests for ten years) ----------------------------
_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


def _cache_path(lat: float, lon: float, half_km: int, start: date, end: date) -> Path:
    return CACHE_DIR / f"modis_{lat:.2f}_{lon:.2f}_{half_km}_{start:%Y%m}_{end:%Y%m}.json"


def _series(lat: float, lon: float, half_km: int, start: date, end: date, job: dict[str, Any]) -> list[dict[str, Any]]:
    composites = [d for d in composite_dates() if start <= d[1] < _next_month(end)]
    chunks = [composites[i:i + MAX_PER_REQUEST] for i in range(0, len(composites), MAX_PER_REQUEST)]
    job["total"] = len(chunks)

    def fetch(chunk: list[tuple[str, date]]) -> list[tuple[date, float | None]]:
        block = _subset(lat, lon, chunk[0][0], chunk[-1][0], half_km)
        rows = []
        for entry in block["subset"]:
            valid = [v for v in (_to_celsius(int(x)) for x in entry["data"]) if v is not None]
            # require at least half the window to be clear-sky, otherwise the mean would be biased by cloud masking
            rows.append((date.fromisoformat(entry["calendar_date"]), sum(valid) / len(valid) if len(valid) >= len(entry["data"]) / 2 else None))
        job["done"] += 1
        return rows

    with ThreadPoolExecutor(max_workers=6) as pool:
        per_composite = [row for rows in pool.map(fetch, chunks) for row in rows]
    by_month: dict[tuple[int, int], list[float]] = {}
    for day, value in per_composite:
        if value is not None:
            by_month.setdefault((day.year, day.month), []).append(value)
    months, cursor = [], date(start.year, start.month, 1)
    while cursor <= end:
        values = by_month.get((cursor.year, cursor.month))
        months.append({"timestamp": cursor.isoformat(), "value": round(sum(values) / len(values), 3) if values else None})
        cursor = _next_month(cursor)
    return months


def _next_month(d: date) -> date:
    return date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def start_series_job(lat: float, lon: float, half_km: int, start: date, end: date) -> str:
    _check_half_width(half_km)
    key = _cache_path(round(lat, 2), round(lon, 2), half_km, start, end)
    job_id = uuid.uuid4().hex
    job: dict[str, Any] = {"status": "running", "done": 0, "total": 0, "source": SOURCE, "unit": "°C"}
    with _lock:
        _jobs[job_id] = job
    if key.exists():
        job.update(status="done", observations=json.loads(key.read_text()), done=1, total=1)
        return job_id

    def run() -> None:
        try:
            observations = _series(round(lat, 2), round(lon, 2), half_km, start, end, job)
            CACHE_DIR.mkdir(exist_ok=True)
            key.write_text(json.dumps(observations))
            job.update(status="done", observations=observations)
        except HTTPException as exc:
            job.update(status="error", detail=exc.detail)
        except Exception as exc:  # surface any failure to the poller instead of hanging it
            job.update(status="error", detail=f"MODIS series failed: {exc}")

    threading.Thread(target=run, daemon=True).start()
    return job_id

# fetch the status of a job from MODIS 
def job_status(job_id: str) -> dict[str, Any]:
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown MODIS job")
    return job
