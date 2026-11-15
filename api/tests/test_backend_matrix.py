import unittest
from datetime import date
from unittest.mock import patch

from fastapi import HTTPException

from api.models.queries import (
    Coordinate,
    GiovanniDataset,
    GiovanniQuery,
    Query,
    UrbanVariable,
)
from api.services.nasa_power import NASA_POWER_PARAMETERS, fetch_monthly_parameters


def _month_offset(year: int, month: int, offset: int) -> date:
    ordinal = year * 12 + month - 1 + offset
    return date(ordinal // 12, ordinal % 12 + 1, 1)


class BackendValidationMatrixTests(unittest.TestCase):
    def test_query_accepts_geographic_and_date_boundary_scenarios(self) -> None:
        for case in range(25):
            with self.subTest(case=case):
                start = _month_offset(1900 + case, case % 12 + 1, 0)
                duration = case + 1
                end = _month_offset(start.year, start.month, duration - 1)
                latitude = -90 + case * 180 / 24
                longitude = 180 - case * 360 / 24
                query = Query(
                    coordinates=[Coordinate(latitude=latitude, longitude=longitude)],
                    variables=[UrbanVariable.AIR_TEMPERATURE],
                    start_date=start,
                    end_date=end,
                )

                self.assertEqual(query.coordinates[0].latitude, latitude)
                self.assertEqual(query.coordinates[0].longitude, longitude)
                self.assertEqual(
                    (query.end_date.year - query.start_date.year) * 12
                    + query.end_date.month - query.start_date.month + 1,
                    duration,
                )

    def test_giovanni_query_accepts_bounding_box_and_month_scenarios(self) -> None:
        datasets = list(GiovanniDataset)
        for case in range(25):
            with self.subTest(case=case):
                west = -180 + case * 7
                south = -90 + case * 3.5
                start = _month_offset(2000 + case, case % 12 + 1, 0)
                duration = case + 1
                query = GiovanniQuery(
                    dataset=datasets[case % len(datasets)],
                    bbox=(west, south, west + 0.25, south + 0.25),
                    start_date=start,
                    end_date=_month_offset(start.year, start.month, duration - 1),
                )

                self.assertEqual(query.bbox[0], west)
                self.assertEqual(query.bbox[2], west + 0.25)
                self.assertEqual(query.bbox[1], south)
                self.assertEqual(
                    (query.end_date.year - query.start_date.year) * 12
                    + query.end_date.month - query.start_date.month + 1,
                    duration,
                )

    def test_nasa_power_parser_preserves_valid_parameter_month_scenarios(self) -> None:
        parameters = list(NASA_POWER_PARAMETERS.values())
        for case in range(25):
            with self.subTest(case=case):
                parameter = parameters[case % len(parameters)]
                start = _month_offset(1990 + case, case % 12 + 1, 0)
                months = [_month_offset(start.year, start.month, offset) for offset in range(case % 12 + 1)]
                expected = {
                    month: case - 12 + index * 0.125
                    for index, month in enumerate(months)
                }
                payload = {
                    "properties": {
                        "parameter": {
                            parameter: {
                                month.strftime("%Y%m"): value
                                for month, value in expected.items()
                            }
                        }
                    }
                }

                with patch(
                    "api.services.nasa_power.call_external_endpoint",
                    return_value=payload,
                ):
                    result = fetch_monthly_parameters(
                        Coordinate(latitude=case - 12, longitude=case * 7 - 84),
                        months,
                        [parameter],
                    )

                self.assertEqual(result[parameter], expected)

    def test_nasa_power_parser_rejects_invalid_value_scenarios(self) -> None:
        parameters = list(NASA_POWER_PARAMETERS.values())
        invalid_values = [
            None,
            -999,
            True,
            float("nan"),
            float("inf"),
            float("-inf"),
            "12.5",
            {"value": 12.5},
            [],
        ]
        months = [date(2022, 1, 1), date(2022, 2, 1), date(2022, 3, 1)]
        for case in range(25):
            with self.subTest(case=case):
                parameter = parameters[case % len(parameters)]
                invalid_month = months[case % len(months)]
                values = {month.strftime("%Y%m"): 1.25 for month in months}
                values[invalid_month.strftime("%Y%m")] = invalid_values[case % len(invalid_values)]
                payload = {"properties": {"parameter": {parameter: values}}}

                with patch(
                    "api.services.nasa_power.call_external_endpoint",
                    return_value=payload,
                ), self.assertRaises(HTTPException) as context:
                    fetch_monthly_parameters(
                        Coordinate(latitude=0, longitude=0),
                        months,
                        [parameter],
                    )

                self.assertEqual(context.exception.status_code, 502)
                self.assertIn(parameter, context.exception.detail)
                self.assertIn(invalid_month.strftime("%Y%m"), context.exception.detail)


if __name__ == "__main__":
    unittest.main()
