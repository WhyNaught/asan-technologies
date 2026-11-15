from __future__ import annotations

import csv
import html
import io
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import date
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException

from ..config import API_TIMEOUT
from ..models.queries import GiovanniDataset, GiovanniQuery

load_dotenv()

GIOVANNI_BASE_URL = os.getenv(
    "GIOVANNI_BASE_URL", "https://giovanni.gsfc.nasa.gov/giovanni"
).rstrip("/")
WORKFLOW_TIMEOUT_SECONDS = 120
POLL_INTERVAL_SECONDS = 2

GIOVANNI_DATASETS: dict[GiovanniDataset, dict[str, str]] = {
    GiovanniDataset.GPM_PRECIPITATION: {
        "label": "Precipitation rate (GPM IMERG)",
        "unit": "mm/hr",
        "cadence": "monthly",
        "description": "Monthly precipitation rate from the active GPM IMERG version 07 product. The selected area is averaged.",
        "kind": "precipitation",
    },
    GiovanniDataset.AQUA_AEROSOL_OPTICAL_DEPTH: {
        "label": "Aerosol optical depth (MODIS Aqua, 550 nm)",
        "unit": "1",
        "cadence": "monthly",
        "description": "Monthly MODIS Aqua version 6.1 aerosol optical-depth product. It measures aerosol through the atmospheric column, not surface PM2.5 concentration.",
        "kind": "air_quality_proxy",
    },
}


def _provider_error(
    status_code: int,
    message: str,
    recommendations: list[str],
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"message": message, "recommendations": recommendations},
    )


def _clean_workflow_message(message: str | None) -> str | None:
    if not message:
        return None
    clean = re.sub(r"<[^>]*>", " ", html.unescape(message))
    clean = " ".join(clean.split())
    return clean or None


def _workflow_recommendations(message: str, dataset: GiovanniDataset) -> list[str]:
    lowered = message.lower()
    if "in our data catalog" in lowered or (
        "could not find" in lowered and dataset.value.lower() in lowered
    ):
        return [
            "Giovanni does not recognize this dataset ID in its own service catalog; changing "
            "the dates, area, or Earthdata credentials will not fix this catalog error.",
            "Verify that the exact field ID is listed in Giovanni's catalog for the Area-Averaged "
            "Time Series service. An active AESIR catalog entry alone does not guarantee Giovanni support.",
            "Choose a field Giovanni lists for this service, or deselect this variable until a "
            "supported aerosol dataset is configured.",
        ]
    recommendations = [
        "Try a shorter date range (for example, 1-3 months) and expand it gradually.",
        "For a regional query, try a smaller bounding box that stays within the dataset's coverage.",
        "Confirm the selected dates and location are covered by this NASA product, then retry.",
    ]
    if "search" in lowered or "data" in lowered or "match" in lowered:
        if dataset == GiovanniDataset.AQUA_AEROSOL_OPTICAL_DEPTH:
            recommendations[0] = (
                "This request uses monthly MODIS Aqua data; choose dates from July 2002 onward "
                "and try a short period first."
            )
        elif dataset == GiovanniDataset.GPM_PRECIPITATION:
            recommendations[0] = (
                "Split long precipitation requests into shorter periods (try up to 5 months "
                "at a time), then combine the returned monthly observations."
            )
        recommendations.append(
            "If a short, covered query still fails, retry later; Giovanni may be temporarily "
            "unable to search its catalog."
        )
    return recommendations


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _request_text(
    url: str, params: dict[str, str], *, earthdata_login: bool = False
) -> str:
    try:
        response = httpx.get(url, params=params, timeout=API_TIMEOUT)
        if earthdata_login and response.is_redirect:
            login_url = urljoin(str(response.url), response.headers.get("location", ""))
            login_target = urlsplit(login_url)
            print(
                f"[Giovanni] Result download redirected to "
                f"{login_target.hostname or 'an unknown host'} "
                f"(HTTP {response.status_code}).",
                file=sys.stderr,
                flush=True,
            )
            if login_target.scheme != "https" or login_target.hostname != "urs.earthdata.nasa.gov":
                raise _provider_error(
                    502,
                    "NASA Giovanni redirected to an unexpected authentication service.",
                    ["Retry later. If the redirect continues, report it to the API maintainer."],
                )
            username = os.getenv("EARTHDATA_USERNAME")
            password = os.getenv("EARTHDATA_PASSWORD")
            if not username or not password:
                print(
                    "[Giovanni] Earthdata Login is required, but "
                    "EARTHDATA_USERNAME or EARTHDATA_PASSWORD is not configured.",
                    file=sys.stderr,
                    flush=True,
                )
                raise _provider_error(
                    502,
                    "NASA Giovanni requires Earthdata Login to download results.",
                    [
                        "Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD in the API's .env file "
                        "or process environment. Restart Uvicorn after changing the file."
                    ],
                )
            response = httpx.get(
                login_url,
                auth=(username, password),
                follow_redirects=True,
                timeout=API_TIMEOUT,
            )
        elif earthdata_login and response.status_code == 401:
            print(
                "[Giovanni] Result download returned HTTP 401 before authentication.",
                file=sys.stderr,
                flush=True,
            )
            raise _provider_error(
                502,
                "NASA Giovanni requires Earthdata Login to download results.",
                [
                    "Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD in the API's .env file "
                    "or process environment, then restart Uvicorn."
                ],
            )
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        print(f"[Giovanni] Request timed out: {exc}", file=sys.stderr, flush=True)
        raise _provider_error(
            504,
            "NASA Giovanni timed out while contacting the service.",
            [
                "Retry the request; Giovanni may be temporarily slow.",
                "If it keeps timing out, request a shorter date range or smaller area.",
            ],
        ) from exc
    except httpx.HTTPStatusError as exc:
        body = exc.response.text[:1000].replace("\n", " ")
        print(
            f"[Giovanni] Upstream HTTP {exc.response.status_code}: {body}",
            file=sys.stderr,
            flush=True,
        )
        if earthdata_login and exc.response.status_code == 401:
            print(
                "[Giovanni] Earthdata Login rejected the configured credentials.",
                file=sys.stderr,
                flush=True,
            )
            raise _provider_error(
                502,
                "NASA Earthdata Login rejected the configured credentials.",
                [
                    "Verify the Earthdata username and password in the API process environment.",
                    "Confirm the account can sign in to NASA Earthdata Login, then restart Uvicorn "
                    "after changing the .env file.",
                ],
            ) from exc
        raise _provider_error(
            502,
            f"NASA Giovanni returned HTTP {exc.response.status_code}.",
            [
                "Retry in a few minutes in case the provider is temporarily unavailable.",
                "If the error persists, check NASA Giovanni service status and share the API log "
                "message with the maintainer.",
            ],
        ) from exc
    except httpx.RequestError as exc:
        print(f"[Giovanni] Network request failed: {exc}", file=sys.stderr, flush=True)
        raise _provider_error(
            502,
            "Could not reach NASA Giovanni.",
            [
                "Check that the API machine has an internet connection and can reach "
                "giovanni.gsfc.nasa.gov.",
                "Retry the request; if it persists, check whether Giovanni is available.",
            ],
        ) from exc
    if earthdata_login and (
        response.is_redirect or "text/html" in response.headers.get("content-type", "").lower()
    ):
        raise _provider_error(
            502,
            "NASA Earthdata Login did not return Giovanni data.",
            [
                "Verify that the Earthdata credentials are valid and that the account can access "
                "NASA Giovanni.",
                "Check the API terminal for the upstream status, then retry.",
            ],
        )
    return response.text


