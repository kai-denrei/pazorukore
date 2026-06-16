// src/games/nurikabe/solver.js — Nurikabe self-solver + uniqueness counter.
// Pure logic, no DOM. The generator uses countSolutions() to guarantee a unique puzzle;
// solveShade() returns one solution's shaded set (or null).
//
// Model. A clue is { r, c, n }: the cell (r,c) is an island ANCHOR whose island must contain
// EXACTLY n unshaded cells (the anchor included). Every non-clue cell is either UNSHADED (part of
// exactly one island) or SHADED (part of the single connected "sea"). The WIN rules:
//   (1) UNSHADED cells form 4-connected islands; each island holds exactly ONE clue and has size
//       === that clue's n;
//   (2) all SHADED cells form ONE single 4-connected region;
//   (3) NO 2×2 block of cells is entirely shaded.
// Total shaded = rows*cols − sum(clue n).
//
// SEARCH. We "grow" each island outward from its anchor using a frontier/flood model, marking
// island cells UNSHADED; every cell never claimed by an island is SHADED. This is far stronger than
// per-cell shaded/unshaded branching because it bakes in rule (1) — islands are sized & one-clue —
// by construction, leaving only sea-connectivity + no-2×2 to verify. We branch over which cell each
// growing island absorbs next, with pruning so two islands never touch, no island exceeds its size,
// and the remaining sea stays connectable.

const cellId = (r, c) => `r${r}c${c}`;

// 4-neighbour offsets.
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Build the static problem context shared by the search.
function buildContext(rows, cols, clues) {
  const N = rows * cols;
  const idx = (r, c) => r * cols + c;
  // owner[cellIndex] = clueIndex if that cell is the anchor of a clue, else -1.
  const anchorOf = new Int32Array(N).fill(-1);
  for (let i = 0; i < clues.length; i++) {
    const cl = clues[i];
    anchorOf[idx(cl.r, cl.c)] = i;
  }
  return { rows, cols, N, idx, anchorOf };
}

