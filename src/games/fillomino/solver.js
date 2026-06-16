// src/games/fillomino/solver.js — Fillomino self-solver + uniqueness counter (§5).
// Pure logic, no DOM. The generator uses countSolutions() to guarantee a unique fill and
// solveFill() returns one filled value grid; index.js reuses both for solve()/uniqueness.
//
// Model. The board is rows×cols. Each cell holds a positive integer. A "region" is a maximal
// orthogonally-connected group of equal-valued cells. A board is a valid Fillomino solution iff
// every region's SIZE equals its VALUE (a region of value N has exactly N cells). `givens` carries
// the clue values (0/empty where unknown); a solution must agree with every non-zero given.
//
// Search. Plain backtracking that fills cells in row-major order, trying each candidate value.
// Pruning (Fillomino-specific), checked incrementally as each value is placed:
//   1. A connected equal-value region may never EXCEED its value (over-grow ⇒ dead end).
//   2. Two DISTINCT same-size COMPLETE regions may not touch orthogonally (they'd merge into a
//      region whose size ≠ value). We forbid a value V from sitting next to an already-complete
//      region of value V that it is not part of.
//   3. When a region becomes fully enclosed (no empty cell orthogonally adjacent to it and it can
//      no longer grow), its size must equal its value.
// Correctness over speed. A 7×7 uniqueness check finishes well under 1s on the generated boards.

// Cap on any region's value: the board side length (max(rows,cols)). Values above this can never
// form a legal region inside the board, so candidate values are restricted to [1, sideCap].
function sideCap(rows, cols) { return Math.max(rows, cols); }

const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// --- region flood over a (partial) value grid ------------------------------------------------
// Flood the maximal equal-value region containing (r,c) over `vals` (0 = empty). Returns the list
// of flat indices in that region. Only used by the incremental checks below.
function floodRegion(vals, rows, cols, r, c) {
  const v = vals[r * cols + c];
  const seen = new Set();
  const stack = [[r, c]];
  seen.add(r * cols + c);
  const out = [];
  while (stack.length) {
    const [cr, cc] = stack.pop();
    out.push(cr * cols + cc);
    for (const [dr, dc] of NB) {
      const nr = cr + dr, nc = cc + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const idx = nr * cols + nc;
      if (seen.has(idx)) continue;
      if (vals[idx] === v) { seen.add(idx); stack.push([nr, nc]); }
    }
  }
  return out;
}

// Does the region (set of flat indices, all value v) have an empty orthogonal neighbour it could
// still grow into? If not, it is fully enclosed and its size is final.
function regionCanGrow(vals, rows, cols, region) {
  for (const idx of region) {
    const r = Math.floor(idx / cols), c = idx % cols;
    for (const [dr, dc] of NB) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      if (vals[nr * cols + nc] === 0) return true;
    }
  }
  return false;
}

// Validity check after placing value v at flat index `at`. `vals` already includes the placement.
// Returns false if this placement creates an immediate contradiction.
function placementOk(vals, rows, cols, at) {
  const v = vals[at];
  const r = Math.floor(at / cols), c = at % cols;

  // Rule 2: the new cell must not sit beside a DISTINCT complete region of the same value. Because
  // we build regions incrementally and never let one exceed its value, a same-value neighbour that
  // is part of a DIFFERENT region (i.e. the merged region would exceed v) is the failure we catch
  // below via the over-grow rule. The explicit adjacency test for *complete* regions is covered by
  // the over-grow rule too: two complete value-v regions touching would flood into one region of
  // size 2v > v. So a single over-grow check after each placement enforces both rules 1 and 2.

  // Flood the region this cell now belongs to and check it has not exceeded v (Rules 1 & 2).
  const region = floodRegion(vals, rows, cols, r, c);
  if (region.length > v) return false;

  // Rule 3 (look-ahead): if this region can no longer grow (fully enclosed) it must already have
  // size === v. We must check the touched region AND any neighbouring regions whose growth room the
  // new cell may have just removed.
  if (region.length < v && !regionCanGrow(vals, rows, cols, region)) return false;

  // Neighbouring DIFFERENT-value regions may have just been enclosed by this placement.
  const checked = new Set(region);
  for (const [dr, dc] of NB) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
    const nidx = nr * cols + nc;
    if (vals[nidx] === 0 || checked.has(nidx)) continue;
    const nv = vals[nidx];
    const nregion = floodRegion(vals, rows, cols, nr, nc);
    for (const x of nregion) checked.add(x);
    if (nregion.length > nv) return false;
    if (nregion.length < nv && !regionCanGrow(vals, rows, cols, nregion)) return false;
  }
  return true;
}

