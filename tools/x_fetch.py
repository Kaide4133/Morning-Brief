#!/usr/bin/env python3
"""
Fetch X posts for §VII–§IX and write key highlights into issue JSON.

Requires .env:
  X_BEARER_TOKEN=...

Optional .env overrides:
  X_WATCHLIST=data/x-watchlist.json

Usage:
  python tools/x_fetch.py data/issues/20260529.json
  python tools/x_fetch.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV = ROOT / ".env"
DEFAULT_WATCHLIST = ROOT / "data" / "x-watchlist.json"
ISSUES_DIR = ROOT / "data" / "issues"


def load_dotenv(path: Path = DEFAULT_ENV) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv()


def _get_env(name: str) -> str | None:
    val = os.environ.get(name)
    return val.strip() if val else None


def resolve_bearer_token() -> str | None:
    token = _get_env("X_BEARER_TOKEN")
    if token:
        return token
    api_key = _get_env("X_API_KEY")
    api_secret = _get_env("X_API_KEY_SECRET")
    if api_key and api_secret:
        from x_auth import fetch_bearer_token

        token = fetch_bearer_token(api_key, api_secret)
        os.environ["X_BEARER_TOKEN"] = token
        return token
    return None


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def load_watchlist(path: Path) -> dict:
    data = load_json(path)
    accounts = []
    seen: set[str] = set()
    for acct in data.get("accounts", []):
        username = acct["username"].lstrip("@").lower()
        if username in seen:
            continue
        seen.add(username)
        accounts.append({**acct, "username": username})
    data["accounts"] = accounts
    return data


@dataclass
class ScoredTweet:
    username: str
    label: str
    section: str
    tweet_id: str
    created_at: datetime
    text: str
    score: int
    url: str


def parse_tweet_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def format_time_et(dt: datetime) -> str:
    try:
        from zoneinfo import ZoneInfo

        local = dt.astimezone(ZoneInfo("America/New_York"))
    except Exception:
        local = dt.astimezone(timezone(timedelta(hours=-5)))
    return f"{local.month}/{local.day} ET"


def clean_tweet_text(text: str) -> str:
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"@\w+", "", text)
    text = re.sub(r"[\U0001F300-\U0001FAFF]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_low_quality_tweet(text: str, raw_text: str) -> bool:
    """過濾回覆、廣告、詐騙提醒等不適合上晨報的貼文。"""
    stripped = raw_text.strip()
    lower = stripped.lower()

    if len(stripped) < 60:
        return True

    # 幾乎只剩 @某人 + 一兩個字（例如 @willdepue Accurate）
    without_urls = re.sub(r"https?://\S+", "", stripped)
    mention_only = re.sub(r"@\w+", "", without_urls).strip()
    if len(mention_only) < 35:
        return True

    junk_phrases = (
        "download now",
        "unsolicited call",
        "scammers",
        "non-ai app",
        "most powerful women",
        "we're honored",
        "livestream of",
        "don't miss the",
    )
    if any(p in lower for p in junk_phrases):
        return True

    return False


def score_tweet(text: str, cfg: dict) -> int:
    lower = text.lower()
    for noise in cfg.get("noise_patterns", []):
        if noise.lower() in lower:
            return 0

    score = 0
    for term, weight in cfg.get("market_keywords", {}).items():
        if term.lower() in lower:
            score += int(weight)

    # Short posts without keywords are usually not market-relevant.
    if score == 0 and len(text) < 40:
        return 0
    return score


def infer_market_reaction(text: str, cfg: dict) -> str:
    lower = text.lower()
    for rule in cfg.get("reaction_templates", []):
        if any(term.lower() in lower for term in rule.get("terms", [])):
            return rule["text"]
    return "留意開盤前風險預算與主線是否需微調"


def summarize_for_brief(text: str, max_len: int = 220) -> str:
    text = clean_tweet_text(text)
    if len(text) <= max_len:
        return text
    cut = text[: max_len - 1].rsplit(" ", 1)[0]
    return cut + "…"


def fetch_user_tweets(username: str, max_results: int = 10) -> list[dict]:
    token = resolve_bearer_token()
    if not token:
        raise RuntimeError("X API 未設定 — 请在 .env 填入 X_BEARER_TOKEN 或 X_CLIENT_ID + X_CLIENT_SECRET")

    query = urllib.parse.urlencode({
        "query": f"from:{username} -is:retweet",
        "max_results": str(max(max_results, 10)),
        "tweet.fields": "created_at,text,lang",
    })
    url = f"https://api.x.com/2/tweets/search/recent?{query}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"X API {exc.code} for @{username}: {body[:200]}") from exc

    return data.get("data", [])


def collect_scored_tweets(cfg: dict, lookback_hours: int) -> list[ScoredTweet]:
    min_score = int(cfg.get("min_score", 2))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)
    scored: list[ScoredTweet] = []

    for acct in cfg.get("accounts", []):
        username = acct["username"]
        label = acct.get("label", username)
        section = acct.get("section", "policy")
        try:
            tweets = fetch_user_tweets(username)
        except Exception as exc:
            print(f"SKIP @{username}: {exc}", file=sys.stderr)
            time.sleep(0.4)
            continue

        for tw in tweets:
            created = parse_tweet_time(tw["created_at"])
            if created < cutoff:
                continue
            text = clean_tweet_text(tw.get("text", ""))
            raw = tw.get("text", "")
            if not text or is_low_quality_tweet(text, raw):
                continue
            score = score_tweet(text, cfg)
            if score < min_score:
                continue
            scored.append(
                ScoredTweet(
                    username=username,
                    label=label,
                    section=section,
                    tweet_id=tw["id"],
                    created_at=created,
                    text=text,
                    score=score,
                    url=f"https://x.com/{username}/status/{tw['id']}",
                )
            )
        time.sleep(0.35)

    scored.sort(key=lambda t: (t.score, t.created_at), reverse=True)
    return scored


def pick_for_section(items: list[ScoredTweet], section: str, limit: int) -> list[ScoredTweet]:
    picked: list[ScoredTweet] = []
    seen_ids: set[str] = set()
    for item in items:
        if item.section != section:
            continue
        if item.tweet_id in seen_ids:
            continue
        picked.append(item)
        seen_ids.add(item.tweet_id)
        if len(picked) >= limit:
            break
    return picked


def build_intelligence(scored: list[ScoredTweet], cfg: dict) -> dict:
    limits = cfg.get("max_items", {})
    trump_limit = int(limits.get("trump", 2))
    musk_limit = int(limits.get("musk", 2))
    policy_limit = int(limits.get("policy", 3))

    trump_items = pick_for_section(scored, "trump", trump_limit)
    musk_items = pick_for_section(scored, "musk", musk_limit)
    policy_items = pick_for_section(scored, "policy", policy_limit)

    # If musk slot is empty, allow high-score tech/policy voices to fill one line.
    if not musk_items:
        for item in scored:
            if item.section == "policy" and item.username in {"nvidia", "amd", "elonmusk"}:
                musk_items = [item]
                policy_items = [p for p in policy_items if p.tweet_id != item.tweet_id][:policy_limit]
                break

    intelligence: dict = {}

    if trump_items:
        intelligence["trump"] = [
            {
                "time": format_time_et(item.created_at),
                "content": (
                    f"<strong>{item.label}：</strong>"
                    f"{summarize_for_brief(item.text)}"
                    f"<em>市場可能反應：{infer_market_reaction(item.text, cfg)}</em>"
                ),
            }
            for item in trump_items
        ]

    if musk_items:
        parts = []
        for item in musk_items:
            snippet = summarize_for_brief(item.text, max_len=200)
            if len(snippet) >= 40:
                parts.append(snippet)
        if parts:
            intelligence["musk"] = "；".join(parts)

    if policy_items:
        intelligence["policy"] = [
            (
                f"<strong>{item.label}：</strong>"
                f"{summarize_for_brief(item.text)}"
                f"<em>市場可能反應：{infer_market_reaction(item.text, cfg)}</em>"
            )
            for item in policy_items
        ]

    return intelligence


def merge_intelligence(issue: dict, intelligence: dict, keep_existing: bool) -> dict:
    issue.setdefault("intelligence", {})
    for key, value in intelligence.items():
        if keep_existing and issue["intelligence"].get(key):
            continue
        issue["intelligence"][key] = value
    return issue


def resolve_issue_path(issue_arg: str | None) -> Path | None:
    if issue_arg:
        path = Path(issue_arg)
        if not path.is_absolute():
            path = ROOT / path
        return path
    if not ISSUES_DIR.exists():
        return None
    files = sorted(p for p in ISSUES_DIR.glob("*.json") if not p.name.startswith("_"))
    return files[-1] if files else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch X highlights into issue JSON")
    parser.add_argument("issue", nargs="?", help="Issue JSON path (default: latest)")
    parser.add_argument("--watchlist", default=_get_env("X_WATCHLIST") or str(DEFAULT_WATCHLIST))
    parser.add_argument("--hours", type=int, help="Override lookback hours")
    parser.add_argument("--dry-run", action="store_true", help="Print result without writing JSON")
    parser.add_argument("--keep-existing", action="store_true", help="Do not overwrite existing intelligence fields")
    parser.add_argument("--print-all", action="store_true", help="Print all scored tweets")
    args = parser.parse_args(argv)

    if not resolve_bearer_token():
        print(
            "SKIP: X API 未設定 — 请在 .env 填入 X_BEARER_TOKEN，"
            "或 X_API_KEY + X_API_KEY_SECRET（见 Developer Console → Keys and tokens）"
        )
        return 0

    watchlist_path = Path(args.watchlist)
    if not watchlist_path.is_absolute():
        watchlist_path = ROOT / watchlist_path
    cfg = load_watchlist(watchlist_path)
    lookback = args.hours or int(cfg.get("lookback_hours", 48))

    print(f"Fetching X signals (last {lookback}h) from {len(cfg['accounts'])} accounts…")
    scored = collect_scored_tweets(cfg, lookback)
    if args.print_all:
        for item in scored:
            print(f"[{item.score}] @{item.username} ({item.section}) {item.text[:120]}")

    intelligence = build_intelligence(scored, cfg)
    if not intelligence:
        print("No market-relevant posts found — issue JSON unchanged.")
        return 0

    print(json.dumps(intelligence, ensure_ascii=True, indent=2))

    if args.dry_run:
        return 0

    issue_path = resolve_issue_path(args.issue)
    if not issue_path or not issue_path.exists():
        print("No issue JSON found — use dry-run or pass path.", file=sys.stderr)
        return 1

    issue = load_json(issue_path)
    merge_intelligence(issue, intelligence, keep_existing=args.keep_existing)
    save_json(issue_path, issue)
    print(f"Updated intelligence in {issue_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
