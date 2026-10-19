#!/usr/bin/env python3
"""Per-agent token, cost and timing stats for one run, for the 3D dashboard.

Reads the Claude Code transcripts of the session that ran /linkedin-review
(one file per subagent plus the main session) and writes numbers only, no
prompts or outputs, to dashboard/data/runs/<RUN_ID>.json and refreshes
dashboard/data/index.json.

Usage:
  python3 scripts/agent_stats.py <RUN_ID>
  python3 scripts/agent_stats.py --all          # every run found in the transcripts
  python3 scripts/agent_stats.py <RUN_ID> --projects-dir ~/.claude/projects/<slug>
"""
import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dashboard" / "data"
RUN_RE = re.compile(r"r\d{8}-\d{4}")
AGENTS = ("scraper", "recruiter", "career-coach", "synthesis")

# USD per million tokens. Source: Claude API pricing as of 2026-10-06.
# cache_write_5m / cache_write_1h default to 1.25x / 2x the input price.
PRICES = {
    "claude-opus-5-5": {"input": 4.00, "output": 20.00, "cache_read": 0.20},
    "claude-opus-5": {"input": 5.00, "output": 25.00, "cache_read": 0.50},
    "claude-sonnet-5-5": {"input": 2.00, "output": 10.00, "cache_read": 0.20},
    "claude-sonnet-5": {"input": 2.00, "output": 10.00, "cache_read": 0.20},
    "claude-haiku-5-5": {"input": 0.10, "output": 0.50, "cache_read": 0.01},
}


def price_of(model):
    p = PRICES.get(model)
    if not p:
        return None
    return {**p, "cache_write_5m": p["input"] * 1.25, "cache_write_1h": p["input"] * 2.0}


def projects_dir():
    slug = re.sub(r"[^A-Za-z0-9]", "-", str(ROOT))
    return Path.home() / ".claude" / "projects" / slug


def read_rows(path):
    rows = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    return rows