def _xml_root(content: str) -> ET.Element:
    try:
        return ET.fromstring(content)
    except ET.ParseError as exc:
        raise _provider_error(
            502,
            "NASA Giovanni returned an invalid workflow response.",
            ["Retry the request. If the response remains invalid, report it to the API maintainer."],
        ) from exc


def _elements(root: ET.Element, name: str) -> list[ET.Element]:
    return [element for element in root.iter() if _local_name(element.tag) == name]


def _field(root: ET.Element, name: str) -> str | None:
    for element in _elements(root, name):
        if element.text and element.text.strip():
            return element.text.strip()
    return None


def _workflow_ids(root: ET.Element) -> tuple[str, str, str]:
    session = next((node for node in _elements(root, "session") if node.get("id")), None)
    resultset = next((node for node in _elements(root, "resultset") if node.get("id")), None)
    result = next((node for node in _elements(root, "result") if node.get("id")), None)
    if session is None or resultset is None or result is None:
        raise _provider_error(
            502,
            "NASA Giovanni returned incomplete workflow identifiers.",
            ["Retry the request. If it persists, report it to the API maintainer."],
        )
    return session.get("id", ""), resultset.get("id", ""), result.get("id", "")


def _csv_observations(content: str, dataset: GiovanniDataset) -> list[dict[str, Any]]:
    try:
        rows = list(csv.reader(io.StringIO(content)))
    except csv.Error as exc:
        raise _provider_error(
            502,
            "NASA Giovanni returned invalid CSV data.",
            ["Retry the request. If the CSV remains invalid, report it to the API maintainer."],
        ) from exc
    if len(rows) < 2:
        raise _provider_error(
            502,
            "NASA Giovanni returned no observations.",
            [
                "Try another date range or a smaller area.",
                "Confirm the selected dataset has coverage for the requested period.",
            ],
        )

    header_index = next(
        (
            index
            for index, row in enumerate(rows)
            if any(
                value.strip().lower() in {"time", "date", "time (utc)"}
                for value in row
            )
        ),
        None,
    )
    if header_index is None:
        raise _provider_error(
            502,
            "NASA Giovanni's CSV has no time column.",
            ["Retry the request. If the returned CSV is still malformed, report it to the API maintainer."],
        )
    header = [value.strip().lower() for value in rows[header_index]]
    time_column = next(
        (i for i, value in enumerate(header) if value in {"time", "date", "time (utc)"}),
        None,
    )
    value_column = next(
        (i for i, value in enumerate(header) if dataset.value.lower() in value),
        None,
    )
    if value_column is None:
        value_column = next(
            (i for i in range(len(header)) if i != time_column),
            None,
        )
    if time_column is None or value_column is None:
        raise _provider_error(
            502,
            "NASA Giovanni's CSV has an unexpected column layout.",
            ["Retry the request. If the returned CSV is still malformed, report it to the API maintainer."],
        )

    observations: dict[date, float] = {}
    for row in rows[header_index + 1:]:
        if len(row) <= max(time_column, value_column):
            continue
        try:
            timestamp = date.fromisoformat(row[time_column].strip()[:10])
            value = float(row[value_column].strip())
        except (ValueError, IndexError):
            continue
        month = date(timestamp.year, timestamp.month, 1)
        if timestamp.year < 1 or value in (-999, -9999, -9999.9):
            continue
        if value == float("inf") or value == float("-inf") or value != value:
            continue
        observations[month] = value
    if not observations:
        raise _provider_error(
            502,
            "NASA Giovanni returned no valid observations for this dataset, area, and period.",
            [
                "Choose dates and a location with product coverage.",
                "Try a nearby or larger area and a shorter date range.",
            ],
        )
    return [
        {"timestamp": month.isoformat(), "value": observations[month]}
        for month in sorted(observations)
    ]


