#!/usr/bin/env python3
"""Start a run: print RUN_ID, RUN_AT and the previous profile path, create the work folder.

Usage: python3 scripts/new_run.py
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
now = datetime.now(timezone.utc)
run_id = "r" + now.astimezone(ZoneInfo("America/Bogota")).strftime("%Y%m%d-%H%M")
run_at = now.strftime("%Y-%m-%dT%H:%M:%SZ")

profiles = sorted((ROOT / "data" / "profiles").glob("r*.json"))
previous = str(profiles[-1].relative_to(ROOT)) if profiles else "none"

work = ROOT / "data" / "work" / run_id
work.mkdir(parents=True, exist_ok=True)
(ROOT / "data" / "runs").mkdir(parents=True, exist_ok=True)
(ROOT / "data" / "profiles").mkdir(parents=True, exist_ok=True)

print(json.dumps({
    "RUN_ID": run_id,
    "RUN_AT": run_at,
    "previous_profile": previous,
    "profile_out": f"data/profiles/{run_id}.json",
    "recruiter_out": f"data/work/{run_id}/recruiter.json",
    "coach_out": f"data/work/{run_id}/career_coach.json",
    "run_out": f"data/runs/{run_id}.json",
}, indent=2))
