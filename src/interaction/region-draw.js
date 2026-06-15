// src/interaction/region-draw.js — Shikaku interaction (§7.2 / §11.3). DRAW FROM ANYWHERE: the
// rubber-band can start on any cell; the rectangle's owning clue is whichever single clue falls
// INSIDE it (the game validates "exactly one clue inside"). A tap (no drag) on a cell already in a
// region clears that region. The live W×H=area HUD turns the validated colour when area == the
// enclosed clue and warns when there are 0 or >1 clues; haptics tick on cell-boundary crossings.

import { EVENTS } from '../core/events.js';
import { getCell } from '../core/grid.js';

export class RegionDraw {
  constructor(board, engine, game) {
    this.board = board; this.engine = engine; this.game = game;
    this._subs = []; this.drag = null; this.preview = null;
  }

  attach() {
    this.el = this.board.el;
    this.hud = document.getElementById('hud');
    this._down = (e) => this._onDown(e);
    this._move = (e) => this._onMove(e);
    this._up = (e) => this._onUp(e);
    this.el.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    this._subs.push(this.engine.on(EVENTS.regionValidated, () => this._vibe([12, 24, 40])));
    this._subs.push(this.engine.on(EVENTS.mistake, () => this._vibe(45)));
  }

  destroy() {
    if (this.el) this.el.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    this._clearPreview();
    this._subs.forEach((off) => off());
    this._subs = [];
  }

  _cellAt(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const b = el && el.closest ? el.closest('.cell') : null;
    return b ? b.dataset.id : null;
  }
  _rc(id) { const c = getCell(this.engine.current().grid, id); return { r: c.row, c: c.col }; }

  // start a rubber-band from ANY cell.
  _onDown(e) {
    const id = this._cellAt(e);
    if (!id) return;
    e.preventDefault();
    this.drag = { start: id, cur: id, area: -1, moved: false };
    this.engine.emit(EVENTS.regionStarted, { from: id });
    this._showPreview();
    this._update(id);
    this._vibe(6);
  }

  _onMove(e) {
    if (!this.drag) return;
    const id = this._cellAt(e);
    if (id) { if (id !== this.drag.start) this.drag.moved = true; this._update(id); }
  }

  _onUp() {
    if (!this.drag) return;
    const { start, cur, moved } = this.drag;
    const rect = this._rect(start, cur);
    this._clearPreview();
    this._setHud('');
    this.drag = null;

    // tap (no drag) on a cell already in a region → clear that region.
    if (!moved) {
      const cell = getCell(this.engine.current().grid, start);
      if (cell && cell.regionId != null) { this.engine.do({ type: 'region-clear', clueId: cell.regionId }); return; }
    }

    // commit the rectangle to its UNIQUE enclosed clue (the game validates area/overlap).
    const clues = this._cluesIn(rect);
    if (clues.length === 1) {
      const ok = this.engine.do({ type: 'region-commit', clueId: clues[0].id, cells: this._cellsIn(rect) });
      this._vibe(ok ? 12 : 40);
    } else {
      this._vibe(40); // 0 or >1 clues — the rectangle is ambiguous; nothing committed
    }
  }

  _update(curId) {
    this.drag.cur = curId;
    const rect = this._rect(this.drag.start, curId);
    const w = rect.c1 - rect.c0 + 1, h = rect.r1 - rect.r0 + 1, area = w * h;
    const clues = this._cluesIn(rect);
    const target = clues.length === 1 ? parseInt(clues[0].value, 10) : null;
    const match = target != null && area === target;
    if (area !== this.drag.area) { this._vibe(match ? [10, 20] : 4); this.drag.area = area; }

    const status = clues.length !== 1 ? 'invalid' : (match ? 'match' : 'ok');
    this.engine.emit(EVENTS.regionPreview, { rect, area, match });
    this._positionPreview(rect, status);
    let note = '';
    if (clues.length === 0) note = ' · no clue';
    else if (clues.length > 1) note = ` · ${clues.length} clues`;
    else if (!match) note = ` · need ${target}`;
    else note = '  ✓';
    this._setHud(`${w} × ${h} = ${area}${note}`, match);
  }

  _rect(aId, bId) {
    const a = this._rc(aId), b = this._rc(bId);
    return { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) };
  }
  _cellsIn(rect) {
    const ids = [];
    for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) ids.push(`r${r}c${c}`);
    return ids;
  }
  _cluesIn(rect) {
    const g = this.engine.current().grid;
    const out = [];
    for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) {
      const cell = getCell(g, `r${r}c${c}`);
      if (cell && cell.role === 'clue') out.push(cell);
    }
    return out;
  }

  _showPreview() {
    if (!this.preview) { this.preview = document.createElement('div'); this.preview.className = 'region-preview'; this.el.appendChild(this.preview); }
    this.preview.hidden = false;
  }
  _positionPreview(rect, status) {
    const b0 = this.board.boxes.get(`r${rect.r0}c${rect.c0}`), b1 = this.board.boxes.get(`r${rect.r1}c${rect.c1}`);
    if (!b0 || !b1 || !this.preview) return;
    this.preview.style.left = Math.min(b0.x, b1.x) + 'px';
    this.preview.style.top = Math.min(b0.y, b1.y) + 'px';
    this.preview.style.width = ((b1.x + b1.w) - b0.x) + 'px';
    this.preview.style.height = ((b1.y + b1.h) - b0.y) + 'px';
    this.preview.classList.toggle('match', status === 'match');
    this.preview.classList.toggle('invalid', status === 'invalid');
  }
  _clearPreview() { if (this.preview) { this.preview.remove(); this.preview = null; } }
  _setHud(text, match) { if (this.hud) { this.hud.textContent = text; this.hud.classList.toggle('match', !!match); } }
  _vibe(p) { if (navigator.vibrate && (!window.__pazoru || window.__pazoru.haptics !== false)) { try { navigator.vibrate(p); } catch (_) {} } }
}

export default RegionDraw;
