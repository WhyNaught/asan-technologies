from __future__ import annotations

import httpx
from fastapi import HTTPException
from typing import Any, Mapping
from ..config import API_TIMEOUT

# helper method to call an external endpoint and get a json-formatted string
# this function throws an error if smth goes wrong, make sure to wrap in a try-catch
def call_external_endpoint(
    url: str, params: Mapping[str, str | int | float] | None = None
) -> Any:
    try:
        response = httpx.get(
            url=url,
            params=params,
            timeout=API_TIMEOUT,
        )
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Data provider timed out") from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502, detail="Data provider returned an error"
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502, detail="Could not reach data provider"
        ) from exc

    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502, detail="Data provider returned invalid JSON"
        ) from exc