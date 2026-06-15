// src/core/events.js — the semantic event vocabulary + a tiny synchronous emitter.
// The engine emits WHAT HAPPENED (§6); skins decide what it MEANS visually (§8.4).
// The engine never says "animate".

// Semantic events skins map to device-native transitions (§6 / §8.4).
export const EVENTS = Object.freeze({
  selectionChanged: 'selectionChanged',
  cellPlaced: 'cellPlaced',
  cellCleared: 'cellCleared',
  pencilToggled: 'pencilToggled',
  regionStarted: 'regionStarted',
  regionPreview: 'regionPreview',
  regionCommitted: 'regionCommitted',
  regionValidated: 'regionValidated',
  regionInvalid: 'regionInvalid',
  conflictDetected: 'conflictDetected',
  conflictCleared: 'conflictCleared',
  mistake: 'mistake',
  hintRevealed: 'hintRevealed',
  solved: 'solved',
  // engine-internal lifecycle / render-diff signals
  loaded: 'loaded',
  cellChanged: 'cellChanged',   // a single cell's render-relevant state changed (drives diff-and-patch)
  moved: 'moved',               // any do/undo/redo completed (history index changed)
});

// Minimal emitter: synchronous, ordered, with off() and once().
export class Emitter {
  constructor() { this._h = new Map(); }

  on(name, fn) {
    if (!this._h.has(name)) this._h.set(name, new Set());
    this._h.get(name).add(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const wrap = (payload) => { this.off(name, wrap); fn(payload); };
    return this.on(name, wrap);
  }

  off(name, fn) {
    const set = this._h.get(name);
    if (set) set.delete(fn);
  }

  emit(name, payload) {
    const set = this._h.get(name);
    if (!set || set.size === 0) return;
    // copy so handlers can subscribe/unsubscribe during dispatch
    for (const fn of [...set]) fn(payload);
  }

  clear() { this._h.clear(); }
}
