// src/games/shikaku/solver.js — Shikaku self-solver + uniqueness counter (§5, §12.2).
// Pure logic, no DOM. The generator uses countSolutions() to guarantee a unique tiling;
// solve() returns the unique tiling and hint() reuses the same search for one forced region.
//
// Model. A clue is { id, r, c, area }. A "candidate" is an axis-aligned rectangle that
//   - contains the clue cell,
//   - has area == clue.area,
//   - stays inside the board,
//   - covers no OTHER clue cell.
// A solution assigns one candidate to every clue such that the rectangles tile the board with
// no overlap and full coverage (every cell covered exactly once). Because total clue area equals
// the board area (the generator guarantees this), "no overlap" ⇒ "full coverage".

// Enumerate candidate rectangles for one clue. Returns [{ r0, c0, r1, c1, cells:[idx...] }],
// where idx = r*cols + c is a flat cell index. clueAt is a flat array: clueAt[idx] = clueIndex
// or -1. We forbid a candidate from covering any clue cell other than its own.
export function candidatesFor(clue, rows, cols, clueAt) {
  const out = [];
  const area = clue.area;
  // Every factor pair (w,h) with w*h == area.
  for (let w = 1; w <= area; w++) {
    if (area % w !== 0) continue;
    const h = area / w;
    if (w > cols || h > rows) continue;
    // The rectangle has top-left (r0,c0); it must include (clue.r, clue.c).
    const r0min = Math.max(0, clue.r - h + 1);
    const r0max = Math.min(clue.r, rows - h);
    const c0min = Math.max(0, clue.c - w + 1);
    const c0max = Math.min(clue.c, cols - w);
    for (let r0 = r0min; r0 <= r0max; r0++) {
      for (let c0 = c0min; c0 <= c0max; c0++) {
        const r1 = r0 + h - 1, c1 = c0 + w - 1;
        // Reject if it swallows a foreign clue.
        let ok = true;
        const cells = [];
        for (let r = r0; r <= r1 && ok; r++) {
          for (let c = c0; c <= c1; c++) {
            const idx = r * cols + c;
            const cl = clueAt[idx];
            if (cl !== -1 && cl !== clue.index) { ok = false; break; }
            cells.push(idx);
          }
        }
        if (ok) out.push({ r0, c0, r1, c1, cells });
      }
    }
  }
  return out;
}

// Build the solver problem from clues. Returns { rows, cols, clues, cands } where
// clues[i] = { index, id, r, c, area } and cands[i] = candidate list for clue i.
export function buildProblem(rows, cols, clues) {
  const clueAt = new Array(rows * cols).fill(-1);
  const cl = clues.map((c, i) => ({ index: i, id: c.id, r: c.r, c: c.c, area: c.area }));
  for (const c of cl) clueAt[c.r * cols + c.c] = c.index;
  const cands = cl.map((c) => candidatesFor(c, rows, cols, clueAt));
  return { rows, cols, clues: cl, cands, clueAt };
}

// Core backtracking search. Covers every cell exactly once by choosing one candidate per clue.
// Uses a "most-constrained cell" heuristic: at each step pick the still-uncovered cell that the
// fewest remaining candidates can cover, and branch over those candidates. This makes both the
// solve and the uniqueness count fast on the small boards v1 generates.
//
// onSolution(assign) is called with the assignment array (assign[clueIndex] = candidate) for each
// full solution. Return true from onSolution to STOP the search early (used by the counter to bail
// at 2 solutions and by solve() to grab the first).
function search(problem, onSolution) {
  const { rows, cols, clues, cands } = problem;
  const N = rows * cols;
  const cover = new Int32Array(N).fill(-1); // cover[idx] = clueIndex covering it, or -1
  cover.fill(-1);
  const assign = new Array(clues.length).fill(null);
  const used = new Array(clues.length).fill(false);

  // Precompute, per cell, which (clueIndex, candIndex) pairs can cover it. This lets the
  // most-constrained-cell heuristic run without rescanning every candidate each step.
  const coverers = Array.from({ length: N }, () => []);
  for (let ci = 0; ci < cands.length; ci++) {
    const list = cands[ci];
    for (let k = 0; k < list.length; k++) {
      for (const idx of list[k].cells) coverers[idx].push([ci, k]);
    }
  }

  let remaining = N;

  function placeable(ci, cand) {
    // A candidate is placeable iff none of its cells are already covered.
    for (const idx of cand.cells) if (cover[idx] !== -1) return false;
    return true;
  }

  function recurse() {
    if (remaining === 0) {
      // Every clue must have been assigned (areas sum to N, so this holds), but guard anyway.
      for (let i = 0; i < clues.length; i++) if (!used[i]) return false;
      return onSolution(assign.slice());
    }
    // Find the uncovered cell with the fewest placeable coverers (fail-fast).
    let bestIdx = -1, bestOpts = null, bestCount = Infinity;
    for (let idx = 0; idx < N; idx++) {
      if (cover[idx] !== -1) continue;
      const opts = [];
      for (const [ci, k] of coverers[idx]) {
        if (used[ci]) continue;
        const cand = cands[ci][k];
        if (placeable(ci, cand)) opts.push([ci, cand]);
      }
      if (opts.length < bestCount) {
        bestCount = opts.length; bestIdx = idx; bestOpts = opts;
        if (bestCount === 0) break; // dead end — prune immediately
      }
    }
    if (bestCount === 0) return false; // an uncovered cell nothing can cover → no solution here

    for (const [ci, cand] of bestOpts) {
      // place
      for (const idx of cand.cells) cover[idx] = ci;
      used[ci] = true; assign[ci] = cand; remaining -= cand.cells.length;
      const stop = recurse();
      // unplace
      for (const idx of cand.cells) cover[idx] = -1;
      used[ci] = false; assign[ci] = null; remaining += cand.cells.length;
      if (stop) return true;
    }
    return false;
  }

  recurse();
}

// Count solutions, capped at `cap` (default 2 — all we need for uniqueness). Returns the count
// (0, 1, or `cap`). Stops as soon as `cap` solutions are found.
export function countSolutions(rows, cols, clues, cap = 2) {
  const problem = buildProblem(rows, cols, clues);
  // Quick infeasibility check: any clue with zero candidates ⇒ zero solutions.
  for (const list of problem.cands) if (list.length === 0) return 0;
  let count = 0;
  search(problem, () => {
    count++;
    return count >= cap; // stop once we hit the cap
  });
  return count;
}

// Find the (first) solution as an assignment: assign[clueIndex] = candidate, or null if unsolvable.
export function solveAssignment(rows, cols, clues) {
  const problem = buildProblem(rows, cols, clues);
  for (const list of problem.cands) if (list.length === 0) return null;
  let result = null;
  search(problem, (assign) => { result = assign; return true; });
  return result ? { clues: problem.clues, assign: result } : null;
}
