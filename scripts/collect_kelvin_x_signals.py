#!/usr/bin/env python3
"""Collect Kelvin morning-brief X signals with one paid search request per day."""
import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path


STATE_DIR = Path.home() / ".hermes" / "kelvin-x-signals" / "daily"
BUDGET_FILE = Path.home() / ".hermes" / "kelvin-x-signals" / "budget.json"


def run(cmd, timeout=45):
    env = os.environ.copy()
    env["PATH"] = str(Path.home() / ".local" / "bin") + os.pathsep + env.get("PATH", "")
    return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout, env=env)


def parse_json(text):
    try:
        return json.loads(text)
    except Exception:
        return None


def compact_error(payload, raw):
    if isinstance(payload, dict):
        return {k: payload.get(k) for k in ("title", "detail", "type") if payload.get(k)} or payload
    return {"raw": raw[:500]}


def load_accounts(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    accounts = payload.get("accounts", []) if isinstance(payload, dict) else payload
    normalized = []
    for account in accounts:
        handle = account.get("handle")
        if not handle:
            query = account.get("query", "")
            handle = query.removeprefix("from:").strip()
        if handle:
            normalized.append({**account, "handle": handle.lstrip("@")})
    return normalized


def load_budget():
    if not BUDGET_FILE.exists():
        return {"status": "unknown", "note": "xurl does not expose live Developer Console balance"}
    try:
        budget = json.loads(BUDGET_FILE.read_text(encoding="utf-8"))
        balance = float(budget["last_known_balance_usd"])
        return {
            "status": "known",
            "last_known_balance_usd": balance,
            "as_of": budget.get("as_of"),
            "source": budget.get("source", "manual"),
            "warn_below_5_usd": balance < 5,
        }
    except Exception as exc:
        return {"status": "invalid", "error": str(exc)}


def normalize_search(payload, account_by_handle):
    if not isinstance(payload, dict):
        return []
    users = {u.get("id"): u for u in payload.get("includes", {}).get("users", []) if isinstance(u, dict)}
    posts = []
    for tweet in payload.get("data") or []:
        if not isinstance(tweet, dict):
            continue
        author = users.get(tweet.get("author_id"), {})
        username = author.get("username")
        account = account_by_handle.get((username or "").lower(), {})
        posts.append({
            "id": tweet.get("id"),
            "text": tweet.get("text"),
            "created_at": tweet.get("created_at"),
            "author_username": username,
            "author_name": author.get("name"),
            "url": f"https://x.com/{username}/status/{tweet.get('id')}" if username and tweet.get("id") else None,
            "watch_bucket": account.get("bucket"),
            "tier": account.get("tier"),
            "why": account.get("why"),
        })
    return posts


def write_result(result, out_path):
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if out_path:
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        Path(out_path).write_text(text, encoding="utf-8")
    print(text)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=dt.date.today().isoformat(), help="Report date in YYYY-MM-DD format")
    parser.add_argument("--watchlist", required=True)
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--max-results", type=int, default=40)
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = STATE_DIR / f"{args.date}-lean.json"
    attempt_path = STATE_DIR / f"{args.date}-paid-attempt.json"
    budget = load_budget()

    if cache_path.exists():
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        cached["cache_reused"] = True
        cached["budget"] = budget
        write_result(cached, args.out)
        return 0 if cached.get("ok") else 1

    result = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "report_date": args.date,
        "hours": args.hours,
        "source": "xurl official X API",
        "mode": "lean-single-request",
        "paid_search_requests": 0,
        "budget": budget,
        "ok": False,
        "signals": [],
        "errors": [],
    }

    if attempt_path.exists():
        result["errors"].append({"stage": "guardrail", "error": "daily_paid_request_already_attempted"})
        write_result(result, args.out)
        return 1

    if not shutil.which("xurl") and not (Path.home() / ".local" / "bin" / "xurl").exists():
        result["errors"].append({"stage": "preflight", "error": "xurl_not_installed"})
        write_result(result, args.out)
        return 2

    auth = run(["xurl", "auth", "status"])
    if auth.returncode != 0:
        result["errors"].append({"stage": "auth", "error": "xurl_auth_status_failed"})
        write_result(result, args.out)
        return 2

    accounts = load_accounts(args.watchlist)
    if not accounts:
        result["errors"].append({"stage": "watchlist", "error": "no_accounts"})
        write_result(result, args.out)
        return 2

    query = "(" + " OR ".join(f"from:{account['handle']}" for account in accounts) + ") -is:retweet"
    attempt = {
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "report_date": args.date,
        "mode": "lean-single-request",
        "query_sha256": hashlib.sha256(query.encode("utf-8")).hexdigest(),
    }
    attempt_path.write_text(json.dumps(attempt, ensure_ascii=False, indent=2), encoding="utf-8")

    proc = run(["xurl", "search", query, "-n", str(args.max_results)])
    result["paid_search_requests"] = 1
    payload = parse_json(proc.stdout or proc.stderr)
    if proc.returncode != 0 or (isinstance(payload, dict) and payload.get("title")):
        result["errors"].append({"stage": "search", "error": compact_error(payload, proc.stdout + proc.stderr)})
        write_result(result, args.out)
        return 1

    account_by_handle = {account["handle"].lower(): account for account in accounts}
    result["signals"] = normalize_search(payload, account_by_handle)
    result["ok"] = bool(result["signals"])
    if not result["ok"]:
        result["errors"].append({"stage": "search", "error": "no_signals_returned"})
    cache_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    write_result(result, args.out)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
