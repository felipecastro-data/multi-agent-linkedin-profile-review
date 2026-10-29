# CLAUDE.md

## What this is
LinkedIn Review v2: Claude Code subagents review Felipe's LinkedIn profile
and career, and a web app shows the result (desktop + mobile). Primary host:
Cloudflare Pages behind Cloudflare Access (gives the iPhone home-screen icon,
which Apps Script can't); the Apps Script viewer stays live as a fallback.
Both serve the same `apps-script/viewer/Index.html`. One command runs
everything: `/linkedin-review`.

## Pipeline
```
/linkedin-review (.claude/skills/linkedin-review/SKILL.md)
  scraper (Claude in Chrome)        → data/profiles/<RUN_ID>.json
  recruiter   ─┐ parallel           → data/work/<RUN_ID>/recruiter.json
  career-coach ┘                    → data/work/<RUN_ID>/career_coach.json
  synthesis                         → data/runs/<RUN_ID>.json   (schema v2)
  scripts/validate_run.py → scripts/publish.py
  scripts/agent_stats.py            → data/stats/<RUN_ID>.json → publish.py --stats
  → Apps Script "ingest" web app → Drive folder "LinkedIn Review data"
  → Apps Script "viewer" web app (Only me) renders it, Office tab included
  → Cloudflare Pages "linkedin-review" (Access) renders the same folder
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

## Agent Office (viewer "Office" tab)
- `apps-script/viewer/Office.html` is the 3D office (Three.js 0.170 ES
  modules from jsDelivr, loaded the first time the tab opens) plus its tab
  UI; `Index.html` includes it and calls `LROffice.view/attach/detach`. It
  shows the pipeline, not the analysis.
- `scripts/agent_stats.py` writes `data/stats/<RUN_ID>.json` from Claude
  Code transcripts: numbers plus tool-event kinds, website hosts and generic
  file names. Never put prompts, search queries, commands, profile content or
  pay figures there. `publish.py --stats` sends it to Drive as `stats_<id>.json`.
- Output tokens are estimated; label cost as approximate wherever shown.
- Agent goals/descriptions live in the `META` constant in `Office.html`;
  update it when an agent's scope changes.
- `python3 scripts/preview_viewer.py` + the `viewer-preview` launch entry
  previews the app locally with data from `data/` (output stays in `data/`).

## Apps Script (fallback)
- `apps-script/viewer/` — `Code.gs` (Drive reads, checklist ticks),
  `Index.html` (the app; a small shim at the top maps its data calls to
  `google.script.run`), `Office.html` (Office tab). Edit the app here, then
  push with clasp (README): `clasp push && clasp deploy -i <deploymentId>`
  from the folder, so the web app URL stays the same.
- `apps-script/ingest/` — `doPost` that saves runs/profiles to Drive.

## Cloudflare Pages (primary)
- `cloudflare/functions/api/[fn].js` — `POST /api/<fn>`, JSON array of args:
  a port of `apps-script/viewer/Code.gs` (listRuns, listStats, getRun,
  getProfile, listChecks, setCheck) on the Drive API, same return shapes.
  **A change to a server function in `Code.gs` must be made here too.**
  Verifies the `Cf-Access-Jwt-Assertion` token (fails closed). Signs in as
  the service account `expenses-reader@expenses-tracker-513017.iam.gserviceaccount.com`
  (shared with Felipe's other Pages apps; needs Editor on the
  "LinkedIn Review data" folder). Listings return the newest 40 files
  (50-subrequest limit). The SA can update `checks.json` but not create it
  (no Drive quota), so the file must exist.
- Pages secrets (production + preview): `FOLDER_ID`, `GOOGLE_SA_KEY`.
  `cloudflare/wrangler.toml` vars: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`.
- `cloudflare/public/` — icons (`apple-touch-icon.png` 180, `icon-192/512.png`,
  `favicon-32.png`) and `manifest.webmanifest`. `index.html` there is built
  by `python3 scripts/preview_viewer.py --pages` (Office.html inlined;
  gitignored). Home-screen `<head>` tags live in `Index.html`.
- `cloudflare/.dev.vars` — local only (gitignored): `DEV_NO_ACCESS=1`,
  `FOLDER_ID`, `GOOGLE_SA_KEY`. `pages-dev` launch entry → http://localhost:8790.
- Production https://linkedin-review.pages.dev (branch `main`), preview
  https://preview.linkedin-review.pages.dev (branch `preview`). Access team
  `odd-paper-fda0.cloudflareaccess.com`.
```sh
cd cloudflare
npm run dev               # local, live Drive data (needs .dev.vars)
npm run deploy:preview    # build, deploy to the preview alias
npm run deploy:prod       # same, to production
```
Deploy to preview first and get Felipe's confirmation from the iPhone before
`deploy:prod`. iOS caches home-screen icons: after an icon change, delete the
home-screen app and add it again.
- Never print or commit `LR_INGEST_TOKEN`.
