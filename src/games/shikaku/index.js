// src/games/shikaku/index.js — the Shikaku game back-end module (§5, §12.2).
// Pure logic: no DOM, no rendering, no input handling. Default export = the GameModule object.
//
// Shikaku ("divide into rectangles"): the board carries clue numbers; the player partitions the
// whole grid into axis-aligned rectangles so each rectangle contains exactly one clue and the
// clue equals the rectangle's area. interaction:'region-draw'.
//
// playState shape (HARD CONTRACT) = { grid, pencil }. The grid is built by makeGrid; each cell is
//   - a CLUE anchor:   role ROLES.clue, value String(area), given:true, regionId = its own clueId
//                      once committed (clue cells are members of their own region).
//   - a region member: role ROLES.member, value null, regionId = the owning clueId.
//   - unassigned:      role ROLES.blank, value null, regionId null.
// pencil is unused by Shikaku's region drawing but kept ({}) to honor the engine's state shape.

import { makeGrid, withCells, getCell, getCellAt, ROLES } from '../../core/grid.js';
import { EVENTS } from '../../core/events.js';
import { generate, presetFor } from './generator.js';
import { solveAssignment, candidatesFor, buildProblem } from './solver.js';

// --- helpers --------------------------------------------------------------------------------

// Collect the clue list (id, r, c, area) from a playState grid.
function cluesOf(grid) {
  const clues = [];
  for (const cell of grid.cells) {
    if (cell.role === ROLES.clue) {
      clues.push({ id: cell.id, r: cell.row, c: cell.col, area: parseInt(cell.value, 10) });
    }
  }
  return clues;
}

// The clueId an anchor cell uses for its own region is just the cell id (stable + unique).
const clueIdOf = (cell) => cell.id;

// Build a blank playState grid from a layout {rows,cols,clues}. Clue anchors get role clue +
// value=area + given. Everything else starts blank/unassigned.
function gridFromLayout(layout) {
  const anchorAt = new Map(); // "r,c" -> area
  for (const cl of layout.clues) anchorAt.set(`${cl.r},${cl.c}`, cl.area);
  const grid = makeGrid(layout.rows, layout.cols, (r, c) => {
    const area = anchorAt.get(`${r},${c}`);
    if (area != null) return { role: ROLES.clue, value: String(area), given: true, regionId: null };
    return { role: ROLES.blank, value: null, regionId: null };
  });
  return grid;
}

// Apply a full solution assignment (from the solver) onto a blank grid, producing the solved
// playState: every cell carries regionId = its owning clue's anchor cell id, anchors keep role
// clue, members get role member.
function assignmentToSolved(grid, layout, assign) {
  // assign[clueIndex] = candidate {cells:[flatIdx]}. Map clueIndex → anchor cell id.
  const cols = layout.cols;
  const patches = [];
  for (let ci = 0; ci < layout.clues.length; ci++) {
    const cl = layout.clues[ci];
    const anchorId = `r${cl.r}c${cl.c}`;
    const cand = assign[ci];
    for (const idx of cand.cells) {
      const r = Math.floor(idx / cols), c = idx % cols;
      const id = `r${r}c${c}`;
      const isAnchor = r === cl.r && c === cl.c;
      patches.push({
        id,
        regionId: anchorId,
        role: isAnchor ? ROLES.clue : ROLES.member,
      });
    }
  }
  return { grid: withCells(grid, patches), pencil: {} };
}

// --- the module -----------------------------------------------------------------------------

