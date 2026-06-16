// src/interaction/star-place.js — Star Battle interaction (§7). Tap a cell to place/remove a star;
// drag to run a line of them. Cells are real DOM buttons → closest('.cell') / elementFromPoint
// hit-test. Hardened pointer model (active pointerId + pointercancel teardown, ignore secondary
// pointerdowns) like the other drag interactions. Any cell may hold a star (no clue cells here).

import { EVENTS } from '../core/events.js';

export class StarPlace {
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

  _onDown(e) {
    if (this.drag) return;                       // ignore a second finger mid-drag
    const id = this._cellIdFromTarget(e.target);
    if (!id) return;
    const starred = !!this.engine.current().stars[id];
    this.drag = { pointerId: e.pointerId, op: starred ? 'clear' : 'star', handled: new Set() };
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

  _act(id) {
    if (this.drag.handled.has(id)) return;
    this.drag.handled.add(id);
    const starred = !!this.engine.current().stars[id];
    const wantStar = this.drag.op === 'star';
    if (starred === wantStar) return;            // already in the desired state
    const ok = this.engine.do({ type: 'star', id });
    if (ok) this._vibe(8);
  }

  _vibe(p) { if (navigator.vibrate && (!window.__pazoru || window.__pazoru.haptics !== false)) { try { navigator.vibrate(p); } catch (_) {} } }
}

export default StarPlace;
