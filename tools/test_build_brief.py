import unittest

from build_brief import build_env, normalize_zone_cards


class ZoneCardRenderingTests(unittest.TestCase):
    def test_zone_membership_sets_stamp_and_fallback_meta(self):
        section = {
            "value": [
                {
                    "code": "2360",
                    "name": "致茂",
                    "industry": "半導體設備",
                    "change": "▼65 (-3.23%)",
                }
            ],
            "rising": [
                {
                    "code": "3406",
                    "name": "玉晶光",
                    "change": "▲79 (+8.62%)",
                }
            ],
        }

        normalize_zone_cards(section)

        self.assertEqual(section["value"][0]["stamp"], "value")
        self.assertEqual(
            section["value"][0]["meta"],
            "半導體設備 · ▼65 (-3.23%)",
        )
        self.assertEqual(section["rising"][0]["stamp"], "rising")
        self.assertEqual(section["rising"][0]["meta"], "▲79 (+8.62%)")

    def test_macro_renders_value_and_rising_labels(self):
        section = {
            "value": [{"code": "0052", "name": "富邦科技", "change": "▼1.44%"}],
            "rising": [{"code": "00919", "name": "群益台灣精選高息", "change": "▲0.64%"}],
        }
        normalize_zone_cards(section)
        template = build_env().from_string(
            "{% import 'macros.html.j2' as m %}"
            "{{ m.trading_card(value) }}{{ m.trading_card(rising) }}"
        )
        html = template.render(
            value=section["value"][0],
            rising=section["rising"][0],
        )

        self.assertIn('class="card-stamp stamp-value">價值</span>', html)
        self.assertIn('class="card-stamp stamp-rising">升溫</span>', html)


if __name__ == "__main__":
    unittest.main()
