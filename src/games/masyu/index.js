// src/games/masyu/index.js — the Masyu (Tatham "Pearl") game back-end module. Pure logic: no DOM,
// no rendering, no input handling. Default export = the GameModule object. Mirrors the Bridges
// module precisely (edge-keyed binary relation, pure toggling applyMove, bundled verified solution).
//
// Masyu: the board carries "pearls" (clues) at some cells, each white ('W') or black ('B'). The
// player draws a SINGLE closed loop through cell centres using orthogonal segments. interaction:
// 'loop-draw'. The loop need NOT visit every cell. Pearl rules (see solver.js):
//   • WHITE at X: X is STRAIGHT and the loop TURNS in at least one of the two next cells.
//   • BLACK at X: X is a TURN and the loop goes STRAIGHT through both next cells.
//
// playState shape (HARD CONTRACT) = { grid, loop }.
//   • grid: built by makeGrid. PEARL cells → role ROLES.clue, value 'B'|'W', given:true. Non-pearl
//           cells → role ROLES.blank, value:null.
//   • loop: a PLAIN OBJECT mapping a canonical edge key → 1. Edge key = the two orthogonally-adjacent
//           cell ids sorted+joined: `${idA}|${idB}` with idA < idB. Cell ids are "r{row}c{col}".
//           Absent edges are OMITTED (never stored as 0). Binary: present or absent.

import { makeGrid, getCell, getCellAt, ROLES } from '../../core/grid.js';
import { EVENTS } from '../../core/events.js';
import { generate, presetFor } from './generator.js';
import { solveLoop } from './solver.js';

// --- helpers --------------------------------------------------------------------------------

const cellId = (r, c) => `r${r}c${c}`;

// The canonical edge key for two cell ids (order-independent).
function edgeKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

// Parse a cell id "r{row}c{col}" → { r, c }.
function parseId(id) {
  const m = /^r(\d+)c(\d+)$/.exec(id);
  if (!m) return null;
  return { r: parseInt(m[1], 10), c: parseInt(m[2], 10) };
}

