# LinkedIn Review — multi-agent career review

A Claude Code pipeline of four subagents that reviews a LinkedIn profile on
two time horizons and publishes the result to a private web app on Google
Apps Script (desktop + mobile). One command runs it: `/linkedin-review`.

- **Recruiter agent (next 1–12 months):** profile score, skill gaps, paste-ready profile edits, salary bands, search keywords.
- **Career-coach agent (next 2–3 years):** industry, company size, target role, skill mandates, country, IC vs management — grounded in the WEF Future of Jobs report and the US BLS Occupational Outlook Handbook.
- **Every market claim is cited** to a source the agent opened during that run.

<p>
  <img src="docs/app-profile.png" alt="Profile tab: score 77/100 with an eight-dimension scorecard and skill gaps" width="68%">
  <img src="docs/app-actions-mobile.png" alt="Action plan on mobile in dark mode with weekly checklist" width="28%">
</p>

<img src="docs/app-sources.png" alt="Sources tab listing the WEF, BLS and market sources opened during the run" width="100%">

> v2 replaced the original PDF report (v1) with the web app, split the agents
> into short-term and long-term scopes, and added a shared "known context"
> file so agents stop re-raising settled facts.

## Agent Office

The app's **Office** tab is a 3D view of the pipeline itself rather than its analysis: a Three.js
office where four toy-robot subagents type at retro terminals in a pinwheel
of desks, take coffee breaks when they finish, and a manager robot walks
over to brief each one,
documents fly from desk to desk as the run progresses, and clicking anyone opens
a frosted card with their goal, tokens, cost, time and tool calls.

- **Data:** `scripts/agent_stats.py <RUN_ID>` reads the Claude Code transcripts and writes numbers only (no prompts, no profile content) to `data/stats/`; `scripts/publish.py --stats <RUN_ID>` sends them to the same Drive folder as the runs. Input and cache tokens are exact; output tokens are estimated from visible text, so cost is an approximate API list-price figure, not a subscription charge. `/linkedin-review` does both after publishing.
- **While it replays:** speech bubbles and a status pill show what each robot is doing from its real tool calls (searching, reading a site, writing a file), desk displays count its tool calls, and the tab adds totals, a run timeline, cost by token type and a *Compare runs* panel. It follows the app's run picker.
- **Code:** `apps-script/viewer/Office.html`, included by `Index.html`. Three.js 0.170 (MIT) loads from jsDelivr the first time the tab opens, so there is no build step.
- **Try it locally:** `python3 scripts/preview_viewer.py`, then `python3 -m http.server 8766 --directory data/preview` and open http://localhost:8766 (uses your local `data/`).

## Architecture

```mermaid
flowchart LR
    U(["/linkedin-review"]) --> S["scraper<br/>Claude in Chrome"]
    S --> P[("profile JSON")]
    P --> R["recruiter<br/>1–12 months"]
    P --> C["career-coach<br/>2–3 years"]
    K["known_context.md"] -.-> R & C
    W(("WebSearch<br/>WEF · BLS · salary data")) -.-> R & C
    R --> Y["synthesis"]
    C --> Y
    Y --> V{"validate_run.py"}
    V --> I["Apps Script<br/>ingest (doPost + token)"]
    I --> D[("Google Drive<br/>run JSON")]
    D --> A["Apps Script viewer<br/>web app · only me"]
    D --> F["Cloudflare Pages<br/>behind Access · home-screen app"]
```

| Agent | Tools | Output |
|---|---|---|
| `scraper` | Claude in Chrome | Profile JSON (`data/schema.json`): header, About, experience, skills, certifications, projects, posts with engagement, recommendations |
| `recruiter` | WebSearch, WebFetch | Score /100, scorecard, 11 answered areas, ranked paste-ready `changes`, sources `r*` |
| `career-coach` | WebSearch, WebFetch | 7 strategic answers, 4–6 "master X within N months" mandates, country comparison, market signals, SWOT, skip-for-now, sources `s*` |
| `synthesis` | Read, Write | One schema-v2 run: summary, week / month / quarter plan, changes since last run, notes on agent disagreements |

## Design choices

