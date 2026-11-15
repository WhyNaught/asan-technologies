from __future__ import annotations

import unittest
from io import BytesIO
from unittest.mock import Mock, patch
from zipfile import ZipFile

from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.main import app
from api.models.queries import (
    AppEEARSProduct,
    AppEEARSQueryResponse,
    AppEEARSRequest,
)
from api.services.nasa_appeears import (
    download_appeears_product,
    query_appeears_product,
    _task_status,
)


def _response(payload: object | None = None, content: bytes = b"") -> Mock:
    response = Mock()
    response.json.return_value = payload
    response.content = content
    response.raise_for_status.return_value = None
    return response


class AppEEARSTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.request = AppEEARSRequest(
            coordinates=[{"latitude": 40.7, "longitude": -74.0}],
            product=AppEEARSProduct.MOD11A1,
            start_date="2024-01-01",
            end_date="2024-01-02",
        )

    def test_product_catalog_only_lists_products_available_in_appeears(self) -> None:
        response = self.client.get("/data/appeears/products")

        self.assertEqual(response.status_code, 200)
        products = {item["id"]: item for item in response.json()["products"]}
        self.assertEqual(
            set(products),
            {"MOD11A1", "MYD11A1", "MOD11A2"},
        )
        self.assertEqual(products["MOD11A1"]["product_id"], "MOD11A1.061")
        self.assertEqual(
            products["MOD11A1"]["layers"],
            ["LST_Day_1km", "LST_Night_1km"],
        )
        self.assertEqual(products["MOD11A2"]["cadence"], "8-day")

    def test_product_request_downloads_bundle_and_returns_zip_archive(self) -> None:
        provider_responses = [
            _response({"token": "test-token"}),
            _response({"task_id": "task-123"}),
            _response([{"status": "done"}]),
            _response({"files": [{"file_id": "file-1", "file_name": "results.csv"}]}),
            _response(content=b"Date,LST_Day_1km\n2024-01-01,300"),
        ]
        with (
            patch.dict(
                "os.environ",
                {
                    "EARTHDATA_USERNAME": "test-user",
                    "EARTHDATA_PASSWORD": "test-password",
                },
            ),
            patch(
                "api.services.nasa_appeears.httpx.request",
                side_effect=provider_responses,
            ) as request_provider,
            patch("api.services.nasa_appeears.time.sleep"),
        ):
            task_id, archive = download_appeears_product(self.request)

        self.assertEqual(task_id, "task-123")
        with ZipFile(BytesIO(archive)) as zip_file:
            self.assertEqual(zip_file.namelist(), ["results.csv"])
            self.assertEqual(
                zip_file.read("results.csv"),
                b"Date,LST_Day_1km\n2024-01-01,300",
            )

        login_call = request_provider.call_args_list[0]
        self.assertEqual(login_call.args[0], "POST")
        self.assertTrue(login_call.args[1].endswith("/api/login"))
        self.assertEqual(
            login_call.kwargs["auth"],
            ("test-user", "test-password"),
        )
        task_call = request_provider.call_args_list[1]
        self.assertEqual(task_call.args[0], "POST")
        self.assertTrue(task_call.args[1].endswith("/api/task"))
        task_payload = task_call.kwargs["json"]
        self.assertEqual(task_payload["task_type"], "point")
        self.assertEqual(
            task_payload["params"]["dates"],
            [{"startDate": "01-01-2024", "endDate": "01-02-2024"}],
        )
        self.assertEqual(
            task_payload["params"]["layers"],
            [
                {"product": "MOD11A1.061", "layer": "LST_Day_1km"},
                {"product": "MOD11A1.061", "layer": "LST_Night_1km"},
            ],
        )
        self.assertEqual(
            task_call.kwargs["headers"],
            {"Authorization": "Bearer test-token"},
        )

    def test_login_requires_both_environment_credentials(self) -> None:
        with (
            patch.dict("os.environ", {}, clear=True),
            self.assertRaises(HTTPException) as context,
        ):
            download_appeears_product(self.request)

        self.assertEqual(context.exception.status_code, 503)

    def test_task_status_accepts_direct_and_enveloped_status_shapes(self) -> None:
        self.assertEqual(_task_status({"task_status": "Running"}), "running")
        self.assertEqual(_task_status({"data": {"status": "Done"}}), "done")
        self.assertEqual(_task_status([{"status": "Queued"}]), "queued")

    def test_task_status_error_reports_response_shape(self) -> None:
        with self.assertRaises(HTTPException) as context:
            _task_status({"task_id": "task-123", "progress": 20})

        self.assertEqual(context.exception.status_code, 502)
        self.assertIn("progress, task_id", context.exception.detail)

    def test_request_endpoint_returns_zip_download(self) -> None:
        with patch(
            "api.main.download_appeears_product",
            return_value=("task-123", b"archive"),
        ) as download:
            response = self.client.post(
                "/data/appeears/request",
                json={
                    "coordinates": [{"latitude": 40.7, "longitude": -74.0}],
                    "product": "MYD11A1",
                    "start_date": "2024-01-01",
                    "end_date": "2024-01-31",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"archive")
        self.assertEqual(response.headers["content-type"], "application/zip")
        self.assertIn(
            "appeears_MYD11A1_task-123.zip",
            response.headers["content-disposition"],
        )
        download.assert_called_once()

    def test_query_converts_point_csv_to_daily_celsius_series(self) -> None:
        csv_content = (
            "Date,Latitude,Longitude,ID,MOD11A1.061__LST_Day_1km,"
            "MOD11A1.061__LST_Night_1km\n"
            "2024-01-02,40.7,-74.0,1,300,290\n"
            "2024-01-01,40.7,-74.0,1,0,-9999\n"
        ).encode()
        archive_buffer = BytesIO()
        with ZipFile(archive_buffer, "w") as archive:
            archive.writestr("points.csv", csv_content)

        with patch(
            "api.services.nasa_appeears.download_appeears_product",
            return_value=("task-123", archive_buffer.getvalue()),
        ):
            result = query_appeears_product(self.request)

        self.assertEqual(result.cadence, "daily")
        self.assertEqual(result.product, AppEEARSProduct.MOD11A1)
        location = result.locations[0]
        self.assertEqual(location.coordinate.latitude, 40.7)
        day_series, night_series = location.series
        self.assertEqual(day_series.variable, "daytime_surface_temperature")
        self.assertEqual(day_series.unit, "°C")
        self.assertEqual(
            [(item.timestamp.isoformat(), item.value) for item in day_series.observations],
            [("2024-01-01", None), ("2024-01-02", 26.85)],
        )
        self.assertEqual(
            [(item.timestamp.isoformat(), item.value) for item in night_series.observations],
            [("2024-01-01", None), ("2024-01-02", 16.85)],
        )

    def test_appeears_query_endpoint_returns_appeears_time_series(self) -> None:
        with patch(
            "api.main.query_appeears_product",
            return_value=AppEEARSQueryResponse.model_validate(
                {
                    "product": "MOD11A2",
                    "cadence": "8-day",
                    "requested_period": ("2024-01-01", "2024-01-31"),
                    "locations": [
                        {
                            "coordinate": {"latitude": 40.7, "longitude": -74.0},
                            "series": [
                                {
                                    "variable": "daytime_surface_temperature",
                                    "label": "Daytime surface temperature",
                                    "layer": "LST_Day_1km",
                                    "unit": "°C",
                                    "cadence": "8-day",
                                    "source": "NASA APPEEARS",
                                    "observations": [
                                        {"timestamp": "2024-01-01", "value": 26.85}
                                    ],
                                },
                                {
                                    "variable": "nighttime_surface_temperature",
                                    "label": "Nighttime surface temperature",
                                    "layer": "LST_Night_1km",
                                    "unit": "°C",
                                    "cadence": "8-day",
                                    "source": "NASA APPEEARS",
                                    "observations": [
                                        {"timestamp": "2024-01-01", "value": 16.85}
                                    ],
                                },
                            ],
                        }
                    ],
                }
            ),
        ):
            response = self.client.post(
                "/data/appeears/query",
                json={
                    "coordinates": [{"latitude": 40.7, "longitude": -74.0}],
                    "product": "MOD11A2",
                    "start_date": "2024-01-01",
                    "end_date": "2024-01-31",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["data_mode"], "nasa_appeears")
        self.assertEqual(payload["cadence"], "8-day")
        self.assertEqual(payload["product"], "MOD11A2")
        series = payload["locations"][0]["series"]
        self.assertEqual(
            [item["variable"] for item in series],
            ["daytime_surface_temperature", "nighttime_surface_temperature"],
        )
        self.assertEqual(
            series[0]["observations"][0]["value"],
            26.85,
        )

    def test_power_query_rejects_appeears_product_selection(self) -> None:
        response = self.client.post(
            "/data/query",
            json={
                "coordinates": [{"latitude": 40.7, "longitude": -74.0}],
                "variables": ["air_temperature", "MOD11A1"],
                "start_date": "2024-01-01",
                "end_date": "2024-03-01",
            },
        )

        self.assertEqual(response.status_code, 422)

    def test_request_endpoint_rejects_unknown_or_duplicate_inputs(self) -> None:
        base_request = {
            "coordinates": [{"latitude": 40.7, "longitude": -74.0}],
            "product": "MOD11C3",
            "start_date": "2024-01-01",
            "end_date": "2024-01-31",
        }
        unknown_product = self.client.post(
            "/data/appeears/request", json=base_request
        )
        duplicate_coordinates = self.client.post(
            "/data/appeears/request",
            json={
                **base_request,
                "product": "MOD11A1",
                "coordinates": [
                    {"latitude": 40.7, "longitude": -74.0},
                    {"latitude": 40.7, "longitude": -74.0},
                ],
            },
        )

        self.assertEqual(unknown_product.status_code, 422)
        self.assertEqual(duplicate_coordinates.status_code, 422)


if __name__ == "__main__":
    unittest.main()
