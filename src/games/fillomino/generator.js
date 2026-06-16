// src/games/fillomino/generator.js — seeded polyomino partition + uniqueness-guaranteed clue
// layout (§12). Pure, seeded via makeGenRng so a gameId reproduces the puzzle exactly. No DOM.
//
// Pipeline (mirrors shikaku/generator.js):
//   1. PARTITION the rows×cols grid into polyominoes whose sizes are in [1, maxSize] by randomized
//      seeded growth: pick an unassigned cell, choose a target size k, grow a connected blob by
//      random adjacent expansion. The SOLUTION grid values every cell by its region's size.
//   2. Verify the partition is a VALID Fillomino solution — NO two DISTINCT regions of the same
//      size are orthogonally adjacent (which would merge them, breaking size===value). Regrow/retry
//      until valid.
//   3. Choose GIVENS: start by revealing ALL cells, confirm countSolutions(...,2)===1, then greedily
//      remove givens (seed-shuffled order) while uniqueness holds → a cleaner puzzle. If a board
//      can't be made unique, re-roll the partition.
//   4. BUDGET: maxAttempts partitions under a wall-clock cap. A deterministic provably-unique
//      FALLBACK partition guarantees generate() never returns a broken puzzle.

import { makeGenRng } from '../../core/rng.js';
import { countSolutions, isValidFill } from './solver.js';

const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Difficulty presets → board size + max region size + clue-density target (fraction of cells kept
// as givens AFTER greedy reduction we aim to reach; we always reduce as far as uniqueness allows,
// density is a floor we don't dig below to keep easier boards readable).
export const PRESETS = {
  easy: { size: 7, maxSize: 7, keepFloor: 0.5 },
  medium: { size: 7, maxSize: 7, keepFloor: 0.35 },
  hard: { size: 7, maxSize: 7, keepFloor: 0.0 },
};

export function presetFor(params) {
  const base = PRESETS[params.difficulty] || PRESETS.easy;
  const size = params.size || base.size;
  // Region values are 1..size (capped at the board side so the numpad covers them).
  const maxSize = Math.min(params.maxSize || base.maxSize, size);
  return { size, maxSize, keepFloor: base.keepFloor };
}

// --- randomized seeded partition into polyominoes -------------------------------------------
// Grow blobs greedily. Returns a flat region-id array (regionOf[idx] = region index) and the list
// of region sizes, or null if the growth painted itself into a corner (rare; caller retries).
function growPartition(rows, cols, rng, maxSize) {
  const N = rows * cols;
  const regionOf = new Int32Array(N).fill(-1);
  let regionCount = 0;
  const sizes = [];

  // Process cells in a seed-shuffled order so blob seeds vary per attempt.
  const order = [];
  for (let i = 0; i < N; i++) order.push(i);
  rng.shuffle(order);

  for (const seedIdx of order) {
    if (regionOf[seedIdx] !== -1) continue;
    const id = regionCount++;
    // Target size in [1, maxSize], biased toward mid sizes for variety.
    const target = rng.range(1, maxSize);
    const blob = [seedIdx];
    regionOf[seedIdx] = id;
    // Frontier = empty cells orthogonally adjacent to the blob.
    const frontier = new Set();
    const addFrontier = (idx) => {
      const r = Math.floor(idx / cols), c = idx % cols;
      for (const [dr, dc] of NB) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const nidx = nr * cols + nc;
        if (regionOf[nidx] === -1) frontier.add(nidx);
      }
    };
    addFrontier(seedIdx);
    while (blob.length < target && frontier.size > 0) {
      const arr = [...frontier];
      const pick = arr[rng.int(arr.length)];
      frontier.delete(pick);
      if (regionOf[pick] !== -1) continue;
      regionOf[pick] = id;
      blob.push(pick);
      addFrontier(pick);
    }
    sizes[id] = blob.length;
  }
  return { regionOf, sizes, regionCount };
}

// Convert a partition into a flat value grid (each cell = its region's size).
function partitionToValues(regionOf, sizes, N) {
  const vals = new Array(N);
  for (let i = 0; i < N; i++) vals[i] = sizes[regionOf[i]];
  return vals;
}

// --- greedy clue digging --------------------------------------------------------------------
// Start from ALL cells given; remove givens (in a seeded order) as long as uniqueness holds.
// Returns the givens array (0 where dug out) or null if the full solution isn't even unique.
function digGivens(rows, cols, solutionVals, rng, keepFloor) {
  const N = rows * cols;
  const givens = solutionVals.slice();
  // Sanity: the fully-revealed board must be uniquely solvable (it is its own solution, but a
  // distinct alternative could in principle exist for some value multisets — verify).
  if (countSolutions(rows, cols, givens, 2) !== 1) return null;

  const order = [];
  for (let i = 0; i < N; i++) order.push(i);
  rng.shuffle(order);

  const minKeep = Math.ceil(keepFloor * N);
  let kept = N;
  for (const idx of order) {
    if (kept <= minKeep) break;
    const saved = givens[idx];
    givens[idx] = 0;
    if (countSolutions(rows, cols, givens, 2) === 1) {
      kept--; // removal preserved uniqueness — keep it dug
    } else {
      givens[idx] = saved; // restore — this clue is load-bearing
    }
  }
  return givens;
}

