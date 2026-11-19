import copy
import hashlib
import json
import unittest
from pathlib import Path
from unittest.mock import patch
import build_brief as builder

ROOT = Path(__file__).resolve().parents[1]


class UnavailableIndicatorsTest(unittest.TestCase):
    def setUp(self):
        self.issue = json.loads((ROOT / 'data/issues/20261119.json').read_text())

    def test_source_backed_null_is_not_a_numeric_meter(self):
        ctx = builder.enrich_issue(self.issue)
        html = builder.render_brief(ctx)
        self.assertNotIn('indicator_display', ctx)
        self.assertEqual(len(ctx['indicator_unavailable']['names']), 5)
        self.assertEqual(html.count('class="indicator-row"'), 5)
        self.assertNotIn('aria-valuenow=', html)
        self.assertIn('本期不換算分數', html)
        self.assertNotIn('id="holdingCountdown"', html)
        self.assertIn('52:42', html)

    def test_missing_declaration_still_fails_closed(self):
        issue = copy.deepcopy(self.issue)
        del issue['indicator_availability']
        with self.assertRaises(ValueError):
            builder.enrich_issue(issue)

    def test_hash_missing_numeric_and_timestamp_tampering_rejected(self):
        for field, value in [('source_sha256', '0' * 64), ('source_image', '../outside.jpg'),
                             ('captured_at', '2026-11-19T09:12:00+08:00'),
                             ('values', {name: 0 for name in self.issue['indicator_availability']['values']})]:
            issue = copy.deepcopy(self.issue)
            issue['indicator_availability'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                builder.enrich_issue(issue)


if __name__ == '__main__':
    unittest.main()
