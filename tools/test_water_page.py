import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import build_brief as builder


class WaterPageTests(unittest.TestCase):
    def comparison(self):
        return {'rows': [
            {'date': '2026-09-04', 'water_level': 69.1, 'taiex_close': 22000.25, 'market_status': 'closed'},
            {'date': '2026-09-07', 'water_level': 68.7, 'taiex_close': None, 'market_status': 'pending'},
        ], 'market_as_of': '2026-09-04', 'retrieved_at': '2026-09-07T12:00:00+08:00', 'source_name': 'unit test only'}

    def records(self):
        return [
            {'date':'2026-09-07','date_display':'2026-09-07','water_level':68.7,'scenario_label':'04 輪動換手'},
            {'date':'2026-09-04','date_display':'2026-09-04','water_level':69.1,'scenario_label':'04 輪動換手'},
        ]

    def test_render_preserves_null_and_includes_table_and_controls(self):
        with patch.object(builder, 'load_water_records', return_value=self.records()), patch.object(builder, 'build_water_comparison', return_value=self.comparison()) as source:
            html = builder.render_water_level([], refresh_market=False)
        source.assert_called_once()
        self.assertFalse(source.call_args.kwargs['refresh'])
        match = re.search(r'id="water-comparison-data" type="application/json">(.*?)</script>', html, re.S)
        self.assertIsNotNone(match)
        assert match is not None
        payload = match.group(1)
        self.assertIsNone(json.loads(payload)['rows'][-1]['taiex_close'])
        self.assertIn('尚無當日收盤', html)
        self.assertIn('22,000.25', html)
        self.assertIn('id="water-chart"', html)
        self.assertIn('data-range="90" aria-pressed="true"', html)
        self.assertIn('逐日明細', html)
        self.assertNotIn('chart.js', html)

    def test_build_writes_only_water_page_mirrors_and_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for asset in ['css/water-level.css','js/water-level.js']:
                file = root/'assets'/asset
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('asset test',encoding='utf8')
            with patch.object(builder,'ROOT',root), patch.object(builder,'SITE',root/'docs'), patch.object(builder,'load_all_issues',return_value=[]), patch.object(builder,'render_water_level',return_value='<html>water test</html>') as render:
                builder.build_water_level_page()
                render.assert_called_once_with([],refresh_market=True)
            for destination in [root,root/'docs',root/'site']:
                self.assertEqual((destination/'water-level.html').read_text(),'<html>water test</html>')
                self.assertEqual((destination/'assets/css/water-level.css').read_text(),'asset test')
                self.assertFalse((destination/'index.html').exists())

    def test_dry_run_does_not_refresh_or_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(builder,'ROOT',root), patch.object(builder,'SITE',root/'docs'), patch.object(builder,'load_all_issues',return_value=[]), patch.object(builder,'render_water_level',return_value='<html>test</html>') as render:
                builder.build_water_level_page(write=False)
                render.assert_called_once_with([],refresh_market=False)
            self.assertEqual(list(root.iterdir()),[])


if __name__ == '__main__':
    unittest.main()
