#!/usr/bin/env python3
"""Check a run document before publishing. Exit code 1 on any error.

Usage: python3 scripts/validate_run.py <RUN_ID>
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_KB = 250


def main(run_id: str) -> int:
    path = ROOT / "data" / "runs" / f"{run_id}.json"
    errors, warnings = [], []
    if not path.exists():
        print(f"ERROR missing {path}")
        return 1
    size_kb = path.stat().st_size / 1024
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"ERROR invalid JSON: {e}")
        return 1

    if d.get("schema_version") != 2:
        errors.append("schema_version must be 2")
    if d.get("run_id") != run_id:
        errors.append(f"run_id is {d.get('run_id')!r}, expected {run_id!r}")
    if size_kb > MAX_KB:
        errors.append(f"{size_kb:.0f} KB is over {MAX_KB} KB")
    for key in ("run_at", "summary", "recruiter", "coach", "plan", "sources"):
        if not d.get(key):
            errors.append(f"missing or empty: {key}")

    rec, coach = d.get("recruiter") or {}, d.get("coach") or {}
    change_ids = {c.get("id") for c in rec.get("changes", [])}
    mandate_ids = {m.get("id") for m in coach.get("mandates", [])}
    source_ids = {s.get("id") for s in d.get("sources", [])}
    coach_keys = set(coach.keys())

    if not isinstance(rec.get("score"), (int, float)):
        errors.append("recruiter.score must be a number")
    for horizon in ("this_week", "this_month", "this_quarter"):
        for item in (d.get("plan") or {}).get(horizon, []):
            ref = item.get("ref")
            if ref and ref not in change_ids | mandate_ids | coach_keys:
                warnings.append(f"plan.{horizon} {item.get('id')} refers to unknown id {ref!r}")

    def walk(o, where):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "source_ids" and isinstance(v, list):
                    for sid in v:
                        if sid not in source_ids:
                            warnings.append(f"{where} cites unknown source {sid!r}")
                else:
                    walk(v, f"{where}.{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f"{where}[{i}]")
    walk({"recruiter": rec, "coach": coach}, "run")

    for w in warnings:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)
    print(f"{'FAIL' if errors else 'OK'}  {path.relative_to(ROOT)}  {size_kb:.1f} KB  "
          f"{len(change_ids)} changes, {len(mandate_ids)} mandates, {len(source_ids)} sources")
    return 1 if errors else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
