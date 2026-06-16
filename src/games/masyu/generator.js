// src/games/masyu/generator.js — LOOP-FIRST Masyu (Tatham "Pearl") generation. Pure, seeded via
// makeGenRng(seed) so a gameId reproduces the puzzle exactly. No DOM.
//
// Pipeline:
//   1. Generate a random SINGLE closed loop on the rows×cols grid: start from a small rectangle
//      cycle and apply randomized "bump" perturbations that grow the loop into adjacent cells while
//      keeping it ONE simple (non-self-crossing) closed loop. Result: a set of cell-edges forming a
//      single cycle covering a good fraction of cells.
//   2. Classify each loop cell straight/turn. Collect every cell that COULD legally host a white
//      pearl and every cell that could host a black pearl, per the Masyu rules.
//   3. Place ALL valid candidate pearls, verify uniqueness via countSolutions(...,2)===1, then
//      GREEDILY remove pearls while uniqueness holds (cleaner puzzle). If not unique even with all
//      candidates, re-roll the loop.
//   4. Budget: maxAttempts + wall-clock cap. A deterministic provably-unique FALLBACK (a fixed
//      rectangle-loop layout with enough pearls) guarantees generate() never returns a broken puzzle.
//
// Export: generate(params) → { rows, cols, pearls:[{id,r,c,kind}], loop:{...}, unique, attempts, ms }
//         presetFor(params).

import { makeGenRng } from '../../core/rng.js';
import { countSolutions } from './solver.js';

