import csv
import os
import re
import time
from datetime import date, datetime
from io import BytesIO, StringIO
from math import isfinite
from uuid import uuid4
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException

from ..config import API_TIMEOUT
from ..models.queries import (
    AppEEARSObservation,
    AppEEARSLocationTimeSeries,
    AppEEARSProduct,
    AppEEARSProductMetadata,
    AppEEARSQueryResponse,
    AppEEARSRequest,
    AppEEARSVariableTimeSeries,
)

# constants 
NASA_APPEEARS_API_URL = "https://appeears.earthdatacloud.nasa.gov/api"
NASA_APPEEARS_TASK_TIMEOUT = 600
NASA_APPEEARS_POLL_INTERVAL = 5

load_dotenv()

# all appears products we want to request should be listed here 
APPEEARS_PRODUCTS = {
    AppEEARSProduct.MOD11A1: AppEEARSProductMetadata(
        id=AppEEARSProduct.MOD11A1,
        product_id="MOD11A1.061",
        platform="Terra",
        resolution="1 km",
        cadence="daily",
        layers=["LST_Day_1km", "LST_Night_1km"],
    ),
    AppEEARSProduct.MYD11A1: AppEEARSProductMetadata(
        id=AppEEARSProduct.MYD11A1,
        product_id="MYD11A1.061",
        platform="Aqua",
        resolution="1 km",
        cadence="daily",
        layers=["LST_Day_1km", "LST_Night_1km"],
    ),
    AppEEARSProduct.MOD11A2: AppEEARSProductMetadata(
        id=AppEEARSProduct.MOD11A2,
        product_id="MOD11A2.061",
        platform="Terra",
        resolution="1 km",
        cadence="8-day",
        layers=["LST_Day_1km", "LST_Night_1km"],
    ),
}

# helper method to make a request to APPEEARS
def _request(
    method: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    auth: tuple[str, str] | None = None,
    json: dict[str, object] | None = None,
) -> httpx.Response:
    try:
        response = httpx.request(
            method,
            f"{NASA_APPEEARS_API_URL}/{path.lstrip('/')}",
            headers=headers,
            auth=auth,
            json=json,
            timeout=API_TIMEOUT,
        )
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504, detail="NASA AppEEARS request timed out"
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502, detail="NASA AppEEARS returned an error"
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502, detail="Could not reach NASA AppEEARS"
        ) from exc

    return response


# wrapper helper to make a request and convert its output to JSON
def _request_json(
    method: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    auth: tuple[str, str] | None = None,
    json: dict[str, object] | None = None,
) -> object:
    response = _request(method, path, headers=headers, auth=auth, json=json)
    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502, detail="NASA AppEEARS returned invalid JSON"
        ) from exc


# helper method to login to NASA APPEEARS
def _login() -> str:
    username = os.getenv("APPEEARS_USERNAME")
    password = os.getenv("APPEEARS_PASSWORD")
    if not username or not password:
        raise HTTPException(
            status_code=503,
            detail=(
                "NASA AppEEARS credentials are not configured; set "
                "APPEEARS_USERNAME and APPEEARS_PASSWORD"
            ),
        )

    result = _request_json(
        "POST",
        "login",
        auth=(username, password),
    )
    token = result.get("token") if isinstance(result, dict) else None
    if not isinstance(token, str) or not token:
        raise HTTPException(
            status_code=502,
            detail="NASA AppEEARS returned an invalid login response",
        )
    return token

# wrapper to get the task_id from the response object NASA sends 
def _task_id(result: object) -> str:
    if isinstance(result, list) and result:
        result = result[0]
    task_id = result.get("task_id") if isinstance(result, dict) else None
    if not isinstance(task_id, str) or not task_id:
        raise HTTPException(
            status_code=502, detail="NASA AppEEARS returned an invalid task response"
        )
    return task_id

# Extract the status across AppEEARS' top-level and enveloped status responses.
def _task_status(result: object) -> str:
    status_keys = {"status", "task_status", "taskstatus"}
    envelope_keys = {"data", "result", "task"}
    pending = [result]
    while pending:
        current = pending.pop(0)
        if isinstance(current, str) and current.strip():
            return current.strip().lower()
        if isinstance(current, list):
            pending.extend(current)
            continue
        if isinstance(current, dict):
            for key, value in current.items():
                normalized_key = key.casefold().replace("-", "_")
                if normalized_key in status_keys and isinstance(value, str) and value.strip():
                    return value.strip().lower()
            pending.extend(
                value
                for key, value in current.items()
                if key.casefold().replace("-", "_") in envelope_keys
            )

    if isinstance(result, dict):
        response_shape = f"object with fields: {', '.join(sorted(result.keys()))}"
    elif isinstance(result, list):
        response_shape = f"list with {len(result)} item(s)"
    else:
        response_shape = type(result).__name__
    raise HTTPException(
        status_code=502,
        detail=(
            "NASA AppEEARS returned an unrecognized task status response "
            f"({response_shape})"
        ),
    )

