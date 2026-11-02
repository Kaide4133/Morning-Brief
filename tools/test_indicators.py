import copy
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from indicators import NAMES, append_snapshot, append_publication, load_store, validate_snapshot
import build_brief as builder


class IndicatorsTest(unittest.TestCase):
    def setUp(self):
        self.store = load_store(Path(__file__).resolve().parents[1] / 'data/indicator-snapshots.json')
        self.snapshot = next(s for s in self.store['snapshots'] if s['date'] == '2026-11-02' and s['revision'] == 1)
        self.store = {'schema_version': 1, 'snapshots': [self.snapshot], 'publication_events': []}

    def test_actual_source_and_pending_publication(self):
        self.assertEqual([x['value'] for x in self.snapshot['indicators']], [28, 63, 15, 46, 14])
        from unittest.mock import patch
        with patch.object(builder, 'load_store', return_value=self.store):
            exported = builder.indicator_export([{'date': '2026-11-02', 'water_level': 83.7, 'taiex_close': None}, {'date':'2026-10-30','water_level':82.4,'taiex_close':1}])
        self.assertIsNone(exported['snapshots'][0]['available_at'])
        self.assertTrue(all(x is None for x in exported['rows'][0]['indicators'].values()))

    def test_reject_conflicts_and_invalid_values(self):
        for value in [float('nan'), float('inf'), -1, 101, None, True]:
            s = copy.deepcopy(self.snapshot); s['indicators'][0]['value'] = value
            with self.subTest(value=value), self.assertRaises(ValueError): validate_snapshot(s)
        s = copy.deepcopy(self.snapshot); s['indicators'][0]['name'] = s['indicators'][1]['name']
        with self.assertRaises(ValueError): validate_snapshot(s)
        s = copy.deepcopy(self.snapshot); s['indicators'][0]['value'] = 29
        with self.assertRaises(ValueError): append_snapshot(self.store, s)
        self.assertFalse(append_snapshot(self.store, self.snapshot))
        s['revision'] = 2
        self.assertTrue(append_snapshot(self.store, s))
        self.assertEqual(self.store['snapshots'][0]['indicators'][0]['value'], 28)

    def test_publication_is_explicit_and_immutable(self):
        with self.assertRaises(ValueError): append_publication(self.store, '2026-11-02', 1, '2026-11-02T00:00:00Z')
        append_publication(self.store, '2026-11-02', 1, '2026-11-02T02:00:00Z')
        with self.assertRaises(ValueError): append_publication(self.store, '2026-11-02', 1, '2026-11-02T03:00:00Z')

    def test_taipei_date_boundary_and_hashes(self):
        s = copy.deepcopy(self.snapshot)
        s['captured_at'] = '2026-11-01T16:00:00Z'
        validate_snapshot(s)
        s['captured_at'] = '2026-11-01T15:59:59Z'
        with self.assertRaises(ValueError): validate_snapshot(s)
        for field in ('source_sha256', 'source_json_sha256'):
            s = copy.deepcopy(self.snapshot); s[field] = 'f' * 63
            with self.subTest(field=field), self.assertRaises(ValueError): validate_snapshot(s)

    def test_revision_capture_and_loaded_store_integrity(self):
        s = copy.deepcopy(self.snapshot); s['revision'] = 2
        s['captured_at'] = '2026-11-02T01:06:06Z'
        with self.assertRaises(ValueError): append_snapshot(self.store, s)
        s['captured_at'] = self.snapshot['captured_at']  # correction to the same capture
        self.assertTrue(append_snapshot(self.store, s))
        s['indicators'][0]['value'] = 99
        self.assertNotEqual(self.store['snapshots'][1]['indicators'][0]['value'], 99)
        broken = copy.deepcopy(self.store); broken['snapshots'][1]['revision'] = 3
        self.assert_load_rejected(broken)
        broken = copy.deepcopy(self.store); broken['snapshots'][1]['captured_at'] = '2026-11-02T01:06:06Z'
        self.assert_load_rejected(broken)

    def assert_load_rejected(self, store):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'store.json'
            path.write_text(json.dumps(store), encoding='utf-8')
            with self.assertRaises(ValueError): load_store(path)

    def test_publication_events_validation(self):
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        with self.assertRaises(ValueError): append_publication(self.store, '2026-11-02', 1, future)
        with self.assertRaises(ValueError): append_publication(self.store, '2026-11-02', True, '2026-11-02T02:00:00Z')
        for event in [
            {'date': '2026-11-02', 'revision': 1, 'available_at': future},
            {'date': '2026-11-02', 'revision': 2, 'available_at': '2026-11-02T02:00:00Z'},
            {'date': '2026-11-02', 'revision': True, 'available_at': '2026-11-02T02:00:00Z'},
            {'date': '2026-11-02', 'revision': 1, 'available_at': '2026-11-02T00:00:00Z'},
        ]:
            broken = copy.deepcopy(self.store); broken['publication_events'] = [event]
            self.assert_load_rejected(broken)
        event = {'date': '2026-11-02', 'revision': 1, 'available_at': '2026-11-02T02:00:00Z'}
        broken = copy.deepcopy(self.store); broken['publication_events'] = [event, event]
        self.assert_load_rejected(broken)


if __name__ == '__main__': unittest.main()
