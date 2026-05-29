#!/usr/bin/env python3
"""Build Kelvin Wiggly Morning Brief HTML from JSON data."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "templates"
SITE = ROOT / "site"
DATA = ROOT / "data" / "issues"
WATER_HISTORY = ROOT / "data" / "water-level-history.json"
SCENARIO_MAP = SITE / "assets" / "covers" / "scenario-map.json"
ICONS = TEMPLATES / "icons.json"

ROMAN = (
    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
    (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
    (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
)
MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split()


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


def enrich_issue(data: dict) -> dict:
    """Add derived fields for templates."""
    dt = datetime.strptime(data["date"], "%Y-%m-%d")
    issue_no = data["issue_no"]
    scenario_map = load_json(SCENARIO_MAP)
    sc = scenario_by_id(scenario_map["scenarios"], data["scenario_id"])
    scenario = {
        "id": sc["id"],
        "name": sc["name"],
        "subtitle": sc["subtitle"],
        "position": sc["position"],
        "reason": data.get("scenario_reason", ""),
    }

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


def build_one(json_path: Path, write: bool = True) -> Path:
    data = load_json(json_path)
    sync_water_level(data)
    ctx = enrich_issue(data)
    html = render_brief(ctx)
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
    out = SITE / "index.html"
    if write:
        out.write_text(html, encoding="utf-8")
        print(f"Wrote {out}")
    return out


def build_water_level_page(write: bool = True) -> Path:
    issues = load_all_issues()
    html = render_water_level(issues)
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
