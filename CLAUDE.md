# CLAUDE.md

## Project purpose

A multi-agent LinkedIn profile audit tool. A set of Claude Code subagents
scrapes a LinkedIn profile, analyzes it from two independent perspectives,
synthesizes the findings, and renders a PDF report.

## Pipeline

```
scraper agent
    → data/raw/*.json                (raw scraped profile, schema: data/schema.json)
    → career-coach agent  ─┐
    → recruiter agent      ┴ (parallel, read-only)
    → data/analysis/*.json           (one file per analysis agent)
    → synthesis agent
    → scripts/generate_pdf.py
    → output/*.pdf
```

- The **scraper** agent drives Claude in Chrome to extract a LinkedIn
  profile into a single JSON file conforming to `data/schema.json`.
- The **career-coach** and **recruiter** agents each read an existing raw
  profile JSON file and independently write their own analysis JSON to
  `data/analysis/`. They run in parallel and are read-only — they never
  modify `data/raw/` and never trigger a new scrape.
- The **synthesis** agent reads both analysis files and produces the
  combined report content consumed by `scripts/generate_pdf.py`, which
  renders the final PDF to `output/`.

## Rules

### No fabricated data

Agents never invent or guess profile content. If a field defined in
`data/schema.json` cannot be scraped or determined, it must be stored as
`null` (or an empty array, for list fields) and its name added to the
`missing_fields` array. This applies at every stage of the pipeline —
analysis and synthesis agents must not fill in gaps left by the scraper;
they should treat `null`/missing fields as genuinely unknown and reflect
that in their output.

### Raw data is cached, not re-fetched

Every scraper run writes a new timestamped file to `data/raw/`
(`profile_<YYYYMMDD_HHMMSS>.json`) rather than overwriting previous runs.
Analysis agents (career-coach, recruiter) always operate on an existing
raw file that is passed to them or otherwise already present in
`data/raw/` — they never invoke the scraper or re-scrape automatically.
Re-scraping only happens when a user explicitly runs the scraper agent
again.

## Schema

The exact JSON structure the scraper must produce is defined in
[`data/schema.json`](data/schema.json). All raw profile files in
`data/raw/` must conform to it.
