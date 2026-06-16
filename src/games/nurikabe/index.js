// src/games/nurikabe/index.js — the Nurikabe game back-end module. Pure logic: no DOM, no rendering,
// no input handling. Default export = the GameModule object. Mirrors the Bridges/Masyu modules: a
// SEPARATE-STATE-OBJECT pattern (playState = grid + a plain-object overlay), a pure toggling
// applyMove, and a bundled verified solution.
//
// Nurikabe: numbered cells are island CLUES (an island's size). The player SHADES every other cell
// into a single connected "sea" so that: (1) the UNSHADED cells form islands — 4-connected groups,
// each containing EXACTLY ONE clue whose value equals the island's size; (2) all SHADED cells form
// ONE 4-connected region; (3) NO 2×2 block is entirely shaded. interaction:'cell-shade'.
//
// playState shape (HARD CONTRACT) = { grid, shaded }.
//   • grid: built by makeGrid. CLUE cells → role ROLES.clue, value String(n) (n = island size ≥ 1),
//           given:true. Every other cell → role ROLES.blank, value:null.
//   • shaded: a PLAIN OBJECT mapping cellId → 1 (absent = unshaded). Cell ids are "r{row}c{col}".
//           Absent cells are OMITTED (never stored as 0). A CLUE cell can never be shaded.

import { makeGrid, getCell, getCellAt, ROLES } from '../../core/grid.js';
import { EVENTS } from '../../core/events.js';
import { generate, presetFor } from './generator.js';
import { solveShade } from './solver.js';

// --- helpers --------------------------------------------------------------------------------

const cellId = (r, c) => `r${r}c${c}`;
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Collect clues { r, c, n } from a playState grid (role clue, integer value).
function cluesOf(grid) {
  const out = [];
  for (const cell of grid.cells) {
    if (cell.role === ROLES.clue) {
      out.push({ r: cell.row, c: cell.col, n: parseInt(cell.value, 10) });
    }
  }
  return out;
}

// Build a blank playState grid from a layout { rows, cols, clues }. Clue anchors get role clue +
// value=String(n) + given. Everything else is a blank cell.
function gridFromLayout(layout) {
  const clueAt = new Map();
  for (const cl of layout.clues) clueAt.set(`${cl.r},${cl.c}`, cl.n);
  return makeGrid(layout.rows, layout.cols, (r, c) => {
    const n = clueAt.get(`${r},${c}`);
    if (n != null) return { role: ROLES.clue, value: String(n), given: true, regionId: null };
    return { role: ROLES.blank, value: null, regionId: null };
  });
}

// Ids of the top-left cell of every fully-shaded 2×2 block — returned as the four cell ids that
// participate in any such block.
function shadedSquares(grid, shaded) {
  const bad = new Set();
  for (let r = 0; r < grid.rows - 1; r++) {
    for (let c = 0; c < grid.cols - 1; c++) {
      const a = cellId(r, c), b = cellId(r + 1, c), d = cellId(r, c + 1), e = cellId(r + 1, c + 1);
      if (shaded[a] && shaded[b] && shaded[d] && shaded[e]) {
        bad.add(a); bad.add(b); bad.add(d); bad.add(e);
      }
    }
  }
  return bad;
}

// --- the module -----------------------------------------------------------------------------

