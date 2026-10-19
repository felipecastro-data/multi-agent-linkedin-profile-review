import { createOffice } from './office.js';

const $ = (id) => document.getElementById(id);
const LOOP_S = 40;      // one run replayed in this many seconds
const HOLD_S = 4;       // pause at the end of each loop
const TYPES = [
  ['input', 'Input', 'var(--c-input)'],
  ['cache_write', 'Cache write', 'var(--c-write)'],
  ['cache_read', 'Cache read', 'var(--c-read)'],
  ['output', 'Output', 'var(--c-output)'],
];
const EDGES = [
  ['scraper', 'recruiter'], ['scraper', 'career-coach'],
  ['recruiter', 'synthesis'], ['career-coach', 'synthesis'],
  ['synthesis', 'orchestrator'],
];

const ORDERS = {
  scraper: 'Scraper, pull the profile.',
  recruiter: 'Recruiter, short-term review.',
  'career-coach': 'Coach, long-term plan.',
  synthesis: 'Synthesis, merge both.',
  publish: 'Validated. Publishing!',
};
const fmtTok = (n) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K' : String(Math.round(n)));
const fmtUsd = (n) => (n == null ? '—' : '~$' + (n < 0.1 ? n.toFixed(3) : n.toFixed(2)));
const fmtDur = (s) => (s == null ? '—' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0'));
const el = (tag, attrs = {}, html = '') => Object.assign(document.createElement(tag), attrs, html ? { innerHTML: html } : {});

const state = { meta: null, index: [], run: null, selected: null, t0: performance.now() / 1000, prev: {}, bubbleUntil: 0, published: false };

async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(path + ' → ' + res.status);
  return res.json();
}

const meta = await getJSON('data/agents.json');
state.meta = meta;
const agentsMeta = meta.agents;

const office = createOffice($('scene'), {
  agents: agentsMeta,
  onPick: (id) => (id ? select(id) : select(null)),
  onHover: (id) => document.querySelectorAll('.tag').forEach((t) => t.classList.toggle('on', t.dataset.id === id || t.dataset.id === state.selected)),
});

// ---- theme ------------------------------------------------------------------
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => office.setTheme(mq.matches);
mq.addEventListener('change', applyTheme);
applyTheme();

// ---- labels -----------------------------------------------------------------------
const labelHost = $('labels');
const tags = {};
for (const id of meta.order) {
  const a = agentsMeta[id];
  const b = el('button', { className: 'tag', type: 'button' });
  b.dataset.id = id;
  b.style.setProperty('--c', a.color);
  b.innerHTML = `<span class="dot"></span><span><b>${a.name}</b><small>—</small></span>`;
  b.addEventListener('click', () => select(state.selected === id ? null : id));
  b.addEventListener('pointerenter', () => b.classList.add('on'));
  b.addEventListener('pointerleave', () => b.classList.toggle('on', state.selected === id));
  labelHost.append(b);
  tags[id] = b;
}

// ---- run data ----------------------------------------------------------------------------
const colorOf = (id) => agentsMeta[id].color;
const agentStats = (id) => (state.run && state.run.agents[id]) || null;

function setStatus(msg) { $('status').textContent = msg || ''; }

async function loadRun(id) {
  try {
    state.run = await getJSON(`data/runs/${id}.json`);
  } catch (e) {
    state.run = null;
    setStatus('Could not load run ' + id);
    return;
  }
  setStatus('');
  state.t0 = performance.now() / 1000;
  renderTotals();
  renderTimeline();
  renderSplitChart();
  renderLabels();
  office.setWall({
    title: state.run.run_id,
    lines: [
      fmtTok(state.run.totals.tokens) + ' tokens',
      fmtUsd(state.run.totals.cost_usd) + ' API-equivalent',
      fmtDur(state.run.wall_s) + ' wall time',
      state.run.totals.tool_calls + ' tool calls',
      fmtUsd(state.run.totals.cache_saved_usd) + ' saved by caching',
    ],
  });
  if (state.selected) renderCard(state.selected);
}