def query_giovanni_series(query: GiovanniQuery) -> dict[str, Any]:
    metadata = GIOVANNI_DATASETS[query.dataset]
    west, south, east, north = query.bbox
    start = query.start_date.isoformat()
    end = query.end_date.isoformat()
    service_url = f"{GIOVANNI_BASE_URL}/daac-bin/service_manager.pl"
    initial = _request_text(
        service_url,
        {
            "service": "ArAvTs",
            "data": query.dataset.value,
            "starttime": f"{start}T00:00:00Z",
            "endtime": f"{end}T23:59:59Z",
            "bbox": f"{west},{south},{east},{north}",
            "temporalresolution": "monthly",
            "portal": "GIOVANNI",
            "format": "xml",
        },
    )
    session, resultset, result = _workflow_ids(_xml_root(initial))
    deadline = time.monotonic() + WORKFLOW_TIMEOUT_SECONDS
    output_file: str | None = None

    while time.monotonic() < deadline:
        status_root = _xml_root(
            _request_text(
                service_url,
                {
                    "session": session,
                    "resultset": resultset,
                    "result": result,
                    "format": "xml",
                },
            )
        )
        result_node = next(
            (
                node
                for node in _elements(status_root, "result")
                if node.get("id") == result
            ),
            None,
        )
        status = next(
            (
                node
                for node in result_node.iter()
                if _local_name(node.tag) == "status"
            ),
            None,
        ) if result_node is not None else None
        code_node = next(
            (
                child
                for child in status.iter()
                if _local_name(child.tag) == "code"
            ),
            None,
        ) if status is not None else None
        code_text = code_node.text.strip() if code_node is not None and code_node.text else None
        if code_text is None:
            raise _provider_error(
                502,
                "NASA Giovanni response is missing its workflow status.",
                ["Retry the request. If it persists, report it to the API maintainer."],
            )
        if code_text != "0":
            message = _clean_workflow_message(
                _field(status, "message") if status is not None else None
            )
            reason = message or "No explanation was provided by Giovanni."
            print(
                f"[Giovanni] Workflow failed with status {code_text}"
                f" for dataset {query.dataset.value}, {start} through {end}: {reason}",
                file=sys.stderr,
                flush=True,
            )
            raise _provider_error(
                502,
                (
                    f"NASA Giovanni workflow failed with status {code_text} for "
                    f"{metadata['label']} ({start} through {end}): {reason}"
                ),
                _workflow_recommendations(reason, query.dataset),
            )

        files = (
            [
                element.get("label", "").strip()
                for element in _elements(result_node, "dataUrl")
                if ".areaAvgTimeSeries." in element.get("label", "")
                and element.get("label", "").strip().endswith(".nc")
            ]
            if result_node is not None
            else []
        )
        if files:
            output_file = files[0]
            break
        time.sleep(POLL_INTERVAL_SECONDS)

    if output_file is None:
        print(
            f"[Giovanni] Workflow timed out after {WORKFLOW_TIMEOUT_SECONDS} seconds "
            f"for dataset {query.dataset.value}.",
            file=sys.stderr,
            flush=True,
        )
        raise _provider_error(
            504,
            f"NASA Giovanni did not finish within {WORKFLOW_TIMEOUT_SECONDS} seconds.",
            [
                "Retry the request; Giovanni may be temporarily busy.",
                "Reduce the requested date range and area, then retry.",
            ],
        )

    serializer = _request_text(
        f"{GIOVANNI_BASE_URL}/daac-bin/serializer.pl",
        {
            "SESSION": session,
            "RESULTSET": resultset,
            "RESULT": result,
            "FILE": output_file.rsplit("/", 1)[-1],
        },
        earthdata_login=True,
    )
    return {
        "dataset": query.dataset.value,
        "label": metadata["label"],
        "unit": metadata["unit"],
        "cadence": metadata["cadence"],
        "source": "NASA Giovanni",
        "description": metadata["description"],
        "observations": _csv_observations(serializer, query.dataset),
    }
