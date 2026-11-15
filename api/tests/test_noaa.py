import unittest
from datetime import date
from unittest.mock import patch

from fastapi import HTTPException

from api.models.queries import Coordinate
from api.services import noaa


class NoaaTests(unittest.TestCase):
    def test_oni_maps_season_to_centre_month(self) -> None:
        noaa._oni_table.cache_clear()
        text = "SEAS  YR   TOTAL   ANOM\n DJF 2024   26.0   1.80\n JFM 2024   26.5   1.50\n"
        with patch("api.services.noaa.httpx.get") as get:
            get.return_value.raise_for_status.return_value.text = text
            result = noaa.fetch_oni([date(2024, 1, 1), date(2024, 2, 1)])
        noaa._oni_table.cache_clear()
        self.assertEqual(result, {date(2024, 1, 1): 1.8, date(2024, 2, 1): 1.5})

    def test_oni_missing_month_fails_loudly(self) -> None:
        noaa._oni_table.cache_clear()
        with patch("api.services.noaa.httpx.get") as get:
            get.return_value.raise_for_status.return_value.text = "SEAS YR TOTAL ANOM\n"
            with self.assertRaises(HTTPException):
                noaa.fetch_oni([date(2024, 1, 1)])
        noaa._oni_table.cache_clear()

    def test_sst_returns_none_over_land_and_values_over_ocean(self) -> None:
        noaa._sst_cached.cache_clear()
        months = [date(2024, 1, 1), date(2024, 2, 1)]
        ocean = {"table": {"rows": [["2024-01-16T12:00:00Z", 0.5, -139.5, 27.7], ["2024-02-16T12:00:00Z", 0.5, -139.5, 27.9]]}}
        land = {"table": {"rows": [["2024-01-16T12:00:00Z", 33.5, -111.5, None], ["2024-02-16T12:00:00Z", 33.5, -111.5, None]]}}
        with patch("api.services.noaa.call_external_endpoint", side_effect=[ocean, land]):
            self.assertEqual(noaa.fetch_sst_series(Coordinate(latitude=0.2, longitude=-139.2), months), {months[0]: 27.7, months[1]: 27.9})
            self.assertIsNone(noaa.fetch_sst_series(Coordinate(latitude=33.2, longitude=-111.8), months))
        noaa._sst_cached.cache_clear()
