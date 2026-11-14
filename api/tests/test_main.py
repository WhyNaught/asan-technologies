import unittest
from datetime import date
from unittest.mock import call, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.main import app
from api.models.queries import Coordinate
from api.services.nasa_power import fetch_monthly_parameters


class DataQueryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_query_returns_monthly_series_for_each_coordinate_and_variable(self) -> None:
        months = [date(2024, 1, 1), date(2024, 2, 1), date(2024, 3, 1)]
        with patch(
            "api.main.fetch_monthly_parameters",
            side_effect=[
                {"T2M": dict(zip(months, [2.5, 3.5, 4.5]))},
                {"T2M": dict(zip(months, [12.5, 13.5, 14.5]))},
            ],
        ) as fetch_temperature:
            response = self.client.post(
                "/data/query",
                json={
                    "coordinates": [
                        {"latitude": 40.7128, "longitude": -74.006},
                        {"latitude": 34.0522, "longitude": -118.2437},
                    ],
                    "variables": ["air_temperature", "night_light_radiance"],
                    "start_date": "2024-01-01",
                    "end_date": "2024-03-01",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["data_mode"], "mixed")
        self.assertEqual(len(payload["locations"]), 2)
        fetch_temperature.assert_has_calls(
            [
                call(
                    Coordinate(latitude=40.7128, longitude=-74.006),
                    months,
                    ["T2M"],
                ),
                call(
                    Coordinate(latitude=34.0522, longitude=-118.2437),
                    months,
                    ["T2M"],
                ),
            ]
        )
        for index, location in enumerate(payload["locations"]):
            self.assertEqual(len(location["series"]), 2)
            temperature_series = location["series"][0]
            synthetic_series = location["series"][1]
            self.assertEqual(temperature_series["source"], "NASA POWER")
            self.assertEqual(
                [item["value"] for item in temperature_series["observations"]],
                [2.5, 3.5, 4.5] if index == 0 else [12.5, 13.5, 14.5],
            )
            self.assertEqual(synthetic_series["source"], "synthetic")
            for series in location["series"]:
                self.assertEqual(series["cadence"], "monthly")
                self.assertEqual(
                    [item["timestamp"] for item in series["observations"]],
                    ["2024-01-01", "2024-02-01", "2024-03-01"],
                )

    def test_variables_endpoint_lists_provider_metadata(self) -> None:
        response = self.client.get("/data/variables")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["data_mode"], "mixed")
        self.assertEqual(
            {item["id"] for item in payload["variables"]},
            {
                "land_surface_temperature",
                "air_temperature",
                "relative_humidity",
                "dew_point_temperature",
                "night_light_radiance",
            },
        )
        air_temperature = next(
            item
            for item in payload["variables"]
            if item["id"] == "air_temperature"
        )
        self.assertEqual(air_temperature["source"], "NASA POWER")
        self.assertEqual(air_temperature["parameter"], "T2M")

    def test_nasa_power_service_requests_multiple_parameters(self) -> None:
        provider_response = {
            "properties": {
                "parameter": {
                    "T2M": {
                        "202201": 0.3,
                        "202202": 2.1,
                        "202213": 12.71,
                    },
                    "RH2M": {"202201": 80.0, "202202": 75.0, "202213": 77.5},
                    "T2MDEW": {"202201": -1.0, "202202": 0.0, "202213": -0.5},
                    "TS": {"202201": 1.0, "202202": 3.0, "202213": 2.0},
                }
            }
        }
        months = [date(2022, 1, 1), date(2022, 2, 1)]
        coordinate = Coordinate(latitude=40.7128, longitude=-74.006)
        with patch(
            "api.services.nasa_power.call_external_endpoint",
            return_value=provider_response,
        ) as call_provider:
            results = fetch_monthly_parameters(
                coordinate, months, ["T2M", "RH2M", "T2MDEW", "TS"]
            )

        self.assertEqual(
            results["T2M"],
            {date(2022, 1, 1): 0.3, date(2022, 2, 1): 2.1},
        )
        self.assertEqual(results["RH2M"][date(2022, 1, 1)], 80.0)
        self.assertEqual(results["T2MDEW"][date(2022, 2, 1)], 0.0)
        self.assertEqual(results["TS"][date(2022, 1, 1)], 1.0)
        self.assertEqual(
            call_provider.call_args.args[0],
            "https://power.larc.nasa.gov/api/temporal/monthly/point",
        )
        self.assertEqual(
            call_provider.call_args.kwargs["params"],
            {
                "parameters": "T2M,RH2M,T2MDEW,TS",
                "community": "SB",
                "longitude": -74.006,
                "latitude": 40.7128,
                "start": 2022,
                "end": 2022,
                "format": "JSON",
            },
        )

    def test_catalog_lists_all_requested_nasa_power_parameters(self) -> None:
        response = self.client.get("/data/variables")
        self.assertEqual(response.status_code, 200)
        variables = {item["id"]: item for item in response.json()["variables"]}
        self.assertEqual(variables["land_surface_temperature"]["parameter"], "TS")
        self.assertEqual(variables["relative_humidity"]["parameter"], "RH2M")
        self.assertEqual(variables["dew_point_temperature"]["parameter"], "T2MDEW")
        self.assertEqual(variables["relative_humidity"]["unit"], "%")

    def test_query_returns_ts_rh2m_and_t2mdew_series(self) -> None:
        month = date(2022, 1, 1)
        with patch(
            "api.main.fetch_monthly_parameters",
            return_value={
                "TS": {month: 12.0},
                "RH2M": {month: 65.0},
                "T2MDEW": {month: 8.0},
            },
        ) as fetch_parameters:
            response = self.client.post(
                "/data/query",
                json={
                    "coordinates": [{"latitude": 40.7, "longitude": -74.0}],
                    "variables": [
                        "land_surface_temperature",
                        "relative_humidity",
                        "dew_point_temperature",
                    ],
                    "start_date": "2022-01-01",
                    "end_date": "2022-01-01",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["data_mode"], "nasa_power")
        series = payload["locations"][0]["series"]
        self.assertEqual(
            [item["observations"][0]["value"] for item in series],
            [12.0, 65.0, 8.0],
        )
        self.assertTrue(all(item["source"] == "NASA POWER" for item in series))
        fetch_parameters.assert_called_once_with(
            Coordinate(latitude=40.7, longitude=-74.0),
            [month],
            ["TS", "RH2M", "T2MDEW"],
        )

    def test_air_temperature_only_query_uses_nasa_power_mode(self) -> None:
        with patch(
            "api.main.fetch_monthly_parameters",
            return_value={"T2M": {date(2022, 1, 1): 0.3}},
        ):
            response = self.client.post(
                "/data/query",
                json={
                    "coordinates": [{"latitude": 40.7128, "longitude": -74.006}],
                    "variables": ["air_temperature"],
                    "start_date": "2022-01-01",
                    "end_date": "2022-01-01",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["data_mode"], "nasa_power")
        self.assertEqual(payload["locations"][0]["series"][0]["source"], "NASA POWER")
        self.assertEqual(
            payload["locations"][0]["series"][0]["observations"][0]["value"],
            0.3,
        )

    def test_nasa_power_service_rejects_missing_month_data(self) -> None:
        with patch(
            "api.services.nasa_power.call_external_endpoint",
            return_value={
                "properties": {"parameter": {"T2M": {"202201": -999}}}
            },
        ):
            with self.assertRaises(HTTPException) as context:
                fetch_monthly_parameters(
                    Coordinate(latitude=0, longitude=0),
                    [date(2022, 1, 1)],
                    ["T2M"],
                )

        self.assertEqual(context.exception.status_code, 502)

    def test_query_rejects_out_of_range_coordinates_and_partial_months(self) -> None:
        valid_query = {
            "coordinates": [{"latitude": 0, "longitude": 0}],
            "variables": ["air_temperature"],
            "start_date": "2024-01-01",
            "end_date": "2024-03-01",
        }

        invalid_coordinate_query = {
            **valid_query,
            "coordinates": [{"latitude": 91, "longitude": 0}],
        }
        partial_month_query = {**valid_query, "start_date": "2024-01-02"}

        self.assertEqual(
            self.client.post("/data/query", json=invalid_coordinate_query).status_code,
            422,
        )
        self.assertEqual(
            self.client.post("/data/query", json=partial_month_query).status_code,
            422,
        )


if __name__ == "__main__":
    unittest.main()
