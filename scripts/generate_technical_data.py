#!/usr/bin/env python3
"""產生 technical-data.json — KW Technical Spider 資料池。"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import re
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATHS = [
    ROOT / "technical-data.json",
    ROOT / "docs" / "technical-data.json",
    ROOT / "site" / "technical-data.json",
]

OFFICIAL_NAME_CACHE: dict[str, str] | None = None
YAHOO_OPENER: urllib.request.OpenerDirector | None = None
YAHOO_CRUMB: str | None = None

STOCK_NAMES: dict[str, str] = {
    "2330": "台積電",
    "2454": "聯發科",
    "3037": "欣興",
    "2383": "台光電",
    "3711": "日月光投控",
    "2308": "台達電",
    "2345": "智邦",
    "2327": "國巨*",
    "2305": "全友",
    "0050": "元大台灣50",
    "0052": "富邦科技",
    "0053": "元大電子",
    "0057": "富邦摩台",
    "00631L": "元大台灣50正2",
    "006203": "元大MSCI台灣",
    "00830": "國泰費城半導體",
    "00850": "元大臺灣ESG永續",
    "00861": "元大全球未來通訊",
    "00876": "元大全球5G",
    "00887": "永豐中國科技50大",
    "00888": "永豐台灣ESG",
    "00878": "國泰永續高股息",
    "00905": "FT臺灣Smart",
    "00910": "第一金太空衛星",
    "00911": "兆豐洲際半導體",
    "00912": "中信臺灣智慧50",
    "00913": "兆豐台灣晶圓製造",
    "00920": "富邦ESG綠色電力",
    "00927": "群益半導體收益",
    "00929": "復華台灣科技優息",
    "00946": "群益科技高息成長",
    "009804": "聯邦台精彩50",
    "009808": "永豐美國科技",
    "00985A": "主動野村台灣50",
    "00988A": "主動統一全球創新",
    "3665": "貿聯-KY",
    "6274": "台燿",
    "3189": "景碩",
    "2449": "京元電子",
    "2382": "廣達",
    "2324": "仁寶",
    "1409": "新纖",
    "1568": "倉佑",
    "2059": "川湖",
    "2061": "風青",
    "2303": "聯電",
    "2313": "華通",
    "2344": "華邦電",
    "2356": "英業達",
    "2360": "致茂",
    "2379": "瑞昱",
    "2455": "全新",
    "2492": "華新",
    "2495": "普安",
    "3008": "大立光",
    "3017": "奇鋐",
    "3021": "鴻名",
    "3026": "禾伸堂",
    "3034": "聯詠",
    "3149": "正達",
    "3481": "群創",
    "3528": "安馳",
    "3556": "禾瑞亞",
    "3624": "光頡",
    "4958": "臻鼎-KY",
    "5274": "信驊",
    "5321": "美而快",
    "8454": "富邦媒",
    "3147": "大綜",
    "5426": "振發",
    "2535": "達欣工",
    "3550": "聯穎",
    "4973": "廣穎",
    "3362": "先進光",
    "6446": "藥華藥",
    "2413": "環科",
    "6204": "艾華",
    "3114": "好德",
    "4542": "科嶠",
    "4939": "亞電",
    "5328": "華容",
    "4741": "泓瀚",
    "4739": "康普",
    "2243": "宏旭-KY",
    "3288": "點晶",
    "8105": "凌巨",
    "2883": "凱基金",
    "8021": "尖點",
    "4556": "旭然",
    "2478": "大毅",
    "6270": "倍微",
    "1714": "和桐",
    "3441": "聯一光",
    "5864": "致和證",
    "6005": "群益證",
    "6015": "宏遠證",
    "6016": "康和證",
    "6116": "華映",
    "6127": "九豪",
    "6197": "佳必琪",
    "6207": "雷科",
    "6223": "旺矽",
    "6239": "力成",
    "6285": "啟碁",
    "6415": "矽力*-KY",
    "6515": "穎崴",
    "6548": "長華科",
    "6654": "羅昇",
    "6870": "騰雲",
    "7769": "鴻勁",
    "8043": "鑫望實",
    "9105": "泰金寶-DR",
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


def _bootstrap_yahoo_session() -> tuple[urllib.request.OpenerDirector, str]:
    """Create a cookie/crumb Yahoo session when anonymous chart calls are rate-limited."""
    global YAHOO_OPENER, YAHOO_CRUMB
    if YAHOO_OPENER is not None and YAHOO_CRUMB:
        return YAHOO_OPENER, YAHOO_CRUMB

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    seed = urllib.request.Request("https://fc.yahoo.com/", headers={"User-Agent": "Mozilla/5.0"})
    try:
        opener.open(seed, timeout=20).read()
    except urllib.error.HTTPError:
        # fc.yahoo.com normally returns 404 after setting the A3 cookie.
        pass
    crumb_req = urllib.request.Request(
        "https://query2.finance.yahoo.com/v1/test/getcrumb",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with opener.open(crumb_req, timeout=20) as resp:
        crumb = resp.read().decode("utf-8", "replace").strip()
    if not crumb or "Too Many Requests" in crumb:
        raise RuntimeError("Yahoo crumb bootstrap failed")
    YAHOO_OPENER, YAHOO_CRUMB = opener, crumb
    return opener, crumb


def _read_yahoo_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        if exc.code != 429:
            raise
    opener, crumb = _bootstrap_yahoo_session()
    sep = "&" if "?" in url else "?"
    authed_url = f"{url}{sep}crumb={urllib.parse.quote(crumb)}"
    authed_req = urllib.request.Request(authed_url, headers={"User-Agent": "Mozilla/5.0"})
    with opener.open(authed_req, timeout=20) as resp:
        return json.loads(resp.read())


def fetch_yahoo_daily(code: str, range_days: str = "2y") -> tuple[list[dict], str, str | None]:
    for suffix, market in ((".TW", "TWSE"), (".TWO", "TPEX")):
        url = (
            f"https://query2.finance.yahoo.com/v8/finance/chart/{code}{suffix}"
            f"?range={range_days}&interval=1d"
        )
        try:
            payload = _read_yahoo_json(url)
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
            meta = result.get("meta") or {}
            yahoo_name = meta.get("shortName") or meta.get("longName") or meta.get("symbol")
            if yahoo_name:
                yahoo_name = str(yahoo_name).strip()
            if len(rows) >= 30:
                return rows, market, yahoo_name
        except Exception:
            continue
    return [], "UNKNOWN", None


def fetch_twse_month_rows(code: str, as_of: str) -> list[dict]:
    """Fetch official TWSE OHLCV for the report month.

    Yahoo occasionally omits a valid Taiwan ETF trading day around distributions,
    so comparing the current intraday bar directly with Yahoo's older bar produces a
    false daily percentage.  Overlay completed TWSE rows while retaining Yahoo's
    current intraday bar when the official daily file is not final yet.
    """
    month = as_of.replace("-", "")[:6] + "01"
    url = "https://www.twse.com.tw/exchangeReport/STOCK_DAY?" + urllib.parse.urlencode(
        {"response": "json", "date": month, "stockNo": code}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8-sig"))
    except Exception:
        return []
    if payload.get("stat") != "OK":
        return []

    rows: list[dict] = []
    for item in payload.get("data") or []:
        if not isinstance(item, list) or len(item) < 9:
            continue
        try:
            roc_year, month_num, day_num = [int(x) for x in str(item[0]).split("/")]
            date = f"{roc_year + 1911:04d}-{month_num:02d}-{day_num:02d}"
            if date > as_of:
                continue
            rows.append(
                {
                    "date": date,
                    "open": float(str(item[3]).replace(",", "")),
                    "high": float(str(item[4]).replace(",", "")),
                    "low": float(str(item[5]).replace(",", "")),
                    "close": float(str(item[6]).replace(",", "")),
                    "volume": int(str(item[1]).replace(",", "")),
                }
            )
        except (TypeError, ValueError):
            continue
    return rows


def _mis_price(value: object) -> float | None:
    try:
        text = str(value or "").split("_")[0].replace(",", "").strip()
        price = float(text)
        return price if price > 0 else None
    except (TypeError, ValueError):
        return None


def fetch_twse_intraday_row(code: str, as_of: str) -> tuple[dict | None, str | None]:
    """Use official TWSE MIS as an intraday fallback for a missing current bar.

    Thinly traded ETFs can have a valid current session in TWSE MIS while Yahoo has
    not emitted a daily bar yet. Only use this path for today's report date. MIS
    sometimes returns ``z=-`` between trades, so fall back to the best bid/ask
    midpoint; this remains an official near-live market observation, not mock data.
    """
    if as_of != datetime.now().strftime("%Y-%m-%d"):
        return None, None
    ex_ch = f"tse_{code}.tw|otc_{code}.tw"
    url = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?" + urllib.parse.urlencode(
        {"ex_ch": ex_ch, "json": "1", "delay": "0"}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8-sig"))
    except Exception:
        return None, None

    for item in payload.get("msgArray") or []:
        if str(item.get("c") or "").strip() != code:
            continue
        raw_date = str(item.get("d") or "")
        if len(raw_date) != 8:
            continue
        date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}"
        if date != as_of:
            continue
        close = _mis_price(item.get("z"))
        if close is None:
            bid = _mis_price(item.get("b"))
            ask = _mis_price(item.get("a"))
            if bid is not None and ask is not None:
                close = (bid + ask) / 2
            else:
                close = bid or ask
        if close is None:
            continue
        open_price = _mis_price(item.get("o")) or close
        high = max(_mis_price(item.get("h")) or close, open_price, close)
        low = min(_mis_price(item.get("l")) or close, open_price, close)
        try:
            volume = int(float(str(item.get("v") or "0").replace(",", "")))
        except (TypeError, ValueError):
            volume = 0
        market = "TWSE" if item.get("ex") == "tse" else "TPEX"
        return {
            "date": date,
            "open": float(open_price),
            "high": float(high),
            "low": float(low),
            "close": float(close),
            "volume": volume,
        }, market
    return None, None


def overlay_daily_rows(rows: list[dict], official_rows: list[dict]) -> list[dict]:
    merged = {row["date"]: row for row in rows if row.get("date")}
    for row in official_rows:
        merged[row["date"]] = row
    return [merged[date] for date in sorted(merged)]


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


def enrich_series_tail(rows: list[dict], tail: int = 250) -> list[dict]:
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

    series = enrich_series_tail(clean, 250)
    weekly_series = enrich_series_tail(resample_weekly(clean), 52)
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

    name = code

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
        "weekly_series": weekly_series,
        "chart_window": 120,
    }

    if len(series) < 180:
        record["_series_warning"] = f"series 僅 {len(series)} 筆，少於 180"

    return record


def load_official_name_map() -> dict[str, str]:
    """從 TWSE/TPEx 公開資料建立 code→中文簡稱；避免 Yahoo 英文簡稱流入 UI。"""
    global OFFICIAL_NAME_CACHE
    if OFFICIAL_NAME_CACHE is not None:
        return OFFICIAL_NAME_CACHE

    urls = (
        "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL",
        "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
        "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
        "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
    )
    names: dict[str, str] = {}
    for url in urls:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                rows = json.loads(resp.read().decode("utf-8-sig"))
        except Exception:
            continue
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            code = (
                row.get("Code")
                or row.get("公司代號")
                or row.get("SecuritiesCompanyCode")
            )
            name = (
                row.get("Name")
                or row.get("公司簡稱")
                or row.get("CompanyAbbreviation")
                or row.get("CompanyName")
            )
            if code and name:
                c = str(code).strip().upper()
                n = str(name).strip()
                if c and n and n != c:
                    names.setdefault(c, n)
    OFFICIAL_NAME_CACHE = names
    return names


def build_html_name_map(html_paths: list[Path]) -> dict[str, str]:
    """從晨報 HTML 建立 code→name 對照（整檔掃描，避免單一代號誤配）。"""
    names: dict[str, str] = {}
    for path in html_paths:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for code, name in re.findall(
            r'<div class="card-code">([^<]+)</div>\s*<div class="card-name">([^<]+)</div>',
            text,
            flags=re.I,
        ):
            c = code.strip().upper()
            n = name.strip()
            if c and n and n != c:
                names[c] = n
        for code, name in re.findall(
            r'data-code="([^"]+)"[^>]*>\s*<div class="code">[^<]*</div>\s*<b>([^<]+)</b>',
            text,
            flags=re.I | re.S,
        ):
            c = code.strip().upper()
            n = name.strip()
            if c and n and n != c:
                names[c] = n
    return names


def resolve_stock_name(
    code: str,
    html_map: dict[str, str],
    yahoo_name: str | None,
) -> str:
    code = code.strip().upper()
    if code in STOCK_NAMES:
        return STOCK_NAMES[code]
    if code in html_map and html_map[code] and html_map[code] != code:
        return html_map[code]
    official_names = load_official_name_map()
    if code in official_names:
        return official_names[code]
    if yahoo_name and yahoo_name != code and not yahoo_name.endswith(code):
        return yahoo_name
    return code


def validate_output(doc: dict, expect_as_of: str | None = None) -> list[str]:
    issues: list[str] = []
    records = doc.get("records") or []
    if not records:
        issues.append("records 為空")
    if expect_as_of and doc.get("as_of") != expect_as_of:
        issues.append(f"as_of 應為 {expect_as_of}，實際 {doc.get('as_of')}")
    for rec in records:
        for key in ("code", "name"):
            if not rec.get(key):
                issues.append(f"{rec.get('code','?')} 缺少 {key}")
        if rec.get("name") == rec.get("code"):
            issues.append(f"{rec.get('code')} name 等於 code（待補）")
        if not rec.get("weekly_series"):
            issues.append(f"{rec.get('code')} 缺少 weekly_series")
        close = rec.get("latest", {}).get("close")
        daily = rec.get("daily", {})
        if close is None:
            issues.append(f"{rec.get('code')} 缺少 close")
        for k in ("ma20", "boll_ub", "boll_lb"):
            if daily.get(k) is None:
                issues.append(f"{rec.get('code')} 缺少 daily.{k}")
        slen = len(rec.get("series") or [])
        if slen < 60:
            issues.append(f"{rec.get('code')} series < 60")
        elif slen < 180:
            issues.append(f"{rec.get('code')} series < 180 (morphology 降權)")
        series = rec.get("series") or []
        if series:
            last = series[-1]
            if expect_as_of and last.get("date") != expect_as_of:
                issues.append(
                    f"{rec.get('code')} 最後一根日期 {last.get('date')} != {expect_as_of}"
                )
            o, h, l, c = last.get("open"), last.get("high"), last.get("low"), last.get("close")
            if not all(isinstance(x, (int, float)) for x in (o, h, l, c)):
                issues.append(f"{rec.get('code')} OHLC 無效")
            elif h < max(o, c, l) - 1e-6 or l > min(o, c, h) + 1e-6:
                issues.append(f"{rec.get('code')} OHLC 邏輯錯誤")
        wlen = len(rec.get("weekly_series") or [])
        if wlen < 10:
            issues.append(f"{rec.get('code')} weekly_series 過短")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="產生 technical-data.json")
    parser.add_argument("--html", nargs="*", help="晨報 HTML 路徑")
    parser.add_argument("--watchlist", help="自訂 watchlist JSON")
    parser.add_argument("--codes", help="逗號分隔代號")
    parser.add_argument("--max", type=int, default=0, help="最多處理檔數，0=全部")
    parser.add_argument("--as-of", dest="as_of", help="資料截至日 YYYY-MM-DD")
    parser.add_argument(
        "--pool",
        help="從既有 technical-data.json 讀取 universe（保留 78 檔代號）",
    )
    args = parser.parse_args()

    html_paths = [Path(p) for p in (args.html or [])]
    if not html_paths and not args.pool:
        html_paths = sorted(ROOT.glob("*-stock-news-kelvin.html"), reverse=True)
        html_paths = sorted(ROOT.glob("docs/*-stock-news-kelvin.html"), reverse=True) + html_paths
    html_map = build_html_name_map(html_paths) if html_paths else {}

    universe = resolve_universe(args)
    if args.pool:
        pool_path = Path(args.pool)
        pool_doc = json.loads(pool_path.read_text(encoding="utf-8"))
        pool_codes = [str(r.get("code", "")).strip() for r in pool_doc.get("records") or []]
        pool_codes = [c for c in pool_codes if c]
        seen: set[str] = set()
        merged: list[str] = []
        for c in pool_codes:
            if c not in seen:
                seen.add(c)
                merged.append(c)
        if merged:
            universe = merged
    if args.max and args.max > 0:
        universe = universe[: args.max]

    as_of = args.as_of or datetime.now().strftime("%Y-%m-%d")
    if not args.as_of and html_paths:
        m = re.search(r"(20\d{6})", html_paths[0].name)
        if m:
            d = m.group(1)
            as_of = f"{d[:4]}-{d[4:6]}-{d[6:8]}"

    records: list[dict] = []
    missing: list[str] = []
    warnings_log: list[str] = []

    for i, code in enumerate(universe):
        rows, market, yahoo_name = fetch_yahoo_daily(code)
        if rows and market == "TWSE":
            rows = overlay_daily_rows(rows, fetch_twse_month_rows(code, as_of))
        if rows and rows[-1].get("date") != as_of:
            intraday_row, intraday_market = fetch_twse_intraday_row(code, as_of)
            if intraday_row:
                rows = overlay_daily_rows(rows, [intraday_row])
                market = intraday_market or market
        rec = build_record(code, rows, market, as_of) if rows else None
        if rec:
            rec["name"] = resolve_stock_name(code, html_map, yahoo_name)
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
        "source": "Yahoo Finance chart API with TWSE STOCK_DAY overlay and official MIS intraday fallback",
        "purpose": "technical-spider scanner radar alert backtest",
        "records": records,
        "missing": missing,
        "meta": {
            "universe_size": len(universe),
            "record_count": len(records),
        },
    }

    issues = validate_output(doc, expect_as_of=as_of)
    if not records:
        print("ERROR: records == 0，中止寫入", file=sys.stderr)
        return 1

    # The browser only needs the recent daily chart window. Keep full weekly data for
    # validation above, then slim the deployed payload so GitHub Pages/WebViews do not
    # intermittently fail while fetching a multi-megabyte JSON file.
    for rec in records:
        rec.pop("weekly_series", None)
        rec.pop("chart_window", None)
        rec["series"] = (rec.get("series") or [])[-90:]
    payload_text = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))

    for path in OUTPUT_PATHS:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(payload_text, encoding="utf-8")

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
