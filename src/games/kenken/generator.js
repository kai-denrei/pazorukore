// src/games/kenken/generator.js — seeded KenKen generator (§12, mirrors Shikaku's pattern).
// Pure, reproducible via makeGenRng so a gameId reproduces the puzzle exactly. No DOM.
//
// Pipeline:
//   1. Build a random N×N Latin square (values 1..N) by seeded row-permutation + backtracking.
//   2. Partition the grid into connected cages of size 1..4 (randomized seeded growth; biased to
//      sizes 2-3).
//   3. Per cage, pick a VALID operator and compute its target from the Latin-square solution.
//   4. VERIFY the cage layout yields a UNIQUE solution via solver.countSolutions(...,2)===1.
//      If not unique, re-roll the cages (cheap) a few times, then re-roll the Latin square
//      (expensive), all under a wall-clock + attempts budget.
//   5. Deterministic, provably-unique fallback if the budget is exhausted.

import { makeGenRng } from '../../core/rng.js';
import { countSolutions } from './solver.js';

// --- difficulty → board size ----------------------------------------------------------------
// easy 4, medium 5, hard 6. (shrink applied at generate() time if uniqueness is slow.)
export const PRESETS = {
  easy: { size: 4 },
  medium: { size: 5 },
  hard: { size: 6 },
};

// presetFor: the difficulty preset drives the board size. An explicit params.size wins ONLY when
// it was passed deliberately (params.sizeExplicit) — otherwise the default size:5 from
// defaultParams would mask the difficulty curve (easy 4 / medium 5 / hard 6).
export function presetFor(params) {
  const base = PRESETS[params.difficulty] || PRESETS.easy;
  const size = params.sizeExplicit ? params.size : base.size;
  return { size };
}

// --- random Latin square --------------------------------------------------------------------
// Backtracking fill where each row is a seeded permutation of 1..N, retried until the column
// constraint holds. For N ≤ 6 this is effectively instant.
function randomLatinSquare(N, rng) {
  const board = new Int32Array(N * N).fill(0);
  const colMask = new Int32Array(N); // bit d set ⇒ d used in this column

  function fillRow(r) {
    if (r === N) return true;
    // Try a few shuffled orderings of 1..N for this row.
    const base = [];
    for (let v = 1; v <= N; v++) base.push(v);
    for (let attempt = 0; attempt < 12; attempt++) {
      rng.shuffle(base);
      if (tryRow(r, 0, base, new Int32Array(1))) {
        if (fillRow(r + 1)) return true;
        // undo this row before retrying with a fresh shuffle
        clearRow(r);
      }
    }
    return false;
  }

  // Place row r as a permutation respecting column masks via column-aware backtracking.
  function tryRow(r, c, perm, _u) {
    const rowUsed = new Set();
    return placeCell(r, 0, rowUsed);
  }

  function placeCell(r, c, rowUsed) {
    if (c === N) return true;
    // Candidate digits: not used in this row, not used in this column.
    const cands = [];
    for (let v = 1; v <= N; v++) {
      if (rowUsed.has(v)) continue;
      if (colMask[c] & (1 << v)) continue;
      cands.push(v);
    }
    rng.shuffle(cands);
    for (const v of cands) {
      board[r * N + c] = v;
      colMask[c] |= (1 << v);
      rowUsed.add(v);
      if (placeCell(r, c + 1, rowUsed)) return true;
      board[r * N + c] = 0;
      colMask[c] &= ~(1 << v);
      rowUsed.delete(v);
    }
    return false;
  }

  function clearRow(r) {
    for (let c = 0; c < N; c++) {
      const v = board[r * N + c];
      if (v) { colMask[c] &= ~(1 << v); board[r * N + c] = 0; }
    }
  }

  if (!fillRow(0)) {
    // Fallback: cyclic Latin square (always valid) — guarantees we never return null.
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) board[r * N + c] = ((r + c) % N) + 1;
  }
  return board;
}

// --- cage partition -------------------------------------------------------------------------
// Grow connected cages by random seeded flood from un-assigned anchors. Target sizes biased to
// 2-3, capped at 4. Returns an array of cages, each { cells:[flatIdx...] } (anchor/op/target added
// later). cells of each cage are orthogonally connected.
function randomCages(N, rng) {
  const owner = new Int32Array(N * N).fill(-1);
  const order = [];
  for (let i = 0; i < N * N; i++) order.push(i);
  rng.shuffle(order);

  const cages = [];
  const neigh = (idx) => {
    const r = (idx / N) | 0, c = idx % N;
    const out = [];
    if (r > 0) out.push(idx - N);
    if (r < N - 1) out.push(idx + N);
    if (c > 0) out.push(idx - 1);
    if (c < N - 1) out.push(idx + 1);
    return out;
  };

  for (const start of order) {
    if (owner[start] !== -1) continue;
    const ci = cages.length;
    const cells = [start];
    owner[start] = ci;
    // pick a target size biased to 2-3 (weights: 1→1, 2→4, 3→3, 4→2).
    const targetSize = weightedSize(rng);
    // grow by repeatedly adding a random un-owned orthogonal neighbour of the current cage.
    while (cells.length < targetSize) {
      const frontier = [];
      for (const cell of cells) {
        for (const nb of neigh(cell)) if (owner[nb] === -1) frontier.push(nb);
      }
      if (frontier.length === 0) break; // boxed in → cage stays smaller
      const pick = frontier[rng.int(frontier.length)];
      owner[pick] = ci;
      cells.push(pick);
    }
    cages.push({ cells });
  }
  return cages;
}

