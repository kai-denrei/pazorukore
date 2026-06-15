// src/core/engine.js — the game-agnostic mid-end (§6).
// Owns: the append-only immutable playState list (universal undo, Tatham §3), the semantic
// event bus, conflict reconciliation, and game-ID round-trips. Knows nothing about DOM,
// rendering, or input. The engine emits WHAT HAPPENED; skins decide what it means (§8.4).

import { Emitter, EVENTS } from './events.js';
import { gridDiff } from './grid.js';
import { makeGenRng, seedFromString, freshSeed } from './rng.js';

// Default move.type → semantic event when a game doesn't supply its own eventsFor().
const DEFAULT_MOVE_EVENTS = {
  place: EVENTS.cellPlaced,
  clear: EVENTS.cellCleared,
  pencil: EVENTS.pencilToggled,
  'region-commit': EVENTS.regionCommitted,
  'region-clear': EVENTS.cellCleared,
};

// Diff two pencil maps ({id:[digits]}) → ids whose candidate set changed.
function pencilDiff(prev, next) {
  if (prev === next) return [];
  const ids = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  const out = [];
  for (const id of ids) {
    const a = (prev && prev[id]) || [], b = (next && next[id]) || [];
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) out.push(id);
  }
  return out;
}

export class Engine {
  constructor() {
    this.bus = new Emitter();
    this.game = null;
    this.params = null;
    this.solution = null;
    this.puzzleDesc = null;     // the generated instance, for gameId (Tatham desc)
    this.history = [];          // immutable playState snapshots
    this.index = -1;
    this.ui = freshUiState();
  }

  on(name, fn) { return this.bus.on(name, fn); }
  off(name, fn) { this.bus.off(name, fn); }
  emit(name, payload) { this.bus.emit(name, payload); }

  // load(game, paramsOrGameId): build the initial position, reset the undo list.
  load(game, paramsOrGameId) {
    this.game = game;
    let params, playState, solution, seed;

    if (typeof paramsOrGameId === 'string' && paramsOrGameId.includes(':')) {
      // a full game-ID: "<encodedParams>:<encodedDesc>"
      const [pStr, descStr] = splitGameId(paramsOrGameId);
      params = game.decodeParams(pStr);
      playState = game.decodeDesc(params, descStr);
      solution = game.solve ? game.solve(playState) : null;
    } else {
      params = (paramsOrGameId && typeof paramsOrGameId === 'object')
        ? paramsOrGameId
        : game.defaultParams();
      seed = params.seed != null ? params.seed : freshSeed();
      params = { ...params, seed };
      const rng = makeGenRng(seed);
      const built = game.newPuzzle(params, rng);
      params = built.params || params;
      playState = built.playState;
      solution = built.solution || null;
    }

    this.params = params;
    this.solution = solution;
    this.puzzleDesc = game.encodeDesc ? game.encodeDesc(playState) : null;
    this.history = [playState];
    this.index = 0;
    this.ui = freshUiState();
    this._reconcileConflicts(playState, true);
    this.emit(EVENTS.loaded, { state: playState, params });
    return playState;
  }

  current() { return this.history[this.index]; }
  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.history.length - 1; }

  // interpret_move already happened in the interaction layer; do() runs execute_move.
  do(move) {
    const prev = this.current();
    if (this.game.validateMove && !this.game.validateMove(prev, move)) {
      this.emit(EVENTS.mistake, { move, state: prev });
      return false;
    }
    const next = this.game.applyMove(prev, move);
    if (!next || next === prev) return false;     // no-op move

    // truncate any redo branch, push, advance
    if (this.index < this.history.length - 1) this.history.length = this.index + 1;
    this.history.push(next);
    this.index++;

    this._emitDiff(prev, next);
    const events = this.game.eventsFor
      ? this.game.eventsFor(prev, move, next)
      : defaultEvents(move);
    for (const e of events) this.emit(e.name, e.payload);
    this._reconcileConflicts(next);
    if (this.game.isSolved(next)) this.emit(EVENTS.solved, { state: next });
    this.emit(EVENTS.moved, { state: next, move, dir: 'do' });
    return true;
  }

  undo() {
    if (!this.canUndo()) return false;
    const prev = this.current();
    this.index--;
    const next = this.current();
    this._emitDiff(prev, next);
    this._reconcileConflicts(next);
    this.emit(EVENTS.moved, { state: next, dir: 'undo' });
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    const prev = this.current();
    this.index++;
    const next = this.current();
    this._emitDiff(prev, next);
    this._reconcileConflicts(next);
    if (this.game.isSolved(next)) this.emit(EVENTS.solved, { state: next });
    this.emit(EVENTS.moved, { state: next, dir: 'redo' });
    return true;
  }

  // Back to move 0; keep uiState (Tatham). History is preserved so redo still works.
  restart() {
    if (this.index === 0) return false;
    const prev = this.current();
    this.index = 0;
    const next = this.current();
    this._emitDiff(prev, next);
    this._reconcileConflicts(next);
    this.emit(EVENTS.moved, { state: next, dir: 'restart' });
    return true;
  }

  // Reveal the next forced cell/region using the game's own solver (§12.3 hints reuse solve()).
  hint() {
    if (!this.game.hint) return null;
    const h = this.game.hint(this.current(), this.solution);
    if (h) {
      this.ui.hintCount++;
      this.emit(EVENTS.hintRevealed, { hint: h, state: this.current() });
      this.do(h);   // reveal the forced step by actually applying it (Tatham hints reuse solve())
    }
    return h;
  }

  // params + specific-instance desc → shareable game-ID (Tatham game-ID serialization).
  gameId() {
    const p = this.game.encodeParams(this.params, true);
    return this.puzzleDesc != null ? `${p}:${this.puzzleDesc}` : p;
  }

  // --- internals ---

  _emitDiff(prev, next) {
    for (const id of gridDiff(prev.grid, next.grid)) this.emit(EVENTS.cellChanged, { id, state: next });
    for (const id of pencilDiff(prev.pencil, next.pencil)) this.emit(EVENTS.cellChanged, { id, state: next, pencil: true });
  }

  // Recompute conflicts; emit conflictDetected for new ones, conflictCleared for resolved ones.
  _reconcileConflicts(state, silent) {
    const next = new Set(this.game.findConflicts ? this.game.findConflicts(state) : []);
    const prev = this.ui.conflicts;
    if (!silent) {
      for (const id of next) if (!prev.has(id)) this.emit(EVENTS.conflictDetected, { id, state });
      for (const id of prev) if (!next.has(id)) this.emit(EVENTS.conflictCleared, { id, state });
    }
    this.ui.conflicts = next;
  }
}

function freshUiState() {
  return { selection: null, conflicts: new Set(), hintCount: 0, drag: null, lastEvent: null };
}

function defaultEvents(move) {
  const name = DEFAULT_MOVE_EVENTS[move && move.type];
  if (!name) return [];
  return [{ name, payload: { move } }];
}

function splitGameId(id) {
  const i = id.indexOf(':');
  return i < 0 ? [id, ''] : [id.slice(0, i), id.slice(i + 1)];
}

export { seedFromString };
