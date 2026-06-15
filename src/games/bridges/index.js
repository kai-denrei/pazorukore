// src/games/bridges/index.js — the Bridges (Hashiwokakero) game back-end module (§5, §12).
// Pure logic: no DOM, no rendering, no input handling. Default export = the GameModule object.
//
// Bridges: the board carries "islands" at some cells, each labelled 1..8. The player connects
// islands with straight horizontal/vertical bridges (0, 1 or 2 between any pair) so that every
// island's attached-bridge count equals its label, no two bridges cross, no bridge passes through
// a third island, and all islands form ONE connected group. interaction:'bridge-draw'.
//
// playState shape (HARD CONTRACT) = { grid, bridges }.
//   • grid: built by makeGrid. ISLAND cells → role ROLES.clue, value String(label), given:true.
//           WATER cells → role ROLES.blank, value:null.
//   • bridges: a PLAIN OBJECT mapping a canonical edge key → count (1|2). Edge key = the two island
//           cell-ids sorted and joined: `${idA}|${idB}` with idA < idB. Islands are identified by
//           their cell id "r{row}c{col}". Zero-count edges are OMITTED (never stored as 0).

import { makeGrid, withCells, getCell, getCellAt, ROLES, cellId } from '../../core/grid.js';
import { EVENTS } from '../../core/events.js';
import { generate, presetFor } from './generator.js';
import { buildGraph, solveAssignment, countSolutions } from './solver.js';

// --- helpers --------------------------------------------------------------------------------

// The canonical edge key for two island ids (order-independent).
function edgeKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

// Collect islands { id, r, c, need } from a playState grid (role clue).
function islandsOf(grid) {
  const out = [];
  for (const cell of grid.cells) {
    if (cell.role === ROLES.clue) {
      out.push({ id: cell.id, r: cell.row, c: cell.col, need: parseInt(cell.value, 10) });
    }
  }
  return out;
}

// Build (and memoise per grid) the abstract graph: legal edges, per-island incidence, crossings.
const _graphCache = new WeakMap();
function graphOf(grid) {
  let g = _graphCache.get(grid);
  if (g) return g;
  const islands = islandsOf(grid);
  const graph = buildGraph(islands);
  // Index legal edges by canonical island-id key for fast lookup.
  const legal = new Map(); // edgeKey -> { ai, bi, edgeIndex, crossKeys:[edgeKey...] }
  for (let k = 0; k < graph.edges.length; k++) {
    const e = graph.edges[k];
    const idA = islands[e.a].id, idB = islands[e.b].id;
    legal.set(edgeKey(idA, idB), { edgeIndex: k, a: e.a, b: e.b, orient: e.orient });
  }
  // Crossing keys per edge (by canonical edge key).
  const crossKeysByKey = new Map();
  for (let k = 0; k < graph.edges.length; k++) {
    const e = graph.edges[k];
    const key = edgeKey(islands[e.a].id, islands[e.b].id);
    const crosses = graph.crossing[k].map((ck) => {
      const ce = graph.edges[ck];
      return edgeKey(islands[ce.a].id, islands[ce.b].id);
    });
    crossKeysByKey.set(key, crosses);
  }
  g = { islands, graph, legal, crossKeysByKey, byId: new Map(islands.map((i) => [i.id, i])) };
  _graphCache.set(grid, g);
  return g;
}

// Current attached-bridge sum per island id, from a bridges object.
function bridgeSums(islands, bridges) {
  const sums = new Map(islands.map((i) => [i.id, 0]));
  for (const [key, count] of Object.entries(bridges)) {
    if (!count) continue;
    const [a, b] = key.split('|');
    if (sums.has(a)) sums.set(a, sums.get(a) + count);
    if (sums.has(b)) sums.set(b, sums.get(b) + count);
  }
  return sums;
}

