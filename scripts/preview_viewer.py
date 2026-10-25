#!/usr/bin/env python3
"""Build a local preview of the viewer web app from the runs in data/.

Usage: python3 scripts/preview_viewer.py
Writes data/preview/index.html (gitignored with the rest of data/): Index.html
with its includes inlined and google.script.run replaced by a stub that serves
data/runs, data/profiles and data/stats the way Code.gs does. Serve it with the
"viewer-preview" entry in .claude/launch.json.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIEWER = ROOT / "apps-script" / "viewer"
DATA = ROOT / "data"
OUT = DATA / "preview" / "index.html"


def docs(folder: str) -> dict:
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted((DATA / folder).glob("r*.json"))}


def listing(d: dict) -> str:
    rows = sorted(({"id": k, "data": v} for k, v in d.items()), key=lambda x: str(x["data"].get("run_at", "")), reverse=True)
    return json.dumps(rows)


def main() -> None:
    runs, profiles, stats = docs("runs"), docs("profiles"), docs("stats")
    payload = {
        "runs": listing(runs),
        "stats": listing(stats),
        "run": {k: json.dumps(v) for k, v in runs.items()},
        "profile": {k: json.dumps(v) for k, v in profiles.items()},
    }
    stub = """<script>
/* preview only: answers google.script.run calls from data/ */
(function(){
  var P=%s,checks={};
  var api={listRuns:function(){return P.runs},listStats:function(){return P.stats},
    getRun:function(id){return P.run[id]||null},getProfile:function(id){return P.profile[id]||null},
    listChecks:function(){return JSON.stringify(Object.keys(checks).map(function(k){return{id:k,data:checks[k]}}))},
    setCheck:function(id,json){checks[id]=JSON.parse(json);return true}};
  window.google={script:{get run(){var ok,fail,h={withSuccessHandler:function(f){ok=f;return h},withFailureHandler:function(f){fail=f;return h}};
    Object.keys(api).forEach(function(k){h[k]=function(){var a=arguments;setTimeout(function(){try{ok(api[k].apply(null,a))}catch(e){fail(e)}},60)}});return h}}};
})();
</script>
""" % json.dumps(payload).replace("</", "<\\/")
    html = (VIEWER / "Index.html").read_text(encoding="utf-8")
    html = re.sub(r"<\?!= include\('(\w+)'\) \?>", lambda m: (VIEWER / f"{m.group(1)}.html").read_text(encoding="utf-8"), html)
    html = html.replace("<body>\n", "<body>\n" + stub, 1)
    # Code.gs doGet adds this meta tag
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">', 1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"OK {OUT.relative_to(ROOT)}: {len(runs)} runs, {len(stats)} stats")


if __name__ == "__main__":
    main()
