#!/usr/bin/env python3
"""Official TWSE TAIEX daily-close cache and water-level comparison rows.

The authoritative source is TWSE's MI_5MINS_HIST report.  The monthly web
report is used for historical backfill; TWSE OpenAPI is an official fallback
for the current month.  No value is forward-filled or inferred.
"""

from __future__ import annotations

import calendar
import copy
import json
import math
import os
import tempfile
import urllib.request
from datetime import date, datetime, time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo


SOURCE_NAME = "Taiwan Stock Exchange (TWSE) MI_5MINS_HIST"
# Keep the official cache under docs: the existing publisher commits docs/,
# so future daily builds retain completed monthly history without CI changes.
CACHE_RELATIVE_PATH = Path("docs") / "taiex-history.json"
TAIPEI = ZoneInfo("Asia/Taipei")
# TWSE cash trading ends at 13:30.  A 14:00 gate avoids accepting an
# accidentally exposed intraday/report row as a completed daily close.
DAILY_CLOSE_PUBLICATION_CUTOFF = time(14, 0)
DEFAULT_TIMEOUT_SECONDS = 12.0
WEB_URLS = (
    "https://www.twse.com.tw/rwd/zh/indicesReport/MI_5MINS_HIST?date={date}&response=json",
    "https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date={date}",
)
OPENAPI_URL = "https://openapi.twse.com.tw/v1/indicesReport/MI_5MINS_HIST"
FetchJSON = Callable[[str, float], Any]


def _iso_now(now: datetime) -> str:
    return now.astimezone(TAIPEI).isoformat(timespec="seconds")


def _normalize_now(now: Optional[datetime]) -> datetime:
    if now is None:
        return datetime.now(TAIPEI)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    return now.astimezone(TAIPEI)


def _parse_iso_date(value: Any) -> date:
    if not isinstance(value, str):
        raise ValueError("date must be a string")
    try:
        parsed = date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid ISO date: %r" % (value,)) from exc
    if parsed.isoformat() != value:
        raise ValueError("date must use YYYY-MM-DD: %r" % (value,))
    return parsed


def _parse_roc_date(value: Any) -> date:
    if not isinstance(value, str):
        raise ValueError("TWSE date must be a string")
    compact = value.strip().replace("/", "")
    if not compact.isdigit() or len(compact) != 7:
        raise ValueError("invalid TWSE ROC date: %r" % (value,))
    roc_year = int(compact[:3])
    if roc_year <= 0:
        raise ValueError("invalid TWSE ROC year: %r" % (value,))
    try:
        return date(roc_year + 1911, int(compact[3:5]), int(compact[5:7]))
    except ValueError as exc:
        raise ValueError("invalid TWSE ROC date: %r" % (value,)) from exc


def _positive_finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool):
        raise ValueError("%s must be numeric" % field)
    try:
        number = float(str(value).strip().replace(",", ""))
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid %s: %r" % (field, value)) from exc
    if not math.isfinite(number) or number <= 0:
        raise ValueError("%s must be finite and positive" % field)
    return number


def _water_level_number(value: Any) -> float:
    if isinstance(value, bool):
        raise ValueError("water_level must be numeric")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid water_level: %r" % (value,)) from exc
    if not math.isfinite(number) or not 0 <= number <= 100:
        raise ValueError("water_level must be finite and between 0 and 100")
    return number


def _validated_ohlc(
    raw_open: Any,
    raw_high: Any,
    raw_low: Any,
    raw_close: Any,
    field_prefix: str = "",
) -> Dict[str, float]:
    prefix = (field_prefix + " ") if field_prefix else ""
    opening = _positive_finite_number(raw_open, prefix + "open")
    high = _positive_finite_number(raw_high, prefix + "high")
    low = _positive_finite_number(raw_low, prefix + "low")
    close = _positive_finite_number(raw_close, prefix + "close")
    if not low <= min(opening, close) <= max(opening, close) <= high:
        raise ValueError("%sOHLC values are inconsistent" % prefix)
    return {"open": opening, "high": high, "low": low, "close": close}


