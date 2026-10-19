---
name: linkedin-review
description: Run Felipe's multi-agent LinkedIn and career review (scraper → recruiter + career coach in parallel → synthesis) and publish it to the LinkedIn Review web app on Google Apps Script. Use for /linkedin-review or "run my LinkedIn review".
---

# /linkedin-review — orchestrator

One run: scrape → recruiter (1–12 months) + career coach (2–3 years) in
parallel → synthesis → validate → publish to the Apps Script app.
Profile URL: `https://www.linkedin.com/in/felipecastro-data/`

Say in one line that the run started and takes ~10–15 minutes. Make a task
list with the steps below. Do not ask questions unless a step is blocked.

## Step 0 — Preflight
1. `python3 scripts/new_run.py` → note `RUN_ID`, `RUN_AT`,
   `previous_profile` and the output paths it prints.
2. Check `.env` has `LR_INGEST_URL` and `LR_INGEST_TOKEN`; if not, stop
   and point him to README → Setup.
3. Check the Claude in Chrome tools are available (`mcp__claude-in-chrome__*`).
   If not, stop: "Connect Chrome first: in VS Code type `@browser` (or turn
   on Enabled by default in `/chrome`); in the terminal start `claude
   --chrome`. Keep Chrome open and signed in to LinkedIn, then run
   /linkedin-review again."

## Step 1 — Scrape
Launch the `scraper` subagent with: profile URL, output `profile_out`,
previous profile path. If the subagent cannot reach the Chrome tools, do
the scrape yourself following `.claude/agents/scraper.md`.
Then confirm the file parses and skim `missing_fields` / `scrape_notes`.

## Step 2 — Recruiter + career coach (parallel)
Launch BOTH subagents in the SAME message:
- `recruiter`: profile path, previous profile path (context only), output
  `recruiter_out`, today's date. "Use WebSearch/WebFetch for salary and
  certification research. No browser tools. Validate the JSON."
- `career-coach`: profile path, output `coach_out`, today's date. "Use
  WebSearch/WebFetch; open the WEF Future of Jobs and BLS OOH pages before
  citing them; compare Colombia (stay, remote), Mexico, Spain, United
  States and one other LatAm country you pick with evidence. Validate the
  JSON."
When both return, confirm both files parse.

## Step 3 — Synthesis
Launch the `synthesis` subagent with: profile, previous profile (or
"none"), coach and recruiter paths, RUN_ID, RUN_AT, output `run_out`.

## Step 4 — Validate and publish
1. `python3 scripts/validate_run.py <RUN_ID>` — must print OK. On ERROR,
   send the errors back to the synthesis subagent once, then re-validate.
   WARN lines are fine; mention them only if many.
2. `python3 scripts/publish.py <RUN_ID>` — must print OK for the profile
   and the run. On FAIL, show the error and stop.
3. Do not commit anything from `data/`: it is gitignored on purpose.

## Step 5 — Dashboard stats
Numbers for the Agent Office dashboard (tokens, cost, timing per agent; no
prompts or profile content).
1. `python3 scripts/agent_stats.py <RUN_ID>` — expect `OK`. On SKIP/FAIL say
   so in one line and go on to Step 6.
2. Commit and push only the stats so GitHub Pages updates:
   `git add dashboard/data && git commit -m "Dashboard stats for <RUN_ID>" && git push`.
   Never add anything else. If the push fails, say so; do not retry in a loop.

## Step 6 — Report
Reply in 3–5 short lines: the profile score, the target role and country
call, the top profile fix this week, what changed since last run, and
anything that could not be scraped or any figure conflict in `notes`.
Last line: "Open the LinkedIn Review app to see it." No recap of the steps.
