# LinkedIn Review — multi-agent career review

A set of Claude Code subagents reviews my LinkedIn profile and career. The
result lands in a responsive web app on Google Apps Script that works on
desktop and mobile. One command runs the whole review: `/linkedin-review`.

> v1 rendered a PDF. v2 replaces it with the web app, sets new agent scopes
> (short-term recruiter, long-term career coach) and adds a shared Known
> context file.

## How it works

```
/linkedin-review  (Claude Code skill)
 ├─ scraper        Claude in Chrome → data/profiles/<RUN_ID>.json
 ├─ recruiter  ┐   1–12 months: score, profile fixes, salary, keywords
 ├─ career-coach┘  2–3 years: industry, role, country, skills (WEF + BLS)
 ├─ synthesis      → data/runs/<RUN_ID>.json (schema v2)
 └─ publish.py ──► Apps Script "ingest" ──► Drive folder ──► Apps Script "viewer" (Only me)
```

| Agent | Horizon | Answers |
|---|---|---|
| recruiter | 1–12 months | Profile score; skill gaps in the current role; projects; recommendations; header/About; experience; certifications; master's or not; content strategy; salary (USD remote + COP); search keywords; paste-ready edits |
| career-coach | 2–3 years | Industry; company size; stay or move and the target role; skill mandates; country (Colombia remote vs Mexico, Spain, US, plus one LatAm pick); tenure; IC vs management; market signals; SWOT; what to skip |
| synthesis | — | Merges both agents into one run: summary, week/month/quarter plan, changes since the last run, conflict notes |

Every agent reads `context/known_context.md` first. That file holds facts I
have confirmed, which the agents must never flag.

## Repo layout

```
.claude/skills/linkedin-review/SKILL.md   orchestrator (/linkedin-review)
.claude/agents/                           scraper, recruiter, career-coach, synthesis
context/known_context.md                  confirmed facts every agent follows
data/schema.json                          profile shape (data/ is otherwise gitignored)
scripts/new_run.py                        RUN_ID, paths, previous profile
scripts/validate_run.py                   checks a run before publishing
scripts/publish.py                        POSTs the run to the ingest web app
apps-script/viewer/                       the app: Code.gs, Index.html, appsscript.json
apps-script/ingest/                       doPost endpoint: Code.gs, appsscript.json
```

## Setup (once)

### 1. Ingest project, which receives runs

1. Go to [script.google.com](https://script.google.com), click **New
   project** and name it `LinkedIn Review – ingest`.
2. Replace `Code.gs` with `apps-script/ingest/Code.gs`.
3. In **Project Settings**, tick **Show "appsscript.json"**. Then replace
   that file with `apps-script/ingest/appsscript.json`.
4. Select `setup` in the function menu and click **Run**, then authorize it.
   The execution log prints `FOLDER_ID` and `INGEST_TOKEN`.
5. Go to **Deploy → New deployment → Web app**. Set **Execute as: Me** and
   **Who has access: Anyone**. Copy the `/exec` URL.
   - This project holds no data. It only writes into the folder, and only
     when a request carries the token.

### 2. Viewer project, which is the app

1. Click **New project** and name it `LinkedIn Review`.
2. Replace `Code.gs` with `apps-script/viewer/Code.gs`.
3. Add an HTML file named `Index` and paste in `apps-script/viewer/Index.html`.
4. Replace `appsscript.json` with `apps-script/viewer/appsscript.json`.
5. In **Project Settings → Script properties**, add `FOLDER_ID` with the
   value from step 1.4.
6. Go to **Deploy → New deployment → Web app**. Set **Execute as: Me** and
   **Who has access: Only myself**. Open the URL and bookmark it. On iPhone,
   use **Share → Add to Home Screen**.

### 3. Local

```bash
cp .env.example .env              # paste LR_INGEST_URL and LR_INGEST_TOKEN
python3 scripts/publish.py --ping  # expect: OK token accepted
python3 scripts/publish.py --all   # backfill earlier runs
python3 scripts/publish.py --checks  # backfill ticked actions (once)
```

## Run a review

1. Open Chrome, signed in to LinkedIn.
2. In Claude Code (VS Code), open this folder.
3. Type `@browser`, or turn on **Enabled by default** in `/chrome`.
4. Run:

```
/linkedin-review
```

A run takes about 10–15 minutes. Reload the app to see it.

## Updating the app

Edit `apps-script/viewer/Index.html`, then paste it into the viewer project.
Publish with **Deploy → Manage deployments → Edit → Version: New version**.
The URL stays the same.

To skip the copy-paste, use [clasp](https://github.com/google/clasp):

1. Turn on the Apps Script API at
   <https://script.google.com/home/usersettings>.
2. Run `npm i -g @google/clasp && clasp login`.
3. In `apps-script/viewer/`, create `.clasp.json` (gitignored):
   `{"scriptId":"<viewer script id>","rootDir":"."}`
4. After each change, run `clasp push` and then
   `clasp deploy -i <deploymentId>`. Reusing the deployment ID keeps the URL.

## Design choices

- **Probabilistic, not deterministic.** Two runs on the same profile can
  differ. The safeguards are:
  - cited sources for every market claim
  - a shared Known context file
  - `validate_run.py`
- **Privacy.**
  - Raw profiles and runs stay in `data/`, which is gitignored, and in my
    own Drive.
  - The viewer is deployed "Only myself".
  - The ingest endpoint is public but needs the token, and it never returns
    data.
- **Old runs keep rendering.** The app reads both schema v1 and v2 runs.
