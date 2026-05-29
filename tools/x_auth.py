"""Shared X API OAuth helpers."""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request

TOKEN_URL = "https://api.x.com/oauth2/token"


def _basic_auth_header(client_id: str, client_secret: str) -> str:
    creds = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    return f"Basic {creds}"


def fetch_bearer_token(api_key: str, api_secret: str) -> str:
    """App-only Bearer Token — 使用 API Key + API Key Secret（非 OAuth 2.0 Client Secret）。"""
    body = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=body,
        headers={
            "Authorization": _basic_auth_header(api_key, api_secret),
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"X token 交換失敗 ({exc.code}): {detail[:400]}") from exc

    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"回應中沒有 access_token: {data}")
    return urllib.parse.unquote(token)


def verify_bearer_token(token: str) -> bool:
    """Quick check that Bearer Token works."""
    req = urllib.request.Request(
        "https://api.x.com/2/tweets/search/recent?"
        + urllib.parse.urlencode({"query": "from:federalreserve", "max_results": "10"}),
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            json.loads(resp.read())
        return True
    except urllib.error.HTTPError:
        return False
