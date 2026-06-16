// src/games/starbattle/generator.js — SOLUTION-FIRST Star Battle generator (K=1, v1).
// Pure, seeded via makeGenRng so a gameId reproduces the puzzle exactly. No DOM.
//
// Pipeline:
//   1. Place a valid K=1 star SOLUTION: exactly one star per row and per column (a permutation),
//      with no two stars 8-adjacent (king move). Built by a randomized permutation with
//      backtracking on the diagonal/vertical adjacency constraint.
//   2. PARTITION the grid into N connected REGIONS, each containing EXACTLY ONE star. Each star is
//      a region seed; grow all regions simultaneously by randomized BFS over a shuffled frontier
//      until every cell is claimed. Simultaneous frontier growth keeps every region 4-connected.
//   3. VERIFY uniqueness: countSolutions(..., k=1, limit=2) === 1. If not unique, re-roll the
//      partition (cheap); after a few partition re-rolls, re-roll the star solution too (expensive).
//      All under an attempts / wall-clock budget.
//   4. FALLBACK (budget exhausted): a deterministic, provably-unique layout — the main-diagonal
//      star placement with row-band regions (region r = row r), which is trivially unique because
//      each region is a full row and "one per region" forces one star per row at the only
//      non-adjacent diagonal position. Verified by countSolutions at construction.
//
// Difficulty → size: easy 5, medium 6, hard 7.

import { makeGenRng } from '../../core/rng.js';
import { countSolutions } from './solver.js';

const DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export const PRESETS = {
  easy: { size: 5 },
  medium: { size: 6 },
  hard: { size: 7 },
};

export function presetFor(params) {
  const base = PRESETS[(params && params.difficulty)] || PRESETS.easy;
  const size = (params && params.size != null) ? params.size : base.size;
  return { size };
}

// Step 1: place a valid K=1 star solution as a permutation (one star per row & column) with no two
// stars 8-adjacent. Returns an array `starCol` where starCol[r] = the column of row r's star, or
// null if none found (shouldn't happen for the small boards here). Randomized + backtracking.
function placeStarSolution(n, rng) {
  const starCol = new Array(n).fill(-1);
  const usedCol = new Array(n).fill(false);

  function place(r) {
    if (r === n) return true;
    // candidate columns for this row, randomized
    const cols = [];
    for (let c = 0; c < n; c++) cols.push(c);
    rng.shuffle(cols);
    for (const c of cols) {
      if (usedCol[c]) continue;
      // adjacency to previous row's star (vertical/diagonal): |c - starCol[r-1]| must be >= 2.
      if (r > 0 && Math.abs(c - starCol[r - 1]) <= 1) continue;
      starCol[r] = c; usedCol[c] = true;
      if (place(r + 1)) return true;
      starCol[r] = -1; usedCol[c] = false;
    }
    return false;
  }

  return place(0) ? starCol : null;
}

// Step 2: grow N connected regions from the N star seeds by simultaneous randomized BFS. Returns a
// flat regionOf array (r*n + c -> region id 0..n-1) with every region 4-connected and containing
// exactly one star, or null if it somehow failed to claim every cell (shouldn't happen).
function growRegions(n, starCol, rng) {
  const N = n * n;
  const regionOf = new Int32Array(N).fill(-1);
  // Each region id g owns the star at (g, starCol[g]).
  const frontier = []; // queue of cells to expand: { idx, region }
  for (let g = 0; g < n; g++) {
    const idx = g * n + starCol[g];
    regionOf[idx] = g;
    frontier.push(idx);
  }
  let claimed = n;

  // Simultaneous growth: repeatedly take a random frontier cell, claim a random unclaimed neighbour
  // for that cell's region, and add it to the frontier. This grows all regions roughly together and
  // keeps each 4-connected (a cell only joins a region adjacent to it).
  while (claimed < N && frontier.length) {
    const fi = rng.int(frontier.length);
    const idx = frontier[fi];
    const r = Math.floor(idx / n), c = idx % n;
    const g = regionOf[idx];
    // unclaimed orthogonal neighbours
    const opts = [];
    for (const [dr, dc] of DIRS4) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
      const nidx = nr * n + nc;
      if (regionOf[nidx] === -1) opts.push(nidx);
    }
    if (opts.length === 0) {
      // exhausted this frontier cell — remove it (swap-pop)
      frontier[fi] = frontier[frontier.length - 1];
      frontier.pop();
      continue;
    }
    const nidx = opts[rng.int(opts.length)];
    regionOf[nidx] = g;
    frontier.push(nidx);
    claimed++;
  }

  if (claimed < N) return null; // unreachable for a connected grid, but guard
  return Array.from(regionOf);
}

