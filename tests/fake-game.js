// tests/fake-game.js — a trivial 2×2 "fill the grid, no repeats in a row" game used to exercise
// the engine in isolation (§15 M1: "Unit-testable with a trivial fake game"). Implements the §5
// GameModule contract minimally.

import { makeGrid, withCells, getCell, ROLES, rowCells } from '../src/core/grid.js';
import { EVENTS } from '../src/core/events.js';

export const fakeGame = {
  meta: {
    id: 'fake',
    name: 'Fake',
    interaction: 'digit-entry',
    requirements: { glyphSet: 'digits', needsOffState: true, needsRegionFill: false },
  },

  defaultParams: () => ({ seed: 1, size: 2 }),

  newPuzzle(params) {
    const grid = makeGrid(params.size, params.size, () => ({ role: ROLES.fillable, value: null }));
    return { params, playState: { grid, pencil: {} }, solution: null };
  },

  validateMove(state, move) {
    const cell = getCell(state.grid, move.id);
    return !!cell && !cell.given;
  },

  applyMove(state, move) {
    if (move.type === 'place') {
      return { ...state, grid: withCells(state.grid, [{ id: move.id, value: String(move.value) }]) };
    }
    if (move.type === 'clear') {
      return { ...state, grid: withCells(state.grid, [{ id: move.id, value: null }]) };
    }
    return state;
  },

  isSolved(state) {
    return state.grid.cells.every((c) => c.value != null) && this.findConflicts(state).length === 0;
  },

  findConflicts(state) {
    const bad = new Set();
    for (let r = 0; r < state.grid.rows; r++) {
      const seen = new Map();
      for (const c of rowCells(state.grid, r)) {
        if (c.value == null) continue;
        if (seen.has(c.value)) { bad.add(c.id); bad.add(seen.get(c.value)); }
        else seen.set(c.value, c.id);
      }
    }
    return [...bad];
  },

  eventsFor(prev, move, next) {
    if (move.type === 'place') return [{ name: EVENTS.cellPlaced, payload: { id: move.id, value: move.value } }];
    if (move.type === 'clear') return [{ name: EVENTS.cellCleared, payload: { id: move.id } }];
    return [];
  },

  encodeParams: (p) => `${p.size}`,
  decodeParams: (s) => ({ seed: 1, size: parseInt(s, 10) || 2 }),
  encodeDesc: () => 'empty',
  decodeDesc(params) { return this.newPuzzle(params).playState; },
};