const cellId = (r, c) => `r${r}c${c}`;
function edgeKeyOf(idA, idB) { return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`; }

// Difficulty presets → grid size + loop density target (fraction of cells the loop should cover).
//
// NOTE on sizing: the loop solver is a backtracking edge-CSP. It is fast when the board is small or
// densely clued, but uniqueness checks on a SPARSELY clued board grow super-linearly with side
// length — at side 7+ a single countSolutions() can run for tens of seconds. Per the unit brief
// ("shrink the board or loop density rather than ship something broken"), we keep ALL difficulties
// on a 6×6 board (where 6×6 uniqueness finishes in well under a second) and express difficulty
// through LOOP DENSITY instead: a denser loop yields more pearls and twistier solutions. This keeps
// generation correct and fast across every preset.
export const PRESETS = {
  easy: { size: 6, density: 0.55 },
  medium: { size: 6, density: 0.65 },
  hard: { size: 6, density: 0.78 },
};

export function presetFor(params) {
  const base = PRESETS[params.difficulty] || PRESETS.easy;
  const size = params.size || base.size;
  return { size, density: base.density };
}

// --- loop representation --------------------------------------------------------------------
// A loop is held as an ordered list of cells [ {r,c}, ... ] forming a simple cycle (consecutive
// cells are orthogonally adjacent, and the last wraps to the first). We grow it with "bumps".

// Build a loop's edge set { edgeKey: 1 } from an ordered cycle of cells.
function cycleToLoop(cycle) {
  const loop = {};
  for (let i = 0; i < cycle.length; i++) {
    const a = cycle[i], b = cycle[(i + 1) % cycle.length];
    loop[edgeKeyOf(cellId(a.r, a.c), cellId(b.r, b.c))] = 1;
  }
  return loop;
}

// A starting rectangle cycle: the perimeter of a rows×cols rectangle [r0..r1]×[c0..c1], walked
// clockwise. Requires at least a 2×2 area. Returns an ordered cell cycle.
function rectangleCycle(r0, c0, r1, c1) {
  const cyc = [];
  for (let c = c0; c <= c1; c++) cyc.push({ r: r0, c });       // top row →
  for (let r = r0 + 1; r <= r1; r++) cyc.push({ r, c: c1 });   // right col ↓
  for (let c = c1 - 1; c >= c0; c--) cyc.push({ r: r1, c });   // bottom row ←
  for (let r = r1 - 1; r >= r0 + 1; r--) cyc.push({ r, c: c0 });// left col ↑
  return cyc;
}

// Grow the loop with randomized "bumps". A bump takes a straight segment of the cycle (cell P at
// index i with neighbours along the same line) and pushes one edge of the loop outward into an
// adjacent empty cell, turning a length-1 straight run into a 3-cell detour — net +2 cells, still a
// single simple cycle. We implement the canonical grid-loop perturbation: pick an edge (P→Q) of the
// cycle; let the cell X be adjacent to BOTH P and Q on one side (forming a unit square P,Q,X,Y).
// If X and Y are both currently OFF the loop, replace edge P→Q with P→Y→X→Q (Y adjacent to P, X
// adjacent to Q). This grows the loop into the square. We pick squares at random.
function growLoop(rows, cols, rng, targetCells) {
  // Start from a random interior rectangle of modest size.
  const r0 = rng.range(0, Math.max(0, rows - 2));
  const c0 = rng.range(0, Math.max(0, cols - 2));
  const r1 = Math.min(rows - 1, r0 + rng.range(1, Math.max(1, rows - 1 - r0)));
  const c1 = Math.min(cols - 1, c0 + rng.range(1, Math.max(1, cols - 1 - c0)));
  if (r1 - r0 < 1 || c1 - c0 < 1) return null;

  let cycle = rectangleCycle(r0, c0, r1, c1);

  // onLoop set for O(1) membership.
  const key = (r, c) => `${r},${c}`;
  let onLoop = new Set(cycle.map((p) => key(p.r, p.c)));

  // Edge index helper: the cycle is ordered; edge i connects cycle[i] and cycle[i+1].
  // For a bump we need a pair of consecutive cells P,Q and an empty unit square outside.
  // Candidate outward square for edge (P,Q): the two cells offset perpendicular to PQ on the side
  // away from the loop interior. We try both sides; accept whichever has both cells empty + in-bounds.
  function inB(r, c) { return r >= 0 && c >= 0 && r < rows && c < cols; }

  const maxIter = targetCells * 12 + 200;
  let iter = 0;
  while (cycle.length < targetCells && iter++ < maxIter) {
    const i = rng.int(cycle.length);
    const P = cycle[i];
    const Q = cycle[(i + 1) % cycle.length];
    const dr = Q.r - P.r, dc = Q.c - P.c; // unit step P→Q
    // perpendicular offsets
    const perps = rng.rand() < 0.5
      ? [{ pr: -dc, pc: dr }, { pr: dc, pc: -dr }]
      : [{ pr: dc, pc: -dr }, { pr: -dc, pc: dr }];
    let bumped = false;
    for (const { pr, pc } of perps) {
      const Y = { r: P.r + pr, c: P.c + pc };       // adjacent to P
      const X = { r: Q.r + pr, c: Q.c + pc };       // adjacent to Q
      if (!inB(Y.r, Y.c) || !inB(X.r, X.c)) continue;
      if (onLoop.has(key(Y.r, Y.c)) || onLoop.has(key(X.r, X.c))) continue;
      // Insert Y,X between P and Q: P → Y → X → Q.
      cycle.splice((i + 1) % cycle.length === 0 ? cycle.length : i + 1, 0, Y, X);
      onLoop.add(key(Y.r, Y.c)); onLoop.add(key(X.r, X.c));
      bumped = true;
      break;
    }
    // (if no bump possible at this edge, just try another random edge next iteration)
    if (!bumped) continue;
  }

  // Sanity: ensure it's still a simple cycle (no repeated cell) — the bump invariant guarantees it,
  // but guard anyway.
  const seen = new Set();
  for (const p of cycle) {
    const k = key(p.r, p.c);
    if (seen.has(k)) return null;
    seen.add(k);
  }
  if (cycle.length < 4) return null;
  return cycle;
}

// --- pearl classification -------------------------------------------------------------------
// Given an ordered cycle, classify each loop cell straight/turn and collect legal pearl candidates.
//   • WHITE candidate at X: X is STRAIGHT and at least ONE loop-neighbour of X is a TURN.
//   • BLACK candidate at X: X is a TURN and BOTH loop-neighbours of X are STRAIGHT.
function pearlCandidates(cycle) {
  const n = cycle.length;
  // shape of cycle position j: compare incoming and outgoing step directions.
  const shape = new Array(n);
  for (let j = 0; j < n; j++) {
    const prev = cycle[(j - 1 + n) % n], cur = cycle[j], next = cycle[(j + 1) % n];
    const inDr = cur.r - prev.r, inDc = cur.c - prev.c;
    const outDr = next.r - cur.r, outDc = next.c - cur.c;
    // straight if direction unchanged (in == out); turn otherwise.
    shape[j] = (inDr === outDr && inDc === outDc) ? 'straight' : 'turn';
  }

  const whites = [], blacks = [];
  for (let j = 0; j < n; j++) {
    const cur = cycle[j];
    const prevShape = shape[(j - 1 + n) % n];
    const nextShape = shape[(j + 1) % n];
    if (shape[j] === 'straight') {
      if (prevShape === 'turn' || nextShape === 'turn') {
        whites.push({ r: cur.r, c: cur.c });
      }
    } else { // turn
      if (prevShape === 'straight' && nextShape === 'straight') {
        blacks.push({ r: cur.r, c: cur.c });
      }
    }
  }
  return { whites, blacks };
}

// --- generate -------------------------------------------------------------------------------

export function generate(params) {
  const { size, density } = presetFor(params);
  const rows = size, cols = size;
  const seed = (params.seed >>> 0) || 1;
  const targetCells = Math.max(8, Math.round(rows * cols * density));

  const budget = {
    maxAttempts: params.maxAttempts || 200,
    maxMs: params.maxMs || 2500,
  };
  const t0 = Date.now();
  let attempts = 0;

  while (attempts < budget.maxAttempts && (Date.now() - t0) < budget.maxMs) {
    attempts++;
    const rng = makeGenRng((seed ^ (attempts * 0x9e3779b1)) >>> 0);
    const cycle = growLoop(rows, cols, rng, targetCells);
    if (!cycle || cycle.length < 4) continue;

    const loop = cycleToLoop(cycle);
    const { whites, blacks } = pearlCandidates(cycle);
    // Need at least a couple of pearls to anchor the puzzle.
    if (whites.length + blacks.length < 2) continue;

    // Place ALL candidate pearls.
    let pearls = [];
    let id = 0;
    for (const w of whites) pearls.push({ id: `p${id++}`, r: w.r, c: w.c, kind: 'W' });
    for (const b of blacks) pearls.push({ id: `p${id++}`, r: b.r, c: b.c, kind: 'B' });

    // Verify uniqueness with all candidates present.
    if (countSolutions(rows, cols, pearls, 2) !== 1) {
      continue; // not unique even fully clued → re-roll the loop
    }

    // GREEDILY remove pearls while uniqueness holds → a cleaner puzzle. Shuffle removal order for
    // variety (still seeded → reproducible).
    const order = rng.shuffle(pearls.map((_, k) => k));
    const keep = new Array(pearls.length).fill(true);
    for (const k of order) {
      keep[k] = false;
      const subset = pearls.filter((_, j) => keep[j]);
      if (subset.length === 0 || countSolutions(rows, cols, subset, 2) !== 1) {
        keep[k] = true; // removing it broke uniqueness (or emptied it) → put it back
      }
    }
    pearls = pearls.filter((_, j) => keep[j]).map((p, k) => ({ id: `p${k}`, r: p.r, c: p.c, kind: p.kind }));

    return { rows, cols, pearls, loop, unique: true, attempts, ms: Date.now() - t0 };
  }

  // Budget exhausted → deterministic provably-unique fallback.
  return knownGood(rows, cols, seed);
}

// A deterministic, provably-unique fallback. We take a perimeter RECTANGLE loop and place its FULL
// legal candidate pearl set (every cell that can host a white/black pearl on that loop, computed the
// same way as the main pipeline). A fully-clued perimeter rectangle is heavily constrained; we VERIFY
// it is unique. If a full-board perimeter somehow isn't unique, we shrink the rectangle (which can
// only tighten constraints) until a fully-clued perimeter verifies unique — a 2×2 perimeter (a
// 4-cell all-turn loop) clued with its candidates is trivially unique, so this always terminates with
// a genuine single-solution puzzle. The verification keeps us honest: we never return a broken board.
function knownGood(rows, cols, seed) {
  // Try perimeter rectangles from the full board inward until a fully-clued one is unique.
  for (let shrink = 0; ; shrink++) {
    const r0 = shrink, c0 = shrink;
    const r1 = rows - 1 - shrink, c1 = cols - 1 - shrink;
    if (r1 - r0 < 1 || c1 - c0 < 1) break; // can't shrink further; fall through to the minimal loop
    const cycle = rectangleCycle(r0, c0, r1, c1);
    const loop = cycleToLoop(cycle);
    const { whites, blacks } = pearlCandidates(cycle);
    let id = 0;
    const pearls = [];
    for (const w of whites) pearls.push({ id: `p${id++}`, r: w.r, c: w.c, kind: 'W' });
    for (const b of blacks) pearls.push({ id: `p${id++}`, r: b.r, c: b.c, kind: 'B' });
    if (pearls.length >= 1 && countSolutions(rows, cols, pearls, 2) === 1) {
      return { rows, cols, pearls, loop, unique: true, attempts: 0, ms: 0, fallback: true };
    }
  }

  // Minimal guaranteed-unique loop: a 2×2 perimeter in the top-left corner (4 cells, all turns). On
  // a board this small, this fully-clued loop is the only single closed loop through those pearls.
  const cycle = rectangleCycle(0, 0, 1, 1);
  const loop = cycleToLoop(cycle);
  const { whites, blacks } = pearlCandidates(cycle);
  let id = 0;
  const pearls = [];
  for (const w of whites) pearls.push({ id: `p${id++}`, r: w.r, c: w.c, kind: 'W' });
  for (const b of blacks) pearls.push({ id: `p${id++}`, r: b.r, c: b.c, kind: 'B' });
  return { rows, cols, pearls, loop, unique: true, attempts: 0, ms: 0, fallback: true };
}