// Are two cell ids orthogonally adjacent (Manhattan distance exactly 1)?
function adjacent(idA, idB) {
  const a = parseId(idA), b = parseId(idB);
  if (!a || !b) return false;
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

// Collect pearls { id, r, c, kind } from a playState grid (role clue, value 'B'|'W').
function pearlsOf(grid) {
  const out = [];
  for (const cell of grid.cells) {
    if (cell.role === ROLES.clue && (cell.value === 'B' || cell.value === 'W')) {
      out.push({ id: cell.id, r: cell.row, c: cell.col, kind: cell.value });
    }
  }
  return out;
}

// Build a blank playState grid from a layout { rows, cols, pearls }. Pearl anchors get role clue +
// value 'B'|'W' + given. Everything else is blank.
function gridFromLayout(layout) {
  const pearlAt = new Map();
  for (const p of layout.pearls) pearlAt.set(`${p.r},${p.c}`, p.kind);
  return makeGrid(layout.rows, layout.cols, (r, c) => {
    const kind = pearlAt.get(`${r},${c}`);
    if (kind != null) return { role: ROLES.clue, value: kind, given: true, regionId: null };
    return { role: ROLES.blank, value: null, regionId: null };
  });
}

// Per-cell loop degree (count of incident present edges) from a loop object.
function degrees(grid, loop) {
  const deg = new Map();
  for (const key of Object.keys(loop)) {
    if (!loop[key]) continue;
    const [a, b] = key.split('|');
    deg.set(a, (deg.get(a) || 0) + 1);
    deg.set(b, (deg.get(b) || 0) + 1);
  }
  return deg;
}

// For a cell id on the loop, return the orientation pair of its incident edges and the loop
// neighbours. orientation 'h' (same row) or 'v' (same col). Returns { neighbors:[id...], shape }.
function localShape(grid, loop, id) {
  const nbs = [];
  for (const key of Object.keys(loop)) {
    if (!loop[key]) continue;
    const [a, b] = key.split('|');
    if (a === id) nbs.push(b);
    else if (b === id) nbs.push(a);
  }
  if (nbs.length !== 2) return { neighbors: nbs, shape: null };
  const self = parseId(id);
  let h = 0, v = 0;
  for (const nb of nbs) {
    const p = parseId(nb);
    if (p.r === self.r) h++; else v++;
  }
  const shape = (h === 2 || v === 2) ? 'straight' : 'turn';
  return { neighbors: nbs, shape };
}

// --- the module -----------------------------------------------------------------------------

const masyu = {
  meta: {
    id: 'masyu',
    name: 'Pearl',
    interaction: 'loop-draw',
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

  // validateMove(state, move): is { type:'loop', a, b } a geometrically LEGAL edge to toggle?
  // Rejects: a===b, a/b not real cells, non-adjacent (Manhattan distance ≠ 1). Pearls are passable
  // (an edge may touch a pearl cell). Drawing OVER a clue is fine — the loop runs through it.
  validateMove(state, move) {
    if (!move || move.type !== 'loop') return false;
    const { a, b } = move;
    if (!a || !b || a === b) return false;
    const grid = state.grid;
    const ca = getCell(grid, a), cb = getCell(grid, b);
    if (!ca || !cb) return false;
    if (!adjacent(a, b)) return false;
    return true;
  },

  // applyMove(state, move): PURE. move = { type:'loop', a, b } → TOGGLE that edge (present→delete,
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

  // isSolved(state): the edges form exactly ONE closed loop (every used cell degree 2, all loop
  // edges in a single cycle, no separate sub-loops) AND every pearl is on the loop and satisfies
  // its rule.
  isSolved(state) {
    const grid = state.grid;
    const loop = state.loop;
    const keys = Object.keys(loop).filter((k) => loop[k]);
    if (keys.length === 0) return false;

    // (1) every stored edge connects two adjacent real cells.
    for (const key of keys) {
      const [a, b] = key.split('|');
      if (!getCell(grid, a) || !getCell(grid, b)) return false;
      if (!adjacent(a, b)) return false;
    }
    // (2) every used cell has degree exactly 2.
    const deg = degrees(grid, loop);
    for (const [, d] of deg) if (d !== 2) return false;

    // (3) single closed loop: walk from any used cell and confirm the walk covers ALL used cells.
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

    // (4) every pearl on the loop and satisfies its rule.
    const pearls = pearlsOf(grid);
    for (const pearl of pearls) {
      if ((deg.get(pearl.id) || 0) !== 2) return false; // pearl not on the loop
      const { neighbors, shape } = localShape(grid, loop, pearl.id);
      if (pearl.kind === 'W') {
        if (shape !== 'straight') return false;
        let anyTurn = false;
        for (const nb of neighbors) {
          if (localShape(grid, loop, nb).shape === 'turn') { anyTurn = true; break; }
        }
        if (!anyTurn) return false;
      } else { // 'B'
        if (shape !== 'turn') return false;
        for (const nb of neighbors) {
          if (localShape(grid, loop, nb).shape !== 'straight') return false;
        }
      }
    }
    return true;
  },

  // findConflicts(state): ids of cells with edge-degree > 2 (impossible loop junctions), plus pearl
  // cells that are fully on the loop (degree 2) but violate their rule. These are the cells the
  // board should flash. We do NOT flag in-progress degree-1 cells (a half-drawn loop is normal).
  findConflicts(state) {
    const grid = state.grid;
    const loop = state.loop;
    const deg = degrees(grid, loop);
    const bad = new Set();

    for (const [id, d] of deg) if (d > 2) bad.add(id);

    const pearls = pearlsOf(grid);
    for (const pearl of pearls) {
      if ((deg.get(pearl.id) || 0) !== 2) continue; // only judge fully-on-loop pearls
      const { neighbors, shape } = localShape(grid, loop, pearl.id);
      let ok = true;
      if (pearl.kind === 'W') {
        if (shape !== 'straight') ok = false;
        else {
          // a neighbour must turn — but only judge once both neighbours are themselves degree 2.
          const ready = neighbors.every((nb) => (deg.get(nb) || 0) === 2);
          if (ready) {
            let anyTurn = false;
            for (const nb of neighbors) if (localShape(grid, loop, nb).shape === 'turn') { anyTurn = true; break; }
            if (!anyTurn) ok = false;
          }
        }
      } else { // 'B'
        if (shape !== 'turn') ok = false;
        else {
          const ready = neighbors.every((nb) => (deg.get(nb) || 0) === 2);
          if (ready) {
            for (const nb of neighbors) if (localShape(grid, loop, nb).shape !== 'straight') ok = false;
          }
        }
      }
      if (!ok) bad.add(pearl.id);
    }
    return [...bad];
  },

  // solve(state): return the unique solution as a fully-drawn playState { grid, loop }, or null if
  // unsolvable. Uses the backtracking loop solver.
  solve(state) {
    const grid = state.grid;
    const pearls = pearlsOf(grid);
    const loop = solveLoop(grid.rows, grid.cols, pearls);
    if (!loop) return null;
    return { grid, loop };
  },

  // hint(state, solution): a next correct loop move toward the solution. Returns a loop move
  // { type:'loop', a, b } — an edge present in solution.loop but missing from state.loop (add it),
  // else an extra edge in state.loop not in the solution (remove it). null if nothing is wrong.
  hint(state, solution) {
    const sol = solution || this.solve(state);
    if (!sol) return null;
    const solLoop = sol.loop;
    const cur = state.loop;
    // Prefer adding a missing solution edge (a forward step).
    for (const key of Object.keys(solLoop)) {
      if (!solLoop[key]) continue;
      if (!cur[key]) {
        const [a, b] = key.split('|');
        return { type: 'loop', a, b };
      }
    }
    // Otherwise remove an extra edge that shouldn't be there.
    for (const key of Object.keys(cur)) {
      if (!cur[key]) continue;
      if (!solLoop[key]) {
        const [a, b] = key.split('|');
        return { type: 'loop', a, b };
      }
    }
    return null;
  },

  // eventsFor(prev, move, next): map a loop move to EVENTS. Edge added → cellPlaced; edge removed →
  // cellCleared. payload carries { a, b, cells:[a,b] } so the board can repaint both endpoints.
  eventsFor(prev, move, next) {
    if (prev === next) return [];
    if (!move || move.type !== 'loop') return [];
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

  // encodeDesc(playState): the pearl layout — 'B'/'W' per pearl cell, '.' for empty — row by row,
  // rows separated by '/'. (The desc is the PUZZLE, i.e. the empty board; the loop is the player's
  // solution and is not serialized here.)
  encodeDesc(playState) {
    const grid = playState.grid;
    const rows = [];
    for (let r = 0; r < grid.rows; r++) {
      let s = '';
      for (let c = 0; c < grid.cols; c++) {
        const cell = getCellAt(grid, r, c);
        s += (cell.role === ROLES.clue && (cell.value === 'B' || cell.value === 'W')) ? cell.value : '.';
      }
      rows.push(s);
    }
    return rows.join('/');
  },

  // decodeDesc(params, str): rebuild the blank playState (pearls only, empty loop) from the desc.
  decodeDesc(params, str) {
    const rowStrs = String(str).split('/');
    const rows = rowStrs.length;
    const cols = rowStrs[0].length;
    const grid = makeGrid(rows, cols, (r, c) => {
      const ch = rowStrs[r][c];
      if (ch === 'B' || ch === 'W') return { role: ROLES.clue, value: ch, given: true, regionId: null };
      return { role: ROLES.blank, value: null, regionId: null };
    });
    return { grid, loop: {} };
  },
};

export default masyu;