const nurikabe = {
  meta: {
    id: 'nurikabe',
    name: 'Nurikabe',
    interaction: 'cell-shade',
    requirements: { glyphSet: 'digits', needsOffState: false, needsRegionFill: false },
  },

  defaultParams() {
    return { seed: 1, size: 6, difficulty: 'easy' };
  },

  // newPuzzle(params): { params, playState:{grid,shaded:{}}, solution:{grid, shaded} }. Generation is
  // driven by makeGenRng(seed) internally for full reproducibility from a gameId.
  newPuzzle(params /*, rng */) {
    const difficulty = (params && params.difficulty) || this.defaultParams().difficulty;
    const presetSize = presetFor({ difficulty }).size;
    const size = (params && params.size != null) ? params.size : presetSize;
    const p = { ...this.defaultParams(), ...params, difficulty, size };
    const layout = generate(p);
    const blank = gridFromLayout(layout);
    const playState = { grid: blank, shaded: {} };
    // The solution is the generator's own (verified-unique) sea, bundled directly.
    const solution = { grid: blank, shaded: { ...layout.shaded } };
    return {
      params: { ...p, size: layout.rows },
      playState,
      solution,
    };
  },

  // validateMove(state, move): is { type:'shade', id } a LEGAL cell to toggle? Rejects: wrong type,
  // missing/unknown cell, or a CLUE cell (a clue can never be shaded).
  validateMove(state, move) {
    if (!move || move.type !== 'shade' || !move.id) return false;
    const cell = getCell(state.grid, move.id);
    if (!cell) return false;
    if (cell.role === ROLES.clue) return false; // clues are never shaded
    return true;
  },

  // applyMove(state, move): PURE. move = { type:'shade', id } → TOGGLE shaded[id] (present→delete,
  // absent→set 1). Returns a NEW state with a NEW shaded object; returns the SAME state (===) for a
  // no-op (an unknown/illegal move). Never mutates the prior shaded object.
  applyMove(state, move) {
    if (!this.validateMove(state, move)) return state;
    const nextShaded = { ...state.shaded };
    if (nextShaded[move.id]) delete nextShaded[move.id];
    else nextShaded[move.id] = 1;
    return { ...state, shaded: nextShaded };
  },

  // isSolved(state): all three WIN rules hold.
  //   (1) UNSHADED cells form 4-connected islands; each island holds EXACTLY ONE clue whose value
  //       equals the island size;
  //   (2) all SHADED cells form ONE 4-connected region;
  //   (3) NO 2×2 block is entirely shaded.
  isSolved(state) {
    const grid = state.grid;
    const shaded = state.shaded;
    const rows = grid.rows, cols = grid.cols;
    const N = rows * cols;

    const clues = cluesOf(grid);
    if (clues.length === 0) return false;

    // No clue cell may be shaded.
    for (const cell of grid.cells) {
      if (cell.role === ROLES.clue && shaded[cell.id]) return false;
    }

    const isShaded = (r, c) => !!shaded[cellId(r, c)];

    // (3) no fully-shaded 2×2.
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (isShaded(r, c) && isShaded(r + 1, c) && isShaded(r, c + 1) && isShaded(r + 1, c + 1)) return false;
      }
    }

    // Collect shaded and unshaded cells.
    const shadedCells = [];
    const unshadedCells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (isShaded(r, c)) shadedCells.push([r, c]);
        else unshadedCells.push([r, c]);
      }
    }
    // Total shaded must equal N − sum(clue values) — a quick necessary check.
    let clueTotal = 0;
    for (const cl of clues) clueTotal += cl.n;
    if (shadedCells.length !== N - clueTotal) return false;
    if (shadedCells.length === 0) return false; // a real puzzle has some sea

    // (2) sea (shaded) is ONE 4-connected region.
    const seaKey = (r, c) => r * cols + c;
    const seaSet = new Set(shadedCells.map(([r, c]) => seaKey(r, c)));
    {
      const start = shadedCells[0];
      const seen = new Set([seaKey(start[0], start[1])]);
      const stack = [start];
      while (stack.length) {
        const [r, c] = stack.pop();
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const k = seaKey(nr, nc);
          if (seaSet.has(k) && !seen.has(k)) { seen.add(k); stack.push([nr, nc]); }
        }
      }
      if (seen.size !== shadedCells.length) return false;
    }

    // (1) UNSHADED cells form islands, each with exactly ONE clue and size === that clue's value.
    const clueAt = new Map();
    for (const cl of clues) clueAt.set(seaKey(cl.r, cl.c), cl.n);
    const visited = new Set();
    for (const [r0, c0] of unshadedCells) {
      const k0 = seaKey(r0, c0);
      if (visited.has(k0)) continue;
      // flood the island
      const island = [];
      const stack = [[r0, c0]];
      visited.add(k0);
      while (stack.length) {
        const [r, c] = stack.pop();
        island.push([r, c]);
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          if (isShaded(nr, nc)) continue;
          const k = seaKey(nr, nc);
          if (!visited.has(k)) { visited.add(k); stack.push([nr, nc]); }
        }
      }
      // exactly one clue, value === island size
      let clueCount = 0, clueVal = -1;
      for (const [r, c] of island) {
        const v = clueAt.get(seaKey(r, c));
        if (v != null) { clueCount++; clueVal = v; }
      }
      if (clueCount !== 1) return false;
      if (clueVal !== island.length) return false;
    }

    return true;
  },

  // findConflicts(state): cells the board should flash. Cells participating in any fully-shaded 2×2
  // block, plus a clue cell that somehow got shaded (shouldn't happen — validateMove rejects it, but
  // we surface it defensively).
  findConflicts(state) {
    const grid = state.grid;
    const shaded = state.shaded;
    const bad = shadedSquares(grid, shaded);
    for (const cell of grid.cells) {
      if (cell.role === ROLES.clue && shaded[cell.id]) bad.add(cell.id);
    }
    return [...bad];
  },

  // solve(state): the unique solution as a fully-shaded playState { grid, shaded }, or null if
  // unsolvable. Uses the backtracking shade solver.
  solve(state) {
    const grid = state.grid;
    const clues = cluesOf(grid);
    const shaded = solveShade(grid.rows, grid.cols, clues);
    if (!shaded) return null;
    return { grid, shaded };
  },

  // hint(state, solution): a next correct shade move toward the solution. Returns a shade move
  // { type:'shade', id } — a cell that should be shaded in the solution but isn't yet (shade it),
  // else a cell currently shaded that shouldn't be (unshade it). null if nothing is wrong.
  hint(state, solution) {
    const sol = solution || this.solve(state);
    if (!sol) return null;
    const solShaded = sol.shaded;
    const cur = state.shaded;
    // Prefer adding a missing shaded cell (a forward step).
    for (const id of Object.keys(solShaded)) {
      if (!solShaded[id]) continue;
      if (!cur[id]) return { type: 'shade', id };
    }
    // Otherwise remove an extra shaded cell that shouldn't be there.
    for (const id of Object.keys(cur)) {
      if (!cur[id]) continue;
      if (!solShaded[id]) return { type: 'shade', id };
    }
    return null;
  },

  // eventsFor(prev, move, next): map a shade move to EVENTS. Cell shaded → cellPlaced; cell unshaded →
  // cellCleared. payload carries { id, cells:[id] } so the board can repaint that cell.
  eventsFor(prev, move, next) {
    if (prev === next) return [];
    if (!move || move.type !== 'shade') return [];
    const present = !!next.shaded[move.id];
    const name = present ? EVENTS.cellPlaced : EVENTS.cellCleared;
    return [{ name, payload: { id: move.id, cells: [move.id] } }];
  },

  // --- serialization (game IDs) -------------------------------------------------------------

  // encodeParams(params, full): "<size>d<difficulty>" with full=false omitting the gen-only difficulty.
  encodeParams(params, full = true) {
    const p = { ...this.defaultParams(), ...params };
    return full ? `${p.size}d${p.difficulty}` : `${p.size}`;
  },

  decodeParams(str) {
    const m = String(str).match(/^(\d+)(?:d(\w+))?$/);
    const size = m ? parseInt(m[1], 10) : 6;
    const difficulty = (m && m[2]) || 'easy';
    return { seed: 1, size, difficulty };
  },

  // encodeDesc(playState): the clue layout — one char per cell, a clue's digit or '.', row by row,
  // rows separated by '/'. (The desc is the PUZZLE, i.e. the empty board; the shaded sea is the
  // player's solution and is not serialized here.) Clue values are single digits 1..9 for the small
  // boards v1 generates, so no escaping is needed.
  encodeDesc(playState) {
    const grid = playState.grid;
    const rows = [];
    for (let r = 0; r < grid.rows; r++) {
      let s = '';
      for (let c = 0; c < grid.cols; c++) {
        const cell = getCellAt(grid, r, c);
        s += cell.role === ROLES.clue ? cell.value : '.';
      }
      rows.push(s);
    }
    return rows.join('/');
  },

  // decodeDesc(params, str): rebuild the blank playState (clues only, empty shaded) from the desc.
  decodeDesc(params, str) {
    const rowStrs = String(str).split('/');
    const rows = rowStrs.length;
    const cols = rowStrs[0].length;
    const grid = makeGrid(rows, cols, (r, c) => {
      const ch = rowStrs[r][c];
      if (ch && ch !== '.') return { role: ROLES.clue, value: ch, given: true, regionId: null };
      return { role: ROLES.blank, value: null, regionId: null };
    });
    return { grid, shaded: {} };
  },
};

export default nurikabe;
