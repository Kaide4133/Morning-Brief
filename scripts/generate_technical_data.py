#!/usr/bin/env python3
"""產生 technical-data.json — KW Technical Spider 資料池。"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATHS = [
    ROOT / "technical-data.json",
    ROOT / "docs" / "technical-data.json",
    ROOT / "site" / "technical-data.json",
]

STOCK_NAMES: dict[str, str] = {
    "2330": "台積電",
    "2454": "聯發科",
    "3037": "欣興",
    "2383": "台光電",
    "3711": "日月光投控",
    "2308": "台達電",
    "2345": "智邦",
    "2327": "國巨*",
    "0050": "元大台灣50",
}


def extract_codes_from_html(html_path: Path) -> list[str]:
    text = html_path.read_text(encoding="utf-8")
    codes: list[str] = []
    for pattern in (
        r'<div class="card-code">([^<]+)</div>',
        r'data-code="([^"]+)"',
    ):
        for raw in re.findall(pattern, text):
            code = raw.strip().upper()
            if code and code not in codes:
                codes.append(code)
    return codes


def load_watchlist(path: Path | None) -> list[str]:
    if not path or not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [str(x).strip() for x in data if str(x).strip()]
    if isinstance(data, dict):
        items = data.get("codes") or data.get("tickers") or []
        return [str(x).strip() for x in items if str(x).strip()]
    return []


def resolve_universe(args: argparse.Namespace) -> list[str]:
    codes: list[str] = []
    if args.watchlist:
        codes.extend(load_watchlist(Path(args.watchlist)))
    if args.html:
        for p in args.html:
            codes.extend(extract_codes_from_html(Path(p)))
    if not codes:
        latest = sorted(ROOT.glob("*-stock-news-kelvin.html"), reverse=True)
        if latest:
            codes.extend(extract_codes_from_html(latest[0]))
    if args.codes:
        for c in args.codes.split(","):
            c = c.strip()
            if c and c not in codes:
                codes.append(c)
    if not codes:
        codes = ["2330", "2454", "3037", "2383", "3711"]
    seen: set[str] = set()
    out: list[str] = []
    for c in codes:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def fetch_yahoo_daily(code: str, range_days: str = "1y") -> tuple[list[dict], str]:
    for suffix, market in ((".TW", "TWSE"), (".TWO", "TPEX")):
        url = (
            f"https://query2.finance.yahoo.com/v8/finance/chart/{code}{suffix}"
            f"?range={range_days}&interval=1d"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                payload = json.loads(resp.read())
            result = payload["chart"]["result"][0]
            timestamps = result.get("timestamp") or []
            quote = result["indicators"]["quote"][0]
            rows: list[dict] = []
            for i, ts in enumerate(timestamps):
                o = quote.get("open", [None] * len(timestamps))[i]
                h = quote.get("high", [None] * len(timestamps))[i]
                l = quote.get("low", [None] * len(timestamps))[i]
                c = quote.get("close", [None] * len(timestamps))[i]
                v = quote.get("volume", [None] * len(timestamps))[i]
                if c is None or o is None:
                    continue
                rows.append(
                    {
                        "date": datetime.fromtimestamp(ts).strftime("%Y-%m-%d"),
                        "open": float(o),
                        "high": float(h or c),
                        "low": float(l or c),
                        "close": float(c),
                        "volume": int(v or 0),
                    }
                )
            if len(rows) >= 30:
                return rows, market
        except Exception:
            continue
    return [], "UNKNOWN"


def sma(values: list[float], n: int) -> float | None:
    if len(values) < n:
        return None
    return sum(values[-n:]) / n


def bollinger(closes: list[float], n: int = 20, k: float = 2.0) -> tuple[float | None, float | None, float | None]:
    if len(closes) < n:
        return None, None, None
    window = closes[-n:]
    mid = sum(window) / n
    sd = statistics.stdev(window) if len(window) >= 2 else 0.0
    return mid, mid + k * sd, mid - k * sd


def resample_weekly(daily: list[dict]) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    for row in daily:
        dt = datetime.strptime(row["date"], "%Y-%m-%d")
        key = dt.strftime("%G-W%V")
        buckets.setdefault(key, []).append(row)
    weeks: list[dict] = []
    for key in sorted(buckets.keys()):
        chunk = buckets[key]
        weeks.append(
            {
                "date": chunk[-1]["date"],
                "open": chunk[0]["open"],
                "high": max(r["high"] for r in chunk),
                "low": min(r["low"] for r in chunk),
                "close": chunk[-1]["close"],
                "volume": sum(r["volume"] for r in chunk),
            }
        )
    return weeks


def enrich_series_tail(rows: list[dict], tail: int = 60) -> list[dict]:
    out: list[dict] = []
    for i, row in enumerate(rows):
        prefix = rows[: i + 1]
        closes = [r["close"] for r in prefix]
        ma5 = sma(closes, 5)
        ma10 = sma(closes, 10)
        ma20 = sma(closes, 20)
        _, ub, lb = bollinger(closes, 20)
        out.append(
            {
                "date": row["date"],
                "open": round(row["open"], 2),
                "high": round(row["high"], 2),
                "low": round(row["low"], 2),
                "close": round(row["close"], 2),
                "volume": int(row["volume"]),
                "ma5": round(ma5, 2) if ma5 is not None else None,
                "ma10": round(ma10, 2) if ma10 is not None else None,
                "ma20": round(ma20, 2) if ma20 is not None else None,
                "boll_ub": round(ub, 2) if ub is not None else None,
                "boll_lb": round(lb, 2) if lb is not None else None,
            }
        )
    return out[-tail:]


def consecutive_up(rows: list[dict]) -> int:
    n = 0
    for i in range(len(rows) - 1, 0, -1):
        if rows[i]["close"] > rows[i - 1]["close"]:
            n += 1
        else:
            break
    return n


def infer_trend_state(close: float, ma5: float, ma10: float, ma20: float, ma60: float | None) -> str:
    if ma60 and close < ma60:
        return "空頭壓力"
    if close < ma20:
        return "轉弱"
    if ma5 > ma10 > ma20:
        return "多頭排列"
    if ma5 > ma10:
        return "短線轉強"
    if close > ma20:
        return "高檔延伸" if close > ma20 * 1.08 else "站上均線"
    return "震盪"


def infer_extension(dist_pct: float, close: float, boll_ub: float | None) -> str:
    if boll_ub and close >= boll_ub * 0.99:
        return "觸及上軌"
    if dist_pct > 10:
        return "過熱"
    if dist_pct >= 5:
        return "偏熱"
    return "正常"


def build_record(code: str, rows: list[dict], market: str, as_of: str) -> dict | None:
    clean = [r for r in rows if r.get("close")]
    if len(clean) < 25:
        return None

    last = clean[-1]
    prev = clean[-2] if len(clean) >= 2 else last
    closes = [r["close"] for r in clean]
    vols = [r["volume"] for r in clean]

    ma5 = sma(closes, 5) or last["close"]
    ma10 = sma(closes, 10) or ma5
    ma20 = sma(closes, 20) or ma10
    ma60 = sma(closes, 60)
    mid, boll_ub, boll_lb = bollinger(closes, 20)

    prev_high20 = max(r["high"] for r in clean[-21:-1]) if len(clean) >= 21 else max(
        r["high"] for r in clean[:-1]
    )
    recent_low10 = min(r["low"] for r in clean[-10:])
    prev_vols = vols[-6:-1] or vols[:-1]
    avg_vol5 = sum(prev_vols) / max(1, len(prev_vols))
    volume_ratio = last["volume"] / avg_vol5 if avg_vol5 else 1.0
    distance_ma20_pct = (last["close"] / ma20 - 1) * 100 if ma20 else 0.0
    span = max(0.01, last["high"] - last["low"])
    upper_shadow_ratio = (last["high"] - max(last["open"], last["close"])) / span
    consec = consecutive_up(clean)
    change_pct = (last["close"] / prev["close"] - 1) * 100 if prev["close"] else 0.0

    weekly_rows = resample_weekly(clean)
    w_closes = [r["close"] for r in weekly_rows]
    w_ma5 = sma(w_closes, 5)
    w_ma10 = sma(w_closes, 10)
    w_ma20 = sma(w_closes, 20)
    _, w_ub, w_lb = bollinger(w_closes, 20)
    w_ma5 = w_ma5 or (w_closes[-1] if w_closes else 0)
    w_ma10 = w_ma10 or w_ma5
    w_ma20 = w_ma20 or w_ma10
    w_ub = w_ub or w_ma20
    w_lb = w_lb or w_ma20

    dist = distance_ma20_pct
    ext = infer_extension(dist, last["close"], boll_ub)
    trend = infer_trend_state(last["close"], ma5, ma10, ma20, ma60)

    support = [f"MA20 {round(ma20)}", f"10日低點 {round(recent_low10)}"]
    resistance = [f"20日前高 {round(prev_high20)}", f"BOLL上緣 {round(boll_ub or mid or 0)}"]

    series = enrich_series_tail(clean, 60)
    flags: list[str] = []
    warnings: list[str] = []
    if last["close"] > ma20:
        flags.append("站上MA20")
    if boll_ub and last["close"] >= boll_ub * 0.97:
        flags.append("接近BOLL上緣")
        warnings.append("接近日線BOLL上緣")
    if dist > 10:
        flags.append("距MA20偏遠")
        warnings.append("距離MA20超過10%")
    if upper_shadow_ratio > 0.35:
        warnings.append("長上影線偏高")
    if consec >= 3:
        warnings.append(f"連續上漲{consec}日")
    if w_ub and last["close"] >= w_ub * 0.97:
        warnings.append("接近週線BOLL上緣")

    trend_score = 70
    if ma5 > ma10 > ma20:
        trend_score = 85
    elif last["close"] < ma20:
        trend_score = 40
    extension_score = min(95, max(20, int(abs(dist) * 6 + (15 if ext == "偏熱" else 0) + (25 if ext == "過熱" else 0))))
    risk_score = min(95, 35 + len(warnings) * 12 + (15 if ext in ("偏熱", "過熱", "觸及上軌") else 0))

    name = STOCK_NAMES.get(code, code)

    summary_parts = [
        f"趨勢{trend}，延伸{ext}。",
        "短線" + ("不宜追高。" if ext in ("偏熱", "過熱", "觸及上軌") else "可續觀察均線支撐。"),
    ]

    record = {
        "code": code,
        "name": name,
        "market": market,
        "as_of": as_of,
        "latest": {
            "close": round(last["close"], 2),
            "change_pct": round(change_pct, 2),
            "volume": int(last["volume"]),
        },
        "daily": {
            "ma5": round(ma5, 2),
            "ma10": round(ma10, 2),
            "ma20": round(ma20, 2),
            "ma60": round(ma60, 2) if ma60 else None,
            "boll_mid": round(mid or ma20, 2),
            "boll_ub": round(boll_ub or 0, 2),
            "boll_lb": round(boll_lb or 0, 2),
            "prev_high20": round(prev_high20, 2),
            "recent_low10": round(recent_low10, 2),
            "volume_ratio": round(volume_ratio, 2),
            "distance_ma20_pct": round(distance_ma20_pct, 2),
            "upper_shadow_ratio": round(upper_shadow_ratio, 3),
            "consecutive_up": consec,
            "trend_state": trend,
            "extension_state": ext,
            "support": support,
            "resistance": resistance,
        },
        "weekly": {
            "ma5": round(w_ma5, 2),
            "ma10": round(w_ma10, 2),
            "ma20": round(w_ma20, 2),
            "boll_ub": round(w_ub, 2),
            "boll_lb": round(w_lb, 2),
            "trend_state": "多頭延伸" if w_ma5 > w_ma10 else "整理",
            "extension_state": "接近週線上緣" if w_ub and last["close"] >= w_ub * 0.97 else "週線中性",
        },
        "analysis": {
            "summary": "".join(summary_parts),
            "trend_score": trend_score,
            "extension_score": extension_score,
            "risk_score": risk_score,
            "labels": flags[:6],
            "warnings": warnings[:6],
        },
        "series": series,
    }

    if len(series) < 60:
        record["_series_warning"] = f"series 僅 {len(series)} 筆，少於 60"

    return record


def extract_name_from_html(code: str, html_paths: list[Path]) -> str | None:
    for path in html_paths:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        m = re.search(
            rf'<div class="card-code">{re.escape(code)}</div>\s*<div class="card-name">([^<]+)</div>',
            text,
        )
        if m:
            return m.group(1).strip()
    return None


def validate_output(doc: dict) -> list[str]:
    issues: list[str] = []
    records = doc.get("records") or []
    if not records:
        issues.append("records 為空")
    for rec in records:
        for key in ("code", "name"):
            if not rec.get(key):
                issues.append(f"{rec.get('code','?')} 缺少 {key}")
        close = rec.get("latest", {}).get("close")
        daily = rec.get("daily", {})
        if close is None:
            issues.append(f"{rec.get('code')} 缺少 close")
        for k in ("ma20", "boll_ub", "boll_lb"):
            if daily.get(k) is None:
                issues.append(f"{rec.get('code')} 缺少 daily.{k}")
        if len(rec.get("series") or []) < 60:
            issues.append(f"{rec.get('code')} series < 60")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="產生 technical-data.json")
    parser.add_argument("--html", nargs="*", help="晨報 HTML 路徑")
    parser.add_argument("--watchlist", help="自訂 watchlist JSON")
    parser.add_argument("--codes", help="逗號分隔代號")
    parser.add_argument("--max", type=int, default=0, help="最多處理檔數，0=全部")
    args = parser.parse_args()

    html_paths = [Path(p) for p in (args.html or [])]
    if not html_paths:
        html_paths = sorted(ROOT.glob("*-stock-news-kelvin.html"), reverse=True)[:1]

    universe = resolve_universe(args)
    if args.max and args.max > 0:
        universe = universe[: args.max]

    as_of = datetime.now().strftime("%Y-%m-%d")
    if html_paths:
        m = re.search(r"(20\d{6})", html_paths[0].name)
        if m:
            d = m.group(1)
            as_of = f"{d[:4]}-{d[4:6]}-{d[6:8]}"

    records: list[dict] = []
    missing: list[str] = []
    warnings_log: list[str] = []

    for i, code in enumerate(universe):
        rows, market = fetch_yahoo_daily(code)
        name_override = extract_name_from_html(code, html_paths)
        rec = build_record(code, rows, market, as_of) if rows else None
        if rec:
            if name_override:
                rec["name"] = name_override
            records.append(rec)
            if rec.get("_series_warning"):
                warnings_log.append(rec["_series_warning"])
                del rec["_series_warning"]
        else:
            missing.append(code)
        time.sleep(0.05)
        if (i + 1) % 10 == 0:
            print(f"…已處理 {i + 1}/{len(universe)}", file=sys.stderr)

    doc = {
        "version": 1,
        "as_of": as_of,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source": "Yahoo Finance chart API (daily close from quote, not meta price)",
        "purpose": "technical-spider scanner radar alert backtest",
        "records": records,
        "missing": missing,
        "meta": {
            "universe_size": len(universe),
            "record_count": len(records),
        },
    }

    issues = validate_output(doc)
    if not records:
        print("ERROR: records == 0，中止寫入", file=sys.stderr)
        return 1

    for path in OUTPUT_PATHS:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "records": len(records),
                "missing": len(missing),
                "validation_issues": issues,
                "outputs": [str(p) for p in OUTPUT_PATHS],
            },
            ensure_ascii=False,
        )
    )
    return 0 if records else 1


if __name__ == "__main__":
    raise SystemExit(main())