const shikaku = {
  meta: {
    id: 'shikaku',
    name: 'Shikaku',
    interaction: 'region-draw',
    requirements: { glyphSet: 'digits', needsOffState: false, needsRegionFill: true },
    // Staged-countdown opt-in (see docs/superpowers/specs/2026-06-15-...). Only games that
    // declare `stages` get the auto-ramp + countdown timer + clock scoring; others keep the
    // legacy count-up timer and manual difficulty.
    stages: {
      time: { easy: 15, medium: 20, hard: 25 },   // countdown budget per stage, seconds
      // Map the upcoming game-in-run index n (1..10) to a difficulty.
      curveForGame(n) {
        if (n <= 3) return 'easy';
        if (n <= 7) return 'medium';
        return 'hard';
      },
    },
  },

  defaultParams() {
    return { seed: 1, difficulty: 'easy' };
  },

  // newPuzzle(params, rng): { params, playState, solution }. We generate a uniquely-solvable
  // layout from params.seed (the engine sets params.seed if absent). The `rng` arg is accepted to
  // honor the §5 signature, but Shikaku generation is driven by makeGenRng(seed) internally for
  // full reproducibility from a gameId.
  newPuzzle(params /*, rng */) {
    const p = { ...this.defaultParams(), ...params };
    const layout = generate(p);
    const blank = gridFromLayout(layout);
    const playState = { grid: blank, pencil: {} };

    // The solved playState: prefer the generator's own (verified-unique) tiling; fall back to the
    // solver if needed. Both agree because uniqueness was verified.
    let solution;
    const solved = this.solve(playState);
    if (solved) solution = solved;
    else solution = this._solvedFromTiling(blank, layout);

    return {
      params: { ...p, size: layout.rows },
      playState,
      solution,
    };
  },

  // Build the solved state directly from the generator's tiling (each piece + its anchor).
  _solvedFromTiling(blank, layout) {
    const patches = [];
    for (const piece of layout.tiling) {
      const anchorId = `r${piece.anchor.r}c${piece.anchor.c}`;
      for (let r = piece.r0; r <= piece.r1; r++) {
        for (let c = piece.c0; c <= piece.c1; c++) {
          const id = `r${r}c${c}`;
          const isAnchor = r === piece.anchor.r && c === piece.anchor.c;
          patches.push({ id, regionId: anchorId, role: isAnchor ? ROLES.clue : ROLES.member });
        }
      }
    }
    return { grid: withCells(blank, patches), pencil: {} };
  },

  // validateMove: a region-commit must be an axis-aligned rectangle covering exactly one clue,
  // with area == clue, fully inside the board, not overlapping an existing (other) region.
  validateMove(state, move) {
    const grid = state.grid;
    if (move.type === 'region-clear') {
      // Valid iff the named clue currently owns a non-trivial region (or even just itself).
      const anchor = getCell(grid, move.clueId);
      return !!anchor && anchor.role === ROLES.clue;
    }
    if (move.type !== 'region-commit') return false;
    const cells = move.cells;
    if (!Array.isArray(cells) || cells.length === 0) return false;

    // Resolve cells; ensure all exist.
    const resolved = [];
    for (const id of cells) {
      const cell = getCell(grid, id);
      if (!cell) return false;
      resolved.push(cell);
    }
    // Bounding box.
    let r0 = Infinity, c0 = Infinity, r1 = -Infinity, c1 = -Infinity;
    for (const cell of resolved) {
      r0 = Math.min(r0, cell.row); c0 = Math.min(c0, cell.col);
      r1 = Math.max(r1, cell.row); c1 = Math.max(c1, cell.col);
    }
    const w = c1 - c0 + 1, h = r1 - r0 + 1;
    // Axis-aligned rectangle: exactly w*h cells, all distinct, filling the bbox.
    if (w * h !== cells.length) return false;
    const seen = new Set(cells);
    if (seen.size !== cells.length) return false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!seen.has(`r${r}c${c}`)) return false;
      }
    }
    // Exactly one clue inside, and it is move.clueId, with area == cell count.
    let clueCount = 0, theClue = null;
    for (const cell of resolved) {
      if (cell.role === ROLES.clue) { clueCount++; theClue = cell; }
    }
    if (clueCount !== 1) return false;
    if (clueIdOf(theClue) !== move.clueId) return false;
    if (parseInt(theClue.value, 10) !== cells.length) return false;

    // No overlap with an existing region owned by a DIFFERENT clue.
    for (const cell of resolved) {
      if (cell.regionId != null && cell.regionId !== move.clueId) return false;
    }
    return true;
  },

  // applyMove: PURE. Returns a NEW state (withCells) or the SAME state object for a no-op.
  applyMove(state, move) {
    const grid = state.grid;

    if (move.type === 'region-commit') {
      const patches = [];
      for (const id of move.cells) {
        const cell = getCell(grid, id);
        if (!cell) return state;
        const isAnchor = clueIdOf(cell) === move.clueId && cell.role === ROLES.clue;
        const nextRole = cell.role === ROLES.clue ? ROLES.clue : ROLES.member;
        if (cell.regionId === move.clueId && cell.role === nextRole) continue; // already set
        patches.push({ id, regionId: move.clueId, role: nextRole });
      }
      if (patches.length === 0) return state; // no-op → same reference (§5)
      return { ...state, grid: withCells(grid, patches), pencil: state.pencil };
    }

    if (move.type === 'region-clear') {
      const patches = [];
      for (const cell of grid.cells) {
        if (cell.regionId === move.clueId) {
          const isAnchor = cell.role === ROLES.clue;
          patches.push({ id: cell.id, regionId: null, role: isAnchor ? ROLES.clue : ROLES.blank });
        }
      }
      if (patches.length === 0) return state; // no-op
      return { ...state, grid: withCells(grid, patches), pencil: state.pencil };
    }

    return state; // unknown move type → no-op
  },

  // isSolved: every non-clue cell belongs to exactly one region, and every clue's region is a
  // perfect rectangle whose area equals the clue. (No-overlap is implied by "exactly one region".)
  isSolved(state) {
    return this.findConflicts(state).length === 0 && this._fullyAssigned(state);
  },

  _fullyAssigned(state) {
    for (const cell of state.grid.cells) {
      if (cell.regionId == null) return false;
    }
    return true;
  },

  // findConflicts: ids of cells in regions that (a) overlap (handled by regionId being single —
  // we instead flag regions that are NOT rectangles), (b) whose committed area ≠ its clue, or
  // (c) cover zero or more-than-one clue. We return every cell of an offending region so the skin
  // can flash the whole rectangle.
  findConflicts(state) {
    const grid = state.grid;
    const byRegion = new Map(); // regionId -> [cells]
    for (const cell of grid.cells) {
      if (cell.regionId == null) continue;
      if (!byRegion.has(cell.regionId)) byRegion.set(cell.regionId, []);
      byRegion.get(cell.regionId).push(cell);
    }
    const bad = new Set();
    for (const [regionId, cells] of byRegion) {
      // Count clues inside this region.
      const clues = cells.filter((c) => c.role === ROLES.clue);
      let offending = false;
      if (clues.length !== 1) offending = true;
      else {
        const clue = clues[0];
        const area = parseInt(clue.value, 10);
        // Region must be a perfect rectangle: bbox area == cell count, and clue area == cell count.
        let r0 = Infinity, c0 = Infinity, r1 = -Infinity, c1 = -Infinity;
        for (const c of cells) {
          r0 = Math.min(r0, c.row); c0 = Math.min(c0, c.col);
          r1 = Math.max(r1, c.row); c1 = Math.max(c1, c.col);
        }
        const bboxArea = (r1 - r0 + 1) * (c1 - c0 + 1);
        if (bboxArea !== cells.length) offending = true;       // holes / non-rectangular
        else if (area !== cells.length) offending = true;       // area ≠ clue
        // The region must be exactly identified by its clue's anchor id; a mismatched owner is a bug
        // but harmless to flag.
        else if (regionId !== clue.id) offending = true;
      }
      if (offending) for (const c of cells) bad.add(c.id);
    }
    return [...bad];
  },

  // solve(state): return the unique tiling as a fully-assigned playState (every cell's regionId
  // set), or null if unsolvable. Uses the backtracking solver over candidate rectangles.
  solve(state) {
    const grid = state.grid;
    const clues = cluesOf(grid);
    if (clues.length === 0) return null;
    const result = solveAssignment(grid.rows, grid.cols, clues);
    if (!result) return null;
    // Build a blank grid (clears any partial player progress) then apply the solution.
    const blank = makeGrid(grid.rows, grid.cols, (r, c) => {
      const cell = getCellAt(grid, r, c);
      if (cell.role === ROLES.clue) {
        return { role: ROLES.clue, value: cell.value, given: cell.given, regionId: null };
      }
      return { role: ROLES.blank, value: null, regionId: null };
    });
    const layout = { rows: grid.rows, cols: grid.cols, clues };
    return assignmentToSolved(blank, layout, result.assign);
  },

  // hint(state, solution): reveal ONE next forced step — a single correct region the player has
  // not yet committed. Returns a region-commit descriptor, or null if nothing remains.
  // Strategy: use the provided solution (or solve() it) and find the first clue whose region in the
  // current state does not yet match the solution; return its full correct rectangle.
  hint(state, solution) {
    const grid = state.grid;
    const sol = solution || this.solve(state);
    if (!sol) return null;
    const solGrid = sol.grid;

    // Group the solution's cells by owning clue (regionId == anchor id).
    const byRegion = new Map();
    for (const cell of solGrid.cells) {
      if (cell.regionId == null) continue;
      if (!byRegion.has(cell.regionId)) byRegion.set(cell.regionId, []);
      byRegion.get(cell.regionId).push(cell.id);
    }

    // Prefer the "most forced" clue first: the one with the FEWEST candidate rectangles in the
    // current clue layout (a singleton candidate is a guaranteed deduction). This makes hints feel
    // like teaching the next logical step, not a random reveal.
    const clues = cluesOf(grid);
    const problem = buildProblem(grid.rows, grid.cols, clues);
    const order = clues
      .map((cl, i) => ({ id: cl.id, n: problem.cands[i].length }))
      .sort((a, b) => a.n - b.n);

    for (const { id: clueId } of order) {
      const want = byRegion.get(clueId);
      if (!want) continue;
      // Is this region already correctly committed in the current state?
      const wantSet = new Set(want);
      let alreadyCorrect = true;
      for (const cell of grid.cells) {
        const inWant = wantSet.has(cell.id);
        const owns = cell.regionId === clueId;
        if (inWant !== owns) { alreadyCorrect = false; break; }
      }
      if (alreadyCorrect) continue;
      // Reveal this region.
      return { type: 'region-commit', clueId, cells: want.slice() };
    }
    return null;
  },

  // eventsFor(prev, move, next): map move types to semantic EVENTS (§6). The engine appends
  // conflict/solve events itself; here we surface region lifecycle + placement signals.
  eventsFor(prev, move, next) {
    if (prev === next) return [];
    if (move.type === 'region-commit') {
      // Did this commit complete a correct region? Check conflicts on the affected clue.
      const conflicts = new Set(this.findConflicts(next));
      const anchor = getCell(next.grid, move.clueId);
      const valid = anchor && !conflicts.has(anchor.id) && anchor.regionId === move.clueId;
      const out = [
        { name: EVENTS.regionCommitted, payload: { clueId: move.clueId, cells: move.cells } },
      ];
      out.push({
        name: valid ? EVENTS.regionValidated : EVENTS.regionInvalid,
        payload: { clueId: move.clueId },
      });
      return out;
    }
    if (move.type === 'region-clear') {
      return [{ name: EVENTS.cellCleared, payload: { clueId: move.clueId } }];
    }
    return [];
  },

  // --- serialization (game IDs) -------------------------------------------------------------

  // encodeParams(params, full): "size,difficulty" with full=false omitting the gen-only difficulty.
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

  // encodeDesc(playState): the clue grid — area per anchor cell, '.' elsewhere — row by row,
  // rows separated by '/'. e.g. "..3/2../...". Multi-digit areas wrap in parens: "(12).." .
  encodeDesc(playState) {
    const grid = playState.grid;
    const rows = [];
    for (let r = 0; r < grid.rows; r++) {
      let s = '';
      for (let c = 0; c < grid.cols; c++) {
        const cell = getCellAt(grid, r, c);
        if (cell.role === ROLES.clue) {
          const a = cell.value;
          s += a.length > 1 ? `(${a})` : a;
        } else {
          s += '.';
        }
      }
      rows.push(s);
    }
    return rows.join('/');
  },

  // decodeDesc(params, str): rebuild the blank playState (anchors only) from the clue grid.
  decodeDesc(params, str) {
    const p = { ...this.defaultParams(), ...params };
    const rowStrs = String(str).split('/');
    const rows = rowStrs.length;
    // Parse each row into tokens: '.' or a digit or a "(NN)" group.
    const parsed = rowStrs.map((rs) => {
      const tokens = [];
      let i = 0;
      while (i < rs.length) {
        const ch = rs[i];
        if (ch === '.') { tokens.push(null); i++; }
        else if (ch === '(') {
          const close = rs.indexOf(')', i);
          tokens.push(parseInt(rs.slice(i + 1, close), 10)); i = close + 1;
        } else { tokens.push(parseInt(ch, 10)); i++; }
      }
      return tokens;
    });
    const cols = parsed[0].length;
    const grid = makeGrid(rows, cols, (r, c) => {
      const area = parsed[r][c];
      if (area != null) return { role: ROLES.clue, value: String(area), given: true, regionId: null };
      return { role: ROLES.blank, value: null, regionId: null };
    });
    return { grid, pencil: {} };
  },
};

export default shikaku;
