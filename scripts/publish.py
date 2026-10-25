#!/usr/bin/env python3
"""Send a run (and its profile) to the Apps Script ingest web app.

Usage:
  python3 scripts/publish.py <RUN_ID>     publish data/runs/<RUN_ID>.json + data/profiles/<RUN_ID>.json
  python3 scripts/publish.py --all        publish every run/profile/stats file in data/ (backfill or re-sync)
  python3 scripts/publish.py --stats <RUN_ID>   publish data/stats/<RUN_ID>.json (Office tab)
  python3 scripts/publish.py --checks     push data/checks_backfill.json (one-time, replaces ticks)
  python3 scripts/publish.py --ping       check the ingest URL and token

Reads LR_INGEST_URL and LR_INGEST_TOKEN from .env (or the environment).
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env() -> dict:
    env = dict(os.environ)
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    missing = [k for k in ("LR_INGEST_URL", "LR_INGEST_TOKEN") if not env.get(k)]
    if missing:
        sys.exit(f"Missing {', '.join(missing)} in .env (copy .env.example and fill it in).")
    return env


def post(env: dict, payload: dict) -> dict:
    payload = {**payload, "token": env["LR_INGEST_TOKEN"]}
    req = urllib.request.Request(
        env["LR_INGEST_URL"],
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    # Apps Script runs doPost, then answers with a 302 to the result; urllib follows it with a GET.
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            body = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}"}
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {"ok": False, "error": "non-JSON reply (is the ingest deployed with Access: Anyone?)",
                "body": body[:200]}


def send(env: dict, kind: str, path: Path) -> bool:
    data = json.loads(path.read_text(encoding="utf-8"))
    res = post(env, {"kind": kind, "id": path.stem, "data": data})
    print(("OK  " if res.get("ok") else "FAIL"), kind, path.stem, res.get("file") or res.get("error"))
    return bool(res.get("ok"))


def main(argv: list) -> int:
    if len(argv) == 2 and argv[0] == "--stats":
        path = ROOT / "data" / "stats" / f"{argv[1]}.json"
        if not path.exists():
            print("FAIL stats", argv[1], "missing", path)
            return 1
        return 0 if send(load_env(), "stats", path) else 1
    if len(argv) != 1:
        print(__doc__)
        return 2
    env = load_env()
    arg = argv[0]
    if arg == "--ping":
        res = post(env, {"kind": "ping", "id": "r00000000-0000", "data": {}})
        ok = res.get("error", "").startswith("kind must be")
        print("OK  token accepted" if ok else f"FAIL {res}")
        return 0 if ok else 1
    if arg == "--checks":
        data = json.loads((ROOT / "data" / "checks_backfill.json").read_text())
        res = post(env, {"kind": "checks", "id": "r00000000-0000", "data": data})
        print(("OK  " if res.get("ok") else "FAIL"), "checks", res.get("file") or res.get("error"))
        return 0 if res.get("ok") else 1
    if arg == "--all":
        ids = sorted(p.stem for p in (ROOT / "data" / "runs").glob("r*.json"))
    else:
        ids = [arg]
    ok = True
    for rid in ids:
        prof = ROOT / "data" / "profiles" / f"{rid}.json"
        run = ROOT / "data" / "runs" / f"{rid}.json"
        if prof.exists():
            ok &= send(env, "profile", prof)
        if not run.exists():
            print("FAIL run", rid, "missing", run)
            ok = False
            continue
        ok &= send(env, "run", run)   # run last: the app shows a run as soon as it lands
        stats = ROOT / "data" / "stats" / f"{rid}.json"
        if arg == "--all" and stats.exists():
            ok &= send(env, "stats", stats)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
