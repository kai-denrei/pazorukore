// src/games/kenken/index.js — the KenKen game module (§5 GameModule contract).
// Pure logic: no DOM, no rendering, no input. Default export = the GameModule the engine drives.
//
// KenKen is a DIGIT-FILL puzzle: it REUSES the existing 'digit-entry' interaction + digit glyph
// rendering (rides all skins, like Sudoku/Fillomino). The KenKen-specific part is the CAGE model:
//   • playState = { grid, pencil } (like Sudoku). EVERY cell is role ROLES.fillable, value = the
//     player digit (string) or null. There are NO given digits.
//   • Cages are groups of cells encoded ON THE GRID: every cell's regionId = its cageId, so the
//     board's existing region renderer draws cage borders by regionId (like Shikaku). The cage's
//     CLUE (target + operator) shows in ONE anchor cell (the cage's top-left = lowest row then
//     lowest col): that cell's `label` = the display clue, e.g. "6×", "3-", "2÷", "5+", or "4" for
//     a single-cell cage. Non-anchor cells have label null.
//   • Operators internally: '+','-','x','/'. '-'/'/'  only for size-2 cages; '+'/'x' for any size.
//     A size-1 cage has no operator (target = the value, label = String(value)).

import { makeGrid, withCells, getCell, ROLES, cellId } from '../../core/grid.js';
import { EVENTS } from '../../core/events.js';
import { countSolutions, solveFill, cageSatisfied } from './solver.js';
import { generate, presetFor } from './generator.js';

// --- operator ⇄ display glyph ----------------------------------------------------------------
const OP_GLYPH = { '+': '+', '-': '-', x: '×', '/': '÷' };
// Compact ASCII codes used in the desc encoding so a gameId stays URL-safe.
const OP_CODE = { '+': 'p', '-': 'm', x: 't', '/': 'd' };
const CODE_OP = { p: '+', m: '-', t: 'x', d: '/' };

// Display label for a cage clue: "<target><opGlyph>" (e.g. "6×"), or just "<target>" for size-1.
function clueLabel(op, target) {
  if (op == null) return String(target);
  return `${target}${OP_GLYPH[op] || op}`;
}

// --- playState ⇄ flat board bridges ----------------------------------------------------------

// playState.grid → flat Int value board (0 = empty, 1..N = digit). Row-major.
function gridToVals(grid) {
  const N = grid.rows * grid.cols;
  const vals = new Array(N).fill(0);
  for (let i = 0; i < grid.cells.length; i++) {
    const v = grid.cells[i].value;
    vals[i] = v == null ? 0 : parseInt(v, 10);
  }
  return vals;
}

// Collect cages off a playState grid: regionId groups the cells; the label-bearing anchor carries
// the clue. Returns [{ id, cells:[flatIdx], op, target, anchor }] in stable cageId order.
function cagesOf(grid) {
  const cols = grid.cols;
  const byRegion = new Map(); // cageId → { cells:[flatIdx], anchorIdx, label }
  for (const cell of grid.cells) {
    const id = cell.regionId;
    if (id == null) continue;
    if (!byRegion.has(id)) byRegion.set(id, { cells: [], anchorIdx: -1, label: null });
    const rec = byRegion.get(id);
    const idx = cell.row * cols + cell.col;
    rec.cells.push(idx);
    if (cell.label != null) { rec.anchorIdx = idx; rec.label = cell.label; }
  }
  const cages = [];
  for (const [id, rec] of byRegion) {
    const { op, target } = parseLabel(rec.label);
    cages.push({ id, cells: rec.cells.slice().sort((a, b) => a - b), op, target, anchor: rec.anchorIdx });
  }
  // Stable order by anchor index (top-left first) for deterministic encoding.
  cages.sort((a, b) => a.anchor - b.anchor);
  return cages;
}

// Parse a display label back to { op, target }. "6×"→{x,6}; "3-"→{-,3}; "4"→{null,4}.
function parseLabel(label) {
  if (label == null) return { op: null, target: 0 };
  const m = /^(\d+)([+\-×÷x*/])?$/.exec(label);
  if (!m) return { op: null, target: parseInt(label, 10) };
  const target = parseInt(m[1], 10);
  const g = m[2];
  if (!g) return { op: null, target };
  const op = g === '×' || g === '*' || g === 'x' ? 'x'
    : g === '÷' || g === '/' ? '/'
    : g === '-' ? '-' : '+';
  return { op, target };
}

