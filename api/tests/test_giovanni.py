# SI was at least partially used to write the code in this file
import unittest
from contextlib import redirect_stderr
from datetime import date
from io import StringIO
from unittest.mock import Mock
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.main import app
from api.models.queries import GiovanniDataset, GiovanniQuery
from api.services.giovanni import (
    _csv_observations,
    _request_text,
    query_giovanni_series,
)


class GiovanniQueryTests(unittest.TestCase):
    def test_dataset_catalog_lists_only_integrated_giovanni_variables(self) -> None:
        response = TestClient(app).get("/data/giovanni/datasets")
        self.assertEqual(response.status_code, 200)
        datasets = response.json()["datasets"]
        self.assertEqual(
            {dataset["id"] for dataset in datasets},
            {dataset.value for dataset in GiovanniDataset},
        )
        self.assertTrue(all(dataset["cadence"] == "monthly" for dataset in datasets))
        self.assertIn(
            "MYD08_M3_6_1_Aerosol_Optical_Depth_Land_And_Ocean_Mean_Mean",
            {dataset["id"] for dataset in datasets},
        )

    def test_query_route_rejects_unavailable_dataset_ids(self) -> None:
        response = TestClient(app).post(
            "/data/giovanni/query",
            json={
                "dataset": "not-a-giovanni-dataset",
                "bbox": [-10, -10, 10, 10],
                "start_date": "2015-01-01",
                "end_date": "2015-03-01",
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_query_route_returns_structured_recommendations(self) -> None:
        detail = {
            "message": "NASA Giovanni could not find matching data.",
            "recommendations": ["Try a shorter date range."],
        }
        with patch(
            "api.main.query_giovanni_series",
            side_effect=HTTPException(status_code=502, detail=detail),
        ):
            response = TestClient(app).post(
                "/data/giovanni/query",
                json={
                    "dataset": GiovanniDataset.GPM_PRECIPITATION.value,
                    "bbox": [-112.35, 33.2, -111.8, 33.75],
                    "start_date": "2015-01-01",
                    "end_date": "2015-02-01",
                },
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], detail)

    def test_query_submits_bbox_polls_and_serializes_monthly_series(self) -> None:
        initial = (
            '<session id="session-1"><resultset id="set-1">'
            '<result id="result-1"/></resultset></session>'
        )
        complete = (
            '<session id="session-1"><resultset id="set-1"><result id="result-1">'
            '<status><code>0</code><message>Workflow completed</message></status>'
            '<data><fileGroup><dataFile><dataUrl label="g4.areaAvgTimeSeries.GPM_3IMERGM_07_precipitation.nc">'
            'https://giovanni.gsfc.nasa.gov/session/result/g4.areaAvgTimeSeries.GPM_3IMERGM_07_precipitation.nc'
            '</dataUrl></dataFile></fileGroup></data>'
            '</result></resultset></session>'
        )
        csv_data = (
            "Title: Monthly area-averaged time series\n"
            "\n"
            "time,GPM_3IMERGM_07_precipitation\n"
            "2015-01-01T00:00:00Z,1.25\n"
            "2015-02-01T00:00:00Z,2.5\n"
        )
        query = GiovanniQuery(
            dataset=GiovanniDataset.GPM_PRECIPITATION,
            bbox=(-112.35, 33.2, -111.8, 33.75),
            start_date=date(2015, 1, 1),
            end_date=date(2015, 2, 1),
        )
        with patch(
            "api.services.giovanni._request_text",
            side_effect=[initial, complete, csv_data],
        ) as request:
            result = query_giovanni_series(query)

        self.assertEqual(
            result["observations"],
            [
                {"timestamp": "2015-01-01", "value": 1.25},
                {"timestamp": "2015-02-01", "value": 2.5},
            ],
        )
        self.assertEqual(result["source"], "NASA Giovanni")
        self.assertEqual(request.call_count, 3)
        launch_params = request.call_args_list[0].args[1]
        self.assertEqual(launch_params["service"], "ArAvTs")
        self.assertEqual(launch_params["data"], "GPM_3IMERGM_07_precipitation")
        self.assertEqual(launch_params["temporalresolution"], "monthly")
        self.assertEqual(launch_params["bbox"], "-112.35,33.2,-111.8,33.75")
        serializer_params = request.call_args_list[2].args[1]
        self.assertEqual(
            serializer_params["FILE"],
            "g4.areaAvgTimeSeries.GPM_3IMERGM_07_precipitation.nc",
        )

    def test_workflow_failure_includes_giovanni_error_message(self) -> None:
        initial = (
            '<session id="session-1"><resultset id="set-1">'
            '<result id="result-1"/></resultset></session>'
        )
        failed = (
            '<session id="session-1"><resultset id="set-1"><result id="result-1">'
            '<status><code>2</code><message>Could not find requested data</message></status>'
            '</result></resultset></session>'
        )
        query = GiovanniQuery(
            dataset=GiovanniDataset.GPM_PRECIPITATION,
            bbox=(-112.35, 33.2, -111.8, 33.75),
            start_date=date(2015, 1, 1),
            end_date=date(2015, 2, 1),
        )
        with patch(
            "api.services.giovanni._request_text",
            side_effect=[initial, failed],
        ):
            with self.assertRaises(HTTPException) as context:
                query_giovanni_series(query)

        self.assertEqual(context.exception.status_code, 502)
        self.assertIn("status 2", context.exception.detail["message"])
        self.assertIn("Could not find requested data", context.exception.detail["message"])
        self.assertTrue(context.exception.detail["recommendations"])
        self.assertIn("up to 5 months", context.exception.detail["recommendations"][0])

    def test_workflow_message_is_cleaned_and_gets_aod_specific_recommendations(self) -> None:
        from api.services.giovanni import (
            _clean_workflow_message,
            _workflow_recommendations,
        )

        message = _clean_workflow_message(
            "Finished searching for data.... Workflow failed&lt;br/&gt;"
            "Please send us <span>feedback</span> describing the problem."
        )

        self.assertEqual(
            message,
            "Finished searching for data.... Workflow failed Please send us feedback "
            "describing the problem.",
        )
        recommendations = _workflow_recommendations(
            message or "", GiovanniDataset.AQUA_AEROSOL_OPTICAL_DEPTH
        )
        self.assertIn("July 2002 onward", recommendations[0])

    def test_catalog_miss_recommends_verifying_giovanni_field_not_changing_dates(self) -> None:
        from api.services.giovanni import _workflow_recommendations

        recommendations = _workflow_recommendations(
            "Could not find MYD08_M3_6_1_Aerosol_Optical_Depth_Land_And_Ocean_Mean_Mean "
            "in our data catalog",
            GiovanniDataset.AQUA_AEROSOL_OPTICAL_DEPTH,
        )

        self.assertIn("Giovanni does not recognize this dataset ID", recommendations[0])
        self.assertIn("AESIR", recommendations[1])
        self.assertNotIn("date range", " ".join(recommendations))

    def test_serializer_reports_missing_earthdata_credentials(self) -> None:
        redirect = Mock(
            is_redirect=True,
            status_code=302,
            headers={"location": "https://urs.earthdata.nasa.gov/oauth/authorize"},
            url="https://giovanni.gsfc.nasa.gov/serializer.pl",
        )
        with patch.dict(
            "os.environ",
            {"EARTHDATA_USERNAME": "", "EARTHDATA_PASSWORD": ""},
        ), patch("api.services.giovanni.httpx.get", return_value=redirect):
            diagnostics = StringIO()
            with redirect_stderr(diagnostics):
                with self.assertRaises(HTTPException) as context:
                    _request_text(
                        "https://giovanni.gsfc.nasa.gov/serializer.pl",
                        {},
                        earthdata_login=True,
                    )

        self.assertEqual(context.exception.status_code, 502)
        self.assertIn(
            "EARTHDATA_USERNAME",
            context.exception.detail["recommendations"][0],
        )
        self.assertIn("Earthdata Login is required", diagnostics.getvalue())

    def test_serializer_uses_credentials_only_after_earthdata_redirect(self) -> None:
        redirect = Mock(
            is_redirect=True,
            status_code=302,
            headers={"location": "https://urs.earthdata.nasa.gov/oauth/authorize"},
            url="https://giovanni.gsfc.nasa.gov/serializer.pl",
        )
        csv_response = Mock(
            is_redirect=False,
            headers={"content-type": "text/csv"},
            text="time,value\n2015-01-01,1\n",
        )
        with patch.dict(
            "os.environ",
            {"EARTHDATA_USERNAME": "test-user", "EARTHDATA_PASSWORD": "test-password"},
        ), patch(
            "api.services.giovanni.httpx.get",
            side_effect=[redirect, csv_response],
        ) as get:
            content = _request_text(
                "https://giovanni.gsfc.nasa.gov/serializer.pl",
                {},
                earthdata_login=True,
            )

        self.assertEqual(content, "time,value\n2015-01-01,1\n")
        self.assertEqual(get.call_args_list[1].args[0], "https://urs.earthdata.nasa.gov/oauth/authorize")
        self.assertEqual(
            get.call_args_list[1].kwargs["auth"],
            ("test-user", "test-password"),
        )
        self.assertTrue(get.call_args_list[1].kwargs["follow_redirects"])

    def test_csv_omits_fill_values_and_invalid_rows(self) -> None:
        csv_data = (
            "time,MYD08_M3_6_1_Aerosol_Optical_Depth_Land_And_Ocean_Mean_Mean\n"
            "2015-01-01T00:00:00Z,0.2\n"
            "2015-02-01T00:00:00Z,-9999\n"
            "not-a-date,0.3\n"
        )
        rows = _csv_observations(
            csv_data, GiovanniDataset.AQUA_AEROSOL_OPTICAL_DEPTH
        )
        self.assertEqual(rows, [{"timestamp": "2015-01-01", "value": 0.2}])

    def test_csv_without_valid_rows_returns_provider_error(self) -> None:
        with self.assertRaises(HTTPException) as context:
            _csv_observations(
                "time,value\n2015-01-01,-9999\n",
                GiovanniDataset.GPM_PRECIPITATION,
            )
        self.assertEqual(context.exception.status_code, 502)

    def test_query_rejects_invalid_bounding_box_and_months(self) -> None:
        with self.assertRaises(ValueError):
            GiovanniQuery(
                dataset=GiovanniDataset.GPM_PRECIPITATION,
                bbox=(10, 20, -10, 30),
                start_date=date(2015, 1, 1),
                end_date=date(2015, 2, 1),
            )
        with self.assertRaises(ValueError):
            GiovanniQuery(
                dataset=GiovanniDataset.GPM_PRECIPITATION,
                bbox=(-10, -10, 10, 10),
                start_date=date(2015, 1, 2),
                end_date=date(2015, 2, 1),
            )


if __name__ == "__main__":
    unittest.main()
