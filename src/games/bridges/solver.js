// src/games/bridges/solver.js — Hashiwokakero (Bridges) self-solver + uniqueness counter
// (§5, §12). Pure logic, no DOM. The generator uses countSolutions() to guarantee a unique
// network; solve() returns the unique assignment and hint() reuses the same search.
//
// Model. An island is { id, r, c, need } where `need` is its label (1..8). Two islands are a
// legal *neighbour pair* (an "edge") iff they share a row or column AND the straight run of cells
// strictly between them is all water (no third island in the way). Each edge may carry 0, 1 or 2
// bridges. A solution assigns a count to every edge such that
//   • each island's attached-bridge sum == its need,
//   • no two edges CROSS (a horizontal edge and a vertical edge whose segments intersect at a
//     water cell may not both carry ≥1 bridge), and
//   • all islands form ONE connected component (via edges carrying ≥1 bridge).
//
// The board geometry (which pairs are collinear-and-clear, and which pairs cross) is precomputed
// once into an edge list + a crossing table, then the search is a pure CSP over edge counts.

// --- geometry: build the abstract edge graph from island positions --------------------------
// islands: [{ id, r, c, need }]. Returns:
//   { islands, edges, edgesByIsland, crossing }
//   edges[k] = { a, b, ai, bi, orient:'h'|'v', cells:[{r,c}...] }  (a<b are island indices; cells
//             are the WATER cells strictly between them)
//   edgesByIsland[i] = [edgeIndex...]
//   crossing[k] = [edgeIndex...]  (edges that geometrically cross edge k; only h-vs-v can cross)
export function buildGraph(islands) {
  const n = islands.length;
  // index islands by cell for "is there an island at (r,c)" lookups.
  const at = new Map();
  for (let i = 0; i < n; i++) at.set(`${islands[i].r},${islands[i].c}`, i);

  const edges = [];
  const edgeKeyToIdx = new Map();

  // Grid bounds, derived from islands' max extent, terminate the directional scans.
  let maxR = 0, maxC = 0;
  for (const isl of islands) { if (isl.r > maxR) maxR = isl.r; if (isl.c > maxC) maxC = isl.c; }

  // For island i, scan in a direction; the FIRST island hit is a neighbour, with the water cells
  // between recorded. Anything beyond it is blocked by that island, so we stop.
  function scanBounded(i, dr, dc) {
    const isl = islands[i];
    let r = isl.r + dr, c = isl.c + dc;
    const between = [];
    while (r >= 0 && c >= 0 && r <= maxR && c <= maxC) {
      const j = at.get(`${r},${c}`);
      if (j !== undefined) {
        const a = Math.min(i, j), b = Math.max(i, j);
        const key = `${a}-${b}`;
        if (!edgeKeyToIdx.has(key)) {
          const orient = dr !== 0 ? 'v' : 'h';
          edgeKeyToIdx.set(key, edges.length);
          edges.push({ a, b, ai: a, bi: b, orient, cells: between.slice() });
        }
        return;
      }
      between.push({ r, c });
      r += dr; c += dc;
    }
  }
  for (let i = 0; i < n; i++) {
    scanBounded(i, -1, 0); // up
    scanBounded(i, 1, 0);  // down
    scanBounded(i, 0, -1); // left
    scanBounded(i, 0, 1);  // right
  }

  const edgesByIsland = Array.from({ length: n }, () => []);
  for (let k = 0; k < edges.length; k++) {
    edgesByIsland[edges[k].a].push(k);
    edgesByIsland[edges[k].b].push(k);
  }

  // Crossing table: a horizontal edge and a vertical edge cross iff one of the vertical edge's
  // water cells equals one of the horizontal edge's water cells (they share a water cell). Two
  // parallel edges never share a water cell (the nearest-island rule prevents overlap).
  const cellOwners = new Map(); // "r,c" -> [edgeIndex...]
  for (let k = 0; k < edges.length; k++) {
    for (const cell of edges[k].cells) {
      const key = `${cell.r},${cell.c}`;
      if (!cellOwners.has(key)) cellOwners.set(key, []);
      cellOwners.get(key).push(k);
    }
  }
  const crossing = Array.from({ length: edges.length }, () => new Set());
  for (const owners of cellOwners.values()) {
    if (owners.length < 2) continue;
    for (let x = 0; x < owners.length; x++) {
      for (let y = x + 1; y < owners.length; y++) {
        const ka = owners[x], kb = owners[y];
        if (edges[ka].orient !== edges[kb].orient) {
          crossing[ka].add(kb); crossing[kb].add(ka);
        }
      }
    }
  }
  return {
    islands,
    edges,
    edgesByIsland,
    crossing: crossing.map((s) => [...s]),
    edgeKeyToIdx,
  };
}