def parse_month_payload(payload: Any, expected_month: str) -> List[Dict[str, Any]]:
    """Validate a complete-OHLC TWSE monthly-web or OpenAPI response."""
    if len(expected_month) != 7:
        raise ValueError("expected_month must use YYYY-MM")
    try:
        date(int(expected_month[:4]), int(expected_month[5:7]), 1)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid expected month") from exc

    raw_rows: Any
    field_indexes: Dict[str, int]
    openapi_shape = isinstance(payload, list)
    if openapi_shape:
        raw_rows = payload
        field_indexes = {}
    elif isinstance(payload, dict):
        if payload.get("stat") != "OK":
            raise ValueError("TWSE response status is not OK")
        fields = payload.get("fields")
        raw_rows = payload.get("data")
        if not isinstance(fields, list) or not isinstance(raw_rows, list):
            raise ValueError("TWSE response lacks fields/data arrays")
        required_fields = {
            "date": "日期",
            "open": "開盤指數",
            "high": "最高指數",
            "low": "最低指數",
            "close": "收盤指數",
        }
        try:
            field_indexes = {key: fields.index(name) for key, name in required_fields.items()}
        except ValueError as exc:
            raise ValueError("TWSE response lacks complete OHLC fields") from exc
    else:
        raise ValueError("TWSE response must be an object or array")

    parsed_rows: List[Dict[str, Any]] = []
    seen = set()
    for raw in raw_rows:
        if openapi_shape:
            required_openapi_fields = (
                "Date",
                "OpeningIndex",
                "HighestIndex",
                "LowestIndex",
                "ClosingIndex",
            )
            if not isinstance(raw, dict) or any(key not in raw for key in required_openapi_fields):
                raise ValueError("invalid TWSE OpenAPI row")
            raw_date = raw["Date"]
            raw_ohlc = (
                raw["OpeningIndex"],
                raw["HighestIndex"],
                raw["LowestIndex"],
                raw["ClosingIndex"],
            )
        else:
            if not isinstance(raw, list) or max(field_indexes.values()) >= len(raw):
                raise ValueError("invalid TWSE monthly row")
            raw_date = raw[field_indexes["date"]]
            raw_ohlc = (
                raw[field_indexes["open"]],
                raw[field_indexes["high"]],
                raw[field_indexes["low"]],
                raw[field_indexes["close"]],
            )
        trade_date = _parse_roc_date(raw_date)
        if trade_date.strftime("%Y-%m") != expected_month:
            raise ValueError("TWSE row outside requested month: %s" % trade_date.isoformat())
        iso_date = trade_date.isoformat()
        if iso_date in seen:
            raise ValueError("duplicate TWSE trade date: %s" % iso_date)
        seen.add(iso_date)
        parsed_rows.append({"date": iso_date, **_validated_ohlc(*raw_ohlc)})
    if not parsed_rows:
        raise ValueError("TWSE month response is empty")
    parsed_rows.sort(key=lambda row: row["date"])
    return parsed_rows


