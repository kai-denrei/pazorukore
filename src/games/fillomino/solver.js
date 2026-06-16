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

// SOUND growth-space bound for a partial region of value v. A region of value v can still grow into
// empty cells, and may MERGE with other value-v cells it reaches through empty cells (a legal merge
// while total ≤ v). So the cells it could ultimately absorb form the connected component, starting
// from `region`, that traverses through EMPTY cells and through OTHER value-v cells. We count cells
// in that component NOT already in `region` (i.e. the extra capacity), capped at `need` (= v - size)
// for an early exit. If that capacity < need, the region can never reach size v → prune.
//
// This is an OVER-estimate of reachable capacity (it ignores that some empty cells will be claimed
// by other regions), so using it only to PRUNE when capacity < need is sound: we never reject a
// branch that could actually complete.
function reachableSpace(vals, rows, cols, region, need, v) {
  const seen = new Set(region);
  const stack = [];
  for (const idx of region) stack.push(idx);
  let count = 0;
  while (stack.length && count < need) {
    const idx = stack.pop();
    const r = Math.floor(idx / cols), c = idx % cols;
    for (const [dr, dc] of NB) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const nidx = nr * cols + nc;
      if (seen.has(nidx)) continue;
      const nv = vals[nidx];
      if (nv === 0 || nv === v) {
        // An empty cell is absorbable; a same-value cell is reachable AND absorbable (legal merge).
        seen.add(nidx);
        count++;
        stack.push(nidx);
      }
    }
  }
  return count;
}

// Validity check after placing value v at flat index `at`. `vals` already includes the placement.
// Returns false if this placement creates an immediate contradiction.
function placementOk(vals, rows, cols, at) {
  const v = vals[at];
  const r = Math.floor(at / cols), c = at % cols;

  // Flood the region this cell now belongs to. A same-value neighbour that belongs to a DISTINCT
  // complete region merges in here, so this one over-grow test enforces BOTH "no region exceeds its
  // value" (Rule 1) and "no two same-size complete regions touch" (Rule 2).
  const region = floodRegion(vals, rows, cols, r, c);
  if (region.length > v) return false;

  // Rule 3 + forward-check: an incomplete region must be able to reach its value through absorbable
  // (empty or same-value) connected cells. If the reachable extra capacity < what it still needs,
  // this branch can never complete → prune. This subsumes the "fully enclosed must equal value" case
  // (capacity 0 < need). Huge win on sparse boards.
  if (region.length < v) {
    const need = v - region.length;
    if (reachableSpace(vals, rows, cols, region, need, v) < need) return false;
  }

  // Neighbouring DIFFERENT-value regions may have just been enclosed / starved by this placement.
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
    if (nregion.length < nv) {
      const need = nv - nregion.length;
      if (reachableSpace(vals, rows, cols, nregion, need, nv) < need) return false;
    }
  }
  return true;
}

// Candidate values for the empty cell at (r,c), honouring any given. With no given we return the
// FULL range [1, cap]; correctness comes from placementOk's SOUND pruning after each tentative
// placement (an over-grow, an enclosed region that can't reach its value, or a starved region). We
// keep candidate generation deliberately complete so the counter never misses a solution.
function candidateValues(vals, rows, cols, r, c, givens, cap) {
  const g = givens ? givens[r * cols + c] : 0;
  if (g && g > 0) return [g];
  const out = [];
  for (let v = 1; v <= cap; v++) out.push(v);
  return out;
}

// Core backtracking fill. onSolution(vals) is called with the completed value grid (a flat array)
// for each full valid Fillomino solution; return true from onSolution to STOP the search early.
// `maxNodes` (optional) caps the number of cell-placement nodes explored; on overflow the search
// aborts and sets out.aborted=true (the caller treats an aborted uniqueness check conservatively).
function search(rows, cols, givens, onSolution, maxNodes = Infinity, out = {}) {
  const N = rows * cols;
  const cap = sideCap(rows, cols);
  const vals = new Int32Array(N);
  if (givens) for (let i = 0; i < N; i++) if (givens[i] > 0) vals[i] = givens[i];
  let nodes = 0;
  out.aborted = false;

  // Validate the givens themselves don't already contradict (over-grown given regions).
  for (let i = 0; i < N; i++) {
    if (vals[i] === 0) continue;
    const r = Math.floor(i / cols), c = i % cols;
    const region = floodRegion(vals, rows, cols, r, c);
    if (region.length > vals[i]) return; // givens contradict — no solution
  }

  // Viable candidate values for the empty cell at index `i`: those that survive placementOk when
  // tentatively placed. Returns the list (possibly empty). Sound + complete.
  function viableAt(i) {
    const r = Math.floor(i / cols), c = i % cols;
    const ok = [];
    for (const v of candidateValues(vals, rows, cols, r, c, givens, cap)) {
      vals[i] = v;
      if (placementOk(vals, rows, cols, i)) ok.push(v);
      vals[i] = 0;
    }
    return ok;
  }

  // Most-constrained-cell (MRV) backtracking. At each step choose the empty cell with the FEWEST
  // viable candidates — prefer cells already touching filled cells (more constrained), which makes
  // proving uniqueness on sparse boards far cheaper than a fixed row-major sweep. Sound: fill order
  // doesn't affect the set of complete solutions.
  function recurse(remaining) {
    if (remaining === 0) {
      // Fully filled — final guard: every region size === value (pruning should already ensure it).
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

    // Pick the empty cell with the fewest viable candidates. Bias selection toward cells adjacent to
    // a filled cell so the search stays local and well-constrained.
    let bestIdx = -1, bestOpts = null, bestScore = Infinity;
    for (let i = 0; i < N; i++) {
      if (vals[i] !== 0) continue;
      const r = Math.floor(i / cols), c = i % cols;
      let touchesFilled = false;
      for (const [dr, dc] of NB) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        if (vals[nr * cols + nc] !== 0) { touchesFilled = true; break; }
      }
      const opts = viableAt(i);
      if (opts.length === 0) return false;              // dead cell → prune this branch immediately
      // Score: fewer options first; among ties prefer cells touching filled cells (tie-break -0.5).
      const score = opts.length - (touchesFilled ? 0.5 : 0);
      if (score < bestScore) {
        bestScore = score; bestIdx = i; bestOpts = opts;
        if (opts.length === 1 && touchesFilled) break;  // can't do better than a forced local cell
      }
    }

    for (const v of bestOpts) {
      if (++nodes > maxNodes) { out.aborted = true; return true; } // bail: stop the whole search
      vals[bestIdx] = v;
      const stop = recurse(remaining - 1);
      vals[bestIdx] = 0;
      if (stop) return true;
    }
    return false;
  }

  let empties = 0;
  for (let i = 0; i < N; i++) if (vals[i] === 0) empties++;
  recurse(empties);
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

// Bounded uniqueness probe for the generator's clue-digging hot loop. Returns true iff the givens
// are provably UNIQUELY solvable WITHIN the node budget. If the search aborts (too expensive) we
// return false — conservative: the generator then keeps the clue rather than risk a non-unique
// puzzle. This NEVER reports a non-unique board as unique. Not part of the public solver API.
export function isUniqueBounded(rows, cols, givens, maxNodes) {
  let count = 0;
  const out = {};
  search(rows, cols, givens, () => { count++; return count >= 2; }, maxNodes, out);
  if (out.aborted) return false; // ran out of budget → treat as "not provably unique"
  return count === 1;
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