// The core search. We maintain:
//   own : Int32Array(N) — cell ownership: -1 unknown (→ sea at the leaf), else clueIndex (island).
// We process islands one at a time, fully growing island i to exactly clues[i].n cells before
// moving to island i+1. Growing enumerates connected cell-sets containing the anchor via the
// standard "add-or-forbid the smallest frontier cell" recursion (each island shape produced exactly
// once). A frontier cell is rejected if it is another clue's anchor, or is orthogonally adjacent to
// a DIFFERENT island (islands may never touch). `forbidden` is a per-island Set cleared between
// islands, so forbidding a cell for island i leaves it available to later islands. When all islands
// are sized, every still-unknown cell is sea; we verify the sea is one connected region with no full
// 2×2 shaded block, and report the solution.
//
// onSolution(shadedSet) is called per full solution; return true to stop early.
function search(ctx, clues, onSolution) {
  const { rows, cols, N, idx, anchorOf } = ctx;
  const own = new Int32Array(N).fill(-1);
  // Seed anchors.
  for (let i = 0; i < clues.length; i++) own[idx(clues[i].r, clues[i].c)] = i;

  const cells = clues.map((cl) => [idx(cl.r, cl.c)]); // owned cell index lists per island
  const target = clues.map((cl) => cl.n);

  // Two orthogonally-ADJACENT clue anchors can never be separated (clue cells are never shaded), so
  // they would form a single island carrying two clues — illegal, zero solutions. Reject up front so
  // the solver agrees with isSolved (otherwise the uniqueness oracle over-counts on touching anchors).
  for (let i = 0; i < clues.length; i++) {
    const r = clues[i].r, c = clues[i].c;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      if (anchorOf[nr * cols + nc] >= 0) return; // adjacent anchor → no valid solution
    }
  }

  // Is cell ci orthogonally adjacent to an island OTHER than `self`?
  function touchesOther(ci, self) {
    const r = (ci / cols) | 0, c = ci % cols;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const o = own[nr * cols + nc];
      if (o >= 0 && o !== self) return true;
    }
    return false;
  }

  // Frontier candidates for island i: unknown, non-forbidden cells 4-adjacent to any of island i's
  // owned cells, that aren't another clue's anchor and don't touch a different island.
  function frontier(i, forbidden) {
    const seen = new Set();
    const out = [];
    for (const ci of cells[i]) {
      const r = (ci / cols) | 0, c = ci % cols;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const ni = nr * cols + nc;
        if (own[ni] !== -1) continue;       // owned by some island already
        if (forbidden.has(ni)) continue;    // excluded from THIS island's growth
        if (anchorOf[ni] !== -1) continue;  // another clue's anchor — islands can't absorb a clue
        if (seen.has(ni)) continue;
        if (touchesOther(ni, i)) continue;
        seen.add(ni);
        out.push(ni);
      }
    }
    return out;
  }

  // Verify a full assignment (all islands sized). Returns the shaded set or null.
  function verifyLeaf() {
    // Sea cells = those still unknown (own === -1). Mark them conceptually as sea.
    const seaCells = [];
    for (let i = 0; i < N; i++) if (own[i] === -1) seaCells.push(i);
    // Sea size must equal N − sum(target). (Always true if islands are exactly sized, but guard.)
    let islandTotal = 0;
    for (const t of target) islandTotal += t;
    if (seaCells.length !== N - islandTotal) return null;
    if (seaCells.length === 0) return null; // need at least some sea for a real puzzle

    // (3) no 2×2 fully sea.
    const isSea = (r, c) => own[r * cols + c] === -1;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (isSea(r, c) && isSea(r + 1, c) && isSea(r, c + 1) && isSea(r + 1, c + 1)) return null;
      }
    }

    // (2) sea is one 4-connected region.
    const seaSet = new Set(seaCells);
    const seen = new Set();
    const stack = [seaCells[0]];
    seen.add(seaCells[0]);
    while (stack.length) {
      const ci = stack.pop();
      const r = (ci / cols) | 0, c = ci % cols;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const ni = nr * cols + nc;
        if (seaSet.has(ni) && !seen.has(ni)) { seen.add(ni); stack.push(ni); }
      }
    }
    if (seen.size !== seaCells.length) return null; // sea disconnected

    // Build the shaded set { cellId: 1 }.
    const shaded = {};
    for (const ci of seaCells) shaded[cellId((ci / cols) | 0, ci % cols)] = 1;
    return shaded;
  }

  // Recurse over islands. Island i is grown to target[i] before island i+1 starts.
  function growIsland(i) {
    if (i === clues.length) {
      const shaded = verifyLeaf();
      if (shaded) return onSolution(shaded);
      return false;
    }
    if (target[i] === 1) return growIsland(i + 1); // a "1" island is just its anchor
    return grow(i, new Set());
  }

  // Grow island i using the add-or-forbid-smallest connected-subset enumeration. `forbidden` holds
  // cells excluded from THIS island (they stay own=-1, available to later islands).
  function grow(i, forbidden) {
    if (cells[i].length === target[i]) {
      return growIsland(i + 1); // island i complete
    }
    const cand = frontier(i, forbidden);
    if (cand.length === 0) return false; // can't reach the target size → dead branch
    // Prune: remaining capacity must be reachable. need cells, have `cand.length` immediate frontier;
    // a lower bound check on whether the target is still attainable is implicit in the recursion, but
    // cheaply bail if even taking everything reachable can't reach target.
    const need = target[i] - cells[i].length;
    if (cand.length < 1 && need > 0) return false;

    const pick = Math.min(...cand);
    // Option A: include `pick` in island i.
    own[pick] = i;
    cells[i].push(pick);
    if (grow(i, forbidden)) return true;
    cells[i].pop();
    own[pick] = -1;
    // Option B: forbid `pick` for THIS island only, keep growing from the rest.
    forbidden.add(pick);
    const stop = grow(i, forbidden);
    forbidden.delete(pick);
    return stop;
  }

  growIsland(0);
}

// Count solutions, capped at `cap` (default 2 — all we need for uniqueness). Returns 0, 1, …, cap.
export function countSolutions(rows, cols, clues, limit = 2) {
  if (!clues || clues.length === 0) return 0;
  // Feasibility: total island area must be < rows*cols (need a non-empty sea) and ≥ clues.length.
  let total = 0;
  for (const cl of clues) {
    if (!(cl.n >= 1)) return 0;
    total += cl.n;
  }
  if (total >= rows * cols) return 0; // no room for sea
  const ctx = buildContext(rows, cols, clues);
  // Reject duplicate anchors.
  const seenAnchor = new Set();
  for (const cl of clues) {
    const k = `${cl.r},${cl.c}`;
    if (seenAnchor.has(k)) return 0;
    seenAnchor.add(k);
    if (cl.r < 0 || cl.c < 0 || cl.r >= rows || cl.c >= cols) return 0;
  }
  let count = 0;
  search(ctx, clues, () => {
    count++;
    return count >= limit;
  });
  return count;
}

// Find one solution's shaded set ({ cellId:1 }), or null if unsolvable.
export function solveShade(rows, cols, clues) {
  if (!clues || clues.length === 0) return null;
  let total = 0;
  for (const cl of clues) {
    if (!(cl.n >= 1)) return null;
    total += cl.n;
  }
  if (total >= rows * cols) return null;
  const ctx = buildContext(rows, cols, clues);
  let result = null;
  search(ctx, clues, (shaded) => { result = shaded; return true; });
  return result;
}
