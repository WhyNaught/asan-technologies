import httpx
from fastapi import HTTPException
from typing import Dict

# helper method to call an external endpoint and get a json-formatted string
def call_external_endpoint(url: str, params: Dict = {}) -> str:
    try:
        response = httpx.get(
            url=url,
            params=params, 
            timeout=10.0,
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

    provider_data = response.json()
    return provider_data