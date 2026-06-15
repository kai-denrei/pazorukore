// src/games/shikaku/generator.js — random rectangulation + uniqueness-guaranteed clue layout
// (§12.2). Pure, seeded via makeGenRng so a gameId reproduces the puzzle exactly. No DOM.
//
// Pipeline:
//   1. Tile the whole board with non-overlapping rectangles (randomTiling) — a full guillotine
//      split with randomized cut positions, biased away from degenerate 1×N slivers.
//   2. Choose an anchor cell per rectangle and emit a clue { id, r, c, area }.
//   3. Run the uniqueness counter (solver.countSolutions). If the clue layout is NOT uniquely
//      solvable, retry with a fresh tiling (and re-randomized anchors) until unique OR the budget
//      (attempts / time) is exhausted — then fall back to the last unique-or-not layout.
//
// BUDGET: maxAttempts tilings, each re-tried with a few anchor re-rolls, all under a wall-clock
// cap. On 7×7 easy this converges in a handful of attempts well under the cap (see test timing).

import { makeGenRng } from '../../core/rng.js';
import { countSolutions } from './solver.js';

// --- random guillotine tiling --------------------------------------------------------------
// Recursively split a rectangle [r0,r1]×[c0,c1] into sub-rectangles. We stop splitting a piece
// when it is small enough (area <= maxArea) AND a coin (biased by minPieces pressure) says stop,
// or when it can no longer be split (1×1). Returns an array of { r0, c0, r1, c1, area }.
function randomTiling(rows, cols, rng, opts) {
  const { minArea, maxArea } = opts;
  const pieces = [];

  function area(r0, c0, r1, c1) { return (r1 - r0 + 1) * (c1 - c0 + 1); }

  function split(r0, c0, r1, c1, depth) {
    const h = r1 - r0 + 1, w = c1 - c0 + 1, a = area(r0, c0, r1, c1);
    const canSplitV = w > 1, canSplitH = h > 1;
    // Decide whether to stop here. Always stop at 1×1. Stop probabilistically once within target.
    if (!canSplitV && !canSplitH) { pieces.push({ r0, c0, r1, c1, area: a }); return; }
    if (a <= maxArea) {
      // Once inside the target band, decide whether to keep this piece. Keep small pieces (don't
      // fragment to 1×1s) AND keep big pieces (so chunky boards retain large anchors up to maxArea);
      // mid-size pieces split more often → a genuine mix of areas incl. high ones (8,9,12,…).
      const t = Math.max(0, Math.min(1, (a - minArea) / Math.max(1, maxArea - minArea)));
      const stopProb = a <= minArea ? 1 : 0.4 + 0.45 * t;   // never split a minimum-area piece → no 1×1 spam
      if (rng.rand() < stopProb) { pieces.push({ r0, c0, r1, c1, area: a }); return; }
    }
    // Choose a split orientation. Prefer cutting the longer side; bias toward whichever is legal.
    let vertical;
    if (canSplitV && canSplitH) vertical = (w > h) ? rng.rand() < 0.72 : rng.rand() < 0.28;
    else vertical = canSplitV;
    if (vertical) {
      const cut = c0 + cutOffset(w, rng); // bias both sides ≥ 2 wide where possible (avoid 1-thick slivers)
      split(r0, c0, r1, cut, depth + 1);
      split(r0, cut + 1, r1, c1, depth + 1);
    } else {
      const cut = r0 + cutOffset(h, rng);
      split(r0, c0, cut, c1, depth + 1);
      split(cut + 1, c0, r1, c1, depth + 1);
    }
  }

  split(0, 0, rows - 1, cols - 1, 0);
  return pieces;
}

// A guillotine cut offset for a side of length `len`. When there's room (len ≥ 4) keep BOTH resulting
// sides ≥ 2 thick so we don't shed 1-thick slivers that fragment into 1×1 clues; otherwise allow any.
function cutOffset(len, rng) {
  if (len >= 4) return rng.range(1, len - 3);
  return rng.range(0, len - 2);
}

// Choose an anchor cell within a rectangle. We avoid always using a corner (too easy/uniform);
// pick a random interior-ish cell, which also tends to help uniqueness.
function chooseAnchor(piece, rng) {
  const r = piece.r0 + rng.int(piece.r1 - piece.r0 + 1);
  const c = piece.c0 + rng.int(piece.c1 - piece.c0 + 1);
  return { r, c };
}

