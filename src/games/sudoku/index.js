// src/games/sudoku/index.js — the Sudoku game module (§5 GameModule contract, §12.1).
// Pure logic: no DOM, no rendering, no input. The default export is the `thegame` object the
// engine drives. Heavy logic lives in ./generator.js (build + dig) and ./solver.js (constraint
// solving, uniqueness counting, technique grading); this file is the thin contract adapter that
// maps between the engine's playState ({ grid, pencil }) and the solver's flat Int8Array boards.

import { makeGrid, withCells, getCell, ROLES, cellId, rowCells, colCells, boxCells } from '../../core/grid.js';
import { EVENTS } from '../../core/events.js';
import { makeGeometry, solveBoard, countSolutions } from './solver.js';
import { generate, DIFFICULTIES } from './generator.js';

// --- playState ⇄ flat board bridges ----------------------------------------------------------

// playState.grid → Int8Array (0 = empty, 1..N = digit). Order is row-major, matching geometry.
function gridToBoard(grid) {
  const N = grid.rows;
  const board = new Int8Array(N * N);
  for (let i = 0; i < grid.cells.length; i++) {
    const v = grid.cells[i].value;
    board[i] = v == null ? 0 : parseInt(v, 10);
  }
  return board;
}

const geomFor = (params) => makeGeometry(params.size, params.box, params.size / params.box);

// Build a playState grid from a given-mask + value board. `givenBoard` carries the clues
// (0 = blank), `valueBoard` (optional) carries the current player values for non-given cells.
function buildPlayState(params, givenBoard, valueBoard) {
  const N = params.size;
  const grid = makeGrid(N, N, (r, c) => {
    const i = r * N + c;
    const g = givenBoard[i];
    if (g !== 0) return { role: ROLES.given, value: String(g), given: true };
    const v = valueBoard ? valueBoard[i] : 0;
    return { role: ROLES.fillable, value: v ? String(v) : null, given: false };
  });
  return { grid, pencil: {} };
}

// --- the module ------------------------------------------------------------------------------

