import unittest

from fastapi.testclient import TestClient

from api.main import app


class DataQueryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_query_returns_monthly_series_for_each_coordinate_and_variable(self) -> None:
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
        self.assertEqual(payload["data_mode"], "synthetic")
        self.assertEqual(len(payload["locations"]), 2)
        for location in payload["locations"]:
            self.assertEqual(len(location["series"]), 2)
            for series in location["series"]:
                self.assertEqual(series["source"], "synthetic")
                self.assertEqual(series["cadence"], "monthly")
                self.assertEqual(
                    [item["timestamp"] for item in series["observations"]],
                    ["2024-01-01", "2024-02-01", "2024-03-01"],
                )

    def test_variables_endpoint_lists_synthetic_catalog(self) -> None:
        response = self.client.get("/data/variables")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["data_mode"], "synthetic")
        self.assertEqual(
            {item["id"] for item in payload["variables"]},
            {
                "land_surface_temperature",
                "air_temperature",
                "night_light_radiance",
            },
        )

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
