#!/usr/bin/env python3
"""Fetch SOX, VIX, Mag7 from Yahoo Finance; optional TAIFEX OI."""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timedelta


def yahoo_chart(symbol: str, days: int = 5) -> list[tuple[str, float]]:
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?interval=1d&range={days}d"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read())
    res = data["chart"]["result"][0]
    ts = res["timestamp"]
    closes = res["indicators"]["quote"][0]["close"]
    rows = []
    for i, c in enumerate(closes):
        if c is not None:
            rows.append((datetime.fromtimestamp(ts[i]).strftime("%Y-%m-%d"), c))
    return rows


def last_change(rows: list[tuple[str, float]]) -> dict:
    if len(rows) < 2:
        v = rows[-1][1]
        return {"value": f"{v:,.2f}", "change_pct": None, "raw": v}
    _, prev = rows[-2]
    date, last = rows[-1]
    pct = (last / prev - 1) * 100
    return {
        "value": f"{last:,.2f}",
        "change_pct": round(pct, 2),
        "date": date,
        "raw": last,
    }


def fetch_mag7() -> list[dict]:
    tickers = [
        ("AAPL", "Apple", "strong"),
        ("MSFT", "Microsoft", "strong"),
        ("NVDA", "Nvidia", "weak"),
        ("AMZN", "Amazon", "weak"),
        ("GOOGL", "Alphabet", "weak"),
        ("META", "Meta", "weak"),
        ("TSLA", "Tesla", "weak"),
    ]
    out = []
    for sym, name, default_tier in tickers:
        rows = yahoo_chart(sym)
        if len(rows) < 2:
            continue
        _, prev = rows[-2]
        _, last = rows[-1]
        chg = last - prev
        pct = (last / prev - 1) * 100
        tier = "strong" if pct >= 1.5 else "weak"
        out.append({
            "name": name,
            "ticker": sym,
            "price": f"{last:.2f}",
            "change_pct": round(pct, 2),
            "change_abs": f"{chg:+.2f}",
            "tier": tier,
            "tier_label": "STRONG" if tier == "strong" else "NEUTRAL",
            "signal": "待編輯",
        })
    return out


def fetch_market_snapshot() -> dict:
    sox = last_change(yahoo_chart("^SOX"))
    vix = last_change(yahoo_chart("^VIX"))
    return {
        "sox": {"value": sox["value"], "change_pct": sox["change_pct"]},
        "vix": {"value": vix["value"], "change_pct": vix["change_pct"]},
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
    }


if __name__ == "__main__":
    snap = fetch_market_snapshot()
    print(json.dumps(snap, ensure_ascii=False, indent=2))
    print("\nMag7 sample:", json.dumps(fetch_mag7()[:2], ensure_ascii=False))