const sudoku = {
  meta: {
    id: 'sudoku',
    name: 'Sudoku',
    interaction: 'digit-entry',
    requirements: { glyphSet: 'digits', needsOffState: true, needsRegionFill: false },
  },

  defaultParams() {
    return { seed: 1, size: 9, box: 3, difficulty: 'easy' };
  },

  // newPuzzle(params, rng) → { params, playState, solution }. rng is pre-seeded by the engine.
  newPuzzle(params, rng) {
    const p = { ...this.defaultParams(), ...params };
    const { solution, puzzle } = generate(p, rng);
    const playState = buildPlayState(p, puzzle);
    const solState = buildSolutionState(p, solution);
    return { params: p, playState, solution: solState };
  },

  // Reject edits to given cells; accept place (1..N), clear, pencil on fillable cells only.
  validateMove(playState, move) {
    const cell = getCell(playState.grid, move.id);
    if (!cell) return false;
    if (cell.given) return false;
    if (move.type === 'place') {
      const v = parseInt(move.value, 10);
      return Number.isInteger(v) && v >= 1 && v <= playState.grid.rows;
    }
    return move.type === 'clear' || move.type === 'pencil';
  },

  // PURE: returns a NEW playState, or the SAME object (===) for a no-op so the engine skips it.
  applyMove(playState, move) {
    const cell = getCell(playState.grid, move.id);
    if (!cell || cell.given) return playState;

    if (move.type === 'place') {
      const value = String(move.value);
      if (cell.value === value) return playState;             // no-op
      // placing a value clears any pencil marks on that cell
      const pencil = clearPencil(playState.pencil, move.id);
      return { grid: withCells(playState.grid, [{ id: move.id, value }]), pencil };
    }

    if (move.type === 'clear') {
      if (cell.value == null && !playState.pencil[move.id]) return playState; // no-op
      const pencil = clearPencil(playState.pencil, move.id);
      const grid = cell.value == null ? playState.grid : withCells(playState.grid, [{ id: move.id, value: null }]);
      return { grid, pencil };
    }

    if (move.type === 'pencil') {
      // pencil marks only make sense on an empty cell; ignore if a value is present
      if (cell.value != null) return playState;
      const digit = String(move.value);
      const cur = playState.pencil[move.id] || [];
      const has = cur.includes(digit);
      const next = has ? cur.filter((d) => d !== digit) : [...cur, digit].sort();
      const pencil = { ...playState.pencil };
      if (next.length) pencil[move.id] = next; else delete pencil[move.id];
      return { grid: playState.grid, pencil };
    }

    return playState;
  },

  // Solved iff every cell is filled and there are no conflicts.
  isSolved(playState) {
    for (const c of playState.grid.cells) if (c.value == null) return false;
    return this.findConflicts(playState).length === 0;
  },

  // Ids of cells that duplicate a value within their row, column, or box.
  findConflicts(playState) {
    const grid = playState.grid;
    const N = grid.rows;
    const box = boxFor(N);
    const bad = new Set();

    const scan = (cells) => {
      const seen = new Map();
      for (const c of cells) {
        if (c.value == null) continue;
        if (seen.has(c.value)) { bad.add(c.id); bad.add(seen.get(c.value)); }
        else seen.set(c.value, c.id);
      }
    };
    for (let r = 0; r < N; r++) scan(rowCells(grid, r));
    for (let c = 0; c < N; c++) scan(colCells(grid, c));
    for (let r = 0; r < N; r += box.bh)
      for (let c = 0; c < N; c += box.bw) scan(boxCells(grid, r, c, box.bh, box.bw));

    return [...bad];
  },

  // Self-solve: return a fully-solved playState, or null if unsolvable / contradictory.
  solve(playState) {
    const N = playState.grid.rows;
    const params = { size: N, box: boxFor(N).bw, difficulty: 'easy' };
    const geom = geomFor(params);
    const board = gridToBoard(playState.grid);
    if (hasImmediateConflict(this, playState)) return null;
    const solved = solveBoard(geom, board);
    if (!solved) return null;
    // rebuild a playState: givens stay given; the rest become filled fillable cells
    const grid = makeGrid(N, N, (r, c) => {
      const i = r * N + c;
      const orig = playState.grid.cells[i];
      return orig.given
        ? { role: ROLES.given, value: orig.value, given: true }
        : { role: ROLES.fillable, value: String(solved[i]), given: false };
    });
    return { grid, pencil: {} };
  },

  // Reveal ONE next forced step: an empty, currently-correct cell, filled from the solution.
  hint(playState, solution) {
    const sol = solution || this.solve(stripPlayerValues(playState));
    if (!sol) return null;
    const grid = playState.grid;
    for (let i = 0; i < grid.cells.length; i++) {
      const cell = grid.cells[i];
      if (cell.given) continue;
      const want = sol.grid.cells[i].value;
      if (cell.value == null) {
        return { type: 'place', id: cell.id, value: want };   // forced next placement
      }
    }
    return null;                                              // nothing empty → already solved
  },

  // Map move types → semantic EVENTS (§6). Optional but provided.
  eventsFor(prev, move, next) {
    if (next === prev) return [];
    if (move.type === 'place') return [{ name: EVENTS.cellPlaced, payload: { id: move.id, value: String(move.value) } }];
    if (move.type === 'clear') return [{ name: EVENTS.cellCleared, payload: { id: move.id } }];
    if (move.type === 'pencil') return [{ name: EVENTS.pencilToggled, payload: { id: move.id, value: String(move.value) } }];
    return [];
  },

  // --- serialization (game IDs) -------------------------------------------------------------

  // encodeParams(params, full): "<size>x<box>" always; difficulty appended only when full=true
  // (difficulty is a gen-only field, omitted from non-full game IDs per §12.1).
  encodeParams(params, full) {
    const base = `${params.size}x${params.box}`;
    return full ? `${base}d${diffCode(params.difficulty)}` : base;
  },

  decodeParams(str) {
    const m = /^(\d+)x(\d+)(?:d([emh]))?$/.exec(String(str).trim());
    const d = this.defaultParams();
    if (!m) return d;
    return {
      ...d,
      size: parseInt(m[1], 10) || d.size,
      box: parseInt(m[2], 10) || d.box,
      difficulty: m[3] ? diffFromCode(m[3]) : d.difficulty,
    };
  },

  // encodeDesc: an N²-char givens string — digit for a given, '.' for a blank.
  encodeDesc(playState) {
    let out = '';
    for (const c of playState.grid.cells) out += c.given && c.value != null ? c.value : '.';
    return out;
  },

  // decodeDesc: rebuild the playState grid from a givens string (givens→given, '.'→fillable).
  decodeDesc(params, str) {
    const p = { ...this.defaultParams(), ...params };
    const N = p.size;
    const chars = String(str);
    const grid = makeGrid(N, N, (r, c) => {
      const ch = chars[r * N + c];
      if (ch && ch !== '.' && ch !== '0') return { role: ROLES.given, value: ch, given: true };
      return { role: ROLES.fillable, value: null, given: false };
    });
    return { grid, pencil: {} };
  },
};

// --- helpers ---------------------------------------------------------------------------------

function buildSolutionState(params, solBoard) {
  const N = params.size;
  const grid = makeGrid(N, N, (r, c) => {
    const i = r * N + c;
    return { role: ROLES.given, value: String(solBoard[i]), given: true };
  });
  return { grid, pencil: {} };
}

function clearPencil(pencil, id) {
  if (!pencil[id]) return pencil;
  const next = { ...pencil };
  delete next[id];
  return next;
}

// A playState with all non-given player values stripped, for re-solving from the original clues.
function stripPlayerValues(playState) {
  const grid = withCells(
    playState.grid,
    playState.grid.cells.filter((c) => !c.given && c.value != null).map((c) => ({ id: c.id, value: null })),
  );
  return { grid, pencil: {} };
}

function hasImmediateConflict(mod, playState) {
  return mod.findConflicts(playState).length > 0;
}

// Box geometry for an N×N board: square boxes (3×3 for 9, 2×3 for 6, 2×2 for 4).
function boxFor(N) {
  switch (N) {
    case 4: return { bh: 2, bw: 2 };
    case 6: return { bh: 2, bw: 3 };
    case 9: return { bh: 3, bw: 3 };
    default: { const s = Math.round(Math.sqrt(N)); return { bh: s, bw: s }; }
  }
}

const DIFF_CODES = { easy: 'e', medium: 'm', hard: 'h' };
const DIFF_FROM = { e: 'easy', m: 'medium', h: 'hard' };
const diffCode = (d) => DIFF_CODES[d] || 'e';
const diffFromCode = (c) => DIFF_FROM[c] || 'easy';

export default sudoku;
export { DIFFICULTIES };
