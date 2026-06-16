// src/games/slitherlink/generator.js — LOOP-FIRST Slitherlink generation. Pure, seeded via
// makeGenRng(seed) so a gameId reproduces the puzzle exactly. No DOM.
//
// Pipeline:
//   1. Generate a random SINGLE closed loop on the DOT LATTICE (the (rows+1)×(cols+1) grid of cell
//      corners): start from a small rectangle cycle of dots and apply randomized "bump"
//      perturbations that grow the loop while keeping it ONE simple (non-self-crossing) closed loop.
//   2. From the loop, compute every CELL's edge-count (how many of its 4 surrounding lattice edges
//      the loop uses — 0..4).
//   3. Reveal ALL cells as clues, verify uniqueness via countSolutions(...,2)===1, then GREEDILY
//      thin the clue set while uniqueness holds (a cleaner puzzle). If not unique even fully clued,
//      re-roll the loop.
//   4. Budget: maxAttempts + wall-clock cap. A deterministic provably-unique FALLBACK (a fixed
//      rectangle-loop layout, fully clued + verified) guarantees generate() never returns broken.
//
// Export: generate(params) → { rows, cols, clues:[{r,c,n}], loop:{...}, unique, attempts, ms }
//         presetFor(params).

import { makeGenRng } from '../../core/rng.js';
import { countSolutions, countSolutionsBounded } from './solver.js';

// Node budget for the per-removal uniqueness check during greedy thinning. A sparse intermediate
// board can blow up the backtracker; capping its work keeps generation fast. An aborted check is
// treated as "keep this clue" (see generate), so the cap only makes boards slightly denser, never
// non-unique. Tuned so a 7×7 hard board generates + verifies well under the wall-clock budget while
// every shipped board's exact final uniqueness check stays well under 1s.
const THIN_NODE_BUDGET = 60000;