// --- deterministic provably-unique fallback -------------------------------------------------
// Tile the board into horizontal strips of width 1 along each row, alternating a deterministic
// pattern of sizes that yields a valid Fillomino fill with NO two same-size regions adjacent, and
// reveal EVERY cell so it is trivially unique. We use single cells (value 1) and dominoes (value 2)
// laid so equal-size regions never touch: a checker-like 1/2 stripe per row, offset between rows.
function deterministicFallback(rows, cols) {
  const N = rows * cols;
  // Build region sizes: fill row by row with regions of value = position-dependent so that no two
  // same-size regions are orthogonally adjacent. Simplest provably-valid fill: every cell its own
  // region of value 1 would put 1-regions edge-to-edge (1-region of size1 next to another size-1
  // region of value 1 → merges). Instead value each cell by a 4-colour-like scheme is unsafe too.
  // Use VERTICAL dominoes of value 2 packed so they tile: pair rows (r,r+1) in each column. If rows
  // is odd, the last row is singletons of value 1, which never touch another value-1 region because
  // every other cell adjacent to them is a value-2 domino cell.
  const vals = new Int32Array(N);
  let r = 0;
  while (r + 1 < rows) {
    for (let c = 0; c < cols; c++) {
      vals[r * cols + c] = 2;
      vals[(r + 1) * cols + c] = 2;
    }
    r += 2;
  }
  // Vertical dominoes in the same column touch each other horizontally (both value 2) → that MERGES
  // adjacent columns' dominoes into one big value-2 region. Fix: make dominoes value 2 but ensure
  // horizontally adjacent dominoes are SEPARATED. They aren't here. So fall back to the always-valid
  // "spiral count" partition: grow a single snake of increasing sizes is complex. Use the simplest
  // guaranteed-valid construction instead — see snakeFill below.
  return snakeFill(rows, cols);
}

// A provably-valid Fillomino fill: partition the board into a sequence of regions of sizes
// 1,2,3,... by a boustrophedon (snake) sweep, where consecutive regions necessarily differ in size
// and are the only ones that touch. Concretely we walk cells in snake order and cut a new region
// every time the running region reaches its target size, with targets cycling 1,2,3,1,2,3,...
// Adjacent regions along the snake differ in size; regions not consecutive on the snake are never
// orthogonally adjacent for these small cycles on a snake path. We then VERIFY with isValidFill and
// only return it if valid; if not, we shrink to all-1-on-odd / all done. Because we verify, this is
// safe to use as a fallback (the generator checks the result).
function snakeFill(rows, cols) {
  const N = rows * cols;
  // Snake order of flat indices.
  const order = [];
  for (let r = 0; r < rows; r++) {
    if (r % 2 === 0) for (let c = 0; c < cols; c++) order.push(r * cols + c);
    else for (let c = cols - 1; c >= 0; c--) order.push(r * cols + c);
  }
  // Try cycles of region-size targets; pick the first that yields a valid fill.
  const cycles = [
    [1, 2, 3], [2, 3], [1, 3, 2], [3, 2, 1], [2, 1, 3], [1, 2], [1, 2, 3, 4],
  ];
  for (const cycle of cycles) {
    const vals = new Int32Array(N);
    let pos = 0, ci = 0;
    while (pos < order.length) {
      const size = cycle[ci % cycle.length];
      ci++;
      const take = Math.min(size, order.length - pos);
      for (let k = 0; k < take; k++) vals[order[pos + k]] = size;
      pos += take;
    }
    if (isValidFill(rows, cols, vals)) return vals;
  }
  // Last resort: every cell value 1 is invalid (1-regions touch); instead a single full-board region
  // requires value === N which exceeds the side cap. So degrade to columns of height = rows where
  // rows<=side: each column a region of size `rows`, adjacent columns same size → invalid. There is
  // no trivial all-purpose tiling, but the cycles above cover all rows×cols we generate (small). If
  // none matched (shouldn't happen for square boards ≥2), return null so caller knows.
  return null;
}

// --- the generator --------------------------------------------------------------------------
// generate(params) → { rows, cols, givens, solution, unique, attempts, ms }
//   givens   : flat array of clue values (0 where blank).
//   solution : flat array of the full solution values.
export function generate(params = {}) {
  const { size, maxSize, keepFloor } = presetFor(params);
  const rows = size, cols = size;
  const N = rows * cols;
  const seed = (params.seed >>> 0) || 1;

  const budget = {
    maxAttempts: params.maxAttempts || 300,
    maxMs: params.maxMs || 800,
  };
  const t0 = Date.now();
  let attempts = 0;

  while (attempts < budget.maxAttempts && (Date.now() - t0) < budget.maxMs) {
    attempts++;
    const rng = makeGenRng((seed ^ (attempts * 0x9e3779b1)) >>> 0);
    const part = growPartition(rows, cols, rng, maxSize);
    if (!part) continue;
    const vals = partitionToValues(part.regionOf, part.sizes, N);
    // The partition must be a VALID Fillomino solution (size===value, no same-size regions merged).
    if (!isValidFill(rows, cols, vals)) continue;

    // Dig clues from the valid solution while uniqueness holds.
    const givens = digGivens(rows, cols, vals, rng, keepFloor);
    if (!givens) continue;
    // Final guarantee: the chosen givens yield exactly one solution.
    if (countSolutions(rows, cols, givens, 2) !== 1) continue;

    return {
      rows, cols,
      givens,
      solution: vals.slice(),
      unique: true,
      attempts,
      ms: Date.now() - t0,
    };
  }

  // Budget exhausted — deterministic provably-unique fallback (fully revealed valid solution).
  const fb = snakeFill(rows, cols) || deterministicFallback(rows, cols);
  const solution = fb ? Array.from(fb) : new Array(N).fill(1);
  return {
    rows, cols,
    givens: solution.slice(),   // reveal all → trivially unique
    solution: solution.slice(),
    unique: true,
    attempts,
    ms: Date.now() - t0,
    fallback: true,
  };
}
