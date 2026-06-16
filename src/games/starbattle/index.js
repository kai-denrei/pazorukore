// src/games/starbattle/index.js — the Star Battle game back-end module. Pure logic: no DOM, no
// rendering, no input handling. Default export = the GameModule object. Mirrors the
// Nurikabe/Bridges modules: a SEPARATE-STATE-OBJECT pattern (playState = grid + a plain-object
// overlay), a pure toggling applyMove, and a bundled verified solution.
//
// Star Battle: an N×N grid is partitioned into N connected REGIONS (the only structure — NO number
// clues). Place stars so EVERY row, EVERY column, and EVERY region has exactly K stars, and NO two
// stars are 8-adjacent (king move). v1 uses K=1. interaction:'star-place'.
//
// playState shape (HARD CONTRACT) = { grid, stars }.
//   • grid: built by makeGrid. EVERY cell → role ROLES.member, value:null, regionId:<0..N-1> (the
//           region it belongs to). Regions are the only structure; there are NO clue cells.
//   • stars: a PLAIN OBJECT mapping cellId → 1 (absent = no star). Cell ids are "r{row}c{col}".
//           Absent cells are OMITTED (never stored as 0).

import { makeGrid, getCell, getCellAt, ROLES } from '../../core/grid.js';
import { EVENTS } from '../../core/events.js';
import { generate, presetFor } from './generator.js';
import { solveStars } from './solver.js';

// --- helpers --------------------------------------------------------------------------------

const cellId = (r, c) => `r${r}c${c}`;
// 8 king-move directions for the adjacency rule.
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

// The K (stars per row/col/region) for a state — from params if known, else default 1.
function kOf(state) {
  return (state && state.k) || 1;
}

// Build a blank playState grid from a flat regionOf array. Every cell is a region MEMBER carrying
// its region id; no clues.
function gridFromRegionOf(rows, cols, regionOf) {
  return makeGrid(rows, cols, (r, c) => ({
    role: ROLES.member,
    value: null,
    regionId: regionOf[r * cols + c],
  }));
}

// Collect, per row / column / region, the count of stars; plus the list of starred cells. Used by
// isSolved and findConflicts.
function tallies(grid, stars) {
  const rows = grid.rows, cols = grid.cols;
  const rowCount = new Array(rows).fill(0);
  const colCount = new Array(cols).fill(0);
  const regionCount = new Map(); // regionId -> count
  const starCells = [];
  for (const cell of grid.cells) {
    if (!stars[cell.id]) continue;
    rowCount[cell.row]++;
    colCount[cell.col]++;
    regionCount.set(cell.regionId, (regionCount.get(cell.regionId) || 0) + 1);
    starCells.push(cell);
  }
  return { rowCount, colCount, regionCount, starCells };
}

// Ids of starred cells that are 8-adjacent to another starred cell.
function adjacencyConflicts(grid, stars) {
  const bad = new Set();
  for (const cell of grid.cells) {
    if (!stars[cell.id]) continue;
    for (const [dr, dc] of KING) {
      const nr = cell.row + dr, nc = cell.col + dc;
      if (nr < 0 || nc < 0 || nr >= grid.rows || nc >= grid.cols) continue;
      if (stars[cellId(nr, nc)]) { bad.add(cell.id); bad.add(cellId(nr, nc)); }
    }
  }
  return bad;
}

// All distinct region ids present in the grid.
function regionIds(grid) {
  const set = new Set();
  for (const cell of grid.cells) set.add(cell.regionId);
  return [...set];
}

// regionOf flat array (r*cols + c -> regionId) from a grid.
function regionOfFromGrid(grid) {
  const arr = new Array(grid.rows * grid.cols);
  for (const cell of grid.cells) arr[cell.row * grid.cols + cell.col] = cell.regionId;
  return arr;
}

// --- the module -----------------------------------------------------------------------------

