// src/games/slitherlink/index.js — the Slitherlink (Tatham "Loopy") game back-end module. Pure
// logic: no DOM, no rendering, no input handling. Default export = the GameModule object. Mirrors
// the Masyu module (edge-keyed binary relation, pure toggling applyMove, bundled verified solution),
// but the loop runs on the DOT LATTICE of cell corners, NOT through cell centres.
//
// Slitherlink: the board carries numbers (0..3) at some CELLS. The player draws a SINGLE closed loop
// along the grid LINES so that each numbered cell equals how many of its 4 sides the loop uses.
// interaction: 'edge-draw'. The loop need NOT visit every dot.
//
// HARD CONTRACT. An N×N CELL grid has (N+1)×(N+1) DOTS at cell corners; dot id = `d{r}c{c}` for
// r,c ∈ 0..N. An EDGE connects two orthogonally-adjacent dots. edgeKey(a,b) = a<b ? a|b : b|a.
//
// playState shape = { grid, loop }.
//   • grid: built by makeGrid. CLUED cells → role ROLES.clue, value String(0..3), given:true.
//           Unclued cells → role ROLES.blank, value:null.
//   • loop: a PLAIN OBJECT mapping a canonical DOT-edge key → 1. Absent edges OMITTED. move =
//           { type:'edge', a:dotA, b:dotB } toggles that edge (present→delete, absent→set 1).
//
// A CELL at (cr,cc) has these 4 edges:
//   top    d{cr}c{cc}|d{cr}c{cc+1}      bottom d{cr+1}c{cc}|d{cr+1}c{cc+1}
//   left   d{cr}c{cc}|d{cr+1}c{cc}      right  d{cr}c{cc+1}|d{cr+1}c{cc+1}
// A clue's value = how many of its 4 edges are present.
//
// WIN (isSolved): present edges form EXACTLY ONE closed loop (every dot degree 0 or 2; all present
// edges a single cycle — connected, no separate sub-loops, no degree-4 dots) AND every clue cell's
// edge-count equals its value.

import { makeGrid, getCell, getCellAt, ROLES } from '../../core/grid.js';
import { EVENTS } from '../../core/events.js';
import { generate, presetFor } from './generator.js';
import { solveLoop } from './solver.js';

// --- helpers --------------------------------------------------------------------------------

const dotId = (r, c) => `d${r}c${c}`;

// The canonical edge key for two dot ids (order-independent).
function edgeKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

// Parse a dot id "d{r}c{c}" → { r, c }, or null.
function parseDot(id) {
  const m = /^d(\d+)c(\d+)$/.exec(id);
  if (!m) return null;
  return { r: parseInt(m[1], 10), c: parseInt(m[2], 10) };
}

// Is dot id within the (rows+1)×(cols+1) lattice of a rows×cols CELL grid?
function dotInBounds(grid, id) {
  const p = parseDot(id);
  if (!p) return false;
  return p.r >= 0 && p.c >= 0 && p.r <= grid.rows && p.c <= grid.cols;
}

