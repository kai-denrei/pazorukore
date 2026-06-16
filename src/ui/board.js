// src/ui/board.js — the board renderer (§11.8 diff-and-patch). Layout is owned by CSS (a grid of
// <button> cells); the canvas mirrors it. Two stacked canvases keep the hot path tiny:
//   • grid-layer  — gridlines + region membranes (skin.region.paint); repainted only on resize/region change.
//   • glyph-layer — per-cell glyphs; repainted per changed cell, and per frame ONLY for animating cells.
// An rAF ticker runs solely while ≥1 cell animates, then stops (bounds the hot path to changed cells).

import { EVENTS } from '../core/events.js';
import { getCell } from '../core/grid.js';
import { makeRegionTint } from '../skins/_region-tint.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

// Shared Fillomino value-region tint (skin-agnostic; coloured by the cell value via the skin's
// `tint` palette). Stateless across boards, so a single instance is fine.
const regionTint = makeRegionTint();

export class Board {
  constructor(boardEl, engine, skin) {
    this.el = boardEl;
    this.engine = engine;
    this.skin = skin;
    this.boxes = new Map();       // cellId → {x,y,w,h} in logical px
    this.cells = new Map();       // cellId → button element
    this.anims = new Map();       // cellId → {event, start, duration, payload}
    this.validatedRegions = new Set();
    this._raf = 0;
    this._gridRaf = 0;            // continuous grid-layer pulse loop
    this._subs = [];
    this._ro = null;
  }

  mount() {
    const st = this.engine.current();
    const { rows, cols } = st.grid;
    this.el.classList.add('is-grid');
    this.el.style.setProperty('--rows', rows);
    this.el.style.setProperty('--cols', cols);
    this.el.innerHTML = '';

    // grid + glyph canvases (behind the buttons)
    this.gridCanvas = this._mkCanvas('grid-layer');
    this.glyphCanvas = this._mkCanvas('glyph-layer');
    this.gctx = this.gridCanvas.getContext('2d');
    this.lctx = this.glyphCanvas.getContext('2d');

    // one <button> per cell (hit-testing, a11y, CSS selection ring + plain-tile fills)
    for (const cell of st.grid.cells) {
      const b = document.createElement('button');
      b.className = 'cell';
      b.type = 'button';
      b.dataset.id = cell.id;
      b.dataset.row = cell.row;
      b.dataset.col = cell.col;
      b.setAttribute('role', 'gridcell');
      b.setAttribute('aria-label', `row ${cell.row + 1} column ${cell.col + 1}, empty`);
      this.el.appendChild(b);
      this.cells.set(cell.id, b);
    }

    this._subscribe();
    this._ro = new ResizeObserver(() => this.layout());
    this._ro.observe(this.el);
    this.layout();
    this._startGridPulse();
  }

  _mkCanvas(cls) {
    const cv = document.createElement('canvas');
    cv.className = `board-canvas ${cls}`;
    this.el.appendChild(cv);
    return cv;
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    cancelAnimationFrame(this._gridRaf);
    this._gridRaf = 0;
    this._subs.forEach((off) => off());
    this._subs = [];
    if (this._ro) this._ro.disconnect();
    this.el.innerHTML = '';
    this.el.classList.remove('is-grid');
  }

  // continuously repaint ONLY the grid layer so its lit segments can pulse (throttled ~25fps; the
  // off/ghost lattice is cheap, the few lit region membranes carry the glow). Off under reduced motion.
  _startGridPulse() {
    if (this._gridRaf || !this.skin.region || !this.skin.region.animated) return;
    if (REDUCED.matches || document.body.classList.contains('force-reduced')) return;
    let last = 0;
    const tick = (now) => {
      if (now - last >= 40) { last = now; this.repaintGrid(now); }
      this._gridRaf = requestAnimationFrame(tick);
    };
    this._gridRaf = requestAnimationFrame(tick);
  }