def ts(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def run_start(run_id):
    naive = datetime.strptime(run_id[1:], "%Y%m%d-%H%M")
    return naive.replace(tzinfo=ZoneInfo("America/Bogota")).astimezone(timezone.utc)


FILE_RE = re.compile(r"^[\w.-]+\.(json|md|py|txt)$")


def tool_event(name, inp):
    """A public-safe description of one tool call: a kind plus, at most, a
    website host or a file name. Never queries, commands, prompts or content."""
    inp = inp if isinstance(inp, dict) else {}

    def host(url):
        h = urlparse(str(url or "")).hostname or ""
        return h[4:] if h.startswith("www.") else h

    def fname(path):
        b = os.path.basename(str(path or ""))
        return b if FILE_RE.match(b) and not RUN_RE.search(b) else ""

    if name == "WebSearch":
        return ["search"]
    if name == "WebFetch":
        return ["fetch", host(inp.get("url"))]
    if name in ("Write", "Edit", "Read"):
        return [name.lower(), fname(inp.get("file_path"))]
    if name == "Bash":
        cmd = str(inp.get("command", ""))
        for key, kind in (("validate_run", "validate"), ("publish.py", "publish"), ("new_run.py", "start"), ("agent_stats", "stats")):
            if key in cmd:
                return [kind]
        return ["bash"]
    if name == "Agent":
        return ["agent", str(inp.get("subagent_type", ""))]
    if name == "SubagentHandback":
        return ["handback"]
    if name.startswith("mcp__claude-in-chrome__"):
        tool = name.rsplit("__", 1)[-1]
        if tool == "navigate":
            return ["browse", host(inp.get("url"))]
        if tool in ("computer", "find", "form_input"):
            return ["click"]
        if tool in ("read_page", "get_page_text"):
            return ["readpage"]
        if tool == "javascript_tool":
            return ["script"]
        return ["tab"]
    if name == "ToolSearch":
        return None
    return ["tool"]


def summarize(rows, reported=None):
    """Token usage, cost and activity for a list of transcript rows.

    A single API request is written as several rows (one per content block),
    so usage is counted once per message id. Input, cache write and cache read
    tokens are exact. The output_tokens field in those rows is a streaming
    placeholder (a few tokens) and the total Claude Code prints when a subagent
    finishes is also low, so output is estimated from the visible text and tool
    inputs (about 3.5 characters per token) and never goes below either of those
    figures. Thinking tokens are not visible and are not counted.
    """
    msgs, tool_ids, tools, events = {}, set(), Counter(), []
    times = []
    visible_chars = 0
    for r in rows:
        if r.get("type") != "assistant":
            continue
        m = r.get("message") or {}
        usage = m.get("usage")
        if not usage or not m.get("id"):
            continue
        times.append(ts(r["timestamp"]))
        prev = msgs.get(m["id"])
        if prev is None or usage.get("output_tokens", 0) >= prev["usage"].get("output_tokens", 0):
            msgs[m["id"]] = {"usage": usage, "model": m.get("model")}
        for c in m.get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("id") not in tool_ids:
                tool_ids.add(c["id"])
                tools[c["name"]] += 1
                ev = tool_event(c["name"], c.get("input"))
                if ev:
                    events.append((ts(r["timestamp"]), [e for e in ev if e != ""]))
                visible_chars += len(json.dumps(c.get("input", "")))
            elif isinstance(c, dict) and c.get("type") == "text" and prev is None:
                visible_chars += len(c.get("text", ""))
    if not msgs:
        return None

    in_total = sum(i["usage"].get("input_tokens", 0) + i["usage"].get("cache_creation_input_tokens", 0)
                   for i in msgs.values())
    row_out = sum(i["usage"].get("output_tokens", 0) for i in msgs.values())
    floor = max(row_out, (reported or 0) - in_total)
    out_total = max(floor, round(visible_chars / 3.5))
    out_source = "estimated"
    # spread the output over requests by their placeholder weight so cost stays per-model
    weights = [i["usage"].get("output_tokens", 0) + 1 for i in msgs.values()]
    wsum = sum(weights)
    for item, w in zip(msgs.values(), weights):
        item["out"] = out_total * w / wsum

    tok = Counter()
    cost = 0.0
    split = Counter()
    saved = 0.0
    priced = True
    models = Counter()
    for item in msgs.values():
        u, model = item["usage"], item["model"]
        models[model] += 1
        cw = u.get("cache_creation") or {}
        w5 = cw.get("ephemeral_5m_input_tokens")
        w1 = cw.get("ephemeral_1h_input_tokens", 0)
        if w5 is None:
            w5, w1 = u.get("cache_creation_input_tokens", 0), 0
        n = {
            "input": u.get("input_tokens", 0),
            "output": item["out"],
            "cache_read": u.get("cache_read_input_tokens", 0),
            "cache_write": w5 + w1,
        }
        tok.update(n)
        p = price_of(model)
        if p is None:
            priced = False
            continue
        parts = {
            "input": n["input"] * p["input"] / 1e6,
            "output": n["output"] * p["output"] / 1e6,
            "cache_read": n["cache_read"] * p["cache_read"] / 1e6,
            "cache_write": (w5 * p["cache_write_5m"] + w1 * p["cache_write_1h"]) / 1e6,
        }
        split.update(parts)
        cost += sum(parts.values())
        saved += n["cache_read"] * (p["input"] - p["cache_read"]) / 1e6

    return {
        "model": models.most_common(1)[0][0],
        "models": dict(models),
        "tokens": {"input": tok["input"], "cache_write": tok["cache_write"],
                   "cache_read": tok["cache_read"], "output": round(tok["output"]),
                   "total": round(sum(tok.values()))},
        "output_source": out_source,
        "cost_usd": round(cost, 4) if priced else None,
        "cost_split": {k: round(v, 4) for k, v in split.items()} if priced else None,
        "cache_saved_usd": round(saved, 4) if priced else None,
        "requests": len(msgs),
        "tool_calls": sum(tools.values()),
        "tools": dict(tools.most_common()),
        "web_searches": tools.get("WebSearch", 0),
        "web_fetches": tools.get("WebFetch", 0),
        "_events": events,
        "_start": min(times),
        "_end": max(times),
    }


def reported_totals(session_dir):
    """{agent_id: subagent_tokens} from the finish notices in the main transcript."""
    main = session_dir.with_suffix(".jsonl")
    out = {}
    if not main.exists():
        return out
    text = main.read_text(encoding="utf-8")
    for m in re.finditer(r"<task-id>(\w+)</task-id>.*?<subagent_tokens>(\d+)</subagent_tokens>", text, re.S):
        out[m.group(1)] = int(m.group(2))
    return out


def find_subagents(pdir):
    """{run_id: [(agent_type, session_dir, rows)]} for every pipeline subagent."""
    found = {}
    for meta in pdir.glob("*/subagents/agent-*.meta.json"):
        try:
            kind = json.loads(meta.read_text()).get("agentType")
        except ValueError:
            continue
        if kind not in AGENTS:
            continue
        rows = read_rows(meta.with_name(meta.name.replace(".meta.json", ".jsonl")))
        first = next((r for r in rows if r.get("type") == "user"), None)
        if not first:
            continue
        content = first["message"]["content"]
        m = RUN_RE.search(content if isinstance(content, str) else json.dumps(content))
        if m:
            agent_id = meta.name[len("agent-"):-len(".meta.json")]
            found.setdefault(m.group(0), []).append((kind, meta.parent.parent, rows, agent_id))
    return found


def orchestrator_rows(session_dir, run_id, last_end):
    main = session_dir.with_suffix(".jsonl")
    if not main.exists():
        return []
    rows = read_rows(main)
    start = run_start(run_id)
    end = last_end + timedelta(minutes=10)
    # The run ends with the publish step and the orchestrator's closing report.
    publish = [r for r in rows if r.get("type") == "assistant" and "publish.py" in json.dumps(r.get("message", {}).get("content", ""))
               and run_id in json.dumps(r["message"]["content"])]
    if publish:
        after = [r for r in rows if r.get("type") == "assistant" and r["timestamp"] > publish[-1]["timestamp"]]
        end = ts((after[0] if after else publish[-1])["timestamp"])
    return [r for r in rows if r.get("type") == "assistant" and "timestamp" in r and start <= ts(r["timestamp"]) <= end]


def build(run_id, subs):
    start = run_start(run_id)
    agents = {}
    reported = reported_totals(subs[0][1])
    for kind, _, rows, agent_id in subs:
        s = summarize(rows, reported.get(agent_id))
        if s:
            agents[kind] = s
    if not agents:
        return None
    session_dir = subs[0][1]
    orch = summarize(orchestrator_rows(session_dir, run_id, max(a["_end"] for a in agents.values())))
    if orch:
        agents["orchestrator"] = orch

    begin = min(a["_start"] for a in agents.values())
    finish = max(a["_end"] for a in agents.values())
    for a in agents.values():
        # [offset_s, kind, detail?] per tool call, for speech bubbles and desk counters
        a["events"] = [[round((when - begin).total_seconds(), 1), *ev] for when, ev in sorted(a.pop("_events"), key=lambda e: e[0])]
        a["start_offset_s"] = round((a.pop("_start") - begin).total_seconds(), 1)
        a["duration_s"] = round((a.pop("_end") - begin).total_seconds() - a["start_offset_s"], 1)

    def total(key):
        return sum((a["tokens"][key] if key != "cost" else (a["cost_usd"] or 0)) for a in agents.values())

    return {
        "run_id": run_id,
        "run_at": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "wall_s": round((finish - begin).total_seconds(), 1),
        "price_basis": "API-equivalent list prices (USD per million tokens), 2026-10-06; excludes WebFetch helper-model calls",
        "totals": {
            "tokens": total("total"),
            "input": total("input"), "cache_write": total("cache_write"),
            "cache_read": total("cache_read"), "output": total("output"),
            "cost_usd": round(total("cost"), 4),
            "cache_saved_usd": round(sum(a["cache_saved_usd"] or 0 for a in agents.values()), 4),
            "requests": sum(a["requests"] for a in agents.values()),
            "tool_calls": sum(a["tool_calls"] for a in agents.values()),
        },
        "agents": agents,
    }


def write_index():
    runs = []
    for p in sorted((OUT / "runs").glob("r*.json")):
        d = json.loads(p.read_text())
        runs.append({"run_id": d["run_id"], "run_at": d["run_at"], "wall_s": d["wall_s"], **d["totals"]})
    (OUT / "index.json").write_text(json.dumps({"runs": runs[::-1]}, indent=2) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_id", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--projects-dir", type=Path)
    args = ap.parse_args()
    if not args.run_id and not args.all:
        ap.error("give a RUN_ID or --all")

    pdir = args.projects_dir or projects_dir()
    if not pdir.exists():
        sys.exit(f"FAIL: no transcripts at {pdir}")
    found = find_subagents(pdir)
    ids = sorted(found) if args.all else [args.run_id]
    (OUT / "runs").mkdir(parents=True, exist_ok=True)

    ok = 0
    for rid in ids:
        doc = build(rid, found[rid]) if rid in found else None
        if not doc:
            print(f"SKIP {rid}: no subagent transcripts found")
            continue
        (OUT / "runs" / f"{rid}.json").write_text(json.dumps(doc, indent=2) + "\n")
        t = doc["totals"]
        print(f"OK {rid}: {len(doc['agents'])} agents, {t['tokens']:,} tokens, ${t['cost_usd']:.2f}, {doc['wall_s']:.0f}s")
        ok += 1
    write_index()
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
