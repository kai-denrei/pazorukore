// src/interaction/cell-shade.js — Nurikabe interaction (§7). Tap a cell to shade/unshade it (the
// "sea"); drag to paint a run. Clue cells (islands) can't be shaded. Cells are real DOM buttons so
// hit-testing is a closest('.cell') / elementFromPoint lookup. Hardened pointer model (active
// pointerId + pointercancel teardown, ignore secondary pointerdowns) like the other drag interactions.

import { EVENTS } from '../core/events.js';
import { getCell } from '../core/grid.js';

export class CellShade {
  constructor(board, engine, game, skin) {
    this.board = board; this.engine = engine; this.game = game; this.skin = skin;
    this.el = board.el;
    this.drag = null;
    this._subs = [];
  }

  attach() {
    this._down = (e) => this._onDown(e);
    this._move = (e) => this._onMove(e);
    this._up = (e) => this._onUp(e);
    this._cancel = (e) => this._onCancel(e);
    this.el.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._cancel);
    this._subs.push(this.engine.on(EVENTS.solved, () => this._vibe([20, 40, 20, 40, 80])));
  }

  destroy() {
    if (this.el) this.el.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._cancel);
    this._endDrag();
    this._subs.forEach((off) => off());
    this._subs = [];
  }

  _cellIdFromTarget(t) { const b = t && t.closest ? t.closest('.cell') : null; return b ? b.dataset.id : null; }
  _cellIdAtPoint(e) { const el = document.elementFromPoint(e.clientX, e.clientY); return this._cellIdFromTarget(el); }
  _shadeable(id) { const cell = getCell(this.engine.current().grid, id); return !!cell && cell.role !== 'clue'; }

  _onDown(e) {
    if (this.drag) return;                       // ignore a second finger mid-drag
    const id = this._cellIdFromTarget(e.target);
    if (!id || !this._shadeable(id)) return;
    const shaded = !!this.engine.current().shaded[id];
    this.drag = { pointerId: e.pointerId, op: shaded ? 'unshade' : 'shade', handled: new Set() };
    this._act(id);
  }

  _onMove(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const id = this._cellIdAtPoint(e);
    if (id) this._act(id);
  }

  _onUp(e) { if (!this.drag || e.pointerId !== this.drag.pointerId) return; this._endDrag(); }
  _onCancel(e) { if (!this.drag || (e && e.pointerId !== this.drag.pointerId)) return; this._endDrag(); }
  _endDrag() { this.drag = null; }

  // shade/unshade `id` if it matches the drag op and hasn't been acted on yet this drag.
  _act(id) {
    if (this.drag.handled.has(id)) return;
    this.drag.handled.add(id);
    if (!this._shadeable(id)) return;
    const shaded = !!this.engine.current().shaded[id];
    const wantShaded = this.drag.op === 'shade';
    if (shaded === wantShaded) return;           // already in the desired state
    const ok = this.engine.do({ type: 'shade', id });
    if (ok) this._vibe(8);
  }

  _vibe(p) { if (navigator.vibrate && (!window.__pazoru || window.__pazoru.haptics !== false)) { try { navigator.vibrate(p); } catch (_) {} } }
}

export default CellShade;