  // measure the real button rects → logical boxes; size both canvases dpr-aware.
  layout() {
    const rect = this.el.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    for (const cv of [this.gridCanvas, this.glyphCanvas]) {
      cv.width = Math.round(rect.width * dpr);
      cv.height = Math.round(rect.height * dpr);
      cv._dpr = dpr;
      cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.boxes.clear();
    for (const [id, b] of this.cells) {
      const r = b.getBoundingClientRect();
      this.boxes.set(id, { x: r.left - rect.left, y: r.top - rect.top, w: r.width, h: r.height });
    }
    if (this.skin.glyph.measure) this._aspect = this.skin.glyph.measure().aspect || 1;
    this.repaintAll();
  }

  geom() {
    const st = this.engine.current();
    return {
      rows: st.grid.rows, cols: st.grid.cols, grid: st.grid,
      boxes: this.boxes, w: this.glyphCanvas.width / this.glyphCanvas._dpr, h: this.glyphCanvas.height / this.glyphCanvas._dpr,
      validated: this.validatedRegions, ui: this.engine.ui,
      box: this.engine.params && this.engine.params.box,
      game: this.engine.game && this.engine.game.meta && this.engine.game.meta.id,
    };
  }

  // repaint only the grid layer (gridlines + region membranes + bridges) at time t.
  repaintGrid(t) {
    if (!this.boxes.size) return;
    const g = this.geom();
    const now = t == null ? performance.now() : t;
    this.gctx.clearRect(0, 0, g.w, g.h);
    if (this.skin.region && this.skin.region.paint) this.skin.region.paint(this.gctx, g, now);
    const st = this.engine.current();
    if (st.bridges && this.skin.bridge && this.skin.bridge.paint) {
      this.skin.bridge.paint(this.gctx, g, st.bridges, { conflicts: this.engine.ui.conflicts, sums: this._bridgeSums(st), t: now });
    }
    // Masyu: the loop renderer draws the closed loop (under) + the pearl squares (over) on the grid layer.
    if (st.loop && this.skin.loop && this.skin.loop.paint) {
      this.skin.loop.paint(this.gctx, g, st.loop, { conflicts: this.engine.ui.conflicts, t: now });
    }
    // Fillomino: colour-code each value-region (flood-filled same-value blob) by its value, using the
    // skin's `tint` palette. Skin-agnostic — painted here so all three skins get it. Updates live
    // because repaintGrid runs on the grid-pulse (futuristic) and on each cell change (see _subscribe).
    if (g.game === 'fillomino' && this.skin.tint) {
      regionTint.paint(this.gctx, g, this.skin.tint);
    }
  }

  // current attached-bridge sum per island id (for the bridge renderer's satisfied/over colouring).
  _bridgeSums(st) {
    const sums = new Map();
    for (const cell of st.grid.cells) if (cell.role === 'clue') sums.set(cell.id, 0);
    for (const [key, count] of Object.entries(st.bridges || {})) {
      if (!count) continue;
      const [a, b] = key.split('|');
      if (sums.has(a)) sums.set(a, sums.get(a) + count);
      if (sums.has(b)) sums.set(b, sums.get(b) + count);
    }
    return sums;
  }

  repaintAll() {
    if (!this.boxes.size) return;
    this.repaintGrid();
    const g = this.geom();
    this.lctx.clearRect(0, 0, g.w, g.h);
    for (const cell of g.grid.cells) this.paintCell(cell.id);
  }

  visualFor(cell) {
    const ui = this.engine.ui;
    const st = this.engine.current();
    return {
      selected: ui.selection === cell.id,
      conflict: ui.conflicts.has(cell.id),
      validated: cell.regionId != null && this.validatedRegions.has(cell.regionId),
      pencil: (st.pencil && st.pencil[cell.id]) || [],
      dim: cell.role === 'fillable' && cell.value == null,
    };
  }

  paintCell(id, anim = null) {
    const box = this.boxes.get(id);
    if (!box) return;
    const cell = getCell(this.engine.current().grid, id);
    if (!cell) return;
    const policy = this.skin.renderPolicy ? this.skin.renderPolicy(cell.role, cell) : 'device';

    // clear just this cell's region on the glyph layer (diff-and-patch)
    this.lctx.clearRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
    this._updateCellChrome(id, cell);
    if (policy !== 'device') return; // plain cells are pure CSS tiles

    const view = this.visualFor(cell);
    this.skin.glyph.paint(this.lctx, box, { value: cell.value, role: cell.role, given: cell.given, row: cell.row, col: cell.col }, view, anim);
  }

  // CSS-side per-cell state (selection ring, plain-tile region fill, aria) — cheap, off-canvas.
  _updateCellChrome(id, cell) {
    const b = this.cells.get(id);
    if (!b) return;
    const view = this.visualFor(cell);
    b.classList.toggle('is-selected', !!view.selected);
    b.classList.toggle('is-conflict', !!view.conflict);
    b.classList.toggle('is-given', !!cell.given);
    b.classList.toggle('is-validated', !!view.validated);
    b.dataset.region = cell.regionId == null ? '' : cell.regionId;
    b.dataset.value = cell.value == null ? '' : cell.value;
    const label = cell.value == null ? 'empty' : `value ${cell.value}`;
    b.setAttribute('aria-label', `row ${cell.row + 1} column ${cell.col + 1}, ${label}`);
  }

  // ── events → repaint / animate ──────────────────────────────────────────────
  _subscribe() {
    const on = (n, fn) => this._subs.push(this.engine.on(n, fn));
    const regionKey = (p) => (p && (p.regionId != null ? p.regionId : p.clueId));
    on(EVENTS.cellChanged, ({ id }) => {
      this.paintCell(id);
      // Fillomino's value-region tint lives on the grid layer and depends on the whole board, so a
      // single cell change can re-shape neighbouring regions. Repaint the grid layer to keep the tint
      // live even on skins whose region renderer isn't animated (retro/pastel don't run a grid-pulse).
      if (this.geom().game === 'fillomino' && this.skin.tint) this.repaintGrid();
    });
    on(EVENTS.selectionChanged, ({ from, to }) => { if (from) this.paintCell(from); if (to) this.paintCell(to); });
    on(EVENTS.regionValidated, (p) => { const k = regionKey(p); if (k != null) this.validatedRegions.add(k); this.repaintAll(); });
    on(EVENTS.regionInvalid, (p) => { const k = regionKey(p); if (k != null) this.validatedRegions.delete(k); this.repaintAll(); });
    on(EVENTS.regionCommitted, () => this.repaintAll());
    on(EVENTS.cellCleared, (p) => { if (p && p.clueId != null) { this.validatedRegions.delete(p.clueId); this.repaintAll(); } });
    on(EVENTS.moved, ({ dir }) => {
      if (dir && dir !== 'do') this.repaintAll();            // undo/redo/restart may move regions/bridges/loop
      else if (this.engine.current().bridges || this.engine.current().loop) this.repaintGrid(); // a bridge/loop 'do' redraws the grid layer
    });

    // semantic events that should ANIMATE their cell(s)
    const animEvents = [EVENTS.cellPlaced, EVENTS.cellCleared, EVENTS.conflictDetected, EVENTS.regionValidated, EVENTS.solved, EVENTS.hintRevealed];
    for (const ev of animEvents) on(ev, (p) => this._animateEvent(ev, p));
  }

  _animateEvent(event, payload) {
    const ids = idsFromPayload(event, payload, this.engine.current());
    if (!ids.length) return;
    const spec = this.skin.glyph.transitionFor ? this.skin.glyph.transitionFor(event, payload) : { duration: 260 };
    if (!spec || REDUCED.matches || document.body.classList.contains('force-reduced')) { ids.forEach((id) => this.paintCell(id)); return; }
    // start is set lazily from the rAF timestamp on the first tick, so it shares the ticker's clock
    // (performance.now() and the rAF timestamp can desync — notably under headless virtual time).
    for (const id of ids) this.anims.set(id, { event, start: null, duration: spec.duration || 260, payload });
    this._startTicker();
  }

  _startTicker() {
    if (this._raf) return;
    const tick = (now) => {
      let alive = false;
      const done = [];
      for (const [id, a] of this.anims) {
        if (a.start == null) a.start = now;       // share the rAF clock (avoids performance.now desync)
        const progress = Math.min(1, (now - a.start) / a.duration);
        this.paintCell(id, { event: a.event, progress, elapsed: now - a.start, payload: a.payload });
        if (progress >= 1) { this.anims.delete(id); done.push(id); } else alive = true;
      }
      for (const id of done) this.paintCell(id);   // clean static repaint of each finished cell
      this._raf = alive ? requestAnimationFrame(tick) : 0;
    };
    this._raf = requestAnimationFrame(tick);
  }
}

// which cells a semantic event animates.
function idsFromPayload(event, payload, state) {
  if (!payload) return [];
  if (event === EVENTS.solved) return state.grid.cells.map((c) => c.id);
  if (payload.id) return [payload.id];
  if (payload.move && payload.move.id) return [payload.move.id];
  if (payload.cells) return payload.cells;
  if (payload.clueId != null) return state.grid.cells.filter((c) => c.regionId === payload.clueId).map((c) => c.id);
  if (payload.hint && payload.hint.id) return [payload.hint.id];
  return [];
}