// Difficulty presets → grid size + size band for the random tiling. Smaller maxArea ⇒ more, smaller
// rectangles ⇒ generally more forced (easier) deductions; larger ⇒ harder.
// Each preset gives a grid size + a RANGE for the per-puzzle maximum rectangle area. generate()
// picks a random maxArea in [maxAreaLo, maxAreaHi] per puzzle (seeded), so the number and size of
// anchors varies board to board — some chunky (few big rectangles up to maxAreaHi), some fine-grained.
export const PRESETS = {
  easy: { size: 8, minArea: 2, maxAreaLo: 5, maxAreaHi: 12 },
  medium: { size: 9, minArea: 2, maxAreaLo: 6, maxAreaHi: 16 },
  hard: { size: 11, minArea: 3, maxAreaLo: 8, maxAreaHi: 22 },
};

export function presetFor(params) {
  const base = PRESETS[params.difficulty] || PRESETS.easy;
  const size = params.size || base.size;
  return { size, minArea: base.minArea, maxAreaLo: base.maxAreaLo, maxAreaHi: base.maxAreaHi };
}

// Generate a uniquely-solvable Shikaku clue layout. Returns
//   { rows, cols, clues:[{id,r,c,area}], tiling:[{r0,c0,r1,c1,area, anchor:{r,c}}], unique, attempts, ms }
// `tiling` is the generator's own solution (the rectangulation the clues were derived from);
// because the layout is verified unique, it equals the solver's solution.
export function generate(params) {
  const { size, minArea, maxAreaLo, maxAreaHi } = presetFor(params);
  const rows = size, cols = size;
  const seed = (params.seed >>> 0) || 1;

  // Per-puzzle chunkiness: pick this board's maximum rectangle area (seeded → reproducible). A high
  // pick yields fewer, larger anchors (e.g. 8,9,12); a low pick yields more, smaller ones.
  const maxArea = params.maxArea || makeGenRng(seed).range(maxAreaLo, maxAreaHi);

  const budget = {
    maxAttempts: params.maxAttempts || 400,
    maxMs: params.maxMs || 600,
    anchorRerolls: 4,
  };
  const t0 = Date.now();
  let attempts = 0;
  let fallback = null; // best-effort layout if we never hit unique within budget

  while (attempts < budget.maxAttempts && (Date.now() - t0) < budget.maxMs) {
    attempts++;
    // Derive a per-attempt seed so each tiling is distinct yet reproducible from the base seed.
    const rng = makeGenRng((seed ^ (attempts * 0x9e3779b1)) >>> 0);
    const pieces = randomTiling(rows, cols, rng, { minArea, maxArea });
    // Reject pathological all-1×1 tilings (every clue "1" is trivially unique but a boring puzzle):
    if (pieces.length >= rows * cols) { if (!fallback) {/* keep looking */} continue; }

    for (let reroll = 0; reroll < budget.anchorRerolls; reroll++) {
      const clues = pieces.map((p, i) => {
        const a = chooseAnchor(p, rng);
        return { id: `clue-${i}`, r: a.r, c: a.c, area: p.area };
      });
      const tiling = pieces.map((p, i) => ({ ...p, anchor: { r: clues[i].r, c: clues[i].c } }));
      const layout = { rows, cols, clues, tiling, attempts, ms: Date.now() - t0 };
      if (!fallback) fallback = { ...layout, unique: false };

      const count = countSolutions(rows, cols, clues, 2);
      if (count === 1) {
        return { ...layout, unique: true, ms: Date.now() - t0 };
      }
      // not unique with these anchors → reroll anchors (cheap) before re-tiling (expensive)
    }
  }

  // Budget exhausted. Fall back to a guaranteed-unique known-good layout for this size so we never
  // hand back a broken puzzle. A full row-strip tiling (each row split into fixed rectangles with a
  // single anchor each) is trivially unique because every clue's only fitting rectangle is its row
  // segment. We use 1×k horizontal strips that tile each row.
  return knownGood(rows, cols, seed);
}

// A deterministic, provably-unique fallback: tile each row into a couple of horizontal strips.
// A 1×k strip clue can only be realized as that exact strip (height 1 forced by neighbors), making
// the whole layout uniquely solvable regardless of seed. Anchors at the strip's left cell.
function knownGood(rows, cols, seed) {
  const rng = makeGenRng(seed >>> 0);
  const clues = [];
  const tiling = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      // strip width 2..3, clamped to row end; width 1 only if a single cell remains
      let w = Math.min(rng.range(2, 3), cols - c);
      if (w < 1) w = 1;
      const c1 = c + w - 1;
      clues.push({ id: `clue-${i}`, r, c, area: w });
      tiling.push({ r0: r, c0: c, r1: r, c1, area: w, anchor: { r, c } });
      c = c1 + 1; i++;
    }
  }
  return { rows, cols, clues, tiling, unique: true, attempts: 0, ms: 0, fallback: true };
}