- **Two horizons, two agents.** Profile tweaks and career strategy pulled each other off course in one prompt. The recruiter owns the profile; the coach is forbidden from commenting on LinkedIn copy.
- **Shared known context.** Confirmed facts (e.g. an employer's rebrand history) live in one file every agent reads first, instead of being patched into each prompt after a bad run.
- **Disagreements are kept, not hidden.** When the two agents give different salary bands or opposite advice, synthesis keeps both and writes a note.
- **Probabilistic, not deterministic.** Two runs on the same profile can differ. Mitigations: cited sources, the known-context file, a scraper "carry-over" rule for lists LinkedIn fails to render, and `validate_run.py` checking ids and references before anything is published.
- **Local by design.** Scraping needs a signed-in, interactive Chrome session, so the pipeline runs on my Mac, not in CI.
- **Private by default.** Raw profiles and runs are gitignored. The viewer web app is deployed "Only myself"; the ingest endpoint is public but needs a secret token and never returns data. Two Apps Script projects keep those two access levels apart.
- **No framework.** The app is one HTML file (vanilla JS, glassmorphism cards, a canvas particle field, light/dark). A small shim maps its data calls to `google.script.run` inside Apps Script and to `POST api/<fn>` elsewhere, so the same file runs on both hosts.
- **Two hosts, one file.** Apps Script serves the page inside a Google iframe, so iOS never sees an app icon. Cloudflare Pages serves the same page with a home-screen icon and manifest; a Pages Function reads the same Drive folder through a service account, behind Cloudflare Access.

## Tech stack

Claude Code (skills + subagents) · Claude in Chrome · Python 3 standard library · Google Apps Script (HtmlService, ContentService, DriveApp) · Google Drive · Cloudflare Pages + Functions + Access · vanilla HTML/CSS/JS

## Repo layout

```
.claude/skills/linkedin-review/SKILL.md   orchestrator (/linkedin-review)
.claude/agents/                           scraper, recruiter, career-coach, synthesis
context/known_context.md                  confirmed facts every agent follows
data/schema.json                          profile shape (the rest of data/ is gitignored)
scripts/new_run.py                        run id, paths, previous profile
scripts/validate_run.py                   checks a run before publishing
scripts/publish.py                        POSTs the run to the ingest web app
scripts/agent_stats.py                    per-agent tokens, cost, timing for the Office tab
scripts/preview_viewer.py                 local preview of the app from data/
apps-script/viewer/                       the app: Code.gs, Index.html, Office.html, appsscript.json
apps-script/ingest/                       doPost endpoint: Code.gs, appsscript.json
cloudflare/                               Pages host: functions/api/[fn].js (Drive twin of Code.gs), icons, manifest
```

## Running it yourself

Requirements: Claude Code with the Claude in Chrome extension, Python 3.9+,
a Google account. Change the profile URL in
`.claude/skills/linkedin-review/SKILL.md` and the facts in
`context/known_context.md` to your own.

### 1. Ingest project (receives runs)
1. [script.google.com](https://script.google.com) → **New project** → name it `LinkedIn Review – ingest`.
2. Replace `Code.gs` with `apps-script/ingest/Code.gs`.
3. **Project Settings** → tick **Show "appsscript.json"** → replace it with `apps-script/ingest/appsscript.json`.
4. Open `Code.gs`, select `setup` → **Run** → authorize. The log prints `FOLDER_ID` and `INGEST_TOKEN`.
5. **Deploy → New deployment → Web app**, Execute as **Me**, access **Anyone**. Copy the `/exec` URL.

### 2. Viewer project (the app)
1. **New project** → `LinkedIn Review`.
2. Replace `Code.gs` with `apps-script/viewer/Code.gs`; add HTML files `Index` and `Office` with `apps-script/viewer/Index.html` and `Office.html`; replace `appsscript.json` with `apps-script/viewer/appsscript.json`.
3. **Project Settings → Script properties** → add `FOLDER_ID`.
4. **Deploy → New deployment → Web app**, Execute as **Me**, access **Only myself**. Bookmark the URL (on iPhone: Share → Add to Home Screen).

### 3. Local
```bash
cp .env.example .env               # LR_INGEST_URL and LR_INGEST_TOKEN
python3 scripts/publish.py --ping  # expect: OK token accepted
```

### 4. Run
Open Chrome signed in to LinkedIn. In Claude Code (VS Code: type `@browser` or
enable Chrome by default in `/chrome`; terminal: `claude --chrome`):

```
/linkedin-review
```

A run takes about 10–15 minutes; reload the app to see it.

### Updating the app
Edit `apps-script/viewer/Index.html` (or `Office.html`), paste it into the viewer project, then
**Deploy → Manage deployments → Edit → New version** (the URL stays the same).
Or with [clasp](https://github.com/google/clasp): enable the Apps Script API,
add a gitignored `.clasp.json` (`{"scriptId":"…","rootDir":"."}`) in
`apps-script/viewer/`, then `clasp push && clasp deploy -i <deploymentId>`.

### Cloudflare Pages (optional: iPhone home-screen icon)
1. In Google Cloud, create a service account with a JSON key and share the Drive folder with it as **Editor** (it rewrites `checks.json`).
2. In Cloudflare Zero Trust, add a self-hosted **Access** application for `<project>.pages.dev` and `*.<project>.pages.dev` with an "only me" policy; put its AUD tag in `cloudflare/wrangler.toml` (`ACCESS_AUD`).
3. In `cloudflare/`: `npm install`, then set the Pages secrets `FOLDER_ID` and `GOOGLE_SA_KEY` (production and preview) with `npx wrangler pages secret put`.
4. `npm run deploy:preview` (or `deploy:prod`). The build inlines `Office.html` into `public/index.html`. On iPhone: open the URL in Safari → Share → Add to Home Screen.

Local: a gitignored `cloudflare/.dev.vars` with `DEV_NO_ACCESS=1`, `FOLDER_ID` and `GOOGLE_SA_KEY`, then `npm run dev` (http://localhost:8790, live Drive data).

## Limitations

- LinkedIn's lazy-loaded pages sometimes render empty to text tools; the scraper falls back to scrolling, section reads and screenshots, and carries unchanged lists over from the previous run (noted in the run).
- Salary bands come from public surveys and job-board aggregates with different samples; the app shows both agents' figures when they disagree.
- Advice is the agents' judgment from public sources, not a guarantee.
- On Cloudflare the run and stats lists show the newest 40 of each (Workers' 50-subrequest limit); Apps Script shows 100.

## License

[MIT](LICENSE)