// --- the CSP search -------------------------------------------------------------------------
// Assign counts (0|1|2) to each edge. Constraints:
//   per-island sum == need; crossing edges can't both be >0; final graph connected.
// onSolution(counts:Int8Array) → return true to stop early.
function search(graph, onSolution) {
  const { islands, edges, edgesByIsland, crossing } = graph;
  const n = islands.length;
  const m = edges.length;
  const counts = new Int8Array(m).fill(-1); // -1 = undecided
  const need = islands.map((i) => i.need);

  // Running per-island: sum of decided bridges, and remaining capacity from undecided edges.
  const sum = new Int32Array(n);       // decided bridges on island
  const slack = new Int32Array(n);     // max additional from still-undecided incident edges (≤2 each, minus crossing locks)
  for (let i = 0; i < n; i++) slack[i] = edgesByIsland[i].length * 2;

  // crossLock[k] > 0 means edge k is forced to 0 because a crossing edge already carries ≥1.
  const crossLock = new Int32Array(m);

  function feasible() {
    // Each island must still be able to reach exactly `need`: sum ≤ need ≤ sum + slack.
    for (let i = 0; i < n; i++) {
      if (sum[i] > need[i]) return false;
      if (sum[i] + slack[i] < need[i]) return false;
    }
    return true;
  }

  // Connectivity check over edges with count ≥1 (only when all edges decided).
  function connected() {
    if (n === 0) return true;
    const adj = Array.from({ length: n }, () => []);
    for (let k = 0; k < m; k++) {
      if (counts[k] >= 1) { adj[edges[k].a].push(edges[k].b); adj[edges[k].b].push(edges[k].a); }
    }
    const seen = new Uint8Array(n);
    const stack = [0]; seen[0] = 1; let cnt = 1;
    while (stack.length) {
      const u = stack.pop();
      for (const v of adj[u]) if (!seen[v]) { seen[v] = 1; cnt++; stack.push(v); }
    }
    return cnt === n;
  }

  // Choose the most-constrained undecided edge: pick by the island with the tightest remaining
  // freedom. We branch on the next undecided edge incident to that island.
  function pickEdge() {
    let bestIsl = -1, bestFreedom = Infinity;
    for (let i = 0; i < n; i++) {
      // freedom = number of ways the remaining undecided incident edges can still vary.
      let undecided = 0;
      for (const k of edgesByIsland[i]) if (counts[k] === -1) undecided++;
      if (undecided === 0) continue;
      // tightness: fewer undecided incident edges (and less slack) ⇒ more constrained.
      const freedom = undecided * 100 + slack[i];
      if (freedom < bestFreedom) { bestFreedom = freedom; bestIsl = i; }
    }
    if (bestIsl === -1) return -1;
    for (const k of edgesByIsland[bestIsl]) if (counts[k] === -1) return k;
    return -1;
  }

  // Set edge k to value v (0|1|2); returns an undo closure.
  // NOTE: `slack[i]` tracks ONLY the raw ±2 capacity of island i's still-undecided incident edges.
  // We deliberately do NOT fold crossing-locks into slack — that bookkeeping is error-prone and a
  // crossLocked edge still has counts[ck] === -1 (undecided), so its 2 stays in slack as a loose but
  // admissible upper bound. `crossLock` is used only to RESTRICT a crossed edge's branch values to 0,
  // never to mutate slack. This keeps feasible() a correct (never over-tight) bound → no missed
  // solutions; crossings are still fully enforced by the branch restriction.
  function setEdge(k, v) {
    const { a, b } = edges[k];
    counts[k] = v;
    sum[a] += v; sum[b] += v;
    slack[a] -= 2; slack[b] -= 2; // this edge no longer contributes its ≤2 capacity
    if (v >= 1) {
      for (const ck of crossing[k]) crossLock[ck]++;
    }
    return () => {
      if (v >= 1) {
        for (const ck of crossing[k]) crossLock[ck]--;
      }
      slack[a] += 2; slack[b] += 2;
      sum[a] -= v; sum[b] -= v;
      counts[k] = -1;
    };
  }

  let stop = false;
  function recurse() {
    if (stop) return;
    if (!feasible()) return;
    const k = pickEdge();
    if (k === -1) {
      // pickEdge returns -1 only when no island has an undecided incident edge. Every edge joins two
      // islands, so this means ALL edges are decided. Verify the exact sums + connectivity.
      for (let i = 0; i < n; i++) if (sum[i] !== need[i]) return;
      if (!connected()) return;
      if (onSolution(counts)) stop = true;
      return;
    }
    // branch on edge k. If locked by a crossing, only 0 is allowed.
    const vals = crossLock[k] > 0 ? [0] : [0, 1, 2];
    for (const v of vals) {
      const undo = setEdge(k, v);
      recurse();
      undo();
      if (stop) return;
    }
  }
  recurse();
}

// Count solutions, capped at `cap` (default 2 — all we need for uniqueness).
export function countSolutions(islands, cap = 2) {
  const graph = buildGraph(islands);
  // Quick infeasibility: an island with need>0 but no incident edges can never be satisfied.
  for (let i = 0; i < islands.length; i++) {
    if (islands[i].need > 0 && graph.edgesByIsland[i].length === 0) return 0;
  }
  let count = 0;
  search(graph, () => { count++; return count >= cap; });
  return count;
}

// Find the (first) solution as a counts map keyed by canonical island-id edge key
// `${idA}|${idB}` (idA<idB), or null if unsolvable.
export function solveAssignment(islands) {
  const graph = buildGraph(islands);
  for (let i = 0; i < islands.length; i++) {
    if (islands[i].need > 0 && graph.edgesByIsland[i].length === 0) return null;
  }
  let found = null;
  search(graph, (counts) => { found = counts.slice(); return true; });
  if (!found) return null;
  return assignmentToBridges(graph, found);
}

// Convert a solved counts array to a bridges object { edgeKey: count } (omitting zeros).
export function assignmentToBridges(graph, counts) {
  const { islands, edges } = graph;
  const bridges = {};
  for (let k = 0; k < edges.length; k++) {
    const v = counts[k];
    if (v > 0) {
      const idA = islands[edges[k].a].id, idB = islands[edges[k].b].id;
      const key = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
      bridges[key] = v;
    }
  }
  return bridges;
}
