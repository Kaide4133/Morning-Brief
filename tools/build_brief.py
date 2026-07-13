#!/usr/bin/env python3
"""Build Kelvin Wiggly Morning Brief HTML from JSON data."""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from scenario_classifier import (
    build_action_guidance,
    build_morning_context,
    resolve_scenario_for_build,
)

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "templates"
SITE = ROOT / "docs"
DATA = ROOT / "data" / "issues"
WATER_HISTORY = ROOT / "data" / "water-level-history.json"
CONTEXT_LATEST = ROOT / "data" / "morning-brief-context-latest.json"
CONTEXT_DIR = ROOT / "data" / "morning-brief-context"
SCENARIO_MAP = SITE / "assets" / "covers" / "scenario-map.json"
ICONS = TEMPLATES / "icons.json"

ROMAN = (
    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
    (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
    (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
)
MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split()
LEGACY_SCENARIO_TERMS = (
    "高檔分化",
    "Divergence / Rotation",
    "DIVERGENCE / ROTATION",
    "強多頭",
    "震盪整理",
    "回檔修正",
    "空頭 / 風險升高",
    "空頭／風險升高",
    "盤後觀望",
    "財報週 / 等待",
    "AI 主線爆發",
)


def to_roman(n: int) -> str:
    out = []
    for value, numeral in ROMAN:
        while n >= value:
            out.append(numeral)
            n -= value
    return "".join(out)


def fmt_pct_filter(value) -> str:
    if value is None:
        return "—"
    return f"{value:+.2f}%"


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def scenario_by_id(scenarios: list[dict], sid: str) -> dict:
    for sc in scenarios:
        if sc["id"] == sid:
            return sc
    raise KeyError(f"Unknown scenario id: {sid}")


def scenario_label_for(data: dict, scenario_map: dict | None = None) -> str:
    if scenario_map is None:
        scenario_map = load_json(SCENARIO_MAP)
    sc = scenario_by_id(scenario_map["scenarios"], data["scenario_id"])
    return f"{sc['id']} {sc['name']}"


def _delta_phrase(ark: dict) -> str:
    prev = ark.get("prev")
    delta = ark.get("delta")
    wl = ark["water_level"]
    if prev is None or delta is None:
        return f"最新紀錄 {wl}%"
    if delta > 0:
        return f"較前次 {prev}% 上升 {abs(delta):.1f} 個百分點"
    if delta < 0:
        return f"較前次 {prev}% 下降 {abs(delta):.1f} 個百分點"
    return f"較前次 {prev}% 持平 0.0 個百分點"


def home_context(data: dict, ctx: dict) -> dict:
    """Fields for index.html — from issue JSON `home` or auto-derived."""
    home = data.get("home", {})
    ark = data["ark"]
    dt = datetime.strptime(data["date"], "%Y-%m-%d")
    md = f"{dt.month}/{dt.day}"
    delta_text = _delta_phrase(ark)

    water_note = home.get("water_note")
    if not water_note:
        water_note = (
            f"{md} 方舟水位以最新紀錄 {ark['water_level']}% 作保守基準，{delta_text}；"
            f"{ctx.get('editorial', {}).get('pull_quote', '')}"
        )

    thesis_blurb = home.get("thesis_blurb") or data.get("strategy", {}).get("playbook", "")

    risk_tagline = home.get("risk_tagline")
    if not risk_tagline:
        risk_tagline = f"{ctx['scenario_label']}｜{data.get('market', {}).get('systemic_risk', '中')}"

    recent_summary = home.get("recent_summary")
    if not recent_summary:
        recent_summary = data.get("editorial", {}).get("pull_quote", "")

    return {
        "water_note": water_note,
        "thesis_blurb": thesis_blurb,
        "risk_tagline": risk_tagline,
        "recent_summary": recent_summary,
    }



def build_verdict_from_scenario(data: dict, scenario: dict, action_guidance: dict | None = None) -> dict:
    """Derive Section XIV verdict from the new scenario classifier.

    Do not read legacy issue-level `verdict` blocks; old issues carried stale
    labels such as 高檔分化/Divergence that should not survive rebuilds.
    """
    ark = data.get("ark") or {}
    wl = ark.get("water_level")
    delta = ark.get("delta")
    risk_bias = (action_guidance or {}).get("risk_bias", "")
    direction = "持平"
    try:
        d = float(delta)
        if d > 0:
            direction = f"上升 {d:+.1f}pt"
        elif d < 0:
            direction = f"下降 {d:+.1f}pt"
    except Exception:
        pass
    label = f"{scenario['id']} {scenario['name']}"
    slug = str(scenario.get("slug") or "").replace("-", "_").upper()
    reason = scenario.get("reason") or data.get("scenario_reason") or "依新版八情境分類器判定。"
    return {
        "level": label,
        "level_en": slug,
        "reason": f"方舟水位 {wl}%（{direction}）；新版八情境判定為「{scenario['name']}」。{reason} ArkQuant 風險姿態：{risk_bias}。",
    }

def normalize_zone_overlap(section: dict | None) -> None:
    """Normalize overlap metadata for templates.

    Historical issue JSON uses `overlap` as a list of ticker codes, while the
    2026-07-06 ETF repair wrote a richer list of objects. Templates need a
    plain code list for `item.code in section.overlap` plus `overlap_names` for
    the visual overlap box. Keep both shapes acceptable at the data boundary.
    """
    if not isinstance(section, dict):
        return

    value = section.get("value") or []
    rising = section.get("rising") or []
    names = dict(section.get("overlap_names") or {})
    by_code = {}
    for item in [*value, *rising]:
        if isinstance(item, dict) and item.get("code"):
            by_code[item["code"]] = item.get("name", "")

    raw_overlap = section.get("overlap") or []
    codes = []
    for entry in raw_overlap:
        if isinstance(entry, dict):
            code = str(entry.get("code") or "").strip()
            if code:
                codes.append(code)
                if entry.get("name"):
                    names[code] = entry["name"]
        else:
            code = str(entry).strip()
            if code:
                codes.append(code)

    # If overlap is omitted, derive it from actual value/rising intersections.
    if not codes:
        value_codes = {item.get("code") for item in value if isinstance(item, dict)}
        rising_codes = {item.get("code") for item in rising if isinstance(item, dict)}
        codes = [code for code in value_codes if code and code in rising_codes]

    deduped = []
    for code in codes:
        if code not in deduped:
            deduped.append(code)
            names.setdefault(code, by_code.get(code, ""))

    section["overlap"] = deduped
    section["overlap_names"] = names


def enrich_issue(data: dict) -> dict:
    """Add derived fields for templates.

    Always resolve through the new classifier first. This prevents legacy
    `scenario_id` / `scenario_reason` values in old issue JSON from leaking into
    regenerated pages, index cards, and water-level history.
    """
    data = copy.deepcopy(data)
    normalize_zone_overlap(data.get("etf"))
    normalize_zone_overlap(data.get("stocks"))
    dt = datetime.strptime(data["date"], "%Y-%m-%d")
    issue_no = data["issue_no"]
    scenario_map = load_json(SCENARIO_MAP)
    effective, _classified, _override = resolve_scenario_for_build(data, scenario_map)
    sc = scenario_by_id(scenario_map["scenarios"], effective["id"])
    scenario = {
        "id": sc["id"],
        "name": sc["name"],
        "slug": sc.get("slug", ""),
        "subtitle": sc["subtitle"],
        "position": sc["position"],
        "sprite": scenario_map.get("sprite", "ChatGPT Image 2026年7月2日 下午07_51_15.png"),
        "reason": effective.get("reason") or data.get("scenario_reason", ""),
    }
    action_guidance = build_action_guidance(data, effective)

    wl = data["ark"]["water_level"]
    ctx = {
        **data,
        "date_display": dt.strftime("%Y/%m/%d"),
        "date_iso": data["date"],
        "date_slug": dt.strftime("%Y%m%d"),
        "issue_no_padded": f"{issue_no:03d}",
        "scenario": scenario,
        "cover_caption": f"{dt.year} · {dt.strftime('%m')} · {dt.strftime('%d')} · Volume One · Issue No.{issue_no:03d}",
        "masthead_roman": to_roman(dt.year),
        "masthead_month": MONTHS[dt.month - 1],
        "masthead_day": dt.strftime("%d"),
        "ark": {
            **data["ark"],
            "water_inset_right": round(100 - wl, 1),
        },
        "filename": f"{dt.strftime('%Y%m%d')}-stock-news-kelvin.html",
        "scenario_label": f"{sc['id']} {sc['name']}",
        "verdict": build_verdict_from_scenario(data, scenario, action_guidance),
        "icons": load_json(ICONS),
        "market_summary": data.get(
            "market_summary",
            f"加權 {data['market']['tw_index']['line'].split()[0] if data.get('market') else ''}",
        ),
    }
    ctx["home"] = home_context(data, ctx)
    return ctx


def sync_water_level(data: dict) -> None:
    """Upsert today's ark water level into data/water-level-history.json."""
    scenario_map = load_json(SCENARIO_MAP)
    label = scenario_label_for(data, scenario_map)
    entry = {
        "date": data["date"],
        "water_level": data["ark"]["water_level"],
        "scenario_id": data["scenario_id"],
        "scenario_label": label,
    }

    store = load_json(WATER_HISTORY) if WATER_HISTORY.exists() else {"records": []}
    records = store.get("records", [])
    records = [r for r in records if r["date"] != data["date"]]
    records.append(entry)
    records.sort(key=lambda r: r["date"], reverse=True)
    store["records"] = records
    save_json(WATER_HISTORY, store)


def load_water_records() -> list[dict]:
    if not WATER_HISTORY.exists():
        return []
    store = load_json(WATER_HISTORY)
    scenario_map = load_json(SCENARIO_MAP)
    rows = []
    for r in store.get("records", []):
        dt = datetime.strptime(r["date"], "%Y-%m-%d")
        label = r.get("scenario_label")
        if not label:
            try:
                label = scenario_label_for({"scenario_id": r["scenario_id"]}, scenario_map)
            except KeyError:
                label = r["scenario_id"]
        rows.append({
            "date": r["date"],
            "date_display": dt.strftime("%Y-%m-%d"),
            "water_level": r["water_level"],
            "scenario_label": label,
        })
    rows.sort(key=lambda x: x["date"], reverse=True)
    return rows


def build_env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    env.filters["fmt_pct"] = fmt_pct_filter
    return env


def render_brief(ctx: dict) -> str:
    env = build_env()
    tpl = env.get_template("morning-brief.html.j2")
    return tpl.render(**ctx)


def validate_no_legacy_scenario_terms(html: str, *, output_name: str) -> None:
    """Guardrail: rebuilt briefs must not publish old scenario taxonomy terms."""
    hits = [term for term in LEGACY_SCENARIO_TERMS if term in html]
    if hits:
        raise SystemExit(
            f"Legacy scenario term(s) still present in {output_name}: {', '.join(hits)}. "
            "Clean the issue/template text or regenerate from the new Ark eight-regime classifier."
        )


def validate_x_signal_lineage(data: dict, html: str) -> None:
    """Fail fast if a modern Kelvin issue omits the X/xurl provenance layer.

    The report may still publish when X is unavailable, but that unavailable/no-signal
    state must be explicit in the issue JSON. This prevents the 2026-06-06 failure mode:
    xurl was only checked after publication and the rendered page did not include its
    reader-facing signal analysis.
    """
    date = data.get("date", "")
    if date < "2026-06-06":
        return

    layer = data.get("xurl_signal_layer")
    if not isinstance(layer, dict):
        raise SystemExit(
            "Missing xurl_signal_layer in issue JSON. Run scripts/collect_kelvin_x_signals.py "
            "before generation, merge/compress the result into Sections VI–IX/X/B, or record "
            "an explicit unavailable/no-material-signal status."
        )

    status = layer.get("status")
    signals_count = int(layer.get("signals_count") or 0)
    included = bool(layer.get("included_in_revision"))
    explicit_non_signal = status in {"unavailable", "blocked", "no_material_signal"}

    if signals_count > 0 and not included:
        raise SystemExit("xurl_signal_layer has signals but included_in_revision is not true.")
    if signals_count <= 0 and not explicit_non_signal:
        raise SystemExit(
            "xurl_signal_layer must contain signals_count > 0 or explicit status "
            "unavailable/blocked/no_material_signal."
        )

    if signals_count > 0:
        # A generic phrase like "X 訊號未給追價催化" is not enough; the rendered
        # page must show actual compressed first-hand signal analysis.
        detail_markers = ("White House", "Elon Musk", "Starlink", "Fed X", "consumer credit", "NVIDIA 延續", "AMD")
        has_signal_detail = any(marker in html for marker in detail_markers)
        has_lineage_wording = ("X 直接訊號" in html) or ("X 貼文" in html) or ("觀察窗" in html)
        if not (has_signal_detail and has_lineage_wording):
            raise SystemExit(
                "xurl_signal_layer exists, but rendered HTML lacks reader-facing X signal details. "
                "Wire the compressed signal packet into Sections VI–IX/X/B before publishing."
            )


def validate_required_reader_fields(data: dict) -> None:
    """Reject modern issues whose lower sections would render blank or malformed."""
    if data.get("date", "") < "2026-07-13":
        return

    analysis = data.get("analysis") or {}
    intelligence = data.get("intelligence") or {}
    validation = data.get("validation") or {}
    appendix = data.get("appendix") or {}
    axes = analysis.get("axes") or {}

    required_strings = {
        "analysis.us_close": analysis.get("us_close"),
        "analysis.tx_night": analysis.get("tx_night"),
        "analysis.axes.thesis": axes.get("thesis"),
        "analysis.axes.policy": axes.get("policy"),
        "analysis.axes.risk": axes.get("risk"),
        "intelligence.musk": intelligence.get("musk"),
        "appendix.after_hours": appendix.get("after_hours"),
        "appendix.execution": appendix.get("execution"),
        "conclusion": data.get("conclusion"),
    }
    missing_strings = [
        path for path, value in required_strings.items()
        if not isinstance(value, str) or not value.strip()
    ]

    required_lists = {
        "validation.strengthened": validation.get("strengthened"),
        "validation.pressure": validation.get("pressure"),
        "validation.long_term": validation.get("long_term"),
        "intelligence.trump": intelligence.get("trump"),
        "intelligence.policy": intelligence.get("policy"),
        "appendix.map_bullets": appendix.get("map_bullets"),
    }
    missing_lists = [
        path for path, value in required_lists.items()
        if not isinstance(value, list) or not value
    ]

    missing = missing_strings + missing_lists
    if missing:
        raise SystemExit(
            "Missing required reader-facing field(s): " + ", ".join(missing) + ". "
            "These fields would make Sections VI–XIII, the conclusion, or appendices blank/malformed."
        )


def render_index(issues: list[dict]) -> str:
    env = build_env()
    sorted_issues = sorted(issues, key=lambda x: x["date"], reverse=True)
    latest_ctx = enrich_issue(sorted_issues[0])

    recent_issues = []
    for raw in sorted_issues[:2]:
        ctx = enrich_issue(raw)
        recent_issues.append({
            "filename": ctx["filename"],
            "date_display": ctx["date_display"],
            "scenario_name": ctx["scenario"]["name"],
            "summary": ctx["home"]["recent_summary"],
        })

    tpl = env.get_template("index.html.j2")
    return tpl.render(latest=latest_ctx, home=latest_ctx["home"], recent_issues=recent_issues)


def render_water_level(issues: list[dict]) -> str:
    env = build_env()
    records = load_water_records()
    sorted_issues = sorted(issues, key=lambda x: x["date"], reverse=True)
    latest_ctx = enrich_issue(sorted_issues[0]) if sorted_issues else None
    tpl = env.get_template("water-level.html.j2")
    return tpl.render(
        records=records,
        latest={
            "water_level": records[0]["water_level"] if records else "—",
            "date_display": records[0]["date_display"] if records else "—",
            "scenario_label": records[0]["scenario_label"] if records else "—",
        },
        latest_brief_url=latest_ctx["filename"] if latest_ctx else "index.html",
    )


def list_issue_files() -> list[Path]:
    if not DATA.exists():
        return []
    return sorted(p for p in DATA.glob("*.json") if not p.name.startswith("_"))


def load_all_issues() -> list[dict]:
    return [load_json(p) for p in list_issue_files()]


def export_morning_context(
    data: dict,
    json_path: Path,
    scenario: dict,
    write: bool = True,
) -> dict:
    action_guidance = build_action_guidance(data, scenario)
    rel_issue = json_path.resolve().relative_to(ROOT).as_posix()
    context = build_morning_context(
        data,
        scenario,
        action_guidance,
        issue_file=rel_issue,
    )
    if write:
        date_slug = datetime.strptime(data["date"], "%Y-%m-%d").strftime("%Y%m%d")
        save_json(CONTEXT_LATEST, context)
        save_json(CONTEXT_DIR / f"{date_slug}.json", context)
        print(f"Wrote {CONTEXT_LATEST}")
        print(f"Wrote {CONTEXT_DIR / f'{date_slug}.json'}")
    return context


def build_one(json_path: Path, write: bool = True) -> Path:
    data = load_json(json_path)
    validate_required_reader_fields(data)
    scenario_map = load_json(SCENARIO_MAP)
    effective, _classified, _override = resolve_scenario_for_build(data, scenario_map)
    sync_water_level(data)
    export_morning_context(data, json_path, effective, write=write)
    ctx = enrich_issue(data)
    html = render_brief(ctx)
    validate_no_legacy_scenario_terms(html, output_name=ctx["filename"])
    validate_x_signal_lineage(data, html)
    out = SITE / ctx["filename"]
    if write:
        SITE.mkdir(parents=True, exist_ok=True)
        out.write_text(html, encoding="utf-8")
        print(f"Wrote {out}")
    return out


def build_index(write: bool = True) -> Path:
    issues = load_all_issues()
    if not issues:
        raise SystemExit("No issue JSON files in data/issues/")
    html = render_index(issues)
    validate_no_legacy_scenario_terms(html, output_name="index.html")
    out = SITE / "index.html"
    if write:
        out.write_text(html, encoding="utf-8")
        print(f"Wrote {out}")
    return out


def build_water_level_page(write: bool = True) -> Path:
    issues = load_all_issues()
    html = render_water_level(issues)
    validate_no_legacy_scenario_terms(html, output_name="water-level.html")
    out = SITE / "water-level.html"
    if write:
        out.write_text(html, encoding="utf-8")
        print(f"Wrote {out}")
    return out


def build_site_pages(write: bool = True) -> None:
    build_index(write=write)
    build_water_level_page(write=write)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build Morning Brief site from JSON")
    parser.add_argument("issue", nargs="?", help="Path to issue JSON (default: latest in data/issues/)")
    parser.add_argument("--all", action="store_true", help="Rebuild all issues + index + water-level")
    parser.add_argument("--index-only", action="store_true", help="Rebuild index.html only")
    parser.add_argument("--sync-water", action="store_true", help="Rebuild water-level.html only")
    args = parser.parse_args(argv)

    if args.index_only:
        build_site_pages()
        return 0

    if args.sync_water:
        build_water_level_page()
        return 0

    if args.all:
        for path in list_issue_files():
            build_one(path)
        build_site_pages()
        return 0

    if args.issue:
        path = Path(args.issue)
    else:
        files = list_issue_files()
        if not files:
            print("No JSON in data/issues/. Copy data/issues/_template.json to YYYYMMDD.json", file=sys.stderr)
            return 1
        path = files[-1]

    build_one(path)
    build_site_pages()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