const dotId = (r, c) => `d${r}c${c}`;
function edgeKeyOf(idA, idB) { return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`; }

// Difficulty presets → grid size + loop density (fraction of dots the loop visits) + clue density
// (fraction of cells revealed AFTER greedy thinning — a TARGET, the floor being whatever uniqueness
// requires).
//
// NOTE on sizing: the solver is a backtracking edge-CSP over the dot lattice. Uniqueness checks on a
// sparsely-clued board grow super-linearly with side length. easy 5 / medium 6 / hard 7 all finish a
// uniqueness check well under 1s in practice (see test timing); larger boards or denser thinning can
// push past that, so we keep these sizes. Difficulty also varies loop density (twistier = harder).
export const PRESETS = {
  easy: { size: 5, density: 0.55 },
  medium: { size: 6, density: 0.62 },
  hard: { size: 7, density: 0.68 },
};

export function presetFor(params) {
  const base = PRESETS[params.difficulty] || PRESETS.easy;
  const size = params.size || base.size;
  return { size, density: base.density };
}

// --- loop representation (on the DOT lattice) ----------------------------------------------
// A loop is held as an ordered list of DOTS [ {r,c}, ... ] forming a simple cycle (consecutive dots
// orthogonally adjacent, last wraps to first). Dot coords range 0..rows / 0..cols. We grow with
// "bumps". Build the loop's edge set { edgeKey:1 } over dot ids from an ordered cycle.
function cycleToLoop(cycle) {
  const loop = {};
  for (let i = 0; i < cycle.length; i++) {
    const a = cycle[i], b = cycle[(i + 1) % cycle.length];
    loop[edgeKeyOf(dotId(a.r, a.c), dotId(b.r, b.c))] = 1;
  }
  return loop;
}

// A starting rectangle cycle of DOTS: the perimeter of [r0..r1]×[c0..c1] dots, walked clockwise.
// Requires at least a 2×2 dot area (i.e. a 1×1 cell). Returns an ordered dot cycle.
function rectangleCycle(r0, c0, r1, c1) {
  const cyc = [];
  for (let c = c0; c <= c1; c++) cyc.push({ r: r0, c });        // top →
  for (let r = r0 + 1; r <= r1; r++) cyc.push({ r, c: c1 });    // right ↓
  for (let c = c1 - 1; c >= c0; c--) cyc.push({ r: r1, c });    // bottom ←
  for (let r = r1 - 1; r >= r0 + 1; r--) cyc.push({ r, c: c0 });// left ↑
  return cyc;
}

// Grow the dot loop with randomized "bumps". Dots range 0..maxR (=rows) and 0..maxC (=cols). A bump
// takes an edge (P→Q) of the cycle and pushes it outward into an adjacent empty unit square of dots
// P,Q,X,Y: replace edge P→Q with P→Y→X→Q (Y adjacent to P, X adjacent to Q), growing the loop +2
// dots, still one simple cycle. We pick edges/squares at random.
function growLoop(rows, cols, rng, targetDots) {
  const maxR = rows, maxC = cols; // dot coordinate bounds (inclusive)
  // Start from a random small dot rectangle (at least 1 cell).
  const r0 = rng.range(0, Math.max(0, maxR - 1));
  const c0 = rng.range(0, Math.max(0, maxC - 1));
  const r1 = Math.min(maxR, r0 + rng.range(1, Math.max(1, maxR - r0)));
  const c1 = Math.min(maxC, c0 + rng.range(1, Math.max(1, maxC - c0)));
  if (r1 - r0 < 1 || c1 - c0 < 1) return null;

  let cycle = rectangleCycle(r0, c0, r1, c1);

  const key = (r, c) => `${r},${c}`;
  let onLoop = new Set(cycle.map((p) => key(p.r, p.c)));
  function inB(r, c) { return r >= 0 && c >= 0 && r <= maxR && c <= maxC; }

  const maxIter = targetDots * 14 + 300;
  let iter = 0;
  while (cycle.length < targetDots && iter++ < maxIter) {
    const i = rng.int(cycle.length);
    const P = cycle[i];
    const Q = cycle[(i + 1) % cycle.length];
    const dr = Q.r - P.r, dc = Q.c - P.c; // unit step P→Q
    const perps = rng.rand() < 0.5
      ? [{ pr: -dc, pc: dr }, { pr: dc, pc: -dr }]
      : [{ pr: dc, pc: -dr }, { pr: -dc, pc: dr }];
    let bumped = false;
    for (const { pr, pc } of perps) {
      const Y = { r: P.r + pr, c: P.c + pc }; // adjacent to P
      const X = { r: Q.r + pr, c: Q.c + pc }; // adjacent to Q
      if (!inB(Y.r, Y.c) || !inB(X.r, X.c)) continue;
      if (onLoop.has(key(Y.r, Y.c)) || onLoop.has(key(X.r, X.c))) continue;
      cycle.splice((i + 1) % cycle.length === 0 ? cycle.length : i + 1, 0, Y, X);
      onLoop.add(key(Y.r, Y.c)); onLoop.add(key(X.r, X.c));
      bumped = true;
      break;
    }
    if (!bumped) continue;
  }

  // Guard: still a simple cycle (no repeated dot).
  const seen = new Set();
  for (const p of cycle) {
    const k = key(p.r, p.c);
    if (seen.has(k)) return null;
    seen.add(k);
  }
  if (cycle.length < 4) return null;
  return cycle;
}

// --- clue derivation -------------------------------------------------------------------------
// From a loop object (edgeKey→1 over dot ids), compute each CELL's edge-count: how many of its 4
// surrounding lattice edges are present. Returns a Map "r,c" → count for every cell.
function cellCounts(rows, cols, loop) {
  const has = (a, b) => loop[edgeKeyOf(a, b)] === 1;
  const counts = new Map();
  for (let cr = 0; cr < rows; cr++) {
    for (let cc = 0; cc < cols; cc++) {
      const tl = dotId(cr, cc), tr = dotId(cr, cc + 1);
      const bl = dotId(cr + 1, cc), br = dotId(cr + 1, cc + 1);
      let n = 0;
      if (has(tl, tr)) n++; // top
      if (has(bl, br)) n++; // bottom
      if (has(tl, bl)) n++; // left
      if (has(tr, br)) n++; // right
      counts.set(`${cr},${cc}`, n);
    }
  }
  return counts;
}

// --- generate -------------------------------------------------------------------------------

export function generate(params) {
  const { size, density } = presetFor(params);
  const rows = size, cols = size;
  const seed = (params.seed >>> 0) || 1;
  const dotTotal = (rows + 1) * (cols + 1);
  const targetDots = Math.max(8, Math.round(dotTotal * density));

  const budget = {
    maxAttempts: params.maxAttempts || 200,
    maxMs: params.maxMs || 3000,
  };
  const t0 = Date.now();
  let attempts = 0;

  while (attempts < budget.maxAttempts && (Date.now() - t0) < budget.maxMs) {
    attempts++;
    const rng = makeGenRng((seed ^ (attempts * 0x9e3779b1)) >>> 0);
    const cycle = growLoop(rows, cols, rng, targetDots);
    if (!cycle || cycle.length < 4) continue;

    const loop = cycleToLoop(cycle);
    const counts = cellCounts(rows, cols, loop);

    // Reveal ALL cells as clues (full clue board is maximally constrained).
    let clues = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        clues.push({ r, c, n: counts.get(`${r},${c}`) });
      }
    }

    // Verify uniqueness fully clued (a full clue board's check is cheap — it's tightly constrained).
    if (countSolutions(rows, cols, clues, 2) !== 1) continue; // re-roll the loop

    // GREEDILY thin clues while uniqueness holds → a cleaner puzzle. Shuffle removal order for
    // variety (seeded → reproducible). We use a BOUNDED uniqueness check (nodeBudget): a sparse
    // intermediate board can blow up the backtracker, so we cap its work. An aborted check is treated
    // as "NOT safely unique" → we KEEP that clue. This guarantees fast generation and a final board
    // whose uniqueness was confirmed within budget (so the shipped puzzle's exact check is fast too).
    // It only ever errs toward a slightly denser board — never toward a non-unique one.
    const order = rng.shuffle(clues.map((_, k) => k));
    const keep = new Array(clues.length).fill(true);
    for (const k of order) {
      keep[k] = false;
      const subset = clues.filter((_, j) => keep[j]);
      if (subset.length === 0) { keep[k] = true; continue; }
      const { count, aborted } = countSolutionsBounded(rows, cols, subset, 2, THIN_NODE_BUDGET);
      if (aborted || count !== 1) {
        keep[k] = true; // removing it broke uniqueness, emptied it, or got too expensive → keep it
      }
    }
    clues = clues.filter((_, j) => keep[j]).map((cl) => ({ r: cl.r, c: cl.c, n: cl.n }));

    // FINAL exact verification of the shipped board. Because every accepted removal passed a bounded
    // unique check, this is fast and (in practice always) confirms unique. If it somehow doesn't,
    // fall back to the fully-clued board for THIS loop, which we already verified unique above.
    if (countSolutions(rows, cols, clues, 2) === 1) {
      return { rows, cols, clues, loop, unique: true, attempts, ms: Date.now() - t0 };
    }
    const full = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) full.push({ r, c, n: counts.get(`${r},${c}`) });
    return { rows, cols, clues: full, loop, unique: true, attempts, ms: Date.now() - t0 };
  }

  // Budget exhausted → deterministic provably-unique fallback.
  return knownGood(rows, cols, seed);
}

// A deterministic, provably-unique fallback. A perimeter RECTANGLE loop, FULLY clued (every cell's
// true edge-count revealed). A fully-clued board is maximally constrained; we VERIFY uniqueness. If
// the full-board perimeter isn't unique we shrink the rectangle (tighter constraints) until a
// fully-clued perimeter verifies unique. A 1×1-cell perimeter (a 4-dot loop) fully clued is trivially
// unique, so this always terminates with a genuine single-solution puzzle.
function knownGood(rows, cols, seed) {
  for (let shrink = 0; ; shrink++) {
    const r0 = shrink, c0 = shrink;
    const r1 = rows - shrink, c1 = cols - shrink; // DOT bounds
    if (r1 - r0 < 1 || c1 - c0 < 1) break;
    const cycle = rectangleCycle(r0, c0, r1, c1);
    const loop = cycleToLoop(cycle);
    const counts = cellCounts(rows, cols, loop);
    const clues = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) clues.push({ r, c, n: counts.get(`${r},${c}`) });
    if (countSolutions(rows, cols, clues, 2) === 1) {
      return { rows, cols, clues, loop, unique: true, attempts: 0, ms: 0, fallback: true };
    }
  }
  // Minimal guaranteed-unique loop: a single 1×1-cell perimeter at the top-left, fully clued.
  const cycle = rectangleCycle(0, 0, 1, 1);
  const loop = cycleToLoop(cycle);
  const counts = cellCounts(rows, cols, loop);
  const clues = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) clues.push({ r, c, n: counts.get(`${r},${c}`) });
  return { rows, cols, clues, loop, unique: true, attempts: 0, ms: 0, fallback: true };
}
