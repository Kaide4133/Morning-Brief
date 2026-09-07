import json
import math
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

import water_market


TAIPEI = ZoneInfo("Asia/Taipei")


class ParseMonthlyPayloadTests(unittest.TestCase):
    def test_parses_roc_dates_and_comma_closes(self):
        payload = {
            "stat": "OK",
            "date": "20260501",
            "fields": ["日期", "開盤指數", "最高指數", "最低指數", "收盤指數"],
            "data": [
                ["115/05/04", "19,900.00", "20,100.00", "19,800.00", "20,012.34"],
                ["115/05/05", "20,010.00", "20,200.00", "19,950.00", "20,100.50"],
            ],
        }

        rows = water_market.parse_month_payload(payload, "2026-05")

        self.assertEqual(
            rows,
            [
                {"date": "2026-05-04", "close": 20012.34},
                {"date": "2026-05-05", "close": 20100.5},
            ],
        )

    def test_parses_openapi_shape(self):
        payload = [
            {
                "Date": "1150904",
                "OpeningIndex": "45991.28",
                "HighestIndex": "46620.96",
                "LowestIndex": "45966.86",
                "ClosingIndex": "46551.13",
            }
        ]
        self.assertEqual(
            water_market.parse_month_payload(payload, "2026-09"),
            [{"date": "2026-09-04", "close": 46551.13}],
        )

    def test_rejects_invalid_roc_date_duplicate_and_bad_close(self):
        base = {
            "stat": "OK",
            "fields": ["日期", "開盤指數", "最高指數", "最低指數", "收盤指數"],
        }
        bad_sets = [
            [["115/02/30", "1", "1", "1", "20,000"]],
            [
                ["115/05/04", "1", "1", "1", "20,000"],
                ["115/05/04", "1", "1", "1", "20,001"],
            ],
            [["115/05/04", "1", "1", "1", "NaN"]],
            [["115/05/04", "1", "1", "1", "0"]],
            [["115/06/01", "1", "1", "1", "20,000"]],
        ]
        for data in bad_sets:
            with self.subTest(data=data):
                with self.assertRaises(ValueError):
                    water_market.parse_month_payload(dict(base, data=data), "2026-05")


class CutoffTests(unittest.TestCase):
    def test_does_not_admit_todays_row_before_publication_cutoff(self):
        rows = [
            {"date": "2026-09-04", "close": 46551.13},
            {"date": "2026-09-07", "close": 47000.0},
        ]
        noon = datetime(2026, 9, 7, 12, 0, tzinfo=TAIPEI)
        after_close = datetime(2026, 9, 7, 14, 0, tzinfo=TAIPEI)

        self.assertEqual(
            water_market.completed_rows(rows, noon),
            [{"date": "2026-09-04", "close": 46551.13}],
        )
        self.assertEqual(water_market.completed_rows(rows, after_close), rows)


class ComparisonTests(unittest.TestCase):
    def test_union_statuses_and_no_silent_fill(self):
        cache = {
            "schema_version": 1,
            "source_name": water_market.SOURCE_NAME,
            "retrieved_at": "2026-09-07T11:50:00+08:00",
            "months": {
                "2026-05": {"status": "complete", "coverage_end": "2026-05-31"},
                "2026-09": {"status": "partial", "coverage_end": "2026-09-04"},
            },
            "rows": [
                {"date": "2026-05-04", "close": 20000.0},
                {"date": "2026-05-06", "close": 20100.0},
                {"date": "2026-09-04", "close": 46551.13},
            ],
        }
        records = [
            {"date": "2026-05-01", "date_display": "05/01", "water_level": 63.8, "scenario_label": "02"},
            {"date": "2026-05-05", "date_display": "05/05", "water_level": 61.6, "scenario_label": "02"},
            {"date": "2026-06-01", "date_display": "06/01", "water_level": 65.0, "scenario_label": "03"},
            {"date": "2026-09-07", "date_display": "09/07", "water_level": 68.7, "scenario_label": "04"},
        ]
        now = datetime(2026, 9, 7, 12, 0, tzinfo=TAIPEI)

        result = water_market.comparison_from_cache(records, cache, now=now)
        by_date = {row["date"]: row for row in result["rows"]}

        self.assertEqual(list(by_date), sorted(by_date))
        self.assertEqual(by_date["2026-05-04"]["market_status"], "closed")
        self.assertIsNone(by_date["2026-05-04"]["water_level"])
        self.assertEqual(by_date["2026-05-01"]["market_status"], "non_trading")
        self.assertIsNone(by_date["2026-05-01"]["taiex_close"])
        self.assertEqual(by_date["2026-05-05"]["market_status"], "non_trading")
        self.assertIsNone(by_date["2026-05-05"]["taiex_close"])
        self.assertEqual(by_date["2026-06-01"]["market_status"], "missing")
        self.assertIsNone(by_date["2026-06-01"]["taiex_close"])
        self.assertEqual(by_date["2026-09-07"]["market_status"], "pending")
        self.assertIsNone(by_date["2026-09-07"]["taiex_close"])
        self.assertEqual(result["market_as_of"], "2026-09-04")

    def test_water_level_accepts_closed_interval_zero_to_one_hundred(self):
        cache = {
            "schema_version": 1,
            "source_name": water_market.SOURCE_NAME,
            "retrieved_at": None,
            "months": {},
            "rows": [],
        }
        records = [
            {"date": "2026-05-01", "water_level": 0},
            {"date": "2026-05-02", "water_level": 100},
            {"date": "2026-05-03", "water_level": None},
        ]
        result = water_market.comparison_from_cache(
            records,
            cache,
            now=datetime(2026, 9, 7, 12, 0, tzinfo=TAIPEI),
        )
        self.assertEqual(
            [row["water_level"] for row in result["rows"]],
            [0.0, 100.0, None],
        )

    def test_water_level_rejects_out_of_range_or_nonfinite_values(self):
        cache = {
            "schema_version": 1,
            "source_name": water_market.SOURCE_NAME,
            "retrieved_at": None,
            "months": {},
            "rows": [],
        }
        for value in (-0.01, 100.01, math.nan, math.inf, -math.inf, True):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    water_market.comparison_from_cache(
                        [{"date": "2026-05-01", "water_level": value}],
                        cache,
                        now=datetime(2026, 9, 7, 12, 0, tzinfo=TAIPEI),
                    )


