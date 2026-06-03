#!/usr/bin/env python3
"""修正 technical-data.json 股票名稱（不重抓行情）。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_technical_data import (  # noqa: E402
    OUTPUT_PATHS,
    build_html_name_map,
    resolve_stock_name,
)

def main() -> int:
    html_paths = sorted(ROOT.glob("*-stock-news-kelvin.html"), reverse=True)
    html_paths += sorted(ROOT.glob("docs/*-stock-news-kelvin.html"), reverse=True)
    html_map = build_html_name_map(html_paths)

    src = ROOT / "docs" / "technical-data.json"
    doc = json.loads(src.read_text(encoding="utf-8"))
    bad: list[str] = []
    for rec in doc.get("records") or []:
        code = str(rec.get("code", "")).strip().upper()
        old = rec.get("name")
        rec["name"] = resolve_stock_name(code, html_map, old if old != code else None)
        if not rec.get("name") or rec["name"] == code:
            bad.append(code)

    for path in OUTPUT_PATHS:
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "records": len(doc.get("records") or []),
                "name_equals_code": bad,
                "3665": next((r["name"] for r in doc["records"] if r["code"] == "3665"), None),
                "00887": next((r["name"] for r in doc["records"] if r["code"] == "00887"), None),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