function weightedSize(rng) {
  // cumulative weights for sizes [1,2,3,4] = [1,4,3,2] → total 10
  const x = rng.int(10);
  if (x < 1) return 1;
  if (x < 5) return 2;
  if (x < 8) return 3;
  return 4;
}

// The anchor of a cage = its top-left cell (lowest row, then lowest col).
function anchorOf(cells, N) {
  let best = cells[0];
  let bestR = (best / N) | 0, bestC = best % N;
  for (const idx of cells) {
    const r = (idx / N) | 0, c = idx % N;
    if (r < bestR || (r === bestR && c < bestC)) { best = idx; bestR = r; bestC = c; }
  }
  return best;
}

// --- operator + target derivation -----------------------------------------------------------
// Given a cage's cells + the Latin-square solution values, pick a valid operator and its target.
// Size-1 → no operator, target = the value. Size-2 → randomly pick among the legal ops
// ('+','x', and '-'/'/' when valid). Size 3-4 → '+' or 'x'.
function deriveClue(cells, sol, rng) {
  const vals = cells.map((idx) => sol[idx]);
  if (vals.length === 1) {
    return { op: null, target: vals[0] };
  }
  if (vals.length === 2) {
    const [a, b] = vals;
    const hi = Math.max(a, b), lo = Math.min(a, b);
    const ops = [];
    ops.push({ op: '+', target: a + b });
    ops.push({ op: 'x', target: a * b });
    ops.push({ op: '-', target: hi - lo });
    if (lo !== 0 && hi % lo === 0) ops.push({ op: '/', target: hi / lo });
    return rng.pick(ops);
  }
  // size 3-4: '+' or 'x'.
  if (rng.rand() < 0.5) {
    let s = 0; for (const v of vals) s += v;
    return { op: '+', target: s };
  }
  let p = 1; for (const v of vals) p *= v;
  return { op: 'x', target: p };
}

// Build the full cage list (with id, op, target, anchor) for a partition + solution.
function buildCages(partition, sol, N, rng) {
  return partition.map((cage, i) => {
    const clue = deriveClue(cage.cells, sol, rng);
    return {
      id: `cage-${i}`,
      cells: cage.cells.slice(),
      op: clue.op,
      target: clue.target,
      anchor: anchorOf(cage.cells, N),
    };
  });
}

// --- generate -------------------------------------------------------------------------------
// Returns { rows, cols, cages, solution(NxN flat values), unique, attempts, ms }.
export function generate(params) {
  const { size } = presetFor(params);
  const N = size;
  const seed = (params.seed >>> 0) || 1;

  const budget = {
    maxAttempts: params.maxAttempts || 200,
    maxMs: params.maxMs || 700,
    cageRerolls: params.cageRerolls || 12,
  };
  const t0 = Date.now();
  let attempts = 0;

  while (attempts < budget.maxAttempts && (Date.now() - t0) < budget.maxMs) {
    // Fresh Latin square per square-attempt (reproducible from the base seed).
    const sqRng = makeGenRng((seed ^ (attempts * 0x9e3779b1) ^ 0x55555555) >>> 0);
    const sol = randomLatinSquare(N, sqRng);

    for (let reroll = 0; reroll < budget.cageRerolls; reroll++) {
      attempts++;
      if ((Date.now() - t0) >= budget.maxMs) break;
      const cageRng = makeGenRng((seed ^ (attempts * 0x85ebca77) ^ (reroll * 0xc2b2ae3d)) >>> 0);
      const partition = randomCages(N, cageRng);
      const cages = buildCages(partition, sol, N, cageRng);

      // Reject the degenerate all-size-1 layout (every cell its own cage → trivially unique but a
      // boring "just the solution" puzzle).
      if (cages.every((c) => c.cells.length === 1)) continue;

      const count = countSolutions(N, N, cages, 2);
      if (count === 1) {
        return {
          rows: N, cols: N,
          cages,
          solution: Array.from(sol),
          unique: true,
          attempts,
          ms: Date.now() - t0,
        };
      }
    }
  }

  // Budget exhausted → deterministic, provably-unique fallback.
  return knownGood(N, seed, attempts, Date.now() - t0);
}

// A deterministic, provably-unique fallback. Build a cyclic Latin square, then make EVERY cell its
// own size-1 cage (target = that cell's value). A board where every cage pins a single value is
// trivially the unique solution. Not the most fun layout, but guaranteed correct and unique — used
// only when the randomized search exhausts its budget (rare for N ≤ 6).
function knownGood(N, seed, attempts, ms) {
  const sol = new Int32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) sol[r * N + c] = ((r + c) % N) + 1;
  const cages = [];
  for (let idx = 0; idx < N * N; idx++) {
    cages.push({ id: `cage-${idx}`, cells: [idx], op: null, target: sol[idx], anchor: idx });
  }
  return {
    rows: N, cols: N,
    cages,
    solution: Array.from(sol),
    unique: true,
    attempts,
    ms,
    fallback: true,
  };
}