function renderTotals() {
  const t = state.run.totals;
  const items = [
    ['Tokens', fmtTok(t.tokens)], ['Cost', fmtUsd(t.cost_usd)], ['Wall time', fmtDur(state.run.wall_s)],
    ['Saved by cache', fmtUsd(t.cache_saved_usd)],
  ];
  $('totals').innerHTML = items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function renderLabels() {
  for (const id of meta.order) {
    const s = agentStats(id);
    tags[id].querySelector('small').textContent = s ? `${fmtTok(s.tokens.total)} tok · ${fmtUsd(s.cost_usd)}` : 'no stats';
  }
}

function renderTimeline() {
  const host = $('timeline');
  host.innerHTML = '';
  const wall = state.run.wall_s;
  for (const id of ['orchestrator', 'scraper', 'recruiter', 'career-coach', 'synthesis']) {
    const s = agentStats(id);
    const row = el('div', { className: 'tl-row' });
    row.innerHTML = `<span class="n">${agentsMeta[id].name}</span>`;
    if (s) {
      const bar = el('i');
      bar.style.cssText = `--c:${colorOf(id)};left:${(s.start_offset_s / wall) * 100}%;width:${Math.max(0.8, (s.duration_s / wall) * 100)}%`;
      bar.title = `${agentsMeta[id].name}: ${fmtDur(s.duration_s)}`;
      row.append(bar);
    }
    host.append(row);
  }
  host.append(el('div', { className: 'playhead', id: 'playhead' }));
}

function renderSplitChart() {
  const rows = ['scraper', 'recruiter', 'career-coach', 'synthesis', 'orchestrator'].filter(agentStats);
  const max = Math.max(...rows.map((id) => agentStats(id).cost_usd || 0), 0.0001);
  $('split-chart').innerHTML = rows.map((id) => {
    const s = agentStats(id);
    const sp = s.cost_split || {};
    const segs = TYPES.map(([k, label, c]) => `<i style="width:${((sp[k] || 0) / max) * 100}%;background:${c}" title="${label} ${fmtUsd(sp[k])}"></i>`).join('');
    return `<div class="sc-row"><span>${agentsMeta[id].name}</span><div class="sc-bar">${segs}</div></div>`;
  }).join('');
  $('legend').innerHTML = TYPES.map(([, label, c]) => `<li><i style="background:${c}"></i>${label}</li>`).join('');
}

function renderPipe(t, wall) {
  const steps = meta.pipeline;
  const synth = agentStats('synthesis');
  const html = steps.map((s, i) => {
    const ids = s.id === 'publish' ? [] : [s.id, s.parallel].filter(Boolean);
    let st = 'wait';
    if (s.id === 'publish') st = synth && t >= synth.start_offset_s + synth.duration_s ? 'on' : 'wait';
    else {
      const ss = ids.map(agentStats).filter(Boolean);
      if (ss.length) {
        const started = ss.some((x) => t >= x.start_offset_s);
        const done = ss.every((x) => t >= x.start_offset_s + x.duration_s);
        st = done ? 'done' : started ? 'on' : 'wait';
      }
    }
    const label = ids.length > 1 ? `${agentsMeta[ids[0]].name} ‖ ${agentsMeta[ids[1]].name}` : s.label;
    const c = ids[0] ? colorOf(ids[0]) : 'var(--accent)';
    return `${i ? '<li class="sep">›</li>' : ''}<li class="${st === 'wait' ? '' : st}" style="--c:${c}">${label}</li>`;
  }).join('');
  if ($('pipe').dataset.h !== html) { $('pipe').dataset.h = html; $('pipe').innerHTML = html; }
}

// ---- card ---------------------------------------------------------------------------------
function renderCard(id) {
  const a = agentsMeta[id], s = agentStats(id);
  $('card').style.setProperty('--c', a.color);
  $('card-step').textContent = a.step;
  $('card-title').textContent = a.name;
  $('card-goal').textContent = a.goal;
  $('card-desc').textContent = a.description;
  $('card-meta').innerHTML = `<dt>Scope</dt><dd>${a.scope}</dd><dt>Reads</dt><dd>${a.inputs}</dd><dt>Writes</dt><dd>${a.outputs}</dd>` +
    (s ? `<dt>Model</dt><dd>${s.model}</dd>` : '');
  if (!s) {
    $('card-stats').innerHTML = '';
    $('card-split').innerHTML = '';
    $('card-foot').textContent = 'No stats for this agent in the selected run.';
    return;
  }
  const stat = (k, v) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`;
  $('card-stats').innerHTML = stat('Tokens', fmtTok(s.tokens.total)) + stat('Cost', fmtUsd(s.cost_usd)) + stat('Time', fmtDur(s.duration_s)) +
    stat('Requests', s.requests) + stat('Tool calls', s.tool_calls) + stat('Web', `${s.web_searches}s · ${s.web_fetches}f`);
  const sp = s.cost_split || {};
  const total = Object.values(sp).reduce((x, y) => x + y, 0) || 1;
  $('card-split').innerHTML = `<div class="bar-line">${TYPES.map(([k, , c]) => `<i style="width:${((sp[k] || 0) / total) * 100}%;background:${c}"></i>`).join('')}</div>` +
    `<ul>${TYPES.map(([k, label, c]) => `<li><i style="background:${c}"></i>${label} ${fmtTok(s.tokens[k])}<span>${fmtUsd(sp[k])}</span></li>`).join('')}</ul>`;
  $('card-foot').textContent = 'Input and cache tokens are exact. Output is estimated from visible text, so costs are approximate and use API list prices, not your subscription.';
}

function select(id) {
  state.selected = id;
  const card = $('card');
  if (id) {
    renderCard(id);
    card.hidden = false;
    const wide = window.innerWidth > 820;
    office.focus(id, wide ? { x: 200, y: 0 } : { x: 0, y: window.innerHeight * 0.2 });
  } else {
    card.hidden = true;
    office.focus(null);
  }
  for (const [k, t] of Object.entries(tags)) {
    t.classList.toggle('on', k === id);
    t.classList.toggle('dim', !!id && k !== id);
  }
}
$('card-close').addEventListener('click', () => select(null));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.selected) select(null); });

const dock = $('dock');
$('dock-toggle').addEventListener('click', () => {
  const closed = dock.classList.toggle('closed');
  $('dock-toggle').setAttribute('aria-expanded', String(!closed));
});
if (window.innerWidth <= 820) { dock.classList.add('closed'); $('dock-toggle').setAttribute('aria-expanded', 'false'); }

// ---- playback + labels each frame --------------------------------------------------------------
office.onFrame = () => {
  for (const id of meta.order) {
    const p = office.projectLabel(id);
    const t = tags[id];
    t.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    t.style.visibility = p.behind ? 'hidden' : 'visible';
  }
  const run = state.run;
  if (!run) return;
  const wall = run.wall_s;
  const el_ = (performance.now() / 1000 - state.t0) % (LOOP_S + HOLD_S);
  const t = Math.min(wall, (el_ / LOOP_S) * wall);
  const holding = el_ > LOOP_S;

  const st = {};
  for (const id of meta.order) {
    const s = run.agents[id];
    if (!s) { st[id] = 'waiting'; continue; }
    if (id === 'orchestrator') st[id] = holding ? 'done' : 'working';
    else st[id] = t < s.start_offset_s ? 'waiting' : t < s.start_offset_s + s.duration_s ? 'working' : 'done';
  }
  office.setStates(st);

  // the manager briefs each agent as it starts, then announces the publish
  const started = Object.keys(st).filter((id) => id !== 'orchestrator' && st[id] === 'working' && state.prev[id] !== 'working');
  if (started.length) {
    const line = started.length > 1
      ? started.map((id) => agentsMeta[id].name).join(' & ') + ': go, in parallel.'
      : ORDERS[started[0]];
    say(line);
    office.cue(started[0]);
  }
  const synthDone = st.synthesis === 'done';
  if (synthDone && !state.published) { say(ORDERS.publish); state.published = true; }
  if (!synthDone) state.published = false;
  state.prev = st;
  const bubble = $('bubble');
  const bp = office.projectLabel('orchestrator');
  const half = bubble.offsetWidth / 2 + 8;
  const bx = Math.min(Math.max(bp.x, half), window.innerWidth - half);
  bubble.style.transform = `translate(${bx.toFixed(1)}px, ${(bp.y - 38).toFixed(1)}px) translate(-50%, -100%)`;
  bubble.hidden = performance.now() / 1000 > state.bubbleUntil || bp.behind;

  const flights = [];
  for (const [from, to] of EDGES) {
    const a = run.agents[from], b = run.agents[to];
    if (!a || !b) continue;
    const end = a.start_offset_s + a.duration_s;
    const begin = end - 0.01 * wall;
    const arrive = Math.max(b.start_offset_s, begin + 0.07 * wall);
    const p = (t - begin) / (arrive - begin);
    if (p > 0 && p < 1 && !holding) flights.push({ from, to, p });
  }
  office.setFlights(flights);

  for (const [id, tag] of Object.entries(tags)) tag.dataset.state = st[id];
  const ph = $('playhead');
  if (ph) ph.style.left = `calc(92px + (100% - 92px) * ${(t / wall).toFixed(4)})`;
  $('clock-label').textContent = `${fmtDur(t)} / ${fmtDur(wall)} · replay ${Math.round(wall / LOOP_S)}×`;
  renderPipe(t, wall);
};

function say(text) {
  $('bubble').textContent = text;
  state.bubbleUntil = performance.now() / 1000 + 2.8;
}

// ---- boot --------------------------------------------------------------------------------------------
try {
  const idx = await getJSON('data/index.json');
  state.index = idx.runs;
  const sel = $('run-select');
  sel.innerHTML = idx.runs.map((r) => {
    const d = new Date(r.run_at);
    const label = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<option value="${r.run_id}">${label} · ${fmtUsd(r.cost_usd)}</option>`;
  }).join('');
  sel.addEventListener('change', () => loadRun(sel.value));
  if (idx.runs.length) await loadRun(idx.runs[0].run_id);
  else setStatus('No runs yet. Run scripts/agent_stats.py <RUN_ID> after /linkedin-review.');
} catch (e) {
  setStatus('No stats yet. Run scripts/agent_stats.py <RUN_ID> after /linkedin-review, then serve this folder over http.');
}
window.__office = office;