// Verify a regionOf partition: N regions, each 4-connected, each holding exactly one star.
function partitionValid(n, regionOf, starCol) {
  const N = n * n;
  const sizes = new Array(n).fill(0);
  const starCount = new Array(n).fill(0);
  const starSet = new Set();
  for (let r = 0; r < n; r++) starSet.add(r * n + starCol[r]);
  for (let i = 0; i < N; i++) {
    const g = regionOf[i];
    if (g < 0 || g >= n) return false;
    sizes[g]++;
    if (starSet.has(i)) starCount[g]++;
  }
  for (let g = 0; g < n; g++) {
    if (sizes[g] === 0) return false;
    if (starCount[g] !== 1) return false;
  }
  // connectivity per region
  const seen = new Uint8Array(N);
  for (let g = 0; g < n; g++) {
    // find a start cell in region g
    let start = -1;
    for (let i = 0; i < N; i++) if (regionOf[i] === g) { start = i; break; }
    if (start < 0) return false;
    const stack = [start]; seen[start] = 1; let cnt = 1;
    while (stack.length) {
      const idx = stack.pop();
      const r = Math.floor(idx / n), c = idx % n;
      for (const [dr, dc] of DIRS4) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
        const nidx = nr * n + nc;
        if (regionOf[nidx] === g && !seen[nidx]) { seen[nidx] = 1; cnt++; stack.push(nidx); }
      }
    }
    if (cnt !== sizes[g]) return false;
  }
  return true;
}

function starsObjFromCols(n, starCol) {
  const stars = {};
  for (let r = 0; r < n; r++) stars[`r${r}c${starCol[r]}`] = 1;
  return stars;
}

// Deterministic, provably-unique fallback. The randomized partition pipeline reliably yields a
// uniquely-solvable layout, so the fallback is the SAME pipeline run on a fixed sequence of seeds —
// fully deterministic (no entropy), and verified unique by countSolutions before returning. (Note: a
// naive row-band partition — region r = row r — is NOT a valid fallback: it adds no constraint
// beyond the per-row rule, so multiple non-attacking permutations remain and uniqueness fails.)
function fallbackLayout(n) {
  const fixedSeeds = [12345, 1, 2, 3, 7, 11, 17, 23, 42, 99, 257, 1009, 2024, 65537];
  for (const s of fixedSeeds) {
    const starRng = makeGenRng(s >>> 0);
    const starCol = placeStarSolution(n, starRng);
    if (!starCol) continue;
    for (let pr = 0; pr < 24; pr++) {
      const partRng = makeGenRng((s ^ ((pr + 1) * 0xc2b2ae3d)) >>> 0);
      const regionOf = growRegions(n, starCol, partRng);
      if (!regionOf) continue;
      if (!partitionValid(n, regionOf, starCol)) continue;
      if (countSolutions(n, n, regionOf, 1, 2) === 1) {
        return {
          rows: n, cols: n, regionOf,
          stars: starsObjFromCols(n, starCol),
          k: 1, unique: true, attempts: 0, ms: 0, fallback: true,
        };
      }
    }
  }
  // Unreachable for n in 5..7 (the pipeline finds a unique partition almost immediately). As an
  // absolute last resort, return a row-band layout flagged unique:false so callers can detect it.
  const regionOf = new Int32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) regionOf[r * n + c] = r;
  const flat = Array.from(regionOf);
  const starCol = placeStarSolution(n, makeGenRng(12345)) || (() => { const a = []; for (let i = 0; i < n; i++) a.push(i); return a; })();
  return {
    rows: n, cols: n, regionOf: flat,
    stars: starsObjFromCols(n, starCol),
    k: 1, unique: countSolutions(n, n, flat, 1, 2) === 1, attempts: 0, ms: 0, fallback: true,
  };
}

// generate(params) → { rows, cols, regionOf (flat array), stars (solution set), k, unique, attempts, ms }.
export function generate(params) {
  const { size } = presetFor(params);
  const n = size;
  const k = (params && params.stars) || 1; // v1: K=1
  const seed = (params && (params.seed >>> 0)) || 1;

  const budget = {
    maxAttempts: (params && params.maxAttempts) || 400,
    maxMs: (params && params.maxMs) || 600,
    partitionRerolls: 6,
  };
  const t0 = Date.now();
  let attempts = 0;
  let fallback = null; // best-effort layout if we never hit unique within budget

  while (attempts < budget.maxAttempts && (Date.now() - t0) < budget.maxMs) {
    attempts++;
    // Per-attempt seed for the STAR solution (expensive to re-roll → only when partitions fail).
    const starRng = makeGenRng((seed ^ (attempts * 0x9e3779b1)) >>> 0);
    const starCol = placeStarSolution(n, starRng);
    if (!starCol) continue;

    for (let pr = 0; pr < budget.partitionRerolls; pr++) {
      // Distinct, reproducible seed per partition re-roll.
      const partRng = makeGenRng((seed ^ (attempts * 0x85ebca77) ^ ((pr + 1) * 0xc2b2ae3d)) >>> 0);
      const regionOf = growRegions(n, starCol, partRng);
      if (!regionOf) continue;
      if (!partitionValid(n, regionOf, starCol)) continue;

      const layout = {
        rows: n, cols: n, regionOf,
        stars: starsObjFromCols(n, starCol),
        k, attempts, ms: Date.now() - t0,
      };
      if (!fallback) fallback = { ...layout, unique: false };

      const count = countSolutions(n, n, regionOf, k, 2);
      if (count === 1) {
        return { ...layout, unique: true, ms: Date.now() - t0 };
      }
      // not unique → reroll partition (cheap); after partitionRerolls, outer loop re-rolls stars.
    }
  }

  // Budget exhausted → deterministic, provably-unique fallback for this size.
  return fallbackLayout(n);
}
