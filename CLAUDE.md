# CLAUDE.md

## What this is
LinkedIn Review v2: Claude Code subagents review Felipe's LinkedIn profile
and career, and a Google Apps Script web app shows the result (desktop +
mobile). One command runs everything: `/linkedin-review`.

## Pipeline
```
/linkedin-review (.claude/skills/linkedin-review/SKILL.md)
  scraper (Claude in Chrome)        → data/profiles/<RUN_ID>.json
  recruiter   ─┐ parallel           → data/work/<RUN_ID>/recruiter.json
  career-coach ┘                    → data/work/<RUN_ID>/career_coach.json
  synthesis                         → data/runs/<RUN_ID>.json   (schema v2)
  scripts/validate_run.py → scripts/publish.py
  → Apps Script "ingest" web app → Drive folder "LinkedIn Review data"
  → Apps Script "viewer" web app (Only me) renders it
```
RUN_ID = `r<YYYYMMDD>-<HHMM>` in America/Bogota time (`scripts/new_run.py`).

## Rules
- **Known context:** every agent reads `context/known_context.md` first and
  never contradicts it (e.g. Blackboard/Anthology naming is never a finding).
  New confirmed facts go in that file, not in individual agent prompts.
- **No fabricated data.** Unknown → `null` / `[]` + `missing_fields`.
  Analysis agents never fill gaps left by the scraper.
- **Scope split.** Recruiter = short term (1–12 months, profile + job
  search). Career coach = long term (2–3 years, strategy; never LinkedIn
  copy). Synthesis only merges.
- **Sources.** Every market claim cites a source opened in that run
  (coach ids `s*`, recruiter ids `r*`).
- **Privacy.** `data/` and `.env` are gitignored and must stay that way.
  Never put personal pay/offer figures in a run unless they are in the
  inputs. The viewer is deployed "Only myself"; the ingest web app holds no
  data and needs the token.
- **Schema changes.** If a run field changes, update the synthesis prompt,
  `scripts/validate_run.py` and the viewer (`apps-script/viewer/Index.html`)
  together; the app must keep rendering older runs.

## Agent Office dashboard
- `dashboard/` is a static Three.js site (GitHub Pages), separate from the
  viewer. It shows the pipeline, not the analysis.
- `scripts/agent_stats.py` writes `dashboard/data/` from Claude Code
  transcripts: numbers only. Never put prompts, profile content or pay
  figures there; the folder is public once pushed.
- Output tokens are estimated; label cost as approximate wherever shown.
- Agent goals/descriptions live in `dashboard/data/agents.json`; update it
  when an agent's scope changes.

## Apps Script
- `apps-script/viewer/` — `Code.gs` (Drive reads, checklist ticks),
  `Index.html` (the app; a small shim at the top maps its data calls to
  `google.script.run`). Edit the app here, then push with clasp (README).
- `apps-script/ingest/` — `doPost` that saves runs/profiles to Drive.
- Never print or commit `LR_INGEST_TOKEN`.