const starbattle = {
  meta: {
    id: 'starbattle',
    name: 'Star Battle',
    interaction: 'star-place',
    requirements: { glyphSet: 'digits', needsOffState: false, needsRegionFill: false },
  },

  defaultParams() {
    return { seed: 1, size: 6, difficulty: 'easy', stars: 1 };
  },

  // newPuzzle(params): { params, playState:{grid, stars:{}}, solution:{grid, stars} }. Generation is
  // driven by makeGenRng(seed) internally for full reproducibility from a gameId.
  newPuzzle(params /*, rng */) {
    const difficulty = (params && params.difficulty) || this.defaultParams().difficulty;
    const presetSize = presetFor({ difficulty }).size;
    const size = (params && params.size != null) ? params.size : presetSize;
    const p = { ...this.defaultParams(), ...params, difficulty, size };
    const layout = generate(p);
    const blank = gridFromRegionOf(layout.rows, layout.cols, layout.regionOf);
    const k = layout.k || 1;
    const playState = { grid: blank, stars: {}, k };
    // The solution is the generator's own (verified-unique) star set, bundled directly.
    const solution = { grid: blank, stars: { ...layout.stars }, k };
    return {
      params: { ...p, size: layout.rows, stars: k },
      playState,
      solution,
    };
  },

  // validateMove(state, move): is { type:'star', id } a real cell to toggle? Rejects wrong type,
  // missing id, or unknown cell.
  validateMove(state, move) {
    if (!move || move.type !== 'star' || !move.id) return false;
    const cell = getCell(state.grid, move.id);
    if (!cell) return false;
    return true;
  },

  // applyMove(state, move): PURE. move = { type:'star', id } → TOGGLE stars[id] (present→delete,
  // absent→set 1). Returns a NEW state with a NEW stars object; returns the SAME state (===) for a
  // no-op (an unknown/illegal move). Never mutates the prior stars object.
  applyMove(state, move) {
    if (!this.validateMove(state, move)) return state;
    const nextStars = { ...state.stars };
    if (nextStars[move.id]) delete nextStars[move.id];
    else nextStars[move.id] = 1;
    return { ...state, stars: nextStars };
  },

  // isSolved(state): exactly K stars in every row, every column, and every region; and no two stars
  // 8-adjacent.
  isSolved(state) {
    const grid = state.grid;
    const stars = state.stars;
    const k = kOf(state);
    const rows = grid.rows, cols = grid.cols;

    const { rowCount, colCount, regionCount, starCells } = tallies(grid, stars);
    // total stars must be k per row → k*rows total (also = k per col / region).
    if (starCells.length !== k * rows) return false;
    for (let r = 0; r < rows; r++) if (rowCount[r] !== k) return false;
    for (let c = 0; c < cols; c++) if (colCount[c] !== k) return false;
    for (const g of regionIds(grid)) {
      if ((regionCount.get(g) || 0) !== k) return false;
    }
    // no two stars 8-adjacent
    if (adjacencyConflicts(grid, stars).size > 0) return false;
    return true;
  },

  // findConflicts(state): cells the board should flash. Any cell in a row/col/region that EXCEEDS k
  // stars (the over-full line/region's starred cells), plus any two 8-adjacent stars.
  findConflicts(state) {
    const grid = state.grid;
    const stars = state.stars;
    const k = kOf(state);
    const { rowCount, colCount, regionCount, starCells } = tallies(grid, stars);
    const bad = new Set();

    for (const cell of starCells) {
      if (rowCount[cell.row] > k) bad.add(cell.id);
      if (colCount[cell.col] > k) bad.add(cell.id);
      if ((regionCount.get(cell.regionId) || 0) > k) bad.add(cell.id);
    }
    for (const id of adjacencyConflicts(grid, stars)) bad.add(id);
    return [...bad];
  },

  // solve(state): the unique solution as a fully-starred playState { grid, stars }, or null if
  // unsolvable. Uses the backtracking star solver over the grid's regions.
  solve(state) {
    const grid = state.grid;
    const k = kOf(state);
    const regionOf = regionOfFromGrid(grid);
    const stars = solveStars(grid.rows, grid.cols, regionOf, k);
    if (!stars) return null;
    return { grid, stars, k };
  },

  // hint(state, solution): a next correct star move toward the solution. Prefer adding a missing
  // star; otherwise remove an extra star that shouldn't be there. null if nothing is wrong.
  hint(state, solution) {
    const sol = solution || this.solve(state);
    if (!sol) return null;
    const solStars = sol.stars;
    const cur = state.stars;
    for (const id of Object.keys(solStars)) {
      if (!cur[id]) return { type: 'star', id };
    }
    for (const id of Object.keys(cur)) {
      if (!solStars[id]) return { type: 'star', id };
    }
    return null;
  },

  // eventsFor(prev, move, next): map a star move to EVENTS. Star added → cellPlaced; star removed →
  // cellCleared. payload carries { id, cells:[id] } so the board can repaint that cell.
  eventsFor(prev, move, next) {
    if (prev === next) return [];
    if (!move || move.type !== 'star') return [];
    const present = !!next.stars[move.id];
    const name = present ? EVENTS.cellPlaced : EVENTS.cellCleared;
    return [{ name, payload: { id: move.id, cells: [move.id] } }];
  },

  // --- serialization (game IDs) -------------------------------------------------------------

  // encodeParams(params, full): "<size>d<difficulty>" with full=false omitting the gen-only
  // difficulty. K is fixed at 1 for v1 so it is not serialized.
  encodeParams(params, full = true) {
    const p = { ...this.defaultParams(), ...params };
    return full ? `${p.size}d${p.difficulty}` : `${p.size}`;
  },

  decodeParams(str) {
    const m = String(str).match(/^(\d+)(?:d(\w+))?$/);
    const size = m ? parseInt(m[1], 10) : 6;
    const difficulty = (m && m[2]) || 'easy';
    return { seed: 1, size, difficulty, stars: 1 };
  },

  // encodeDesc(playState): the REGION layout — one char per cell = region id in base36, rows joined
  // '/'. (The desc is the PUZZLE, i.e. the empty board's region partition; the stars are the
  // player's/solution's answer and are not serialized here.) For v1 sizes (≤ 7 regions) the ids fit
  // in a single base36 digit.
  encodeDesc(playState) {
    const grid = playState.grid;
    const rows = [];
    for (let r = 0; r < grid.rows; r++) {
      let s = '';
      for (let c = 0; c < grid.cols; c++) {
        const cell = getCellAt(grid, r, c);
        s += (cell.regionId).toString(36);
      }
      rows.push(s);
    }
    return rows.join('/');
  },

  // decodeDesc(params, str): rebuild the blank playState (region members, empty stars) from the desc.
  decodeDesc(params, str) {
    const rowStrs = String(str).split('/');
    const rows = rowStrs.length;
    const cols = rowStrs[0].length;
    const k = (params && params.stars) || 1;
    const grid = makeGrid(rows, cols, (r, c) => ({
      role: ROLES.member,
      value: null,
      regionId: parseInt(rowStrs[r][c], 36),
    }));
    return { grid, stars: {}, k };
  },
};

export default starbattle;