// Are two dot ids orthogonally adjacent (Manhattan distance exactly 1)?
function adjacentDots(idA, idB) {
  const a = parseDot(idA), b = parseDot(idB);
  if (!a || !b) return false;
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

// Collect clues { id, r, c, n } from a playState grid (role clue, value '0'..'3').
function cluesOf(grid) {
  const out = [];
  for (const cell of grid.cells) {
    if (cell.role === ROLES.clue && cell.value != null) {
      out.push({ id: cell.id, r: cell.row, c: cell.col, n: parseInt(cell.value, 10) });
    }
  }
  return out;
}

// The 4 surrounding dot-edge keys of cell (cr,cc).
function cellEdgeKeys(cr, cc) {
  const tl = dotId(cr, cc), tr = dotId(cr, cc + 1);
  const bl = dotId(cr + 1, cc), br = dotId(cr + 1, cc + 1);
  return [
    edgeKey(tl, tr), // top
    edgeKey(bl, br), // bottom
    edgeKey(tl, bl), // left
    edgeKey(tr, br), // right
  ];
}

// Per-cell present-edge count from a loop object.
function cellEdgeCount(loop, cr, cc) {
  let n = 0;
  for (const k of cellEdgeKeys(cr, cc)) if (loop[k]) n++;
  return n;
}

// Per-dot degree (count of incident present edges) from a loop object.
function dotDegrees(loop) {
  const deg = new Map();
  for (const key of Object.keys(loop)) {
    if (!loop[key]) continue;
    const [a, b] = key.split('|');
    deg.set(a, (deg.get(a) || 0) + 1);
    deg.set(b, (deg.get(b) || 0) + 1);
  }
  return deg;
}

// Build a blank playState grid from a layout { rows, cols, clues }. Clued cells get role clue + the
// numeric value + given. Everything else is blank.
function gridFromLayout(layout) {
  const clueAt = new Map();
  for (const cl of layout.clues) clueAt.set(`${cl.r},${cl.c}`, cl.n);
  return makeGrid(layout.rows, layout.cols, (r, c) => {
    const n = clueAt.get(`${r},${c}`);
    if (n != null) return { role: ROLES.clue, value: String(n), given: true, regionId: null };
    return { role: ROLES.blank, value: null, regionId: null };
  });
}

// --- the module -----------------------------------------------------------------------------

const slitherlink = {
  meta: {
    id: 'slitherlink',
    name: 'Slitherlink',
    interaction: 'edge-draw',
    requirements: { glyphSet: 'digits', needsOffState: false, needsRegionFill: false },
  },

  defaultParams() {
    return { seed: 1, size: 6, difficulty: 'easy' };
  },

  // newPuzzle(params): { params, playState:{grid,loop:{}}, solution:{grid,loop} }. Generation is
  // driven by makeGenRng(seed) internally for full reproducibility from a gameId.
  newPuzzle(params /*, rng */) {
    const difficulty = (params && params.difficulty) || this.defaultParams().difficulty;
    const presetSize = presetFor({ difficulty }).size;
    const size = (params && params.size != null) ? params.size : presetSize;
    const p = { ...this.defaultParams(), ...params, difficulty, size };
    const layout = generate(p);
    const blank = gridFromLayout(layout);
    const playState = { grid: blank, loop: {} };
    // The solution is the generator's own (verified-unique) loop, bundled directly.
    const solution = { grid: blank, loop: { ...layout.loop } };
    return {
      params: { ...p, size: layout.rows },
      playState,
      solution,
    };
  },

  // validateMove(state, move): is { type:'edge', a, b } a geometrically LEGAL lattice edge to toggle?
  // Rejects: wrong type, a===b, a/b not real dots (out of lattice bounds), non-adjacent dots.
  validateMove(state, move) {
    if (!move || move.type !== 'edge') return false;
    const { a, b } = move;
    if (!a || !b || a === b) return false;
    const grid = state.grid;
    if (!dotInBounds(grid, a) || !dotInBounds(grid, b)) return false;
    if (!adjacentDots(a, b)) return false;
    return true;
  },

  // applyMove(state, move): PURE. move = { type:'edge', a, b } → TOGGLE that edge (present→delete,
  // absent→set 1). Returns a NEW state with a NEW loop object; returns the SAME state (===) for a
  // no-op (an unknown/illegal move). Never mutates the prior loop object.
  applyMove(state, move) {
    if (!this.validateMove(state, move)) return state;
    const key = edgeKey(move.a, move.b);
    const nextLoop = { ...state.loop };
    if (nextLoop[key]) delete nextLoop[key];
    else nextLoop[key] = 1;
    return { ...state, loop: nextLoop };
  },

  // isSolved(state): present edges form exactly ONE closed loop (every dot degree 0 or 2, all edges
  // in a single cycle, no sub-loops, no degree-4 dots) AND every clue cell's edge-count == its value.
  isSolved(state) {
    const grid = state.grid;
    const loop = state.loop;
    const keys = Object.keys(loop).filter((k) => loop[k]);
    if (keys.length === 0) return false;

    // (1) every stored edge connects two adjacent in-bounds dots.
    for (const key of keys) {
      const [a, b] = key.split('|');
      if (!dotInBounds(grid, a) || !dotInBounds(grid, b)) return false;
      if (!adjacentDots(a, b)) return false;
    }
    // (2) every used dot has degree exactly 2 (no stubs, no degree-4 crossings).
    const deg = dotDegrees(loop);
    for (const [, d] of deg) if (d !== 2) return false;

    // (3) single closed loop: walk from any used dot and confirm the walk covers ALL used dots.
    const used = [...deg.keys()];
    const adj = new Map(used.map((id) => [id, []]));
    for (const key of keys) {
      const [a, b] = key.split('|');
      adj.get(a).push(b);
      adj.get(b).push(a);
    }
    const start = used[0];
    let prev = null, cur = start, steps = 0;
    do {
      const opts = adj.get(cur);
      const next = opts[0] === prev ? opts[1] : opts[0];
      prev = cur; cur = next; steps++;
      if (steps > used.length + 1) return false; // safety
    } while (cur !== start);
    if (steps !== used.length) return false; // multiple disjoint loops

    // (4) every clue cell's edge-count equals its value.
    const clues = cluesOf(grid);
    for (const cl of clues) {
      if (cellEdgeCount(loop, cl.r, cl.c) !== cl.n) return false;
    }
    return true;
  },

  // findConflicts(state): ids of clue cells whose present-edge count already EXCEEDS their value
  // (over-budget — can never be fixed by adding more), plus dots with degree > 2 (impossible loop
  // junctions). We do NOT flag in-progress under-count clues or degree-1 dots (a half-drawn loop is
  // normal). Conflict cells are clue cell ids; conflict dots are dot ids.
  findConflicts(state) {
    const grid = state.grid;
    const loop = state.loop;
    const bad = new Set();

    // over-budget clue cells
    for (const cl of cluesOf(grid)) {
      if (cellEdgeCount(loop, cl.r, cl.c) > cl.n) bad.add(cl.id);
    }
    // degree-too-high dots
    const deg = dotDegrees(loop);
    for (const [id, d] of deg) if (d > 2) bad.add(id);

    return [...bad];
  },

  // solve(state): return the unique solution as a fully-drawn playState { grid, loop }, or null if
  // unsolvable. Uses the backtracking loop solver.
  solve(state) {
    const grid = state.grid;
    const clues = cluesOf(grid);
    const loop = solveLoop(grid.rows, grid.cols, clues);
    if (!loop) return null;
    return { grid, loop };
  },

  // hint(state, solution): a next correct edge move toward the solution. Returns an edge move
  // { type:'edge', a, b } — an edge present in solution.loop but missing from state.loop (add it),
  // else an extra edge in state.loop not in the solution (remove it). null if nothing is wrong.
  hint(state, solution) {
    const sol = solution || this.solve(state);
    if (!sol) return null;
    const solLoop = sol.loop;
    const cur = state.loop;
    for (const key of Object.keys(solLoop)) {
      if (!solLoop[key]) continue;
      if (!cur[key]) {
        const [a, b] = key.split('|');
        return { type: 'edge', a, b };
      }
    }
    for (const key of Object.keys(cur)) {
      if (!cur[key]) continue;
      if (!solLoop[key]) {
        const [a, b] = key.split('|');
        return { type: 'edge', a, b };
      }
    }
    return null;
  },

  // eventsFor(prev, move, next): map an edge move to EVENTS. Edge added → cellPlaced; edge removed →
  // cellCleared. payload carries { a, b, cells:[a,b] } (the two dot ids) so the board can repaint
  // both endpoints.
  eventsFor(prev, move, next) {
    if (prev === next) return [];
    if (!move || move.type !== 'edge') return [];
    const { a, b } = move;
    const key = edgeKey(a, b);
    const present = !!next.loop[key];
    const name = present ? EVENTS.cellPlaced : EVENTS.cellCleared;
    return [{ name, payload: { a, b, cells: [a, b] } }];
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

  // encodeDesc(playState): the clue layout — one char per cell: a digit 0..3 for a clue, '.' for an
  // unclued cell — row by row, rows separated by '/'. (The desc is the PUZZLE, i.e. the empty board;
  // the loop is the player's solution and is not serialized here.)
  encodeDesc(playState) {
    const grid = playState.grid;
    const rows = [];
    for (let r = 0; r < grid.rows; r++) {
      let s = '';
      for (let c = 0; c < grid.cols; c++) {
        const cell = getCellAt(grid, r, c);
        s += (cell.role === ROLES.clue && cell.value != null) ? cell.value : '.';
      }
      rows.push(s);
    }
    return rows.join('/');
  },

  // decodeDesc(params, str): rebuild the blank playState (clues only, empty loop) from the desc.
  decodeDesc(params, str) {
    const rowStrs = String(str).split('/');
    const rows = rowStrs.length;
    const cols = rowStrs[0].length;
    const grid = makeGrid(rows, cols, (r, c) => {
      const ch = rowStrs[r][c];
      if (ch >= '0' && ch <= '3') return { role: ROLES.clue, value: ch, given: true, regionId: null };
      return { role: ROLES.blank, value: null, regionId: null };
    });
    return { grid, loop: {} };
  },
};

export default slitherlink;