// Build a blank playState grid from a layout { rows, cols, islands }. Island anchors get role clue
// + value=label + given. Everything else is water (blank).
function gridFromLayout(layout) {
  const islandAt = new Map();
  for (const isl of layout.islands) islandAt.set(`${isl.r},${isl.c}`, isl.need);
  return makeGrid(layout.rows, layout.cols, (r, c) => {
    const need = islandAt.get(`${r},${c}`);
    if (need != null) return { role: ROLES.clue, value: String(need), given: true, regionId: null };
    return { role: ROLES.blank, value: null, regionId: null };
  });
}

// --- the module -----------------------------------------------------------------------------

const bridges = {
  meta: {
    id: 'bridges',
    name: 'Bridges',
    interaction: 'bridge-draw',
    requirements: { glyphSet: 'digits', needsOffState: true, needsRegionFill: false },
  },

  defaultParams() {
    return { seed: 1, size: 7, difficulty: 'easy' };
  },

  // newPuzzle(params, rng): { params, playState:{grid,bridges:{}}, solution }. Generation is driven
  // by makeGenRng(seed) internally for full reproducibility from a gameId; the `rng` arg is accepted
  // to honor the §5 signature.
  newPuzzle(params /*, rng */) {
    // Resolve size: an explicit params.size wins; otherwise take the difficulty preset's size (so
    // 'medium'/'hard' get their larger boards rather than the easy default).
    const difficulty = (params && params.difficulty) || this.defaultParams().difficulty;
    const presetSize = presetFor({ difficulty }).size;
    const size = (params && params.size != null) ? params.size : presetSize;
    const p = { ...this.defaultParams(), ...params, difficulty, size };
    const layout = generate(p);
    const blank = gridFromLayout(layout);
    const playState = { grid: blank, bridges: {} };
    // The solution is the generator's own (verified-unique) network. Cross-check via solve() so the
    // bundled solution is always a real, solver-confirmed assignment.
    const solvedBridges = this.solve(playState);
    const solution = solvedBridges || { grid: blank, bridges: { ...layout.bridges } };
    return {
      params: { ...p, size: layout.rows },
      playState,
      solution,
    };
  },

  // validateMove(state, move): is { type:'bridge', a, b } a geometrically LEGAL edge to cycle?
  // Rejects: a===b, a/b not islands, not a connectable pair (not collinear-and-clear, or blocked by
  // a third island), or an edge that would cross another bridge that currently carries ≥1.
  // (Exceeding a clue is allowed transiently — conflicts surface it — so we don't reject on sums.)
  validateMove(state, move) {
    if (!move || move.type !== 'bridge') return false;
    const { a, b } = move;
    if (!a || !b || a === b) return false;
    const grid = state.grid;
    const ca = getCell(grid, a), cb = getCell(grid, b);
    if (!ca || !cb || ca.role !== ROLES.clue || cb.role !== ROLES.clue) return false;
    const { legal, crossKeysByKey } = graphOf(grid);
    const key = edgeKey(a, b);
    if (!legal.has(key)) return false; // not a collinear-and-clear neighbour pair
    // If this edge would cross another edge that currently carries a bridge, reject (a crossing is
    // geometrically illegal). We only block when the edge is about to become >0; cycling 1→2 keeps
    // crossing the same set, and 2→0 removes it — but we keep the rule simple and symmetric: the
    // pair may not coexist with a crossing live bridge at all.
    const current = state.bridges[key] || 0;
    if (current === 0) {
      // about to add the first bridge — ensure no crossing edge is live.
      for (const ck of crossKeysByKey.get(key) || []) {
        if ((state.bridges[ck] || 0) > 0) return false;
      }
    }
    return true;
  },

  // applyMove(state, move): PURE. move = { type:'bridge', a, b } → CYCLE that edge's count 0→1→2→0.
  // Returns a NEW state with a NEW bridges object; returns the SAME state (===) for a no-op (an
  // unknown/illegal move). Never mutates the prior bridges object.
  applyMove(state, move) {
    if (!move || move.type !== 'bridge') return state;
    const { a, b } = move;
    if (!a || !b || a === b) return state;
    const grid = state.grid;
    const ca = getCell(grid, a), cb = getCell(grid, b);
    if (!ca || !cb || ca.role !== ROLES.clue || cb.role !== ROLES.clue) return state;
    const { legal } = graphOf(grid);
    const key = edgeKey(a, b);
    if (!legal.has(key)) return state; // illegal edge → no-op (same reference)

    const cur = state.bridges[key] || 0;
    const next = (cur + 1) % 3; // 0→1→2→0
    const nextBridges = { ...state.bridges };
    if (next === 0) delete nextBridges[key];
    else nextBridges[key] = next;
    return { ...state, bridges: nextBridges };
  },

  // isSolved(state): every island's bridge sum == its label, no crossings, all connected.
  isSolved(state) {
    const grid = state.grid;
    const { islands, legal, crossKeysByKey } = graphOf(grid);
    if (islands.length === 0) return false;
    const bridgesObj = state.bridges;

    // (1) every stored edge is legal and a non-crossing live pair.
    for (const [key, count] of Object.entries(bridgesObj)) {
      if (!count) continue;
      if (!legal.has(key)) return false;
      if (count < 1 || count > 2) return false;
      for (const ck of crossKeysByKey.get(key) || []) {
        if ((bridgesObj[ck] || 0) > 0) return false; // crossing
      }
    }
    // (2) per-island sums.
    const sums = bridgeSums(islands, bridgesObj);
    for (const isl of islands) {
      if (sums.get(isl.id) !== isl.need) return false;
    }
    // (3) connectivity over edges with count ≥1.
    return this._connected(islands, bridgesObj);
  },

  _connected(islands, bridgesObj) {
    const n = islands.length;
    if (n === 0) return false;
    const idx = new Map(islands.map((i, k) => [i.id, k]));
    const adj = Array.from({ length: n }, () => []);
    for (const [key, count] of Object.entries(bridgesObj)) {
      if (!count) continue;
      const [a, b] = key.split('|');
      if (!idx.has(a) || !idx.has(b)) continue;
      adj[idx.get(a)].push(idx.get(b));
      adj[idx.get(b)].push(idx.get(a));
    }
    const seen = new Uint8Array(n);
    const stack = [0]; seen[0] = 1; let cnt = 1;
    while (stack.length) {
      const u = stack.pop();
      for (const v of adj[u]) if (!seen[v]) { seen[v] = 1; cnt++; stack.push(v); }
    }
    return cnt === n;
  },

  // findConflicts(state): island ids whose current bridge sum > label (over-budget), plus the ids of
  // islands on any edge that crosses another live edge (a geometrically illegal crossing). These are
  // the cells the board should flash red.
  findConflicts(state) {
    const grid = state.grid;
    const { islands, legal, crossKeysByKey } = graphOf(grid);
    const bridgesObj = state.bridges;
    const bad = new Set();

    // over-budget islands
    const sums = bridgeSums(islands, bridgesObj);
    for (const isl of islands) {
      if (sums.get(isl.id) > isl.need) bad.add(isl.id);
    }
    // crossing edges → flag both islands on each crossing edge
    for (const [key, count] of Object.entries(bridgesObj)) {
      if (!count) continue;
      if (!legal.has(key)) { // an edge that somehow isn't legal — flag its endpoints
        const [a, b] = key.split('|');
        bad.add(a); bad.add(b);
        continue;
      }
      for (const ck of crossKeysByKey.get(key) || []) {
        if ((bridgesObj[ck] || 0) > 0) {
          const [a, b] = key.split('|');
          bad.add(a); bad.add(b);
          const [ca2, cb2] = ck.split('|');
          bad.add(ca2); bad.add(cb2);
        }
      }
    }
    return [...bad];
  },

  // solve(state): return the unique solution as a fully-bridged playState, or null if unsolvable.
  // Uses the backtracking solver over candidate edge counts.
  solve(state) {
    const grid = state.grid;
    const islands = islandsOf(grid);
    if (islands.length === 0) return null;
    const solvedBridges = solveAssignment(islands);
    if (!solvedBridges) return null;
    return { grid, bridges: solvedBridges };
  },

  // hint(state, solution): a next correct edge to add/raise toward the solution. Returns a bridge
  // move { type:'bridge', a, b } whose application moves a stored edge closer to the solution's
  // count, or null if nothing is wrong/missing. Strategy: find an edge whose current count is BELOW
  // the solution's, and return it (cycling will raise it). If an edge is ABOVE the solution's (a
  // mistake), returning it also helps — cycling continues toward 0 → the correct value eventually,
  // but we prefer a clean "add the next correct bridge" to feel like teaching the next step.
  hint(state, solution) {
    const grid = state.grid;
    const sol = solution || this.solve(state);
    if (!sol) return null;
    const solBridges = sol.bridges;
    const cur = state.bridges;
    // Prefer an edge that is below its solution count (a forward step).
    for (const [key, want] of Object.entries(solBridges)) {
      const have = cur[key] || 0;
      if (have < want) {
        const [a, b] = key.split('|');
        return { type: 'bridge', a, b };
      }
    }
    // Otherwise, any stored edge that is wrong (present but shouldn't be, or over-count) → point at it.
    for (const [key, have] of Object.entries(cur)) {
      const want = solBridges[key] || 0;
      if (have !== want) {
        const [a, b] = key.split('|');
        return { type: 'bridge', a, b };
      }
    }
    return null;
  },

  // eventsFor(prev, move, next): map a bridge move to EVENTS. Adding/raising a bridge → cellPlaced;
  // cycling back to 0 (edge removed) → cellCleared. We include BOTH affected island ids in
  // payload.cells so the board can repaint them.
  eventsFor(prev, move, next) {
    if (prev === next) return [];
    if (!move || move.type !== 'bridge') return [];
    const { a, b } = move;
    const key = edgeKey(a, b);
    const nextCount = next.bridges[key] || 0;
    const name = nextCount === 0 ? EVENTS.cellCleared : EVENTS.cellPlaced;
    return [{ name, payload: { a, b, count: nextCount, cells: [a, b] } }];
  },

  // --- serialization (game IDs) -------------------------------------------------------------

  // encodeParams(params, full): "<size>d<difficulty>" with full=false omitting the gen-only difficulty.
  encodeParams(params, full = true) {
    const p = { ...this.defaultParams(), ...params };
    return full ? `${p.size}d${p.difficulty}` : `${p.size}`;
  },

  decodeParams(str) {
    const m = String(str).match(/^(\d+)(?:d(\w+))?$/);
    const size = m ? parseInt(m[1], 10) : 7;
    const difficulty = (m && m[2]) || 'easy';
    return { seed: 1, size, difficulty };
  },

  // encodeDesc(playState): the island layout — label per island cell, '.' for water — row by row,
  // rows separated by '/'. Labels are a single digit 1..8 so no escaping is needed.
  // e.g. ".3..2/....." . (Bridges does not serialize bridge counts in the desc — the desc is the
  // PUZZLE, i.e. an empty board; bridges are the player's solution.)
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

  // decodeDesc(params, str): rebuild the blank playState (islands only, empty bridges) from the desc.
  decodeDesc(params, str) {
    const rowStrs = String(str).split('/');
    const rows = rowStrs.length;
    const cols = rowStrs[0].length;
    const grid = makeGrid(rows, cols, (r, c) => {
      const ch = rowStrs[r][c];
      if (ch && ch !== '.') return { role: ROLES.clue, value: ch, given: true, regionId: null };
      return { role: ROLES.blank, value: null, regionId: null };
    });
    return { grid, bridges: {} };
  },
};

export default bridges;