# gets the files that NASA sends 
def _bundle_files(result: object) -> list[dict[str, object]]:
    files = result.get("files") if isinstance(result, dict) else None
    if not isinstance(files, list) or not files:
        raise HTTPException(
            status_code=502, detail="NASA AppEEARS returned an empty task bundle"
        )
    if any(not isinstance(item, dict) for item in files):
        raise HTTPException(
            status_code=502, detail="NASA AppEEARS returned an invalid task bundle"
        )
    return files

# creates the request for the task payload 
def _task_payload(request: AppEEARSRequest) -> dict[str, object]:
    product = APPEEARS_PRODUCTS[request.product]
    return {
        "task_type": "point",
        "task_name": f"surface_temperature_{uuid4().hex[:12]}",
        "params": {
            "dates": [
                {
                    "startDate": request.start_date.strftime("%m-%d-%Y"),
                    "endDate": request.end_date.strftime("%m-%d-%Y"),
                }
            ],
            "layers": [
                {"product": product.product_id, "layer": layer}
                for layer in product.layers
            ],
            "coordinates": [
                {
                    "id": str(index),
                    "latitude": coordinate.latitude,
                    "longitude": coordinate.longitude,
                }
                for index, coordinate in enumerate(request.coordinates, start=1)
            ],
        },
    }

# waits for the task to complete before sending any data back to the user 
# this is because APPEEARS is async 
def _wait_for_task(task_id: str, headers: dict[str, str]) -> None:
    deadline = time.monotonic() + NASA_APPEEARS_TASK_TIMEOUT
    while True:
        status = _task_status(
            _request_json("GET", f"status/{task_id}", headers=headers)
        )
        if status == "done":
            return
        if status in {"error", "failed", "cancelled", "canceled"}:
            raise HTTPException(
                status_code=502, detail="NASA AppEEARS could not process the task"
            )

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise HTTPException(
                status_code=504, detail="NASA AppEEARS task did not finish in time"
            )
        time.sleep(min(NASA_APPEEARS_POLL_INTERVAL, remaining))


# download data from APPEEARS
def download_appeears_product(request: AppEEARSRequest) -> tuple[str, bytes]:
    token = _login()
    headers = {"Authorization": f"Bearer {token}"}
    task_id = _task_id(
        _request_json(
            "POST",
            "task",
            headers=headers,
            json=_task_payload(request),
        )
    )
    _wait_for_task(task_id, headers)

    bundle = _bundle_files(
        _request_json("GET", f"bundle/{task_id}", headers=headers)
    )
    archive = BytesIO()
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as zip_file:
        for item in bundle:
            file_id = item.get("file_id")
            file_name = item.get("file_name")
            if not isinstance(file_id, (str, int)) or not isinstance(file_name, str):
                raise HTTPException(
                    status_code=502,
                    detail="NASA AppEEARS returned an invalid task bundle",
                )
            response = _request(
                "GET",
                f"bundle/{task_id}/{file_id}",
                headers=headers,
            )
            safe_name = file_name.replace("\\", "/").rsplit("/", 1)[-1]
            safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", safe_name)
            if not safe_name or safe_name in {".", ".."}:
                safe_name = f"{file_id}.csv"
            zip_file.writestr(safe_name, response.content)

    return task_id, archive.getvalue()

# parse the timestamp into a datetime object to be consistent with our response format 
def _parse_timestamp(value: str) -> date:
    value = value.strip()
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        for date_format in ("%m/%d/%Y", "%m-%d-%Y"):
            try:
                return datetime.strptime(value, date_format).date()
            except ValueError:
                continue
    raise HTTPException(
        status_code=502, detail="NASA AppEEARS returned an invalid observation date"
    )

# find a column name in the table, returns it
def _find_column(fieldnames: list[str], expected: str) -> str | None:
    for fieldname in fieldnames:
        if fieldname.strip().casefold() == expected.casefold():
            return fieldname
    return None

# get the column pertaining to the relevant layer (day vs. night)
def _find_layer_column(fieldnames: list[str], layer: str) -> str | None:
    matches = [
        fieldname
        for fieldname in fieldnames
        if fieldname.strip().casefold().endswith(layer.casefold())
    ]
    if not matches:
        return None
    exact_matches = [name for name in matches if name.strip().casefold() == layer.casefold()]
    return exact_matches[0] if exact_matches else matches[0]