def completed_rows(rows: Iterable[Dict[str, Any]], now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Return only rows whose daily close can be complete at the cutoff."""
    local_now = _normalize_now(now)
    today = local_now.date()
    today_complete = local_now.time().replace(tzinfo=None) >= DAILY_CLOSE_PUBLICATION_CUTOFF
    completed: List[Dict[str, Any]] = []
    for row in rows:
        row_date = _parse_iso_date(row["date"])
        if row_date < today or (row_date == today and today_complete):
            completed.append(row)
    return completed


def _request_json(url: str, timeout: float) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json,text/plain,*/*",
            "User-Agent": "Mozilla/5.0 (compatible; Morning-Brief/1.0; +https://www.twse.com.tw/)",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read()
    return json.loads(body.decode("utf-8-sig"))


def _month_keys(start_date: date, end_date: date) -> List[str]:
    if end_date < start_date:
        return []
    keys = []
    year, month = start_date.year, start_date.month
    while (year, month) <= (end_date.year, end_date.month):
        keys.append("%04d-%02d" % (year, month))
        month += 1
        if month == 13:
            year += 1
            month = 1
    return keys


def _last_day(month_key: str) -> str:
    year, month = (int(part) for part in month_key.split("-"))
    return date(year, month, calendar.monthrange(year, month)[1]).isoformat()


def _empty_cache() -> Dict[str, Any]:
    return {
        "schema_version": 1,
        "source_name": SOURCE_NAME,
        "retrieved_at": None,
        "months": {},
        "rows": [],
    }


def _validate_cache(cache: Any) -> Dict[str, Any]:
    if not isinstance(cache, dict) or cache.get("schema_version") != 1:
        raise ValueError("unsupported TAIEX cache schema")
    if cache.get("source_name") != SOURCE_NAME:
        raise ValueError("unexpected TAIEX cache source")
    months = cache.get("months")
    rows = cache.get("rows")
    if not isinstance(months, dict) or not isinstance(rows, list):
        raise ValueError("invalid TAIEX cache")
    seen = set()
    normalized = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("invalid TAIEX cache row")
        iso_date = _parse_iso_date(row.get("date"))
        if iso_date.isoformat() in seen:
            raise ValueError("duplicate cached TAIEX date")
        seen.add(iso_date.isoformat())
        cached_row = {
            "date": iso_date.isoformat(),
            "close": _positive_finite_number(row.get("close"), "cached close"),
        }
        ohl_fields = ("open", "high", "low")
        present_ohl_fields = {field for field in ohl_fields if field in row}
        if present_ohl_fields and present_ohl_fields != set(ohl_fields):
            raise ValueError("cached TAIEX row has partial OHLC")
        if present_ohl_fields:
            cached_row.update(
                _validated_ohlc(
                    row["open"],
                    row["high"],
                    row["low"],
                    row.get("close"),
                    "cached",
                )
            )
        normalized.append(cached_row)
    normalized.sort(key=lambda row: row["date"])
    validated = copy.deepcopy(cache)
    validated["rows"] = normalized
    return validated


def load_taiex_cache(root: Any) -> Dict[str, Any]:
    path = Path(root) / CACHE_RELATIVE_PATH
    if not path.exists():
        return _empty_cache()
    with path.open("r", encoding="utf-8") as handle:
        return _validate_cache(json.load(handle))


def _atomic_write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise


def _month_urls(month_key: str, current_month: str) -> List[str]:
    request_date = month_key.replace("-", "") + "01"
    web_urls = [template.format(date=request_date) for template in WEB_URLS]
    if month_key == current_month:
        return [OPENAPI_URL] + web_urls
    return web_urls


def _fetch_valid_month(
    month_key: str,
    current_month: str,
    now: datetime,
    fetch_json: FetchJSON,
    timeout: float,
    existing_dates: Iterable[str] = (),
) -> Tuple[List[Dict[str, Any]], str, List[str]]:
    failures = []
    required_dates = set(existing_dates)
    for url in _month_urls(month_key, current_month):
        try:
            payload = fetch_json(url, timeout)
            rows = completed_rows(parse_month_payload(payload, month_key), now)
            fetched_dates = {row["date"] for row in rows}
            if not rows:
                raise ValueError("TWSE month response is empty")
            if not required_dates.issubset(fetched_dates):
                omitted = sorted(required_dates - fetched_dates)
                raise ValueError(
                    "TWSE month response regressed and omitted verified dates: %s"
                    % ", ".join(omitted)
                )
            return rows, url, failures
        except Exception as exc:
            failures.append("%s: %s" % (url, exc))
    raise OSError("; ".join(failures))


def refresh_taiex_cache(
    root: Any,
    start_date: str,
    end_date: str,
    now: Optional[datetime] = None,
    fetch_json: FetchJSON = _request_json,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> Tuple[Dict[str, Any], List[str]]:
    """Backfill missing past months and refresh the current month.

    A month is merged only after the full response validates.  If every
    requested fetch fails, the cache file is left byte-for-byte untouched.
    """
    local_now = _normalize_now(now)
    start = _parse_iso_date(start_date)
    requested_end = _parse_iso_date(end_date)
    end = min(requested_end, local_now.date())
    path = Path(root) / CACHE_RELATIVE_PATH
    cache = load_taiex_cache(root)
    candidate = copy.deepcopy(cache)
    current_month = local_now.strftime("%Y-%m")
    existing_months = candidate["months"]
    rows_by_date = {row["date"]: row for row in candidate["rows"]}
    changed = False
    errors: List[str] = []

    for month_key in _month_keys(start, end):
        metadata = existing_months.get(month_key, {})
        cached_month_rows = [
            row for cached_date, row in rows_by_date.items() if cached_date.startswith(month_key + "-")
        ]
        has_complete_ohlc = bool(cached_month_rows) and all(
            all(field in row for field in ("open", "high", "low", "close"))
            for row in cached_month_rows
        )
        if (
            month_key < current_month
            and metadata.get("status") == "complete"
            and has_complete_ohlc
        ):
            continue
        if month_key > current_month:
            continue
        try:
            verified_month_dates = [
                cached_date
                for cached_date in rows_by_date
                if cached_date.startswith(month_key + "-")
            ]
            month_rows, request_url, prior_failures = _fetch_valid_month(
                month_key,
                current_month,
                local_now,
                fetch_json,
                timeout,
                existing_dates=verified_month_dates,
            )
        except Exception as exc:
            errors.append("%s: %s" % (month_key, exc))
            continue

        # Replace only this month's rows after the complete response validates.
        for cached_date in list(rows_by_date):
            if cached_date.startswith(month_key + "-"):
                del rows_by_date[cached_date]
        for row in month_rows:
            rows_by_date[row["date"]] = row
        is_past = month_key < current_month
        coverage_end = _last_day(month_key) if is_past else (
            month_rows[-1]["date"] if month_rows else None
        )
        retrieved_at = _iso_now(local_now)
        existing_months[month_key] = {
            "status": "complete" if is_past else "partial",
            "coverage_end": coverage_end,
            "request_url": request_url,
            "retrieved_at": retrieved_at,
            "row_count": len(month_rows),
        }
        if prior_failures:
            existing_months[month_key]["fallback_after"] = prior_failures
        changed = True

    if changed:
        candidate["rows"] = sorted(rows_by_date.values(), key=lambda row: row["date"])
        candidate["retrieved_at"] = _iso_now(local_now)
        candidate["source_name"] = SOURCE_NAME
        candidate["schema_version"] = 1
        _atomic_write_json(path, candidate)
        return _validate_cache(candidate), errors
    return cache, errors


def _covered_as_non_trading(cache: Dict[str, Any], iso_date: str) -> bool:
    month = cache.get("months", {}).get(iso_date[:7])
    if not isinstance(month, dict):
        return False
    coverage_end = month.get("coverage_end")
    return month.get("status") in ("complete", "partial") and isinstance(coverage_end, str) and iso_date <= coverage_end


def comparison_from_cache(
    records: Iterable[Dict[str, Any]],
    cache: Dict[str, Any],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    local_now = _normalize_now(now)
    cache = _validate_cache(cache)
    record_list = list(records)
    water_by_date: Dict[str, Dict[str, Any]] = {}
    for record in record_list:
        iso_date = _parse_iso_date(record.get("date")).isoformat()
        if iso_date in water_by_date:
            raise ValueError("duplicate water-level date: %s" % iso_date)
        value = record.get("water_level")
        if value is not None:
            value = _water_level_number(value)
        normalized = dict(record)
        normalized["water_level"] = value
        water_by_date[iso_date] = normalized

    if not water_by_date:
        return {
            "rows": [],
            "market_as_of": None,
            "retrieved_at": cache.get("retrieved_at"),
            "source_name": cache.get("source_name", SOURCE_NAME),
        }

    first_date, last_date = min(water_by_date), max(water_by_date)
    official_rows = completed_rows(cache.get("rows", []), local_now)
    market_by_date = {
        row["date"]: row
        for row in official_rows
        if first_date <= row["date"] <= last_date
    }
    union_dates = sorted(set(water_by_date) | set(market_by_date))
    today = local_now.date().isoformat()
    before_cutoff = local_now.time().replace(tzinfo=None) < DAILY_CLOSE_PUBLICATION_CUTOFF
    output_rows = []
    for iso_date in union_dates:
        water = water_by_date.get(iso_date, {})
        market = market_by_date.get(iso_date)
        close = market["close"] if market is not None else None
        if close is not None:
            status = "closed"
        elif iso_date == today and before_cutoff:
            status = "pending"
        elif _covered_as_non_trading(cache, iso_date):
            status = "non_trading"
        else:
            status = "missing"
        row = {
            "date": iso_date,
            "water_level": water.get("water_level"),
            "taiex_open": market.get("open") if market is not None else None,
            "taiex_high": market.get("high") if market is not None else None,
            "taiex_low": market.get("low") if market is not None else None,
            "taiex_close": close,
            "market_status": status,
        }
        for optional_key in ("date_display", "scenario_label"):
            if optional_key in water:
                row[optional_key] = water[optional_key]
        output_rows.append(row)

    market_as_of = max(market_by_date) if market_by_date else None
    return {
        "rows": output_rows,
        "market_as_of": market_as_of,
        "retrieved_at": cache.get("retrieved_at"),
        "source_name": cache.get("source_name", SOURCE_NAME),
    }


def build_water_comparison(records: Iterable[Dict[str, Any]], root: Any, refresh: bool = True) -> Dict[str, Any]:
    """Build JSON-serializable chart rows without allowing feed failures to break a brief."""
    record_list = list(records)
    refresh_errors: List[str] = []
    try:
        cache = load_taiex_cache(root)
    except Exception as exc:
        cache = _empty_cache()
        refresh_errors.append("cache: %s" % exc)

    if refresh and os.environ.get("KW_WATER_OFFLINE") != "1" and record_list:
        dates = sorted(_parse_iso_date(record.get("date")).isoformat() for record in record_list)
        try:
            cache, errors = refresh_taiex_cache(root, dates[0], dates[-1])
            refresh_errors.extend(errors)
        except Exception as exc:
            # Reloading preserves any valid prior cache if refresh failed before
            # returning.  A corrupt cache remains an explicit all-missing result.
            refresh_errors.append("refresh: %s" % exc)
            try:
                cache = load_taiex_cache(root)
            except Exception:
                pass

    result = comparison_from_cache(record_list, cache)
    if refresh_errors:
        result["refresh_error"] = "; ".join(refresh_errors)
    return result


__all__ = [
    "SOURCE_NAME",
    "build_water_comparison",
    "comparison_from_cache",
    "completed_rows",
    "load_taiex_cache",
    "parse_month_payload",
    "refresh_taiex_cache",
]
