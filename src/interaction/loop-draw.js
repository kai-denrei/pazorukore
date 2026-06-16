// src/interaction/loop-draw.js — Masyu / Pearl interaction. The player drags across orthogonally
// adjacent cells to lay (draw) or lift (erase) loop segments. The OP is decided lazily from the
// FIRST edge the drag crosses: if that edge is currently absent ⇒ 'lay'; if present ⇒ 'lift'. A
// continuous drag then keeps laying/lifting a path as the pointer enters new neighbour cells.
//
// The model mirrors bridge-draw's hardened single-pointer discipline verbatim: the active pointerId
// lives on this.drag, secondary pointerdowns are ignored while a drag is live, pointermove/up are
// guarded by pointerId, and a window 'pointercancel' (plus destroy) tears the gesture down cleanly.
//
// Each edge is a key over its two ORTHOGONALLY-ADJACENT cell ids (sorted+joined). We act at most
// once per edge per drag (this.drag.handled Set), and only when the edge matches the chosen op.
// engine.do({ type:'loop', a, b }) validates + applies (toggles) + emits.

import { EVENTS } from '../core/events.js';
import { getCell } from '../core/grid.js';

const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class LoopDraw {
  constructor(board, engine, game, skin) {
    this.board = board; this.engine = engine; this.game = game; this.skin = skin;
    this._subs = []; this.drag = null;
  }

  attach() {
    this.el = this.board.el;
    this._down = (e) => this._onDown(e);
    this._move = (e) => this._onMove(e);
    this._up = (e) => this._onUp(e);
    this._cancel = (e) => this._onCancel(e);
    this.el.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._cancel);
    this._subs.push(this.engine.on(EVENTS.conflictDetected, () => this._vibe(35)));
    this._subs.push(this.engine.on(EVENTS.solved, () => this._vibe([20, 40, 30])));
  }

  destroy() {
    if (this.el) this.el.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._cancel);
    this._endDrag();
    this._subs.forEach((off) => off()); this._subs = [];
  }

  // single-pointer discipline: clear any in-progress drag's visuals + state.
  _endDrag() {
    this._clearHighlights();
    this.drag = null;
  }
  _onCancel(e) { if (this.drag && (!e || e.pointerId === this.drag.pointerId)) this._endDrag(); }

  // the cell id under the pointer (same hit-test as bridge-draw: elementFromPoint → nearest .cell).
  _cellAt(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const b = el && el.closest ? el.closest('.cell') : null;
    return b ? b.dataset.id : null;
  }
  _cell(id) { return id && getCell(this.engine.current().grid, id); }

  // are two cell ids orthogonally adjacent (share an edge)?
  _adjacent(a, b) {
    const ca = this._cell(a), cb = this._cell(b);
    if (!ca || !cb) return false;
    const dr = Math.abs(ca.row - cb.row), dc = Math.abs(ca.col - cb.col);
    return dr + dc === 1;
  }

  _edgePresent(a, b) { return (this.engine.current().loop || {})[edgeKey(a, b)] === 1; }

  _onDown(e) {
    if (this.drag) return;                 // ignore secondary pointers while a drag is active
    const id = this._cellAt(e);
    if (!id || !this._cell(id)) return;
    e.preventDefault();
    // op is undecided until the first edge is crossed (lazy from the first absent/present edge).
    this.drag = { anchor: id, op: null, handled: new Set(), pointerId: e.pointerId };
    this._setHl(id, true);
    this._vibe(6);
  }

  _onMove(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const id = this._cellAt(e);
    if (!id || id === this.drag.anchor) return;
    const anchor = this.drag.anchor;
    if (!this._adjacent(anchor, id)) {
      // a fast diagonal/long jump landed off-path — re-seat the anchor without acting.
      this._reseat(id);
      return;
    }
    const key = edgeKey(anchor, id);
    if (!this.drag.handled.has(key)) {
      this.drag.handled.add(key);
      const present = this._edgePresent(anchor, id);
      if (this.drag.op == null) this.drag.op = present ? 'lift' : 'lay'; // decide op from first edge
      const wantPresent = this.drag.op === 'lift'; // lift acts on present edges, lay on absent ones
      if (present === wantPresent) {
        const ok = this.engine.do({ type: 'loop', a: anchor, b: id }); // validate + toggle + emit
        this._vibe(ok ? 10 : 30);
      }
    }
    this._reseat(id); // advance so a continuous drag lays/lifts a contiguous path
  }

  _onUp(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this._endDrag();
  }

  _reseat(id) {
    if (this.drag.anchor === id) return;
    this._setHl(this.drag.anchor, false);
    this.drag.anchor = id;
    this._setHl(id, true);
  }

  _setHl(id, on) { const b = this.board.cells.get(id); if (b) b.classList.toggle('is-loop-anchor', on); }
  _clearHighlights() { for (const b of this.board.cells.values()) b.classList.remove('is-loop-anchor'); }

  _vibe(p) { if (navigator.vibrate && (!window.__pazoru || window.__pazoru.haptics !== false)) { try { navigator.vibrate(p); } catch (_) {} } }
}

export default LoopDraw;
