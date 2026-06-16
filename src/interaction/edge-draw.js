// src/interaction/edge-draw.js — Slitherlink interaction (§7). Tap or drag along the DOT LATTICE
// (cell corners) to lay/lift loop edges: the pointer position maps to the nearest lattice edge and
// emits { type:'edge', a, b }. Hardened pointer model (active pointerId + pointercancel teardown,
// ignore secondary pointerdowns) so an OS-interrupted touch or a second finger can't strand the drag.

import { EVENTS } from '../core/events.js';

const dotId = (r, c) => `d${r}c${c}`;
const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class EdgeDraw {
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

  // dot-lattice pixel coords from the board's measured cell boxes: xs[0..cols], ys[0..rows].
  _lattice() {
    const g = this.engine.current().grid, boxes = this.board.boxes;
    const { rows, cols } = g;
    const xs = [], ys = [];
    for (let c = 0; c < cols; c++) { const b = boxes.get(`r0c${c}`); if (!b) return null; xs.push(b.x); }
    const lc = boxes.get(`r0c${cols - 1}`); if (!lc) return null; xs.push(lc.x + lc.w);
    for (let r = 0; r < rows; r++) { const b = boxes.get(`r${r}c0`); if (!b) return null; ys.push(b.y); }
    const lr = boxes.get(`r${rows - 1}c0`); if (!lr) return null; ys.push(lr.y + lr.h);
    return { xs, ys, rows, cols };
  }

  // pointer (client coords) → the nearest lattice edge { a, b } (two adjacent dot ids), or null.
  _edgeAt(e) {
    const L = this._lattice(); if (!L) return null;
    const { xs, ys } = L;
    const rect = this.el.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const nearest = (arr, v) => { let bi = 0, bd = Infinity; for (let i = 0; i < arr.length; i++) { const d = Math.abs(arr[i] - v); if (d < bd) { bd = d; bi = i; } } return { i: bi, d: bd }; };
    const seg = (arr, v) => { for (let i = 0; i < arr.length - 1; i++) if (v >= arr[i] && v <= arr[i + 1]) return i; return v < arr[0] ? 0 : arr.length - 2; };
    const rH = nearest(ys, py), cH = seg(xs, px);   // nearest horizontal line + its column segment
    const cV = nearest(xs, px), rV = seg(ys, py);   // nearest vertical line + its row segment
    if (rH.d <= cV.d) return { a: dotId(rH.i, cH), b: dotId(rH.i, cH + 1) };  // horizontal edge
    return { a: dotId(rV, cV.i), b: dotId(rV + 1, cV.i) };                    // vertical edge
  }

  _onDown(e) {
    if (this.drag) return;                          // ignore a second finger mid-drag
    const edge = this._edgeAt(e);
    if (!edge) return;
    const present = !!this.engine.current().loop[edgeKey(edge.a, edge.b)];
    this.drag = { pointerId: e.pointerId, op: present ? 'lift' : 'lay', handled: new Set() };
    this._act(edge);
  }

  _onMove(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const edge = this._edgeAt(e);
    if (edge) this._act(edge);
  }

  _onUp(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this._endDrag();
  }

  _onCancel(e) {
    if (!this.drag || (e && e.pointerId !== this.drag.pointerId)) return;
    this._endDrag();
  }

  _endDrag() { this.drag = null; }

  // toggle `edge` if it matches the drag op and hasn't been acted on yet this drag (lay → add only
  // absent edges; lift → remove only present ones), so a continuous drag lays/lifts a clean path.
  _act(edge) {
    const key = edgeKey(edge.a, edge.b);
    if (this.drag.handled.has(key)) return;
    const present = !!this.engine.current().loop[key];
    const wantPresent = this.drag.op === 'lay';
    this.drag.handled.add(key);
    if (present === wantPresent) return;            // already in the desired state
    const ok = this.engine.do({ type: 'edge', a: edge.a, b: edge.b });
    if (ok) this._vibe(8);
  }

  _vibe(p) { if (navigator.vibrate && (!window.__pazoru || window.__pazoru.haptics !== false)) { try { navigator.vibrate(p); } catch (_) {} } }
}

export default EdgeDraw;
