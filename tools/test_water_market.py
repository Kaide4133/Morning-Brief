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
    def test_parses_monthly_roc_dates_and_complete_comma_ohlc(self):
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
                {
                    "date": "2026-05-04",
                    "open": 19900.0,
                    "high": 20100.0,
                    "low": 19800.0,
                    "close": 20012.34,
                },
                {
                    "date": "2026-05-05",
                    "open": 20010.0,
                    "high": 20200.0,
                    "low": 19950.0,
                    "close": 20100.5,
                },
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
            [
                {
                    "date": "2026-09-04",
                    "open": 45991.28,
                    "high": 46620.96,
                    "low": 45966.86,
                    "close": 46551.13,
                }
            ],
        )

    def test_rejects_invalid_date_duplicate_bad_ohlc_and_wrong_month_atomically(self):
        base = {
            "stat": "OK",
            "fields": ["日期", "開盤指數", "最高指數", "最低指數", "收盤指數"],
        }
        bad_sets = [
            [["115/02/30", "19,900", "20,100", "19,800", "20,000"]],
            [
                ["115/05/04", "19,900", "20,100", "19,800", "20,000"],
                ["115/05/04", "20,000", "20,200", "19,900", "20,100"],
            ],
            [["115/05/04", "19,900", "20,100", "19,800", "NaN"]],
            [["115/05/04", "0", "20,100", "19,800", "20,000"]],
            [["115/05/04", "19,900", "19,950", "19,800", "20,000"]],
            [["115/05/04", "19,900", "20,100", "19,950", "20,000"]],
            [["115/06/01", "19,900", "20,100", "19,800", "20,000"]],
            [
                ["115/05/04", "19,900", "20,100", "19,800", "20,000"],
                ["115/05/05", "bad", "20,200", "19,900", "20,100"],
            ],
        ]
        for data in bad_sets:
            with self.subTest(data=data):
                with self.assertRaises(ValueError):
                    water_market.parse_month_payload(dict(base, data=data), "2026-05")

    def test_rejects_missing_monthly_or_openapi_ohlc_fields_and_empty_payload(self):
        missing_monthly_field = {
            "stat": "OK",
            "fields": ["日期", "開盤指數", "最高指數", "收盤指數"],
            "data": [["115/05/04", "19,900", "20,100", "20,000"]],
        }
        missing_openapi_field = [
            {
                "Date": "1150904",
                "OpeningIndex": "45991.28",
                "HighestIndex": "46620.96",
                "ClosingIndex": "46551.13",
            }
        ]
        for payload, month in (
            (missing_monthly_field, "2026-05"),
            (missing_openapi_field, "2026-09"),
            ([], "2026-09"),
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    water_market.parse_month_payload(payload, month)


class CutoffTests(unittest.TestCase):
    def test_does_not_admit_todays_row_before_publication_cutoff(self):
        rows = [
            {
                "date": "2026-09-04",
                "open": 45991.28,
                "high": 46620.96,
                "low": 45966.86,
                "close": 46551.13,
            },
            {
                "date": "2026-09-07",
                "open": 46600.0,
                "high": 47100.0,
                "low": 46500.0,
                "close": 47000.0,
            },
        ]
        noon = datetime(2026, 9, 7, 12, 0, tzinfo=TAIPEI)
        after_close = datetime(2026, 9, 7, 14, 0, tzinfo=TAIPEI)

        self.assertEqual(
            water_market.completed_rows(rows, noon),
            [rows[0]],
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
                {
                    "date": "2026-05-04",
                    "open": 19900.0,
                    "high": 20100.0,
                    "low": 19800.0,
                    "close": 20000.0,
                },
                {"date": "2026-05-06", "close": 20100.0},
                {
                    "date": "2026-09-04",
                    "open": 45991.28,
                    "high": 46620.96,
                    "low": 45966.86,
                    "close": 46551.13,
                },
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
        self.assertEqual(by_date["2026-05-04"]["taiex_open"], 19900.0)
        self.assertEqual(by_date["2026-05-04"]["taiex_high"], 20100.0)
        self.assertEqual(by_date["2026-05-04"]["taiex_low"], 19800.0)
        self.assertEqual(by_date["2026-05-04"]["taiex_close"], 20000.0)
        self.assertEqual(by_date["2026-05-06"]["taiex_close"], 20100.0)
        self.assertIsNone(by_date["2026-05-06"]["taiex_open"])
        self.assertIsNone(by_date["2026-05-06"]["taiex_high"])
        self.assertIsNone(by_date["2026-05-06"]["taiex_low"])
        self.assertEqual(by_date["2026-05-01"]["market_status"], "non_trading")
        self.assertIsNone(by_date["2026-05-01"]["taiex_close"])
        self.assertEqual(by_date["2026-05-05"]["market_status"], "non_trading")
        self.assertIsNone(by_date["2026-05-05"]["taiex_close"])
        self.assertEqual(by_date["2026-06-01"]["market_status"], "missing")
        self.assertIsNone(by_date["2026-06-01"]["taiex_close"])
        self.assertEqual(by_date["2026-09-07"]["market_status"], "pending")
        for field in ("taiex_open", "taiex_high", "taiex_low", "taiex_close"):
            self.assertIsNone(by_date["2026-09-07"][field])
        self.assertEqual(result["market_as_of"], "2026-09-04")

    def test_legacy_close_only_cache_is_readable_but_partial_ohlc_is_rejected(self):
        base_cache = {
            "schema_version": 1,
            "source_name": water_market.SOURCE_NAME,
            "retrieved_at": None,
            "months": {"2026-05": {"status": "complete", "coverage_end": "2026-05-31"}},
            "rows": [{"date": "2026-05-04", "close": 20000.0}],
        }
        result = water_market.comparison_from_cache(
            [{"date": "2026-05-04", "water_level": 50}],
            base_cache,
            now=datetime(2026, 9, 7, 12, 0, tzinfo=TAIPEI),
        )
        row = result["rows"][0]
        self.assertEqual(row["taiex_close"], 20000.0)
        self.assertIsNone(row["taiex_open"])
        self.assertIsNone(row["taiex_high"])
        self.assertIsNone(row["taiex_low"])

        for partial in (
            {"open": 19900.0},
            {"open": 19900.0, "high": 20100.0},
            {"open": 19900.0, "high": 20100.0, "low": None},
        ):
            with self.subTest(partial=partial):
                malformed = dict(base_cache)
                malformed["rows"] = [
                    {"date": "2026-05-04", "close": 20000.0, **partial}
                ]
                with self.assertRaises(ValueError):
                    water_market.comparison_from_cache(
                        [{"date": "2026-05-04", "water_level": 50}],
                        malformed,
                        now=datetime(2026, 9, 7, 12, 0, tzinfo=TAIPEI),
                    )

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


class RefreshOHLCUpgradeTests(unittest.TestCase):
    def test_complete_past_legacy_month_is_refetched_and_retains_full_ohlc(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            cache_path = root / "docs" / "taiex-history.json"
            legacy = {
                "schema_version": 1,
                "source_name": water_market.SOURCE_NAME,
                "retrieved_at": "2026-08-31T14:00:00+08:00",
                "months": {
                    "2026-08": {
                        "status": "complete",
                        "coverage_end": "2026-08-31",
                        "request_url": "https://www.twse.com.tw/legacy",
                        "retrieved_at": "2026-08-31T14:00:00+08:00",
                        "row_count": 1,
                    }
                },
                "rows": [{"date": "2026-08-31", "close": 43386.41}],
            }
            cache_path.write_text(json.dumps(legacy, indent=2) + "\n", encoding="utf-8")
            source_payload = {
                "stat": "OK",
                "fields": ["日期", "開盤指數", "最高指數", "最低指數", "收盤指數"],
                "data": [
                    ["115/08/31", "43,210.25", "43,500.00", "43,100.50", "43,386.41"]
                ],
            }
            fetched_urls = []

            def fetch(url, _timeout):
                fetched_urls.append(url)
                return source_payload

            cache, errors = water_market.refresh_taiex_cache(
                root,
                start_date="2026-08-01",
                end_date="2026-08-31",
                now=datetime(2026, 9, 7, 12, 0, tzinfo=TAIPEI),
                fetch_json=fetch,
            )

            self.assertEqual(errors, [])
            self.assertEqual(len(fetched_urls), 1)
            self.assertEqual(
                cache["rows"],
                [
                    {
                        "date": "2026-08-31",
                        "open": 43210.25,
                        "high": 43500.0,
                        "low": 43100.5,
                        "close": 43386.41,
                    }
                ],
            )
            written = json.loads(cache_path.read_text(encoding="utf-8"))
            self.assertEqual(written["rows"], cache["rows"])

    def test_complete_past_month_with_full_ohlc_is_not_refetched(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            cache_path = root / "docs" / "taiex-history.json"
            complete = {
                "schema_version": 1,
                "source_name": water_market.SOURCE_NAME,
                "retrieved_at": "2026-08-31T14:00:00+08:00",
                "months": {
                    "2026-08": {
                        "status": "complete",
                        "coverage_end": "2026-08-31",
                        "row_count": 1,
                    }
                },
                "rows": [
                    {
                        "date": "2026-08-31",
                        "open": 43210.25,
                        "high": 43500.0,
                        "low": 43100.5,
                        "close": 43386.41,
                    }
                ],
            }
            cache_path.write_text(json.dumps(complete, indent=2) + "\n", encoding="utf-8")
            before = cache_path.read_bytes()

            cache, errors = water_market.refresh_taiex_cache(
                root,
                start_date="2026-08-01",
                end_date="2026-08-31",
                now=datetime(2026, 9, 7, 12, 0, tzinfo=TAIPEI),
                fetch_json=mock.Mock(side_effect=AssertionError("must not fetch")),
            )

            self.assertEqual(errors, [])
            self.assertEqual(cache["rows"], complete["rows"])
            self.assertEqual(cache_path.read_bytes(), before)


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


class OfflineDraftTests(unittest.TestCase):
    def test_explicit_offline_environment_never_calls_network_refresh(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(water_market.os.environ, {"KW_WATER_OFFLINE": "1"}), mock.patch.object(water_market, "refresh_taiex_cache") as refresh:
                result = water_market.build_water_comparison(
                    [{"date": "2026-09-04", "water_level": 69.1}], Path(tmp), refresh=True
                )
            refresh.assert_not_called()
            self.assertIsNone(result["rows"][0]["taiex_close"])
            self.assertNotIn("refresh_error", result)


if __name__ == "__main__":
    unittest.main()