# convert a given temp to celsius 
def _temperature_celsius(value: str | None) -> float | None:
    if value is None or value.strip().casefold() in {
        "",
        "na",
        "nan",
        "none",
        "0",
        "-999",
        "-9999",
    }:
        return None
    try:
        kelvin = float(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail="NASA AppEEARS returned an invalid temperature value",
        ) from exc
    if not isfinite(kelvin):
        return None
    return round(kelvin - 273.15, 3)

# parses the CSV that APPEEARS returns, converts it to a JSON like with NASA POWER 
def _parse_point_csvs(
    request: AppEEARSRequest,
    csv_files: list[tuple[str, bytes]],
) -> AppEEARSQueryResponse:
    product = APPEEARS_PRODUCTS[request.product]
    point_ids = {
        str(index): coordinate
        for index, coordinate in enumerate(request.coordinates, start=1)
    }
    observations: dict[str, dict[str, list[AppEEARSObservation]]] = {
        point_id: {layer: [] for layer in product.layers}
        for point_id in point_ids
    }
    seen_layers: set[str] = set()

    for _, content in csv_files:
        try:
            text = content.decode("utf-8-sig")
            reader = csv.DictReader(StringIO(text))
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=502, detail="NASA AppEEARS returned an invalid CSV file"
            ) from exc
        fieldnames = reader.fieldnames or []
        date_column = _find_column(fieldnames, "Date")
        id_column = _find_column(fieldnames, "ID")
        layer_columns = {
            layer: _find_layer_column(fieldnames, layer)
            for layer in product.layers
        }
        seen_layers.update(
            layer for layer, column in layer_columns.items() if column is not None
        )
        if date_column is None:
            raise HTTPException(
                status_code=502,
                detail="NASA AppEEARS CSV is missing the observation date column",
            )

        for row in reader:
            point_id = row.get(id_column, "").strip() if id_column else None
            if not point_id:
                point_id = None
            if point_id not in observations:
                if len(point_ids) == 1 and point_id is None:
                    point_id = next(iter(point_ids))
                else:
                    raise HTTPException(
                        status_code=502,
                        detail="NASA AppEEARS CSV returned an unknown point identifier",
                    )

            date_value = row.get(date_column)
            if not date_value:
                raise HTTPException(
                    status_code=502,
                    detail="NASA AppEEARS CSV is missing an observation date",
                )
            timestamp = _parse_timestamp(date_value)
            for layer, column in layer_columns.items():
                if column is None:
                    continue
                observations[point_id][layer].append(
                    AppEEARSObservation(
                        timestamp=timestamp,
                        value=_temperature_celsius(row.get(column)),
                    )
                )

    if not csv_files or seen_layers != set(product.layers):
        raise HTTPException(
            status_code=502,
            detail="NASA AppEEARS task bundle did not include expected LST data",
        )

    # account for the layer series (day vs night)
    layer_series = {
        "LST_Day_1km": (
            "daytime_surface_temperature",
            "Daytime surface temperature",
        ),
        "LST_Night_1km": (
            "nighttime_surface_temperature",
            "Nighttime surface temperature",
        ),
    }
    locations = []
    for point_id, coordinate in point_ids.items():
        series = []
        for layer in product.layers:
            variable, label = layer_series[layer]
            series.append(
                AppEEARSVariableTimeSeries(
                    variable=variable,
                    label=label,
                    layer=layer,
                    unit="°C",
                    cadence=product.cadence,
                    source="NASA APPEEARS",
                    observations=sorted(
                        observations[point_id][layer],
                        key=lambda observation: observation.timestamp,
                    ),
                )
            )
        locations.append(
            AppEEARSLocationTimeSeries(coordinate=coordinate, series=series)
        )

    return AppEEARSQueryResponse(
        product=request.product,
        cadence=product.cadence,
        requested_period=(request.start_date, request.end_date),
        locations=locations,
    )

# main wrapper for querying the APPEEARS api
def query_appeears_product(request: AppEEARSRequest) -> AppEEARSQueryResponse:
    _, archive_bytes = download_appeears_product(request)
    try:
        with ZipFile(BytesIO(archive_bytes)) as archive:
            csv_files = [
                (file_name, archive.read(file_name))
                for file_name in archive.namelist()
                if file_name.casefold().endswith(".csv")
            ]
    except (BadZipFile, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail="NASA AppEEARS returned an invalid task archive",
        ) from exc
    return _parse_point_csvs(request, csv_files)
