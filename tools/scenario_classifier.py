#!/usr/bin/env python3
"""Morning Brief eight-scenario classifier and ArkQuant context builder."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCENARIO_MAP_PATH = ROOT / "docs" / "assets" / "covers" / "scenario-map.json"

PCT_RE = re.compile(r"([+-]?\d+(?:\.\d+)?)\s*%")

EARNINGS_KEYWORDS = (
    "財報週",
    "財報公布",
    "earnings week",
    "earnings season",
    "nvda earnings",
    "nvidia earnings",
    "major earnings",
    "盤後財報",
    "q1 財報",
    "q2 財報",
    "q3 財報",
    "q4 財報",
)

AI_KEYWORDS = (
    "ai ",
    "人工智慧",
    "半導體",
    "semi",
    "sox",
    "nvidia",
    "nvda",
    "台積電",
    "記憶體",
    "hbm",
    "封測",
    "ic 設計",
)

AFTERMARKET_KEYWORDS = (
    "週末",
    "weekend",
    "holiday",
    "連假",
    "休市",
    "無交易",
    "no trading",
    "pre-event",
    "盤前觀望",
    "靜待消息",
)

HIGH_SYSTEMIC_RISK = {"高", "高偏高", "中偏高", "偏高"}
DEFAULT_TRIM_PRIORITY = [
    "positive_return_overheated_branch",
    "non_moat_branch",
    "leveraged_etf_overheat",
    "low_efficiency_small_branch",
]


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def scenario_entry(scenario_map: dict, sid: str) -> dict:
    for sc in scenario_map["scenarios"]:
        if sc["id"] == sid:
            return sc
    raise KeyError(f"Unknown scenario id: {sid}")


def _num(value, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _pct_from_meta(meta: str | None) -> float | None:
    if not meta:
        return None
    # Ark ETF cards can explicitly have no source price while still exposing
    # NAV and premium/discount.  In that shape the first percentage belongs to
    # premium/discount, not a market-price move, so it must not enter breadth.
    normalized = meta.strip()
    if normalized.startswith(("股價 —", "股價 -")):
        return None
    matches = PCT_RE.findall(meta)
    if not matches:
        return None
    # Card metadata starts with the market-price move; later percentages are
    # ETF premium/discount or monthly-revenue fields. Breadth must use the
    # first percentage, never the final business-metric percentage.
    return float(matches[0])


def _collect_meta_items(data: dict) -> list[str]:
    items: list[str] = []
    for section in ("etf", "stocks"):
        block = data.get(section) or {}
        for bucket in ("value", "rising"):
            for row in block.get(bucket) or []:
                meta = row.get("meta")
                if meta:
                    items.append(meta)
    return items


def _strength_ratio(data: dict) -> tuple[float, int, int]:
    """Return (positive_ratio, positive_count, total_count)."""
    positives = 0
    total = 0
    for meta in _collect_meta_items(data):
        pct = _pct_from_meta(meta)
        if pct is None:
            continue
        total += 1
        if pct > 0:
            positives += 1
    if total == 0:
        return 0.5, 0, 0
    return positives / total, positives, total


def _market_pct(data: dict, key: str) -> float:
    market = data.get("market") or {}
    block = market.get(key) or {}
    if "change_pct" in block:
        return _num(block.get("change_pct"))
    if "delta" in block:
        return _num(block.get("delta"))
    return 0.0


def _systemic_risk(data: dict) -> str:
    return str((data.get("market") or {}).get("systemic_risk") or "").strip()


def _water_metrics(data: dict) -> tuple[float, float | None, float | None]:
    ark = data.get("ark") or {}
    wl = _num(ark.get("water_level"))
    prev = ark.get("prev")
    delta = ark.get("delta")
    prev_f = _num(prev) if prev is not None else None
    delta_f = _num(delta) if delta is not None else None
    if delta_f is None and prev_f is not None:
        delta_f = round(wl - prev_f, 2)
    return wl, prev_f, delta_f


def _water_direction(delta: float | None) -> str:
    if delta is None:
        return "stable"
    if delta > 0:
        return "rising"
    if delta < 0:
        return "falling"
    return "stable"


def _text_blob(data: dict) -> str:
    """Text features for classification.

    Deliberately ignore legacy scenario fields (`scenario_reason`,
    `home.risk_tagline`, etc.) so old editorial labels cannot feed back into the
    new classifier. Only market/strategy/editorial content should influence
    event/theme detection.
    """
    parts: list[str] = []
    for key in ("market_summary",):
        val = data.get(key)
        if val:
            parts.append(str(val))
    for section in ("hero", "strategy", "editorial", "temperature"):
        block = data.get(section)
        if isinstance(block, dict):
            parts.extend(str(v) for v in block.values() if v)
        elif block:
            parts.append(str(block))
    intel = data.get("intelligence") or {}
    if isinstance(intel, dict):
        for val in intel.values():
            if isinstance(val, list):
                parts.extend(str(x) for x in val)
            elif val:
                parts.append(str(val))
    return " ".join(parts).lower()


def _has_keywords(text: str, keywords: tuple[str, ...]) -> bool:
    return any(kw in text for kw in keywords)


def _is_weekend(date_str: str) -> bool:
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return dt.weekday() >= 5


def _has_sparse_tape(data: dict) -> bool:
    market = data.get("market") or {}
    sox = _market_pct(data, "sox")
    tw = _market_pct(data, "tw_index")
    has_market = bool(market.get("sox") or market.get("tw_index"))
    _, _, total = _strength_ratio(data)
    strategy = data.get("strategy") or {}
    tape = str(strategy.get("tape") or "").strip()
    return (not has_market and total == 0) or tape in {"", "盤勢一句", "…"}


def _has_local_strength(data: dict, pos_ratio: float, pos_count: int) -> bool:
    rising = data.get("stocks", {}).get("rising") or []
    etf_rising = data.get("etf", {}).get("rising") or []
    if rising or etf_rising:
        return True
    text = _text_blob(data)
    if _has_keywords(text, AI_KEYWORDS) and pos_ratio >= 0.35:
        return True
    return pos_count >= 2 and pos_ratio >= 0.3


def _match_result(sid: str, scenario_map: dict, confidence: float, reason: str) -> dict:
    sc = scenario_entry(scenario_map, sid)
    return {
        "id": sc["id"],
        "slug": sc["slug"],
        "name": sc["name"],
        "label": sc["name"],
        "confidence": round(confidence, 2),
        "reason": reason,
    }


def _external_risk_score(sox: float, vix: float, twii: float, nasdaq: float, risk: str) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    if sox <= -5:
        score += 3
        reasons.append(f"SOX {sox:+.2f}% 急跌")
    elif sox <= -3:
        score += 2
        reasons.append(f"SOX {sox:+.2f}% 轉弱")
    elif sox >= 2:
        score -= 1
        reasons.append(f"SOX {sox:+.2f}% 支撐")

    if nasdaq <= -1.5:
        score += 1
        reasons.append(f"Nasdaq {nasdaq:+.2f}% 偏弱")
    elif nasdaq >= 1:
        score -= 1
        reasons.append(f"Nasdaq {nasdaq:+.2f}% 偏強")

    if twii <= -2:
        score += 2
        reasons.append(f"台股 {twii:+.2f}% 明顯回檔")
    elif twii <= -1:
        score += 1
        reasons.append(f"台股 {twii:+.2f}% 偏弱")
    elif twii >= 1:
        score -= 1
        reasons.append(f"台股 {twii:+.2f}% 偏強")

    if vix >= 10:
        score += 3
        reasons.append(f"VIX {vix:+.2f}% 大升")
    elif vix >= 5:
        score += 2
        reasons.append(f"VIX {vix:+.2f}% 升溫")
    elif vix <= -5:
        score -= 1
        reasons.append(f"VIX {vix:+.2f}% 降溫")

    if risk in {"高", "高偏高", "偏高"}:
        score += 2
        reasons.append(f"系統性風險 {risk}")
    elif risk == "中偏高":
        score += 1
        reasons.append("系統性風險中偏高")

    return score, reasons


def classify_scenario(data: dict, scenario_map: dict) -> dict:
    """Classify the new Ark-oriented eight scenarios.

    New taxonomy:
    01 trend_expansion, 02 theme_catalyst, 03 high_level_speed_control,
    04 rotation_switching, 05 orderly_pullback, 06 risk_contraction,
    07 low_level_repair, 08 event_wait.
    """
    wl, _prev, delta = _water_metrics(data)
    sox = _market_pct(data, "sox")
    vix = _market_pct(data, "vix")
    twii = _market_pct(data, "tw_index")
    nasdaq = _market_pct(data, "nasdaq")
    risk = _systemic_risk(data)
    pos_ratio, pos_count, total = _strength_ratio(data)
    text = _text_blob(data)
    date_str = data.get("date", "")
    water_dir = _water_direction(delta)
    d = delta or 0.0
    risk_score, risk_reasons = _external_risk_score(sox, vix, twii, nasdaq, risk)
    ai_theme = _has_keywords(text, AI_KEYWORDS)
    event_wait = _has_keywords(text, EARNINGS_KEYWORDS) or _has_keywords(text, AFTERMARKET_KEYWORDS)
    try:
        event_wait = event_wait or _is_weekend(date_str)
    except Exception:
        pass
    event_wait = event_wait or _has_sparse_tape(data)

    breadth_label = "unknown"
    if total > 0:
        if pos_ratio >= 0.60:
            breadth_label = "strong"
        elif pos_ratio >= 0.45:
            breadth_label = "healthy_mixed"
        elif pos_ratio >= 0.35:
            breadth_label = "rotation_mixed"
        else:
            breadth_label = "weak"

    # 08 event wait: earnings/macro/holiday/no-trading days are not ordinary tape days.
    # Keep true risk-off ahead of event-wait so panic days still reduce exposure.
    # A sharp Ark-water deterioration is itself a risk-budget contraction signal,
    # even when external markets rally or the editorial text mentions earnings.
    if event_wait and not (
        (risk_score >= 4 and water_dir == "falling") or d <= -2.5
    ):
        return _match_result(
            "08",
            scenario_map,
            0.72,
            "重大事件/財報/休市或盤面資料未完整反映，方向需等事件落地",
        )

    # 06 risk contraction: external/internal deterioration forces exposure reduction.
    if (risk_score >= 4 and water_dir == "falling") or d <= -2.5 or (risk in {"高", "高偏高"} and (water_dir == "falling" or risk_score >= 2)):
        reason_parts = []
        if d <= -2.5:
            reason_parts.append(f"水位急降 {d:+.1f}pt")
        reason_parts.extend(r for r in risk_reasons if "支撐" not in r and "偏強" not in r and "降溫" not in r)
        reason = "、".join(reason_parts) or "水位或外部風險明顯惡化"
        return _match_result(
            "06",
            scenario_map,
            0.84,
            f"{reason}，風險預算收縮",
        )

    # 05 orderly pullback: healthy-water correction, not systemic risk-off.
    if wl >= 60 and (d <= -1.0 or (risk_score >= 3 and breadth_label in {"weak", "rotation_mixed"})):
        return _match_result(
            "05",
            scenario_map,
            0.78,
            f"水位 {wl}% 仍在健康區，但水位/外部/廣度進入有序回檔，等待承接確認",
        )

    # 07 low-level repair: low water starts improving, but not full expansion.
    if wl < 60 and water_dir == "rising" and d >= 0.5 and risk_score < 3:
        return _match_result(
            "07",
            scenario_map,
            0.76,
            f"水位 {wl}% 低位回升 {d:+.1f}pt，屬修復初期而非主升段",
        )

    # 01 trend expansion: water, externals, and breadth all lean constructive.
    if water_dir == "rising" and d >= 0.5 and risk_score <= 0 and (breadth_label in {"strong", "healthy_mixed", "unknown"}) and (twii >= 0 or sox >= 0 or nasdaq >= 0):
        return _match_result(
            "01",
            scenario_map,
            0.78,
            "水位上升，外部風險降溫且內部廣度不差，進入趨勢擴張",
        )

    # 03 high-level speed control: high healthy water, but slope slows or external pressure rises.
    # This replaces the old catch-all 高檔分化 for high-water days like 2026-07-02.
    if wl >= 72 and d > -1.0 and risk_score < 4:
        slope_reason = (
            f"水位 {wl}% 快速上升 {d:+.1f}pt，但外部/位階壓力仍要求控速"
            if d >= 1.0
            else f"水位 {wl}% 仍健康但斜率 {d:+.1f}pt 放緩/外部壓力升高"
        )
        return _match_result(
            "03",
            scenario_map,
            0.76,
            f"{slope_reason}，追價需控速",
        )

    # 02 theme catalyst: concrete theme catalyst, but not broad expansion.
    if ai_theme and risk_score < 4 and d > -1.5:
        return _match_result(
            "02",
            scenario_map,
            0.74,
            "AI/半導體/主線題材有明確催化，但仍需避免追第一根",
        )

    # 04 rotation switching: mixed breadth, capital rotation, weak-vs-strong separation.
    if breadth_label in {"healthy_mixed", "rotation_mixed"} or wl >= 60:
        return _match_result(
            "04",
            scenario_map,
            0.68,
            f"廣度 {breadth_label}、水位 {wl}%：市場偏輪動換手，重點是汰弱留強",
        )

    # Fallback: low water but not repairing = event/rotation wait rather than bullish.
    return _match_result(
        "04",
        scenario_map,
        0.52,
        "無明確擴張/收縮訊號，預設輪動換手",
    )

def build_action_guidance(data: dict, scenario: dict) -> dict:
    """Machine-readable posture for ArkQuant under the new eight scenarios.

    Keep legacy flat fields for existing callers, but expose the safer nested
    trim/deploy/rebuy gates that ArkQuant should consume.
    """
    sid = scenario["id"]
    guidance_by_id = {
        "01": {
            "risk_bias": "constructive",
            "allow_add": True,
            "allow_trim": True,
            "deploy_mode": "selective_add",
            "max_initial_deploy_pct": 0.4,
            "trim": {"allowed": True, "mode": "selective_trim", "max_overshoot_pct": 0.25},
            "deploy": {
                "allowed": True,
                "mode": "selective_add",
                "max_initial_deploy_pct": 0.4,
                "conditions": ["core_or_high_quality_only", "no_chase", "position_size_limited"],
            },
            "rebuy": {"allowed": True, "mode": "wait_for_pullback", "conditions": ["MA20_support", "murphy_right_side_reconfirmation"]},
        },
        "02": {
            "risk_bias": "constructive_but_selective",
            "allow_add": True,
            "allow_trim": True,
            "deploy_mode": "theme_follow_no_chase",
            "max_initial_deploy_pct": 0.3,
            "trim": {"allowed": True, "mode": "selective_trim", "max_overshoot_pct": 0.25},
            "deploy": {
                "allowed": True,
                "mode": "theme_follow_no_chase",
                "max_initial_deploy_pct": 0.3,
                "conditions": ["theme_confirmed", "no_first_bar_chase", "pullback_or_volume_confirmation"],
            },
            "rebuy": {"allowed": True, "mode": "wait_for_pullback", "conditions": ["sold_name_drawdown_2_to_3_pct", "support_holds"]},
        },
        "03": {
            "risk_bias": "balanced_cautious",
            "allow_add": True,
            "allow_trim": True,
            "deploy_mode": "slow_selective_add",
            "max_initial_deploy_pct": 0.25,
            "trim": {"allowed": True, "mode": "selective_trim", "max_overshoot_pct": 0.25},
            "deploy": {
                "allowed": True,
                "mode": "slow_selective_add",
                "max_initial_deploy_pct": 0.25,
                "conditions": ["conditional_only", "core_or_high_quality_only", "pullback_confirmed", "no_chase"],
            },
            "rebuy": {"allowed": True, "mode": "wait_for_pullback", "conditions": ["sold_name_drawdown_2_to_3_pct", "MA20_support", "murphy_right_side_reconfirmation"]},
        },
        "04": {
            "risk_bias": "selective",
            "allow_add": False,
            "allow_trim": True,
            "deploy_mode": "rotate_after_confirmation",
            "trim": {"allowed": True, "mode": "rotate_trim", "max_overshoot_pct": 0.25},
            "deploy": {"allowed": False, "mode": "rotate_after_confirmation", "conditions": ["wait_for_relative_strength_confirmation"]},
            "rebuy": {"allowed": True, "mode": "wait_for_confirmation", "conditions": ["rotation_confirms", "no_new_low"]},
        },
        "05": {
            "risk_bias": "defensive",
            "allow_add": False,
            "allow_trim": True,
            "deploy_mode": "wait_for_pullback",
            "rebuy_condition": ["MA20_support", "volume_contract", "murphy_right_side_reconfirmation", "water_stabilizes"],
            "trim": {"allowed": True, "mode": "selective_trim", "max_overshoot_pct": 0.25},
            "deploy": {"allowed": False, "mode": "wait_for_pullback", "conditions": ["water_stabilizes", "support_confirmed"]},
            "rebuy": {"allowed": True, "mode": "wait_for_pullback", "conditions": ["MA20_support", "volume_contract", "murphy_right_side_reconfirmation", "water_stabilizes"]},
        },
        "06": {
            "risk_bias": "risk_off",
            "allow_add": False,
            "allow_trim": True,
            "deploy_mode": "reduce_exposure",
            "trim": {"allowed": True, "mode": "reduce_exposure", "max_overshoot_pct": 0.25},
            "deploy": {"allowed": False, "mode": "disabled", "conditions": ["risk_off_no_new_exposure"]},
            "rebuy": {"allowed": False, "mode": "disabled_until_stabilized", "conditions": ["risk_bias_improves", "water_stabilizes"]},
        },
        "07": {
            "risk_bias": "constructive_but_cautious",
            "allow_add": True,
            "allow_trim": True,
            "deploy_mode": "small_probe",
            "max_initial_deploy_pct": 0.2,
            "required_confirmation": ["three_signal", "MA20_reclaim", "no_new_low"],
            "trim": {"allowed": True, "mode": "cleanup_weak_only", "max_overshoot_pct": 0.25},
            "deploy": {"allowed": True, "mode": "small_probe", "max_initial_deploy_pct": 0.2, "conditions": ["three_signal", "MA20_reclaim", "no_new_low"]},
            "rebuy": {"allowed": True, "mode": "small_probe", "conditions": ["no_new_low", "support_reclaim"]},
        },
        "08": {
            "risk_bias": "event_wait",
            "allow_add": False,
            "allow_trim": False,
            "deploy_mode": "wait_for_event_resolution",
            "trim": {"allowed": False, "mode": "wait_for_event_resolution", "max_overshoot_pct": 0.25},
            "deploy": {"allowed": False, "mode": "wait_for_event_resolution", "conditions": ["event_resolved"]},
            "rebuy": {"allowed": False, "mode": "wait_for_event_resolution", "conditions": ["event_resolved"]},
        },
    }
    base = dict(guidance_by_id.get(sid, guidance_by_id["04"]))
    base["trim_priority"] = list(DEFAULT_TRIM_PRIORITY)
    # Copy trim priority into the nested trim gate as well.
    base.setdefault("trim", {})["priority"] = list(DEFAULT_TRIM_PRIORITY)
    return base


def build_leader_policy(data: dict, water: dict, action_guidance: dict, scenario_out: dict) -> dict:
    """Build the short-term policy block consumed by Moorlock.

    This is the user's/editor's near-term operating posture: mainly water
    direction/change plus tactical policy notes. It is not a ticker-level signal.
    """
    direction = water.get("direction") or "stable"
    change = water.get("change")
    risk_bias = action_guidance.get("risk_bias", "neutral") if isinstance(action_guidance, dict) else "neutral"
    allow_add = action_guidance.get("allow_add") if isinstance(action_guidance, dict) else None
    if risk_bias == "risk_off":
        short_term_bias = "reduce_risk_review"
        posture = "risk_off"
        default_policy = "水位急降且風險預算收縮，暫停新增曝險；先檢查過熱、非護城河與槓桿風險。"
    elif risk_bias == "event_wait":
        short_term_bias = "event_wait"
        posture = "event_wait"
        default_policy = "重大事件尚未落地，暫停新增與非必要調節；等待事件解析。"
    elif allow_add is False:
        short_term_bias = "defensive_hold_review"
        posture = risk_bias if risk_bias != "neutral" else "defensive"
        default_policy = "目前不允許新增曝險；維持防禦檢查，等待水位、價格與情境重新確認。"
    elif direction == "rising":
        short_term_bias = "increase_exposure_allowed"
        posture = "constructive_selective"
        default_policy = "水位上升，允許依個股訊號小額佈局；仍禁止追價。"
    elif direction == "falling":
        short_term_bias = "cautious_review"
        posture = "balanced_cautious"
        default_policy = "水位下降，優先檢查調節與控速；佈局需小額且有回測/承接確認。"
    else:
        short_term_bias = "hold_selective"
        posture = "neutral_selective"
        default_policy = "水位持平，維持選擇性操作；等待個股訊號確認。"

    strategy = data.get("strategy") or {}
    intel = data.get("intelligence") or {}
    market = data.get("market") or {}
    notes = []
    for key in ("playbook", "risk", "tape"):
        val = strategy.get(key)
        if val:
            notes.append(str(val))
    for key in ("policy", "trump", "musk"):
        val = intel.get(key) if isinstance(intel, dict) else None
        if isinstance(val, list):
            notes.extend(str(x) for x in val[:2])
        elif val:
            notes.append(str(val))
    # Keep the policy block compact for machine consumers and UI badges.
    compact_notes = []
    for note in notes:
        t = " ".join(note.split())
        if t and t not in compact_notes:
            compact_notes.append(t[:220])

    return {
        "source": "morning_brief_editorial_policy",
        "short_term_bias": short_term_bias,
        "risk_posture": posture if risk_bias == "neutral" else risk_bias,
        "water_policy": {
            "direction": direction,
            "change": change,
            "interpretation": default_policy,
        },
        "scenario_context": {
            "id": scenario_out.get("id"),
            "label": scenario_out.get("label"),
            "confidence": scenario_out.get("confidence"),
        },
        "policy_focus": compact_notes[:4] or [default_policy],
        "systemic_risk": market.get("systemic_risk"),
        "moorlock_use": "Use as top-level market/water/policy gate only; ticker-level seven-engine signals still decide candidates.",
    }

def build_morning_context(
    data: dict,
    scenario: dict,
    action_guidance: dict,
    *,
    issue_file: str | None = None,
) -> dict:
    wl, prev, delta = _water_metrics(data)
    editorial = data.get("editorial") or {}
    summary = (
        data.get("scenario_reason")
        or editorial.get("pull_quote")
        or (data.get("hero") or {}).get("subhead", "")
    )
    scenario_out = {
        "id": scenario["id"],
        "slug": scenario.get("slug", ""),
        "label": scenario.get("label") or scenario.get("name", ""),
        "confidence": scenario.get("confidence", 1.0),
        "reason": scenario.get("reason") or data.get("scenario_reason", ""),
    }
    if scenario.get("source"):
        scenario_out["source"] = scenario["source"]
    if scenario.get("classifier_suggestion"):
        scenario_out["classifier_suggestion"] = scenario["classifier_suggestion"]
    if scenario.get("legacy_manual_id"):
        scenario_out["legacy_manual_id"] = scenario["legacy_manual_id"]

    enriched_guidance = dict(action_guidance)
    enriched_guidance["confidence"] = scenario_out.get("confidence", 1.0)
    enriched_guidance["source"] = "morning_brief_classifier"
    water_out = {
        "level": wl,
        "previous": prev,
        "change": delta,
        "direction": _water_direction(delta),
    }
    leader_policy = build_leader_policy(data, water_out, enriched_guidance, scenario_out)

    return {
        "schema_version": "morning_brief_context.v1",
        "taxonomy_version": "ark_eight_regime.v1",
        "date": data["date"],
        "valid_for_trading_date": data["date"],
        "data_as_of": data["date"],
        "stale": False,
        "issue_no": data.get("issue_no"),
        "scenario": scenario_out,
        "water": water_out,
        "leader_policy": leader_policy,
        "action_guidance": enriched_guidance,
        "editorial": {
            "state_label": scenario_out["label"],
            "summary": summary,
        },
        "source": {
            "issue_file": issue_file or "",
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        },
    }


def resolve_scenario_for_build(
    data: dict,
    scenario_map: dict,
) -> tuple[dict, dict, bool]:
    """Return (effective_scenario, classifier_result, used_override).

    After the July 2026 redesign, legacy issue JSON files may still carry the old
    catch-all `scenario_id: "02"` meaning 高檔分化. Do not let that stale manual
    value override the new taxonomy unless the issue explicitly locks it with
    `scenario_override: true` or `lock_scenario: true`.
    """
    classified = classify_scenario(data, scenario_map)
    manual_id = str(data.get("scenario_id") or "").strip()
    locked = bool(data.get("scenario_override") or data.get("lock_scenario"))
    if manual_id and locked:
        sc = scenario_entry(scenario_map, manual_id)
        effective = {
            "id": sc["id"],
            "slug": sc["slug"],
            "name": sc["name"],
            "label": sc["name"],
            "confidence": 1.0,
            "reason": data.get("scenario_reason", ""),
            "source": "manual_override",
            "classifier_suggestion": classified["id"],
        }
        return effective, classified, True

    if manual_id and manual_id != classified["id"]:
        classified = {**classified, "source": "classifier", "legacy_manual_id": manual_id}
    else:
        classified = {**classified, "source": "classifier"}
    data["scenario_id"] = classified["id"]
    data["scenario_reason"] = classified["reason"]
    return classified, classified, False


def audit_issues(issues_dir: Path, scenario_map: dict) -> int:
    files = sorted(
        p for p in issues_dir.glob("*.json") if not p.name.startswith("_")
    )
    if not files:
        print(f"No issue JSON files in {issues_dir}", file=sys.stderr)
        return 1

    current_dist: Counter[str] = Counter()
    predicted_dist: Counter[str] = Counter()

    for path in files:
        data = load_json(path)
        current = str(data.get("scenario_id") or "").strip() or "—"
        predicted = classify_scenario(data, scenario_map)
        current_dist[current] += 1
        predicted_dist[predicted["id"]] += 1
        print(
            f"{data['date']} current={current} "
            f"predicted={predicted['id']}/{predicted['slug']} "
            f"confidence={predicted['confidence']:.2f} reason={predicted['reason']}"
        )

    print("\n--- current distribution ---")
    for sid in sorted(current_dist):
        print(f"{sid}: {current_dist[sid]}")

    print("\n--- predicted distribution ---")
    for sid in sorted(predicted_dist):
        print(f"{sid}: {predicted_dist[sid]}")

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Morning Brief scenario classifier")
    parser.add_argument(
        "--audit",
        metavar="ISSUES_DIR",
        help="Audit scenario predictions for all issue JSON files",
    )
    args = parser.parse_args(argv)

    scenario_map = load_json(SCENARIO_MAP_PATH)
    if args.audit:
        return audit_issues(Path(args.audit), scenario_map)
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
