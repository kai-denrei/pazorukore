// src/games/fillomino/index.js — the Fillomino game module (§5 GameModule contract).
// Pure logic: no DOM, no rendering, no input. The default export is the GameModule the engine
// drives. Heavy logic lives in ./generator.js (partition + dig) and ./solver.js (backtracking
// fill, uniqueness counting); this file is the thin contract adapter mapping between the engine's
// playState ({ grid, pencil }) and the solver's flat Int value grids.
//
// Fillomino is a DIGIT-FILL puzzle: it REUSES the existing 'digit-entry' interaction and digit
// glyph rendering (no new interaction or renderer). Every cell holds a positive integer; the board
// is SOLVED when every cell is filled AND every maximal orthogonally-connected equal-value region
// has size === its value.
//
// playState shape (HARD CONTRACT) = { grid, pencil }. The grid is built by makeGrid; each cell is
//   - a GIVEN (revealed clue): role ROLES.given, value String(n), given:true.
//   - a player cell:           role ROLES.fillable, value null (or String(n) when filled), given:false.
// value is ALWAYS a string or null. pencil is the candidate-mark map ({}).

import { makeGrid, withCells, getCell, ROLES } from '../../core/grid.js';
import { EVENTS } from '../../core/events.js';
import { countSolutions, solveFill, isValidFill, overgrownCells } from './solver.js';
import { generate, presetFor } from './generator.js';

// --- playState ⇄ flat board bridges ----------------------------------------------------------

// playState.grid → flat Int value grid (0 = empty, n = digit). Row-major.
function gridToVals(grid) {
  const N = grid.rows * grid.cols;
  const vals = new Array(N).fill(0);
  for (let i = 0; i < grid.cells.length; i++) {
    const v = grid.cells[i].value;
    vals[i] = v == null ? 0 : parseInt(v, 10);
  }
  return vals;
}

// Givens (flat clue values, 0 = blank) → blank player playState.
function buildPlayState(rows, cols, givens) {
  const grid = makeGrid(rows, cols, (r, c) => {
    const g = givens[r * cols + c];
    if (g && g > 0) return { role: ROLES.given, value: String(g), given: true };
    return { role: ROLES.fillable, value: null, given: false };
  });
  return { grid, pencil: {} };
}

// Full solution value grid (givens marked given, the rest filled fillable) → solved playState.
function buildSolutionState(rows, cols, solution, givens) {
  const grid = makeGrid(rows, cols, (r, c) => {
    const i = r * cols + c;
    const isGiven = givens && givens[i] > 0;
    return isGiven
      ? { role: ROLES.given, value: String(solution[i]), given: true }
      : { role: ROLES.fillable, value: String(solution[i]), given: false };
  });
  return { grid, pencil: {} };
}

function clearPencil(pencil, id) {
  if (!pencil[id]) return pencil;
  const next = { ...pencil };
  delete next[id];
  return next;
}

// --- the module ------------------------------------------------------------------------------

const fillomino = {
  meta: {
    id: 'fillomino',
    name: 'Fillomino',
    interaction: 'digit-entry',
    requirements: { glyphSet: 'digits', needsOffState: true, needsRegionFill: false },
  },

  defaultParams() {
    return { seed: 1, size: 7, difficulty: 'easy' };
  },

  // newPuzzle(params, rng) → { params, playState, solution }. rng is accepted for signature parity
  // with the engine; generation is seeded deterministically from params.seed inside generate().
  newPuzzle(params, rng) {
    const p = { ...this.defaultParams(), ...params };
    const { size } = presetFor(p);
    const out = generate({ ...p, size });
    const playState = buildPlayState(out.rows, out.cols, out.givens);
    const solution = buildSolutionState(out.rows, out.cols, out.solution, out.givens);
    return { params: { ...p, size: out.rows }, playState, solution };
  },

  // Reject edits to given cells; accept place (1..rows), clear, pencil on fillable cells only.
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

  // Solved iff every cell is filled AND every maximal equal-value region size === its value.
  isSolved(playState) {
    const grid = playState.grid;
    for (const c of grid.cells) if (c.value == null) return false;
    return isValidFill(grid.rows, grid.cols, gridToVals(grid));
  },

  // Ids of cells whose connected equal-value region SIZE EXCEEDS its value (over-grown regions).
  findConflicts(playState) {
    const grid = playState.grid;
    const vals = gridToVals(grid);
    const flat = overgrownCells(grid.rows, grid.cols, vals);
    return flat.map((idx) => grid.cells[idx].id);
  },

  // Self-solve: return a fully-filled playState (givens preserved), or null if unsolvable.
  solve(playState) {
    const grid = playState.grid;
    const rows = grid.rows, cols = grid.cols;
    // Solve from the GIVENS only (ignore player-entered values), so solve() always reaches the
    // intended unique solution regardless of the player's partial/incorrect entries.
    const givens = new Array(rows * cols).fill(0);
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i].given) givens[i] = parseInt(grid.cells[i].value, 10);
    }
    const filled = solveFill(rows, cols, givens);
    if (!filled) return null;
    const out = makeGrid(rows, cols, (r, c) => {
      const i = r * cols + c;
      const orig = grid.cells[i];
      return orig.given
        ? { role: ROLES.given, value: orig.value, given: true }
        : { role: ROLES.fillable, value: String(filled[i]), given: false };
    });
    return { grid: out, pencil: {} };
  },

  // Reveal ONE next forced step: an empty, currently-correct cell, filled from the solution.
  hint(playState, solution) {
    const sol = solution || this.solve(playState);
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

  // Map move types → semantic EVENTS (§6).
  eventsFor(prev, move, next) {
    if (next === prev) return [];
    if (move.type === 'place') return [{ name: EVENTS.cellPlaced, payload: { id: move.id, value: String(move.value) } }];
    if (move.type === 'clear') return [{ name: EVENTS.cellCleared, payload: { id: move.id } }];
    if (move.type === 'pencil') return [{ name: EVENTS.pencilToggled, payload: { id: move.id, value: String(move.value) } }];
    return [];
  },

  // --- serialization (game IDs) -------------------------------------------------------------

  // encodeParams(params, full): "<size>" always; difficulty appended as "d<difficulty>" when full.
  encodeParams(params, full) {
    const base = `${params.size || this.defaultParams().size}`;
    return full ? `${base}d${params.difficulty || 'easy'}` : base;
  },

  decodeParams(str) {
    const m = /^(\d+)(?:d([a-z]+))?$/.exec(String(str).trim());
    const d = this.defaultParams();
    if (!m) return d;
    return {
      ...d,
      size: parseInt(m[1], 10) || d.size,
      difficulty: m[2] || d.difficulty,
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

export default fillomino;
export { generate, presetFor };
