import unittest
from datetime import date
from unittest.mock import patch

from fastapi import HTTPException

from api.services import modis


def _block(values, nrows=2, ncols=2):
    return {"cellsize": 926.625, "nrows": nrows, "ncols": ncols, "xllcorner": -10400000.0, "yllcorner": 3700000.0, "subset": [{"calendar_date": "2024-07-19", "data": values}]}


class ModisTests(unittest.TestCase):
    def test_fill_values_are_missing_and_kelvin_is_converted(self) -> None:
        self.assertIsNone(modis._to_celsius(0))
        self.assertAlmostEqual(modis._to_celsius(15000), 15000 * 0.02 - 273.15)

    def test_pixels_are_listed_north_first_and_west_to_east(self) -> None:
        pixels = modis._pixel_centres(_block([1, 2, 3, 4]))
        self.assertEqual(len(pixels), 4)
        self.assertGreater(pixels[0]["north"], pixels[2]["north"])
        self.assertLess(pixels[0]["west"], pixels[1]["west"])
        self.assertAlmostEqual(pixels[0]["north"] - pixels[0]["south"], 0.00833, places=4)

    def test_map_uses_the_composite_nearest_mid_month(self) -> None:
        dates = (("A2024193", date(2024, 7, 11)), ("A2024201", date(2024, 7, 19)), ("A2024209", date(2024, 7, 27)))
        with patch.object(modis, "composite_dates", return_value=dates), patch.object(modis, "_subset", return_value=_block([15000, 0, 15100, 15200])) as subset:
            result = modis.map_for_month(33.4, -112.0, date(2024, 7, 1), 1)
        self.assertEqual(result["composite_date"], date(2024, 7, 19))
        self.assertEqual(subset.call_args.args[2], "A2024201")
        self.assertIsNone(result["pixels"][1]["value"])

    def test_oversized_window_is_rejected(self) -> None:
        with self.assertRaises(HTTPException):
            modis.map_for_month(0, 0, date(2024, 7, 1), 51)

    def test_series_masks_cloudy_composites_and_averages_by_month(self) -> None:
        dates = tuple((f"A{i}", date(2024, 1 + i // 2, 1 + (i % 2) * 10)) for i in range(4))  # 2 composites in Jan, 2 in Feb
        blocks = {"data": [[15000, 15000, 15000, 15000], [15500, 15500, 15500, 15500], [0, 0, 0, 15000], [16000, 16000, 16000, 16000]]}
        def fake(lat, lon, first, last, half):
            return {"subset": [{"calendar_date": d[1].isoformat(), "data": blocks["data"][i]} for i, d in enumerate(dates)]}
        job = {"done": 0, "total": 0}
        with patch.object(modis, "composite_dates", return_value=dates), patch.object(modis, "_subset", side_effect=fake):
            months = modis._series(0, 0, 1, date(2024, 1, 1), date(2024, 3, 1), job)
        self.assertAlmostEqual(months[0]["value"], (15000 + 15500) / 2 * 0.02 - 273.15, places=2)
        self.assertAlmostEqual(months[1]["value"], 16000 * 0.02 - 273.15, places=2)  # the mostly-cloudy composite is dropped
        self.assertIsNone(months[2]["value"])  # no composites in March: a gap, never an invented value
