// "Compare runs" panel: one stacked bar per run (cost by agent, shared scale),
// totals and the change against the previous run, plus a table view.

const ORDER = ['orchestrator', 'scraper', 'recruiter', 'career-coach', 'synthesis'];

export function createCompare({ panel, list, legend, table, tip, agentsMeta, loadRun, onPick, fmt }) {
  const cache = {};
  async function getRun(id) { return cache[id] || (cache[id] = await loadRun(id)); }

  legend.innerHTML = ORDER.map((id) => `<li><i style="background:var(--ag-${id})"></i>${agentsMeta[id].name}</li>`).join('');

  function delta(cur, prev, f) {
    if (prev == null || !prev) return '';
    const pct = ((cur - prev) / prev) * 100;
    const sign = pct > 0 ? '+' : pct < 0 ? '−' : '±';
    return `<span class="delta">${sign}${Math.abs(pct).toFixed(0)}% ${f}</span>`;
  }

  async function render(index) {
    list.innerHTML = '<p class="muted">Loading runs…</p>';
    const runs = await Promise.all(index.map((r) => getRun(r.run_id).catch(() => null)));
    const ok = runs.filter(Boolean);
    const max = Math.max(...ok.map((r) => r.totals.cost_usd || 0), 0.0001);
    list.innerHTML = ok.map((r, i) => {
      const prev = ok[i + 1]; // index is newest first
      const label = new Date(r.run_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const segs = ORDER.filter((id) => r.agents[id]).map((id) => {
        const a = r.agents[id];
        return `<i data-agent="${id}" data-run="${r.run_id}" style="width:${((a.cost_usd || 0) / max) * 100}%;background:var(--ag-${id})" tabindex="0" aria-label="${agentsMeta[id].name} ${fmt.usd(a.cost_usd)}"></i>`;
      }).join('');
      return `<button class="cmp-row" type="button" data-run="${r.run_id}">
        <span class="cmp-when">${label}</span>
        <span class="cmp-bar">${segs}</span>
        <span class="cmp-nums"><b>${fmt.usd(r.totals.cost_usd)}</b> · ${fmt.tok(r.totals.tokens)} tok · ${fmt.dur(r.wall_s)}
          ${prev ? `<br>${delta(r.totals.cost_usd, prev.totals.cost_usd, 'cost')} ${delta(r.wall_s, prev.wall_s, 'time')}` : '<br><span class="delta">first run</span>'}</span>
      </button>`;
    }).join('') || '<p class="muted">No runs yet.</p>';

    table.innerHTML = `<thead><tr><th>Agent</th>${ok.map((r) => `<th>${r.run_id}</th>`).join('')}</tr></thead><tbody>` +
      ORDER.map((id) => `<tr><th>${agentsMeta[id].name}</th>${ok.map((r) => {
        const a = r.agents[id];
        return `<td>${a ? `${fmt.usd(a.cost_usd)}<br><small>${fmt.tok(a.tokens.total)} · ${fmt.dur(a.duration_s)}</small>` : '—'}</td>`;
      }).join('')}</tr>`).join('') +
      `<tr class="total"><th>Total</th>${ok.map((r) => `<td>${fmt.usd(r.totals.cost_usd)}</td>`).join('')}</tr></tbody>`;
  }

  // hover / focus tooltip on segments
  function showTip(seg) {
    const r = cache[seg.dataset.run], id = seg.dataset.agent, a = r && r.agents[id];
    if (!a) return;
    tip.innerHTML = `<b>${agentsMeta[id].name}</b><br>${fmt.usd(a.cost_usd)} · ${fmt.tok(a.tokens.total)} tokens<br>${fmt.dur(a.duration_s)} · ${a.tool_calls} tool calls`;
    tip.hidden = false;
    const b = seg.getBoundingClientRect(), p = panel.getBoundingClientRect();
    tip.style.left = `${Math.min(b.left + b.width / 2 - p.left, p.width - 110)}px`;
    tip.style.top = `${b.top - p.top - 8}px`;
  }
  list.addEventListener('pointerover', (e) => { const s = e.target.closest('.cmp-bar i'); if (s) showTip(s); });
  list.addEventListener('pointerout', (e) => { if (e.target.closest('.cmp-bar i')) tip.hidden = true; });
  list.addEventListener('focusin', (e) => { const s = e.target.closest('.cmp-bar i'); if (s) showTip(s); });
  list.addEventListener('focusout', () => (tip.hidden = true));
  list.addEventListener('click', (e) => { const row = e.target.closest('.cmp-row'); if (row) onPick(row.dataset.run); });

  return { render };
}
