// src/games/kenken/solver.js — KenKen self-solver + uniqueness counter (§5, mirrors Shikaku).
// Pure logic, no DOM. The generator uses countSolutions() to guarantee a unique cage layout;
// solveFill() returns the unique Latin-square fill that honours every cage.
//
// Model. The board is N×N. A solution is a Latin square (values 1..N, no repeat in any row or
// column) such that every cage's cells, combined under the cage's operator, hit the cage target:
//   '+'  sum of cells === target
//   'x'  product of cells === target
//   '-'  |a - b| === target            (size-2 cages only)
//   '/'  max(a,b) / min(a,b) === target (size-2 cages only, exact integer division)
// A size-1 cage has no operator; its single cell must equal target.
//
// A cage is { id, cells:[flatIdx...], op, target }. cells are flat indices r*cols + c.

// --- cage arithmetic -------------------------------------------------------------------------

// Does a COMPLETE set of cage values satisfy its op→target? values is an array of ints.
export function cageSatisfied(op, target, values) {
  if (op == null || values.length === 1) return values[0] === target;
  if (op === '+') {
    let s = 0;
    for (const v of values) s += v;
    return s === target;
  }
  if (op === 'x') {
    let p = 1;
    for (const v of values) p *= v;
    return p === target;
  }
  if (op === '-') {
    if (values.length !== 2) return false;
    return Math.abs(values[0] - values[1]) === target;
  }
  if (op === '/') {
    if (values.length !== 2) return false;
    const hi = Math.max(values[0], values[1]);
    const lo = Math.min(values[0], values[1]);
    return lo !== 0 && hi % lo === 0 && hi / lo === target;
  }
  return false;
}

// Prune a PARTIAL cage: given the values placed so far (filled.length < cage size), can this cage
// still possibly reach its target? Returns false to prune the branch. Conservative: never prunes a
// reachable state.
function cagePartialOk(op, target, filled, remainingCount, N) {
  if (op === '+') {
    let s = 0;
    for (const v of filled) s += v;
    if (s > target) return false;                      // sum already overshoots
    // even if every remaining cell were the max (N), can we still reach target? must be >= target.
    // and with every remaining at min (1), sum must not exceed target — covered above.
    if (s + remainingCount * N < target) return false; // can't reach even at max
    return true;
  }
  if (op === 'x') {
    let p = 1;
    for (const v of filled) p *= v;
    if (target % p !== 0) return false;                // product must divide target
    if (p > target) return false;
    return true;
  }
  // '-' and '/' are size-2 cages; partial = 1 cell placed → nothing to prune yet (any first value
  // can pair with some second). size-1 cages are complete on first placement (handled elsewhere).
  return true;
}

// --- problem build ---------------------------------------------------------------------------

// Build solver scaffolding from cages. Returns { N, cages, cellCage } where cellCage[idx] = cage
// index owning that cell, and each cage carries { idx, op, target, cells:[...], pos: Map idx→k }.
export function buildProblem(rows, cols, cages) {
  const N = rows; // KenKen boards are square; rows === cols.
  const cellCage = new Int32Array(N * N).fill(-1);
  const cg = cages.map((c, i) => {
    for (const idx of c.cells) cellCage[idx] = i;
    return { idx: i, op: c.op, target: c.target, cells: c.cells.slice() };
  });
  return { N, cages: cg, cellCage };
}

// --- backtracking search ---------------------------------------------------------------------

// Core search. Fills cells one at a time using MRV (fill the cell with the fewest legal candidates
// next). Maintains Latin-square row/col masks and per-cage running state for pruning. onSolution
// receives the completed board (Int array, length N*N); return true to STOP early.
function search(problem, onSolution) {
  const { N, cages, cellCage } = problem;
  const board = new Int32Array(N * N).fill(0);
  const rowMask = new Int32Array(N); // bit d set ⇒ value (d) used in this row
  const colMask = new Int32Array(N);
  const FULL = (1 << (N + 1)) - 2;    // bits 1..N set

  // Per-cage tracking: how many cells still empty, and the list of currently-placed values.
  const cageRemaining = cages.map((c) => c.cells.length);
  const cageValues = cages.map(() => []);

  function candidatesMask(idx) {
    const r = (idx / N) | 0, c = idx % N;
    let used = rowMask[r] | colMask[c];
    return FULL & ~used; // bits of legal digits
  }

  // Try placing value v at cell idx; returns true if it keeps every touched cage feasible.
  function cageAcceptsPlace(idx, v) {
    const ci = cellCage[idx];
    if (ci === -1) return true;
    const cage = cages[ci];
    const vals = cageValues[ci];
    const willRemain = cageRemaining[ci] - 1;
    if (willRemain === 0) {
      // completing the cage: the full set must satisfy op→target exactly.
      const full = vals.concat(v);
      return cageSatisfied(cage.op, cage.target, full);
    }
    // partial: prune.
    const partial = vals.concat(v);
    return cagePartialOk(cage.op, cage.target, partial, willRemain, N);
  }

  function place(idx, v) {
    const r = (idx / N) | 0, c = idx % N;
    board[idx] = v;
    rowMask[r] |= (1 << v);
    colMask[c] |= (1 << v);
    const ci = cellCage[idx];
    if (ci !== -1) { cageValues[ci].push(v); cageRemaining[ci]--; }
  }

  function unplace(idx, v) {
    const r = (idx / N) | 0, c = idx % N;
    board[idx] = 0;
    rowMask[r] &= ~(1 << v);
    colMask[c] &= ~(1 << v);
    const ci = cellCage[idx];
    if (ci !== -1) { cageValues[ci].pop(); cageRemaining[ci]++; }
  }

  function recurse(filled) {
    if (filled === N * N) {
      return onSolution(Array.from(board));
    }
    // MRV: choose the empty cell with the fewest candidate digits.
    let bestIdx = -1, bestMask = 0, bestCount = Infinity;
    for (let idx = 0; idx < N * N; idx++) {
      if (board[idx] !== 0) continue;
      const mask = candidatesMask(idx);
      let count = 0;
      for (let m = mask; m; m &= m - 1) count++;
      if (count < bestCount) {
        bestCount = count; bestIdx = idx; bestMask = mask;
        if (count === 0) break;        // dead end — prune now
        if (count === 1) break;        // forced — can't do better
      }
    }
    if (bestCount === 0) return false;

    for (let v = 1; v <= N; v++) {
      if (!(bestMask & (1 << v))) continue;
      if (!cageAcceptsPlace(bestIdx, v)) continue;
      place(bestIdx, v);
      const stop = recurse(filled + 1);
      unplace(bestIdx, v);
      if (stop) return true;
    }
    return false;
  }

  recurse(0);
}

// Count solutions, capped at `limit` (default 2 — all we need for uniqueness). Returns 0, 1, …,
// up to `limit`. Stops as soon as `limit` solutions are found.
export function countSolutions(rows, cols, cages, limit = 2) {
  const problem = buildProblem(rows, cols, cages);
  let count = 0;
  search(problem, () => {
    count++;
    return count >= limit;
  });
  return count;
}

// Return the (first) full Latin-square fill honouring all cages, as a flat Int array length N*N,
// or null if unsolvable.
export function solveFill(rows, cols, cages) {
  const problem = buildProblem(rows, cols, cages);
  let result = null;
  search(problem, (board) => { result = board; return true; });
  return result;
}
