#!/usr/bin/env python3
"""Regression checks for Morning Brief eight-scenario classification."""
from __future__ import annotations

import json
from pathlib import Path

from scenario_classifier import (
    _pct_from_meta,
    build_action_guidance,
    build_morning_context,
    classify_scenario,
)

ROOT = Path(__file__).resolve().parents[1]
SCENARIO_MAP = json.loads(
    (ROOT / "docs/assets/covers/scenario-map.json").read_text(encoding="utf-8")
)


def issue(*, water: float, delta: float, text: str) -> dict:
    return {
        "date": "2026-07-22",
        "ark": {"water_level": water, "prev": water - delta, "delta": delta},
        "market": {
            "sox": {"change_pct": 5.21},
            "nasdaq": {"change_pct": 1.29},
            "vix": {"change_pct": -8.58},
            "tw_index": {"change_pct": 1.82},
            "systemic_risk": "中",
        },
        "hero": {"headline": text},
        "strategy": {"tape": "盤中廣度偏強"},
        "etf": {"value": [], "rising": []},
        "stocks": {"value": [], "rising": []},
    }


def main() -> int:
    assert _pct_from_meta("727 / ▲57 (+8.51%)｜月營收變動 2%｜月營收年增 38.9%") == 8.51
    assert _pct_from_meta("56.75 / ▲1.5 (+2.71%)｜即時淨值 56.91｜折溢價 -0.28%") == 2.71
    assert _pct_from_meta("股價 —｜即時淨值 305.71｜折溢價 1.01%") is None

    sharp_issue = issue(
        water=73.0,
        delta=-3.5,
        text="晶片反彈，進入大型科技財報週",
    )
    sharp = classify_scenario(sharp_issue, SCENARIO_MAP)
    assert sharp["id"] == "06", sharp
    sharp_guidance = build_action_guidance(sharp_issue, sharp)
    sharp_context = build_morning_context(sharp_issue, sharp, sharp_guidance)
    assert sharp_context["action_guidance"]["allow_add"] is False
    assert sharp_context["leader_policy"]["short_term_bias"] == "reduce_risk_review"
    assert "暫停新增" in sharp_context["leader_policy"]["water_policy"]["interpretation"]

    event_issue = issue(
        water=73.0,
        delta=-0.3,
        text="進入大型科技財報週",
    )
    event = classify_scenario(event_issue, SCENARIO_MAP)
    assert event["id"] == "08", event

    print("scenario regression: 7/7 passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