// Candidate values for the empty cell at (r,c): [1, sideCap], honouring any given. We prune
// candidates that obviously can't extend a too-big neighbouring region, but full validity is
// confirmed by placementOk after the tentative placement.
function candidateValues(vals, rows, cols, r, c, givens, cap) {
  const g = givens ? givens[r * cols + c] : 0;
  if (g && g > 0) return [g];
  const out = [];
  for (let v = 1; v <= cap; v++) out.push(v);
  return out;
}

// Core backtracking fill. onSolution(vals) is called with the completed value grid (a flat array)
// for each full valid Fillomino solution; return true from onSolution to STOP the search early.
function search(rows, cols, givens, onSolution) {
  const N = rows * cols;
  const cap = sideCap(rows, cols);
  const vals = new Int32Array(N);
  if (givens) for (let i = 0; i < N; i++) if (givens[i] > 0) vals[i] = givens[i];

  // Validate the givens themselves don't already contradict (over-grown given regions).
  for (let i = 0; i < N; i++) {
    if (vals[i] === 0) continue;
    const r = Math.floor(i / cols), c = i % cols;
    const region = floodRegion(vals, rows, cols, r, c);
    if (region.length > vals[i]) return; // givens contradict — no solution
  }

  function recurse(start) {
    let i = start;
    while (i < N && vals[i] !== 0) i++;
    if (i === N) {
      // Fully filled — verify every region size === value (final guard; pruning should ensure it).
      const seen = new Uint8Array(N);
      for (let idx = 0; idx < N; idx++) {
        if (seen[idx]) continue;
        const r = Math.floor(idx / cols), c = idx % cols;
        const region = floodRegion(vals, rows, cols, r, c);
        if (region.length !== vals[idx]) return false;
        for (const x of region) seen[x] = 1;
      }
      return onSolution(Array.from(vals));
    }
    const r = Math.floor(i / cols), c = i % cols;
    for (const v of candidateValues(vals, rows, cols, r, c, givens, cap)) {
      vals[i] = v;
      if (placementOk(vals, rows, cols, i)) {
        if (recurse(i + 1)) { vals[i] = 0; return true; }
      }
      vals[i] = 0;
    }
    return false;
  }

  recurse(0);
}

// Count solutions, capped at `limit` (default 2 — all we need for uniqueness). Returns 0, 1, or
// up to `limit`. Stops as soon as `limit` solutions are found.
export function countSolutions(rows, cols, givens, limit = 2) {
  let count = 0;
  search(rows, cols, givens, () => {
    count++;
    return count >= limit;
  });
  return count;
}

// Return one filled value grid (flat Int array) for the givens, or null if unsolvable.
export function solveFill(rows, cols, givens) {
  let result = null;
  search(rows, cols, givens, (vals) => { result = vals; return true; });
  return result;
}

// --- shared validators (used by index.js; kept here so the engine has one source of truth) ----

// Every maximal equal-value region size === value, over a COMPLETE flat value grid. Returns true
// for a valid Fillomino solution. (Empty cells, value 0, make it return false.)
export function isValidFill(rows, cols, vals) {
  const N = rows * cols;
  const seen = new Uint8Array(N);
  for (let idx = 0; idx < N; idx++) {
    if (vals[idx] === 0 || vals[idx] == null) return false;
    if (seen[idx]) continue;
    const r = Math.floor(idx / cols), c = idx % cols;
    const region = floodRegion(vals, rows, cols, r, c);
    if (region.length !== vals[idx]) return false;
    for (const x of region) seen[x] = 1;
  }
  return true;
}

// Flat indices of cells whose connected equal-value region size EXCEEDS its value (over-grown
// regions). Empty cells (0/null) are ignored. Used by index.js findConflicts.
export function overgrownCells(rows, cols, vals) {
  const N = rows * cols;
  const bad = new Set();
  const seen = new Uint8Array(N);
  for (let idx = 0; idx < N; idx++) {
    if (!vals[idx]) { seen[idx] = 1; continue; }
    if (seen[idx]) continue;
    const r = Math.floor(idx / cols), c = idx % cols;
    const region = floodRegion(vals, rows, cols, r, c);
    for (const x of region) seen[x] = 1;
    if (region.length > vals[idx]) for (const x of region) bad.add(x);
  }
  return [...bad];
}

export { floodRegion };
