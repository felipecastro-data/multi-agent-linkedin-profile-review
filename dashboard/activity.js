// Turns each agent's recorded tool events into speech bubbles and running
// counters as the replay plays. Events are [offset_s, kind, detail?], where
// detail is at most a website host or a file name (see scripts/agent_stats.py).

const PHRASES = {
  search: () => 'Searching the web…',
  fetch: (d) => (d ? `Reading ${d}` : 'Reading a web page'),
  browse: (d) => (d ? `Opening ${d}` : 'Opening a page'),
  click: () => 'Clicking through the page',
  readpage: () => 'Reading the page',
  script: () => 'Extracting page data',
  tab: () => 'Opening a browser tab',
  write: (d) => (d ? `Writing ${d}` : 'Writing a file'),
  edit: (d) => (d ? `Editing ${d}` : 'Editing a file'),
  read: (d) => (d ? `Reading ${d}` : 'Reading a file'),
  bash: () => 'Running a check',
  validate: () => 'Validating the run',
  publish: () => 'Publishing to the app',
  start: () => 'Starting a new run',
  stats: () => 'Saving the stats',
  handback: () => 'Done, handing back',
  tool: () => 'Using a tool',
};
const WEB = new Set(['search', 'fetch', 'browse']);
const FILES = new Set(['write', 'edit', 'read']);

export function createActivity(host, agentsMeta, order) {
  const bubbles = {};
  for (const id of order) {
    const b = document.createElement('div');
    b.className = 'say';
    b.hidden = true;
    b.style.setProperty('--c', agentsMeta[id].color);
    host.append(b);
    bubbles[id] = b;
  }
  let cursors = {}, lastT = -1;
  const blank = () => ({ tools: 0, web: 0, files: 0 });

  function phrase(ev) {
    const [, kind, detail] = ev;
    if (kind === 'agent') return `Launching ${agentsMeta[detail] ? agentsMeta[detail].name : 'an agent'}`;
    return (PHRASES[kind] || PHRASES.tool)(detail);
  }

  /**
   * run: run document; t: replay time (s); opts.project(id) → {x, y, behind};
   * opts.mute(id) → true to hide that agent's bubble (e.g. the manager is giving orders).
   * Returns per-agent counters up to t.
   */
  function update(run, t, holding, opts) {
    if (t < lastT) cursors = {};
    lastT = t;
    const now = performance.now() / 1000;
    const counts = {};
    for (const id of order) {
      const events = (run.agents[id] && run.agents[id].events) || [];
      const c = cursors[id] || (cursors[id] = { i: 0, counts: blank(), shown: -1, shownAt: 0, until: 0 });
      while (c.i < events.length && events[c.i][0] <= t) {
        const kind = events[c.i][1];
        c.counts.tools++;
        if (WEB.has(kind)) c.counts.web++;
        if (FILES.has(kind) && kind !== 'read') c.counts.files++;
        c.i++;
      }
      counts[id] = c.counts;
      // show the newest event, at most every 1.3 s so it can be read
      if (!holding && c.i > 0 && c.i - 1 !== c.shown && now - c.shownAt > 1.3) {
        c.shown = c.i - 1;
        c.shownAt = now;
        c.until = now + 2.2;
        bubbles[id].textContent = phrase(events[c.shown]);
      }
      const b = bubbles[id];
      const p = opts.project(id);
      const hide = now > c.until || p.behind || (opts.mute && opts.mute(id));
      b.hidden = hide;
      if (!hide) {
        const half = b.offsetWidth / 2 + 8;
        const x = Math.min(Math.max(p.x, half), window.innerWidth - half);
        b.style.transform = `translate(${x.toFixed(1)}px, ${(p.y - 40).toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
    return counts;
  }

  function reset() { cursors = {}; lastT = -1; for (const b of Object.values(bubbles)) b.hidden = true; }
  return { update, reset };
}
