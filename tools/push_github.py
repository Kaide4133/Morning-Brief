#!/usr/bin/env python3
"""Push site/ to GitHub Pages (Morning-Brief repo)."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
DEFAULT_REMOTE = "https://github.com/kaide4133/Morning-Brief.git"
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


load_dotenv()


def run(cmd: list[str], cwd: Path, env: dict | None = None) -> None:
    display = []
    for part in cmd:
        if "github_pat_" in part or "ghp_" in part or "gho_" in part:
            display.append("<redacted>")
        else:
            display.append(part)
    print("+", " ".join(display))
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--message", "-m", default="Update morning brief")
    parser.add_argument("--remote", default=os.environ.get("GITHUB_REMOTE", DEFAULT_REMOTE))
    parser.add_argument("--branch", default=os.environ.get("GITHUB_BRANCH", "main"))
    parser.add_argument("--init", action="store_true", help="git init if missing")
    args = parser.parse_args()

    pat = os.environ.get("GITHUB_PAT") or os.environ.get("GH_TOKEN")
    if not pat:
        print("Set GITHUB_PAT (or GH_TOKEN) with repo scope.", file=sys.stderr)
        return 1

    git_dir = ROOT / ".git"
    if not git_dir.exists():
        if not args.init:
            print("No git repo. Run with --init first.", file=sys.stderr)
            return 1
        run(["git", "init"], ROOT)
        run(["git", "branch", "-M", args.branch], ROOT)

    # Stage site + templates + data + tools (not secrets)
    run(["git", "add", "site", "templates", "data", "tools", "requirements.txt", ".gitignore", "README.md"], ROOT)

    status = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True)
    if not status.stdout.strip():
        print("Nothing to commit.")
        return 0

    run(["git", "commit", "-m", args.message], ROOT)

    remote_url = args.remote.replace("https://", f"https://{pat}@")
    remotes = subprocess.run(["git", "remote"], cwd=ROOT, capture_output=True, text=True)
    if "origin" not in remotes.stdout:
        run(["git", "remote", "add", "origin", remote_url], ROOT)
    else:
        run(["git", "remote", "set-url", "origin", remote_url], ROOT)

    run(["git", "push", "-u", "origin", args.branch], ROOT)
    print("Pushed. GitHub Pages should update in 1–3 minutes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
