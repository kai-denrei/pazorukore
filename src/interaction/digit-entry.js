// src/interaction/digit-entry.js — Sudoku interaction (§7.1). Translates taps into move
// descriptors (Tatham interpret_move) and owns the selection (uiState, not on the undo chain).
// The numpad (controls.js) calls place/clear/pencil on the selected cell. No native keyboard.

import { EVENTS } from '../core/events.js';
import { getCell } from '../core/grid.js';
import { NumpadPopup } from '../ui/numpad-popup.js';

export class DigitEntry {
  constructor(board, engine, game) {
    this.board = board; this.engine = engine; this.game = game;
    this._subs = [];
    this.pencilMode = false;        // toggled by the controls pencil button
    this.popup = new NumpadPopup();
  }

  attach() {
    this.el = this.board.el;
    this._onDown = (e) => this._tap(e);
    this.el.addEventListener('pointerdown', this._onDown);
    // haptics (feature-detected, degrade silently — §11.5)
    this._subs.push(this.engine.on(EVENTS.conflictDetected, () => this._vibe(35)));
    this._subs.push(this.engine.on(EVENTS.solved, () => this._vibe([20, 40, 20, 40, 80])));
  }

  destroy() {
    if (this.el) this.el.removeEventListener('pointerdown', this._onDown);
    this.popup.hide();
    this._subs.forEach((off) => off());
    this._subs = [];
  }

  _tap(e) {
    const b = e.target.closest('.cell');
    if (!b) return;
    const id = b.dataset.id;
    const cell = getCell(this.engine.current().grid, id);
    if (!cell) return;
    // second tap on an already-selected EDITABLE cell → open the number popup centred on the tap.
    if (this.engine.ui.selection === id && !cell.given) {
      this._openPad(id, e.clientX, e.clientY);
    } else {
      this.select(id);
    }
  }

  _openPad(id, x, y) {
    const st = this.engine.current();
    const counts = new Map();
    for (const c of st.grid.cells) if (c.value != null) counts.set(c.value, (counts.get(c.value) || 0) + 1);
    this.popup.show(x, y, {
      size: st.grid.rows,
      counts,
      pencil: this.pencilMode,
      onPick: (d) => { if (this.pencilMode) this.pencil(d); else this.place(d); },
    });
  }

  select(id) {
    const from = this.engine.ui.selection;
    if (from === id) return;
    this.engine.ui.selection = id;
    this.engine.emit(EVENTS.selectionChanged, { from, to: id });
  }

  place(value) {
    const id = this.engine.ui.selection;
    if (!id) return false;
    const cell = getCell(this.engine.current().grid, id);
    if (!cell || cell.given) return false;
    const ok = this.engine.do({ type: 'place', id, value: String(value) });
    if (ok) this._vibe(8);
    return ok;
  }

  clear() {
    const id = this.engine.ui.selection;
    if (!id) return false;
    const cell = getCell(this.engine.current().grid, id);
    if (!cell || cell.given) return false;
    return this.engine.do({ type: 'clear', id });
  }

  pencil(value) {
    const id = this.engine.ui.selection;
    if (!id) return false;
    const cell = getCell(this.engine.current().grid, id);
    if (!cell || cell.given || cell.value != null) return false;
    const ok = this.engine.do({ type: 'pencil', id, value: String(value) });
    if (ok) this._vibe(6);
    return ok;
  }

  _vibe(p) { if (navigator.vibrate && (!window.__pazoru || window.__pazoru.haptics !== false)) { try { navigator.vibrate(p); } catch (_) {} } }
}

export default DigitEntry;
