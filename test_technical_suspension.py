#!/usr/bin/env python3
import unittest

from scripts import generate_technical_data as technical


class SecurityMarketStatusTests(unittest.TestCase):
    def test_status_is_date_bounded(self):
        active = technical.security_market_status("5904", "2026-08-03")
        resumed = technical.security_market_status("5904.TWO", "2026-08-10")
        self.assertEqual(active["status"], "suspended_for_par_value_change")
        self.assertEqual(active["reference_close"], 72.0)
        self.assertEqual(resumed["status"], "normal")

    def test_verified_suspension_appends_non_trade_marker(self):
        status = technical.security_market_status("5904", "2026-08-03")
        rows = [
            {
                "date": "2026-07-31",
                "open": 72.0,
                "high": 72.0,
                "low": 72.0,
                "close": 72.0,
                "volume": 0,
            }
        ]
        out = technical.append_no_trade_marker(rows, "2026-08-03", status)
        self.assertEqual(out[-1]["date"], "2026-08-03")
        self.assertEqual(out[-1]["volume"], 0)
        self.assertTrue(out[-1]["no_trade_marker"])
        self.assertEqual(out[-1]["market_status"], "suspended_for_par_value_change")


if __name__ == "__main__":
    unittest.main()
