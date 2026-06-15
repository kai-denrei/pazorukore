// src/interaction/bridge-draw.js — Bridges interaction. Touch-down on an island, drag toward a
// neighbour island (or release on it), release → cycle that pair's bridge count 0→1→2→0 (Tatham's
// click-to-cycle). The target is the island under the finger if collinear+legal, else the first
// legal island in the drag's dominant direction (forgiving flicks). A snapped preview line + island
// highlights show what will connect; the game's validateMove enforces collinear-clear / no-crossing.

import { EVENTS } from '../core/events.js';
import { getCell } from '../core/grid.js';

const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class BridgeDraw {
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
    this._subs.push(this.engine.on(EVENTS.conflictDetected, () => this._vibe(35)));
    this._subs.push(this.engine.on(EVENTS.solved, () => this._vibe([20, 40, 30])));
  }

  destroy() {
    if (this.el) this.el.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    this._clearHighlights(); this._clearPreview();
    this._subs.forEach((off) => off()); this._subs = [];
  }

  _cellAt(e) { const el = document.elementFromPoint(e.clientX, e.clientY); const b = el && el.closest ? el.closest('.cell') : null; return b ? b.dataset.id : null; }
  _island(id) { const c = id && getCell(this.engine.current().grid, id); return (c && c.role === 'clue') ? c : null; }
  _legal(b) { return this.game.validateMove(this.engine.current(), { type: 'bridge', a: this.drag.from, b }); }

  _onDown(e) {
    const id = this._cellAt(e);
    const isl = this._island(id);
    if (!isl) return;
    e.preventDefault();
    this.drag = { from: id, fr: { r: isl.row, c: isl.col }, sx: e.clientX, sy: e.clientY, target: null };
    this._setHl(id, 'from', true);
    this._vibe(6);
  }

  _onMove(e) { if (this.drag) this._setTarget(this._candidate(e)); }

  _onUp(e) {
    if (!this.drag) return;
    const target = this._candidate(e) || this.drag.target;
    const from = this.drag.from;
    this._setHl(from, 'from', false);
    if (this.drag.target) this._setHl(this.drag.target, 'target', false);
    this._clearPreview(); this._setHud('');
    this.drag = null;
    if (target) { const ok = this.engine.do({ type: 'bridge', a: from, b: target }); this._vibe(ok ? 12 : 40); }
  }

  // the target island for the current pointer.
  _candidate(e) {
    const over = this._island(this._cellAt(e));
    const fr = this.drag.fr;
    if (over && over.id !== this.drag.from && (over.row === fr.r || over.col === fr.c) && this._legal(over.id)) return over.id;
    const dx = e.clientX - this.drag.sx, dy = e.clientY - this.drag.sy;
    if (Math.hypot(dx, dy) < 10) return null;
    let dr = 0, dc = 0;
    if (Math.abs(dx) >= Math.abs(dy)) dc = dx > 0 ? 1 : -1; else dr = dy > 0 ? 1 : -1;
    return this._scan(fr, dr, dc);
  }

  // first island from (fr) stepping (dr,dc); return it only if the edge is legal (else null).
  _scan(fr, dr, dc) {
    const grid = this.engine.current().grid;
    let r = fr.r + dr, c = fr.c + dc;
    while (r >= 0 && c >= 0 && r < grid.rows && c < grid.cols) {
      const cell = grid.cells[r * grid.cols + c];
      if (cell && cell.role === 'clue') return this._legal(cell.id) ? cell.id : null;
      r += dr; c += dc;
    }
    return null;
  }

  _setTarget(target) {
    if (target === this.drag.target) { this._positionPreview(target); return; }
    if (this.drag.target) this._setHl(this.drag.target, 'target', false);
    this.drag.target = target;
    if (target) { this._setHl(target, 'target', true); this._setHud(this._hudText(target)); }
    else this._setHud('');
    this._positionPreview(target);
  }

  _hudText(target) {
    const cur = this.engine.current().bridges[edgeKey(this.drag.from, target)] || 0;
    const next = (cur + 1) % 3;
    return `${cur} → ${next} bridge${next === 2 ? 's' : ''}`;
  }

  _setHl(id, cls, on) { const b = this.board.cells.get(id); if (b) b.classList.toggle('is-bridge-' + cls, on); }
  _clearHighlights() { for (const b of this.board.cells.values()) b.classList.remove('is-bridge-from', 'is-bridge-target'); }

  _positionPreview(target) {
    if (!target) { this._clearPreview(); return; }
    const a = this.board.boxes.get(this.drag.from), b = this.board.boxes.get(target);
    if (!a || !b) return;
    if (!this.preview) { this.preview = document.createElement('div'); this.preview.className = 'bridge-preview'; this.el.appendChild(this.preview); }
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
    const horiz = Math.abs(ay - by) < 1;
    const s = this.preview.style;
    if (horiz) { s.left = `${Math.min(ax, bx)}px`; s.top = `${ay - 2.5}px`; s.width = `${Math.abs(bx - ax)}px`; s.height = '5px'; }
    else { s.left = `${ax - 2.5}px`; s.top = `${Math.min(ay, by)}px`; s.width = '5px'; s.height = `${Math.abs(by - ay)}px`; }
  }
  _clearPreview() { if (this.preview) { this.preview.remove(); this.preview = null; } }
  _setHud(text) { if (this.hud) this.hud.textContent = text; }
  _vibe(p) { if (navigator.vibrate && (!window.__pazoru || window.__pazoru.haptics !== false)) { try { navigator.vibrate(p); } catch (_) {} } }
}

export default BridgeDraw;