class CacheFailureTests(unittest.TestCase):
    def test_source_failure_preserves_verified_cache_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            cache_path = root / "docs" / "taiex-history.json"
            original = {
                "schema_version": 1,
                "source_name": water_market.SOURCE_NAME,
                "retrieved_at": "2026-08-31T14:00:00+08:00",
                "months": {
                    "2026-08": {
                        "status": "complete",
                        "coverage_end": "2026-08-31",
                        "request_url": "https://www.twse.com.tw/example",
                        "retrieved_at": "2026-08-31T14:00:00+08:00",
                        "row_count": 1,
                    }
                },
                "rows": [{"date": "2026-08-31", "close": 43386.41}],
            }
            cache_path.write_text(json.dumps(original, indent=2) + "\n", encoding="utf-8")
            before = cache_path.read_bytes()

            def fail(_url, _timeout):
                raise OSError("offline")

            cache, errors = water_market.refresh_taiex_cache(
                root,
                start_date="2026-08-01",
                end_date="2026-09-07",
                now=datetime(2026, 9, 7, 12, 0, tzinfo=TAIPEI),
                fetch_json=fail,
            )

            self.assertEqual(cache_path.read_bytes(), before)
            self.assertEqual(cache["rows"], original["rows"])
            self.assertTrue(errors)

    def test_empty_or_regressing_current_month_response_preserves_last_good_cache(self):
        for fetched_rows in (
            [],
            [
                {
                    "Date": "1150901",
                    "OpeningIndex": "46177.11",
                    "HighestIndex": "46948.72",
                    "LowestIndex": "46081.11",
                    "ClosingIndex": "46948.72",
                }
            ],
        ):
            with self.subTest(fetched_rows=fetched_rows), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "docs").mkdir()
                cache_path = root / "docs" / "taiex-history.json"
                original = {
                    "schema_version": 1,
                    "source_name": water_market.SOURCE_NAME,
                    "retrieved_at": "2026-09-04T14:00:00+08:00",
                    "months": {
                        "2026-09": {
                            "status": "partial",
                            "coverage_end": "2026-09-04",
                            "request_url": water_market.OPENAPI_URL,
                            "retrieved_at": "2026-09-04T14:00:00+08:00",
                            "row_count": 2,
                        }
                    },
                    "rows": [
                        {"date": "2026-09-01", "close": 46948.72},
                        {"date": "2026-09-04", "close": 46551.13},
                    ],
                }
                cache_path.write_text(json.dumps(original, indent=2) + "\n", encoding="utf-8")
                before = cache_path.read_bytes()

                cache, errors = water_market.refresh_taiex_cache(
                    root,
                    start_date="2026-09-01",
                    end_date="2026-09-07",
                    now=datetime(2026, 9, 7, 12, 0, tzinfo=TAIPEI),
                    fetch_json=lambda _url, _timeout: fetched_rows,
                )

                self.assertEqual(cache_path.read_bytes(), before)
                self.assertEqual(cache["rows"], original["rows"])
                self.assertTrue(errors)


class BuildInterfaceTests(unittest.TestCase):
    def test_build_interface_survives_refresh_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            cache = {
                "schema_version": 1,
                "source_name": water_market.SOURCE_NAME,
                "retrieved_at": "2026-09-04T14:00:00+08:00",
                "months": {"2026-09": {"status": "partial", "coverage_end": "2026-09-04"}},
                "rows": [{"date": "2026-09-04", "close": 46551.13}],
            }
            (root / "docs" / "taiex-history.json").write_text(json.dumps(cache), encoding="utf-8")
            records = [{"date": "2026-09-04", "water_level": 69.1, "scenario_label": "04", "date_display": "09/04"}]
            with mock.patch.object(water_market, "refresh_taiex_cache", side_effect=OSError("offline")):
                result = water_market.build_water_comparison(records, root, refresh=True)
            self.assertEqual(result["rows"][0]["taiex_close"], 46551.13)
            self.assertEqual(result["rows"][0]["market_status"], "closed")
            self.assertIn("refresh_error", result)


if __name__ == "__main__":
    unittest.main()
