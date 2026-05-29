#!/usr/bin/env python3
"""Obtain / verify X Bearer Token for x_fetch.py."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from x_auth import fetch_bearer_token, verify_bearer_token

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"


def load_dotenv(path: Path = ENV_PATH) -> None:
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


def get_env(name: str) -> str | None:
    val = os.environ.get(name)
    return val.strip() if val else None


def upsert_env_key(path: Path, key: str, value: str) -> None:
    lines: list[str] = []
    found = False
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
    pattern = re.compile(rf"^{re.escape(key)}=")
    for i, line in enumerate(lines):
        if pattern.match(line.strip()):
            lines[i] = f"{key}={value}"
            found = True
            break
    if not found:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    load_dotenv()

    bearer = get_env("X_BEARER_TOKEN")
    if bearer and verify_bearer_token(bearer):
        print("OK — 現有 X_BEARER_TOKEN 可用")
        return 0

    api_key = get_env("X_API_KEY")
    api_secret = get_env("X_API_KEY_SECRET")
    if api_key and api_secret:
        token = fetch_bearer_token(api_key, api_secret)
        upsert_env_key(ENV_PATH, "X_BEARER_TOKEN", token)
        print(f"OK — 已用 API Key 換取 Bearer Token 並寫入 {ENV_PATH}")
        return 0

    print(
        "無法取得 Bearer Token。\n"
        "\n"
        "Developer Console → 你的 App → Keys and tokens，擇一：\n"
        "  A) 直接複製「Bearer Token」→ 寫入 .env 的 X_BEARER_TOKEN\n"
        "  B) 複製「API Key」+「API Key Secret」→ 寫入 X_API_KEY / X_API_KEY_SECRET\n"
        "\n"
        "注意：OAuth 2.0 Client ID / Client Secret（你截圖那組）\n"
        "      是給使用者登入用，不能拿來抓公開貼文。\n",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
