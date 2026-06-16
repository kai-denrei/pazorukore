// src/games/starbattle/solver.js — Star Battle self-solver + uniqueness counter.
// Pure logic, no DOM. The generator uses countSolutions() to guarantee a unique solution;
// solveStars() returns one solution (a stars-set) for the bundled answer / solve()/hint().
//
// Star Battle: an N×N grid partitioned into N connected REGIONS. Place stars so EVERY row,
// EVERY column, and EVERY region has exactly K stars, and NO two stars are 8-adjacent (king
// move). v1 uses K=1.
//
// Model. The search places stars ROW BY ROW. Within a row it chooses K columns to star (the
// chosen columns must be mutually non-adjacent within the row, and each must not be vertically
// or diagonally adjacent to a star already placed in the previous row). It prunes on:
//   • column counts (no column may exceed K, and every column must still be able to reach K);
//   • region counts (no region may exceed K, and every region must still be able to reach K);
//   • the 8-adjacency rule (a placed star forbids its 8 neighbours).
// `regionOf` maps a flat cell index (r*cols + c) to its region id (0..N-1). It may be passed as
// a flat array, a 2D array (regionOf[r][c]), or a function (r,c)=>id; normalizeRegionOf handles all.

// Normalize regionOf into a flat lookup function (r, c) -> regionId.
function normalizeRegionOf(rows, cols, regionOf) {
  if (typeof regionOf === 'function') return regionOf;
  if (Array.isArray(regionOf) && regionOf.length && Array.isArray(regionOf[0])) {
    return (r, c) => regionOf[r][c]; // 2D grid
  }
  // flat array indexed r*cols + c
  return (r, c) => regionOf[r * cols + c];
}

// Build the per-row column combinations of size k whose chosen columns are pairwise
// non-adjacent (>= 2 apart). Returns an array of arrays of column indices (sorted ascending).
function rowCombos(cols, k) {
  const out = [];
  const combo = [];
  function rec(start) {
    if (combo.length === k) { out.push(combo.slice()); return; }
    for (let c = start; c < cols; c++) {
      // within-row adjacency: a chosen column must be >= 2 from the previous chosen one.
      if (combo.length && c - combo[combo.length - 1] < 2) continue;
      combo.push(c);
      rec(c + 1);
      combo.pop();
    }
  }
  rec(0);
  return out;
}

// Core backtracking. Calls onSolution(starsFlatSet) with a Set of flat cell indices for each
// full solution; return true from onSolution to STOP early.
function search(rows, cols, regionFn, k, onSolution) {
  const N = rows * cols;
  const numRegions = rows; // an N×N board has N regions in this game
  const combos = rowCombos(cols, k);

  // region id of every cell + region count of remaining capacity bookkeeping
  const regionAt = new Int32Array(N);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) regionAt[r * cols + c] = regionFn(r, c);
  }

  const colCount = new Int32Array(cols);
  const regionCount = new Int32Array(numRegions);
  // chosen columns in the previous placed row (for vertical/diagonal adjacency checks)
  let prevCols = [];
  const placedByRow = []; // placedByRow[r] = array of chosen columns
  const stars = []; // flat indices, in placement order

  // Feasibility prune after placing through row `r` (0-based): every column and every region must
  // still be able to reach k given the rows that remain. rowsLeft = rows - (r + 1).
  function feasible(rAfter) {
    const rowsLeft = rows - (rAfter + 1);
    for (let c = 0; c < cols; c++) {
      if (colCount[c] > k) return false;
      if (colCount[c] + rowsLeft < k) return false; // can't add more than rowsLeft per column (1 max/row anyway)
    }
    for (let g = 0; g < numRegions; g++) {
      if (regionCount[g] > k) return false;
      // a region could still gain at most (its remaining cells in unplaced rows) stars, but the
      // simple bound rowsLeft (since at most one star per region per row would be too loose) — use a
      // tighter per-region remaining-cell count instead.
    }
    return true;
  }

  // Tighter region reachability: count, per region, how many cells lie in rows > rAfter. If a region
  // already has < k and cannot fit the deficit in remaining rows, prune. We precompute region cell
  // counts per row band lazily — cheap for the small boards here.
  function regionFeasible(rAfter) {
    // remaining capacity per region (cells available in unplaced rows, but at most 1 star/row/region
    // is achievable only loosely — bound by remaining cell count).
    const remCells = new Int32Array(numRegions);
    for (let r = rAfter + 1; r < rows; r++) {
      for (let c = 0; c < cols; c++) remCells[regionAt[r * cols + c]]++;
    }
    for (let g = 0; g < numRegions; g++) {
      if (regionCount[g] + remCells[g] < k) return false;
    }
    return true;
  }

  function recurse(r) {
    if (r === rows) {
      // all rows placed; counts of k per row guaranteed by construction. Verify col/region == k.
      for (let c = 0; c < cols; c++) if (colCount[c] !== k) return false;
      for (let g = 0; g < numRegions; g++) if (regionCount[g] !== k) return false;
      return onSolution(new Set(stars));
    }

    for (const cChoice of combos) {
      // adjacency to previous row's stars (vertical + diagonal): a chosen column must not be within
      // 1 column of any previous-row chosen column.
      let adj = false;
      for (const c of cChoice) {
        for (const pc of prevCols) {
          if (Math.abs(c - pc) <= 1) { adj = true; break; }
        }
        if (adj) break;
      }
      if (adj) continue;

      // apply
      const idxs = cChoice.map((c) => r * cols + c);
      let ok = true;
      for (const c of cChoice) {
        colCount[c]++;
        regionCount[regionAt[r * cols + c]]++;
      }
      for (const idx of idxs) stars.push(idx);
      const savedPrev = prevCols;
      prevCols = cChoice;

      if (feasible(r) && regionFeasible(r)) {
        if (recurse(r + 1)) {
          // unwind not needed; propagate stop
          for (const c of cChoice) { colCount[c]--; regionCount[regionAt[r * cols + c]]--; }
          for (let i = 0; i < idxs.length; i++) stars.pop();
          prevCols = savedPrev;
          return true;
        }
        ok = true;
      } else {
        ok = false;
      }

      // unwind
      for (const c of cChoice) { colCount[c]--; regionCount[regionAt[r * cols + c]]--; }
      for (let i = 0; i < idxs.length; i++) stars.pop();
      prevCols = savedPrev;
      void ok;
    }
    return false;
  }

  recurse(0);
}

// Count solutions, capped at `limit` (default 2 — all uniqueness needs). Returns 0, 1, …, limit.
export function countSolutions(rows, cols, regionOf, k = 1, limit = 2) {
  const regionFn = normalizeRegionOf(rows, cols, regionOf);
  let count = 0;
  search(rows, cols, regionFn, k, () => {
    count++;
    return count >= limit;
  });
  return count;
}

// Find one solution as a stars-set ({ 'r{row}c{col}': 1 }), or null if unsolvable.
export function solveStars(rows, cols, regionOf, k = 1) {
  const regionFn = normalizeRegionOf(rows, cols, regionOf);
  let result = null;
  search(rows, cols, regionFn, k, (set) => { result = set; return true; });
  if (!result) return null;
  const stars = {};
  for (const idx of result) {
    const r = Math.floor(idx / cols), c = idx % cols;
    stars[`r${r}c${c}`] = 1;
  }
  return stars;
}
