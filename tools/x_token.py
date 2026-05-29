#!/usr/bin/env python3
"""Exchange X Client ID + Secret for Bearer Token (OAuth 2.0 app-only)."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from x_auth import fetch_bearer_token

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
    client_id = get_env("X_CLIENT_ID")
    client_secret = get_env("X_CLIENT_SECRET")
    if not client_id or not client_secret:
        print("請在 .env 填入 X_CLIENT_ID 和 X_CLIENT_SECRET", file=sys.stderr)
        return 1

    token = fetch_bearer_token(client_id, client_secret)
    upsert_env_key(ENV_PATH, "X_BEARER_TOKEN", token)
    print(f"OK — Bearer Token 已寫入 {ENV_PATH}")
    print("接下來執行: python tools\\x_fetch.py --dry-run")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
