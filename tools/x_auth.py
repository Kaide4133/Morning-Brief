"""Shared X API OAuth helpers."""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request


def fetch_bearer_token(client_id: str, client_secret: str) -> str:
    creds = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    body = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    req = urllib.request.Request(
        "https://api.twitter.com/oauth2/token",
        data=body,
        headers={
            "Authorization": f"Basic {creds}",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"X token 交換失敗 ({exc.code}): {detail[:300]}") from exc

    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"回應中沒有 access_token: {data}")
    return token
