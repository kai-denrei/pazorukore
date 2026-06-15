// src/ui/admin.js — the ?admin / "Tune" panel. GENERIC and now MULTI-SECTION: it builds itself from
// each tunable target's `params` schema. The Futuristic skin exposes two: the glyph (Numbers) and the
// region (Grid) — so the grid has its own variables, separate from the numbers. A change re-resolves
// that target's params and repaints (numbers → full repaint; grid → grid layer). Overrides persist to
// localStorage per skin+section; Copy dumps both as JSON, Reset restores defaults.

const LS_KEY = (skinId, sec) => `pazoru.admin.${skinId}.${sec}`;

export class Admin {
  constructor(panelEl) { this.el = panelEl; }

  show(skin, board) {
    this.skin = skin; this.board = board;
    this.el.hidden = false;

    this.sections = [];
    if (skin.glyph && skin.glyph.params) this.sections.push({
      key: 'glyph', label: 'Numbers', target: skin.glyph,
      onChange: () => { if (skin.glyph.setColors) skin.glyph.setColors(this._glyphColors()); board.repaintAll(); },
    });
    if (skin.region && skin.region.params && skin.region.setParams) this.sections.push({
      key: 'grid', label: 'Grid', target: skin.region,
      onChange: () => board.repaintGrid(),
    });

    // restore persisted overrides per section
    for (const sec of this.sections) { const saved = this._load(skin.meta.id, sec.key); if (saved) sec.target.setParams(saved); }
    board.repaintAll();
    if (!this._section(this.active)) this.active = this._section('grid') ? 'grid' : (this.sections[0] && this.sections[0].key);
    this._render();
  }

  // render the active tab's params (Numbers / Grid are separate panels via the tab strip).
  _render() {
    const skin = this.skin;
    let html = `<div class="admin-head"><strong>${skin.meta.name}</strong><span class="muted">?admin</span></div>`;
    if (this.sections.length > 1) {
      html += `<div class="admin-tabs">${this.sections.map((s) => `<button class="admin-tab${s.key === this.active ? ' on' : ''}" data-tab="${s.key}">${s.label}</button>`).join('')}</div>`;
    }
    const sec = this._section(this.active) || this.sections[0];
    if (sec) {
      const params = (sec.target.params || []).filter((p) => p.type !== 'text');
      const groups = {};
      for (const p of params) (groups[p.group || 'misc'] ||= []).push(p);
      for (const [g, ps] of Object.entries(groups)) { html += `<h3>${g}</h3>`; for (const p of ps) html += this._row(sec.key, p, sec.target.getParams()[p.key]); }
    }
    html += `<div class="admin-actions"><button data-a="reset">reset tab</button><button data-a="copy">copy all</button></div><div class="admin-copied muted" hidden></div>`;
    this.el.innerHTML = html;
    this._wire();
  }

  _row(sec, p, val) {
    const id = `adm-${sec}-${p.key}`;
    let input;
    if (p.type === 'range') input = `<input type="range" id="${id}" data-sec="${sec}" data-k="${p.key}" min="${p.min}" max="${p.max}" step="${p.step || 1}" value="${val}">`;
    else if (p.type === 'color') input = `<input type="color" id="${id}" data-sec="${sec}" data-k="${p.key}" value="${val}">`;
    else if (p.type === 'toggle') input = `<input type="checkbox" id="${id}" data-sec="${sec}" data-k="${p.key}" ${val ? 'checked' : ''}>`;
    else if (p.type === 'select') input = `<select id="${id}" data-sec="${sec}" data-k="${p.key}">${(p.options || []).map((o) => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    else input = `<input type="text" id="${id}" data-sec="${sec}" data-k="${p.key}" value="${val}">`;
    const show = p.type === 'range' ? `<span class="val" data-v="${sec}-${p.key}">${val}</span>` : '<span class="val"></span>';
    return `<div class="admin-row"><label for="${id}">${p.label || p.key}</label>${input}${show}</div>`;
  }

  _section(key) { return this.sections.find((s) => s.key === key); }

  _wire() {
    this.el.addEventListener('input', (e) => {
      const k = e.target.dataset.k, secKey = e.target.dataset.sec;
      if (!k || !secKey) return;
      const sec = this._section(secKey); if (!sec) return;
      const p = sec.target.params.find((x) => x.key === k);
      let v = e.target.value;
      if (p.type === 'range') { v = parseFloat(v); const out = this.el.querySelector(`[data-v="${secKey}-${k}"]`); if (out) out.textContent = v; }
      else if (p.type === 'toggle') v = e.target.checked;
      sec.target.setParams({ [k]: v });
      sec.onChange();
      this._save();
    });
    this.el.addEventListener('click', (e) => {
      if (e.target.dataset.tab) { this.active = e.target.dataset.tab; this._render(); return; }
      const a = e.target.dataset.a; if (!a) return;
      if (a === 'reset') this._reset();
      if (a === 'copy') this._copy();
    });
  }

  _glyphColors() {
    const p = this.skin.glyph.getParams();
    return { on: p.color || '#1bf0c8', bg: p.bg || '#070b0c', card: p.card, ink: p.ink, edge: p.edgeColor };
  }

  _reset() {
    const sec = this._section(this.active); if (!sec) return;   // reset just the active tab
    const defs = {};
    for (const p of sec.target.params) defs[p.key] = p.default;
    sec.target.setParams(defs);
    this.board.repaintAll();
    this._save();
    this._render();
  }

  _copy() {
    const out = {};
    for (const sec of this.sections) out[sec.key] = sec.target.getParams();
    const json = JSON.stringify(out, null, 0);
    const note = this.el.querySelector('.admin-copied');
    const done = () => { if (note) { note.hidden = false; note.textContent = 'copied ✓ — both sections'; } };
    if (navigator.clipboard) navigator.clipboard.writeText(json).then(done, () => { if (note) { note.hidden = false; note.textContent = json; } });
    else if (note) { note.hidden = false; note.textContent = json; }
  }

  _save() { for (const sec of this.sections) { try { localStorage.setItem(LS_KEY(this.skin.meta.id, sec.key), JSON.stringify(sec.target.getParams())); } catch (_) {} } }
  _load(skinId, sec) { try { return JSON.parse(localStorage.getItem(LS_KEY(skinId, sec)) || 'null'); } catch (_) { return null; } }
}

export default Admin;