// Build a blank player playState grid from a cage layout. Every cell role fillable, value null,
// regionId = its cageId; the anchor cell of each cage carries `label`.
function buildPlayState(rows, cols, cages) {
  const cageOf = new Map();    // flatIdx → cageId
  const labelAt = new Map();   // flatIdx → label
  for (const cage of cages) {
    for (const idx of cage.cells) cageOf.set(idx, cage.id);
    labelAt.set(cage.anchor, clueLabel(cage.op, cage.target));
  }
  const grid = makeGrid(rows, cols, (r, c) => {
    const idx = r * cols + c;
    return {
      role: ROLES.fillable,
      value: null,
      given: false,
      regionId: cageOf.get(idx),
      label: labelAt.get(idx) != null ? labelAt.get(idx) : null,
    };
  });
  return { grid, pencil: {} };
}

// Build the solved playState: same blank grid but every cell filled from the solution.
function buildSolutionState(rows, cols, cages, solution) {
  const cageOf = new Map();
  const labelAt = new Map();
  for (const cage of cages) {
    for (const idx of cage.cells) cageOf.set(idx, cage.id);
    labelAt.set(cage.anchor, clueLabel(cage.op, cage.target));
  }
  const grid = makeGrid(rows, cols, (r, c) => {
    const idx = r * cols + c;
    return {
      role: ROLES.fillable,
      value: String(solution[idx]),
      given: false,
      regionId: cageOf.get(idx),
      label: labelAt.get(idx) != null ? labelAt.get(idx) : null,
    };
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

const kenken = {
  meta: {
    id: 'kenken',
    name: 'KenKen',
    interaction: 'digit-entry',
    requirements: { glyphSet: 'digits', needsOffState: true, needsRegionFill: false },
    fixedDigitCounts: true,
  },

  defaultParams() {
    return { seed: 1, size: 5, difficulty: 'easy' };
  },

  // newPuzzle(params, rng) → { params, playState, solution }. rng accepted for §5 signature parity;
  // generation is seeded deterministically from params.seed inside generate().
  newPuzzle(params /*, rng */) {
    const p = { ...this.defaultParams(), ...params };
    // The difficulty preset drives the board size (easy 4 / medium 5 / hard 6); a size passed
    // EXPLICITLY by the caller overrides it. (defaultParams pins size:5, so we must distinguish.)
    const sizeExplicit = params && params.size != null;
    const { size } = presetFor({ ...p, sizeExplicit });
    const out = generate({ ...p, size, sizeExplicit });
    const playState = buildPlayState(out.rows, out.cols, out.cages);
    const solution = buildSolutionState(out.rows, out.cols, out.cages, out.solution);
    return { params: { ...p, size: out.rows }, playState, solution };
  },

  // Reject nothing on given (there are none); accept place (1..rows), clear, pencil.
  validateMove(playState, move) {
    const cell = getCell(playState.grid, move.id);
    if (!cell) return false;
    if (move.type === 'place') {
      const v = parseInt(move.value, 10);
      return Number.isInteger(v) && v >= 1 && v <= playState.grid.rows;
    }
    return move.type === 'clear' || move.type === 'pencil';
  },

  // PURE: returns a NEW playState, or the SAME object (===) for a no-op so the engine skips it.
  // Identical place/clear/pencil semantics to Sudoku.
  applyMove(playState, move) {
    const cell = getCell(playState.grid, move.id);
    if (!cell) return playState;

    if (move.type === 'place') {
      const value = String(move.value);
      if (cell.value === value) return playState;             // no-op
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
      if (cell.value != null) return playState;               // pencil only on empty cells
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

  // Solved iff every cell is filled AND it is a valid Latin square AND every cage op→target holds.
  isSolved(playState) {
    const grid = playState.grid;
    for (const c of grid.cells) if (c.value == null) return false;
    if (this.findConflicts(playState).length > 0) return false;
    // Every cage must be fully satisfied (findConflicts only flags COMPLETE wrong cages; a fully
    // filled board makes every cage complete, so this is equivalent — but assert explicitly).
    const cages = cagesOf(grid);
    const vals = gridToVals(grid);
    for (const cage of cages) {
      const cv = cage.cells.map((idx) => vals[idx]);
      if (!cageSatisfied(cage.op, cage.target, cv)) return false;
    }
    return true;
  },

  // Ids of cells that (a) duplicate a value within their row/column, or (b) belong to a COMPLETE
  // cage whose op→target is violated. Partial cages are never flagged.
  findConflicts(playState) {
    const grid = playState.grid;
    const N = grid.rows;
    const cols = grid.cols;
    const bad = new Set();

    // Row/col duplicates.
    const scan = (cells) => {
      const seen = new Map();
      for (const c of cells) {
        if (c.value == null) continue;
        if (seen.has(c.value)) { bad.add(c.id); bad.add(seen.get(c.value)); }
        else seen.set(c.value, c.id);
      }
    };
    for (let r = 0; r < N; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(grid.cells[r * cols + c]);
      scan(row);
    }
    for (let c = 0; c < cols; c++) {
      const col = [];
      for (let r = 0; r < N; r++) col.push(grid.cells[r * cols + c]);
      scan(col);
    }

    // Complete cages whose op→target is wrong.
    const vals = gridToVals(grid);
    const cages = cagesOf(grid);
    for (const cage of cages) {
      const filled = cage.cells.every((idx) => vals[idx] !== 0);
      if (!filled) continue; // partial → never flagged
      const cv = cage.cells.map((idx) => vals[idx]);
      if (!cageSatisfied(cage.op, cage.target, cv)) {
        for (const idx of cage.cells) bad.add(grid.cells[idx].id);
      }
    }

    return [...bad];
  },

  // Self-solve: return a fully-filled playState (cage layout preserved), or null if unsolvable.
  solve(playState) {
    const grid = playState.grid;
    const rows = grid.rows, cols = grid.cols;
    const cages = cagesOf(grid);
    const filled = solveFill(rows, cols, cages);
    if (!filled) return null;
    return buildSolutionState(rows, cols, cages, filled);
  },

  // Reveal ONE next forced step: an empty cell, filled from the solution.
  hint(playState, solution) {
    const sol = solution || this.solve(playState);
    if (!sol) return null;
    const grid = playState.grid;
    for (let i = 0; i < grid.cells.length; i++) {
      const cell = grid.cells[i];
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

  // encodeParams(params, full): "<size>" always; "d<difficulty>" appended when full=true.
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

  // encodeDesc(playState): round-trip the FULL cage layout. Compact format:
  //   "<cageId-grid>;<clue-list>"
  //   • cageId-grid: one base36 char per cell (row-major) = the cage's INDEX (0..numCages-1) in
  //     anchor order. Cages with >36 ids never occur for N ≤ 6 (max 36 cells), so a single base36
  //     digit suffices.
  //   • clue-list: per cage, in the SAME index order, "<opCode><target>" joined by ','. opCode is
  //     one of p(+) m(-) t(×) d(÷) or 's' for a size-1 single-cell cage (no operator).
  // This reconstructs identical cages (cells via the grid, op+target via the clue list).
  encodeDesc(playState) {
    const grid = playState.grid;
    const cages = cagesOf(grid);                 // anchor-sorted → stable index order
    const indexOf = new Map();
    cages.forEach((cage, i) => indexOf.set(cage.id, i));
    let gridStr = '';
    for (const cell of grid.cells) {
      const i = indexOf.get(cell.regionId);
      gridStr += i.toString(36);
    }
    const clueStr = cages.map((cage) => {
      const code = cage.op == null ? 's' : OP_CODE[cage.op];
      return `${code}${cage.target}`;
    }).join(',');
    return `${gridStr};${clueStr}`;
  },

  // decodeDesc(params, str): rebuild the blank playState from the encoded cage layout.
  decodeDesc(params, str) {
    const p = { ...this.defaultParams(), ...params };
    const N = p.size;
    const [gridStr, clueStr] = String(str).split(';');
    // Parse cell → cageIndex.
    const cellCage = [];
    for (let i = 0; i < gridStr.length; i++) cellCage.push(parseInt(gridStr[i], 36));
    // Parse clue list → { op, target } per cage index.
    const clues = clueStr.split(',').map((tok) => {
      const code = tok[0];
      const target = parseInt(tok.slice(1), 10);
      if (code === 's') return { op: null, target };
      return { op: CODE_OP[code], target };
    });
    // Group cells per cage index.
    const groups = new Map(); // index → [flatIdx]
    for (let idx = 0; idx < cellCage.length; idx++) {
      const ci = cellCage[idx];
      if (!groups.has(ci)) groups.set(ci, []);
      groups.get(ci).push(idx);
    }
    // Build cages with anchor = top-left cell.
    const cages = [];
    for (const [ci, cells] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      const clue = clues[ci] || { op: null, target: 0 };
      const anchor = anchorIdx(cells, N);
      cages.push({ id: `cage-${ci}`, cells: cells.slice().sort((a, b) => a - b), op: clue.op, target: clue.target, anchor });
    }
    return buildPlayState(N, N, cages);
  },
};

// Anchor = top-left cell (lowest row, then lowest col) of a flat-index cell set.
function anchorIdx(cells, N) {
  let best = cells[0];
  let bestR = (best / N) | 0, bestC = best % N;
  for (const idx of cells) {
    const r = (idx / N) | 0, c = idx % N;
    if (r < bestR || (r === bestR && c < bestC)) { best = idx; bestR = r; bestC = c; }
  }
  return best;
}

export default kenken;
export { generate, presetFor };
