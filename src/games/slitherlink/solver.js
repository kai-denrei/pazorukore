// src/games/slitherlink/solver.js — Slitherlink self-solver + uniqueness counter.
// Pure logic, no DOM. The generator uses countSolutions() to guarantee a unique loop; solveLoop()
// returns one solution loop and the GameModule's solve()/hint() reuse it.
//
// Model. The board is rows×cols CELLS. The loop is drawn along grid LINES — i.e. on the DOT LATTICE
// of cell corners. An N×M cell grid has (N+1)×(M+1) DOTS at id `d{r}c{c}` for r∈0..rows, c∈0..cols.
// An EDGE connects two orthogonally-adjacent dots. The player toggles edges; the WIN condition is
// that the present edges form EXACTLY ONE closed loop (every dot has degree 0 or 2, all present
// edges are a single cycle — connected, no separate sub-loops, no degree-4 dots) AND every numbered
// cell's count of present surrounding edges equals its clue value (0..3, sometimes 4 internally —
// but Slitherlink clues are 0..3 since 4 forces an isolated 1-cell loop).
//
// A CELL at (cr,cc) has these 4 lattice edges (dots are corners of that cell):
//   top    d{cr}c{cc}   — d{cr}c{cc+1}
//   bottom d{cr+1}c{cc} — d{cr+1}c{cc+1}
//   left   d{cr}c{cc}   — d{cr+1}c{cc}
//   right  d{cr}c{cc+1} — d{cr+1}c{cc+1}
//
// Geometry is precomputed once (the dot lattice ⇒ a list of undirected lattice edges + per-cell and
// per-dot incidence) and the search is a backtracking CSP over edge present/absent. PRUNING:
//   • a DOT's degree may never exceed 2 (eager branch cut);
//   • a fully-decided dot must have degree 0 or 2 (no dangling stubs);
//   • a CLUE cell's present-edge count may never exceed its value, and once all 4 of its edges are
//     decided the count must equal the value exactly;
//   • UNION-FIND over the dot path-segments forbids closing a sub-loop EARLY: an edge that joins two
//     dots already in the same component closes a cycle, legal ONLY if that cycle already contains
//     every dot with a present edge (otherwise it strands a segment ⇒ never a single loop).

// --- geometry ---------------------------------------------------------------------------------

const dotId = (r, c) => `d${r}c${c}`;
function edgeKeyOf(idA, idB) { return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`; }

// Build the dot-lattice edge graph for a rows×cols CELL board.
//   dotN           = (rows+1)*(cols+1)
//   edges[k]       = { a, b }            (a<b are dot indices = r*(cols+1)+c)
//   edgesByDot[i]  = [edgeIndex...]      the ≤4 incident lattice edges of dot i
//   edgesByCell[j] = [edgeIndex...]      the 4 surrounding edges of cell j = cr*cols+cc
function buildGraph(rows, cols) {
  const dr = rows + 1, dc = cols + 1;
  const dotN = dr * dc;
  const dotIdx = (r, c) => r * dc + c;

  const edges = [];
  const edgeKeyToIdx = new Map();
  const edgesByDot = Array.from({ length: dotN }, () => []);

  function addEdge(ia, ib) {
    const a = Math.min(ia, ib), b = Math.max(ia, ib);
    const key = `${a}-${b}`;
    let k = edgeKeyToIdx.get(key);
    if (k !== undefined) return k;
    k = edges.length;
    edgeKeyToIdx.set(key, k);
    edges.push({ a, b });
    edgesByDot[a].push(k);
    edgesByDot[b].push(k);
    return k;
  }

  // All horizontal + vertical lattice edges between adjacent dots.
  for (let r = 0; r < dr; r++) {
    for (let c = 0; c < dc; c++) {
      const i = dotIdx(r, c);
      if (c + 1 < dc) addEdge(i, dotIdx(r, c + 1)); // horizontal →
      if (r + 1 < dr) addEdge(i, dotIdx(r + 1, c)); // vertical ↓
    }
  }

  // The 4 surrounding edges of each cell.
  const cellN = rows * cols;
  const edgesByCell = Array.from({ length: cellN }, () => []);
  for (let cr = 0; cr < rows; cr++) {
    for (let cc = 0; cc < cols; cc++) {
      const j = cr * cols + cc;
      const tl = dotIdx(cr, cc), tr = dotIdx(cr, cc + 1);
      const bl = dotIdx(cr + 1, cc), br = dotIdx(cr + 1, cc + 1);
      edgesByCell[j].push(edgeKeyToIdx.get(`${Math.min(tl, tr)}-${Math.max(tl, tr)}`)); // top
      edgesByCell[j].push(edgeKeyToIdx.get(`${Math.min(bl, br)}-${Math.max(bl, br)}`)); // bottom
      edgesByCell[j].push(edgeKeyToIdx.get(`${Math.min(tl, bl)}-${Math.max(tl, bl)}`)); // left
      edgesByCell[j].push(edgeKeyToIdx.get(`${Math.min(tr, br)}-${Math.max(tr, br)}`)); // right
    }
  }

  return { rows, cols, dr, dc, dotN, dotIdx, edges, edgesByDot, cellN, edgesByCell };
}

// --- the search -------------------------------------------------------------------------------
// A single backtracking engine shared by countSolutions() and solveLoop(). `onSolution(present)` is
// called with the present-edge array on each complete valid solution; return true to stop early.
// `nodeBudget` (optional) caps the number of search nodes; exceeding it ABORTS the search and the
// caller learns it via runSearch's return value `{ aborted }`. This lets generation stay fast: a
// uniqueness check that would explode is treated as "not safely unique" so the clue is kept.
function runSearch(graph, clues, onSolution, nodeBudget = Infinity) {
  const { dotN, edges, edgesByDot, cellN, edgesByCell } = graph;
  const m = edges.length;
  let nodes = 0;
  let aborted = false;

  // clueOf[cellIndex] = value (0..4) or -1 if unclued. cellClueList = clued cell indices.
  const clueOf = new Int32Array(cellN).fill(-1);
  for (const cl of clues) {
    const j = cl.r * graph.cols + cl.c;
    clueOf[j] = cl.n;
  }
  // Per-cell running present-edge count + decided-edge count (cells have exactly 4 edges).
  const cellPresent = new Int32Array(cellN);
  const cellDecided = new Int32Array(cellN);
  // Which cells each edge belongs to (1 or 2 cells) — for incremental clue bookkeeping.
  const cellsByEdge = Array.from({ length: m }, () => []);
  for (let j = 0; j < cellN; j++) for (const k of edgesByCell[j]) cellsByEdge[k].push(j);

  const present = new Int8Array(m).fill(-1); // -1 undecided, 0 absent, 1 present
  const degree = new Int32Array(dotN);       // per-dot present-edge degree
  const decided = new Int32Array(dotN);       // per-dot decided-edge count

  // Union-Find over dots that have at least one PRESENT edge, with an explicit undo log (no path
  // compression so unions reverse trivially). `compSize[root]` = number of present-degree dots in
  // that component, maintained incrementally; `activeDots` = total present-degree dots. The FINAL
  // closure is legal iff the closing component already holds every active dot, i.e.
  // compSize[root] === activeDots — an O(1) test instead of an O(dotN) scan.
  const parent = new Int32Array(dotN);
  const rank = new Int32Array(dotN);
  const compSize = new Int32Array(dotN);
  for (let i = 0; i < dotN; i++) parent[i] = i;
  let activeDots = 0;
  function find(x) { while (parent[x] !== x) x = parent[x]; return x; }
  function union(a, b) {
    let ra = find(a), rb = find(b);
    if (ra === rb) return null; // already connected → this edge closes a cycle
    if (rank[ra] < rank[rb]) { const t = ra; ra = rb; rb = t; }
    const prevParent = parent[rb];
    const bumped = rank[ra] === rank[rb];
    const movedSize = compSize[rb];
    parent[rb] = ra;
    compSize[ra] += movedSize;
    if (bumped) rank[ra]++;
    return () => { parent[rb] = prevParent; compSize[ra] -= movedSize; if (bumped) rank[ra]--; };
  }

  // Clue prune: a clue cell may never EXCEED its value; once all 4 edges decided it must equal it.
  function clueOk(j) {
    const v = clueOf[j];
    if (v < 0) return true;
    if (cellPresent[j] > v) return false;
    if (cellDecided[j] === 4 && cellPresent[j] !== v) return false;
    // also: remaining undecided edges can't make up a deficit
    if (cellPresent[j] + (4 - cellDecided[j]) < v) return false;
    return true;
  }
  function dotCloseOk(i) {
    if (decided[i] !== edgesByDot[i].length) return true;
    return degree[i] === 0 || degree[i] === 2;
  }

  // Full validation once every edge is decided: a single closed loop + all clues satisfied.
  function fullValidate() {
    for (let i = 0; i < dotN; i++) if (degree[i] !== 0 && degree[i] !== 2) return false;
    let start = -1, used = 0;
    for (let i = 0; i < dotN; i++) if (degree[i] === 2) { used++; if (start === -1) start = i; }
    if (start === -1) return false; // empty is not a loop
    // walk the single cycle from `start`
    let prevEdge = -1, cur = start, steps = 0;
    do {
      let nextEdge = -1;
      for (const k of edgesByDot[cur]) if (present[k] === 1 && k !== prevEdge) { nextEdge = k; break; }
      if (nextEdge === -1) return false;
      const ed = edges[nextEdge];
      cur = ed.a === cur ? ed.b : ed.a;
      prevEdge = nextEdge;
      steps++;
      if (steps > used + 1) return false;
    } while (cur !== start);
    if (steps !== used) return false; // multiple disjoint loops
    for (let j = 0; j < cellN; j++) {
      if (clueOf[j] >= 0 && cellPresent[j] !== clueOf[j]) return false;
    }
    return true;
  }

  // Activate a dot the moment it gains its FIRST present edge: it becomes a singleton component of
  // size 1 and joins the active-dot count. Returns true if it was newly activated (so undo can
  // reverse it). Deactivation happens symmetrically when its last present edge is removed.
  function activate(x) {
    if (degree[x] === 0) { compSize[x] = 1; activeDots++; return true; }
    return false;
  }
  function deactivate(x) { if (degree[x] === 0) { compSize[x] = 0; activeDots--; } }

  // Set edge k = v (0|1). Returns an undo closure. A present edge that would CLOSE a cycle
  // prematurely returns the sentinel CLOSE_BAD so the caller prunes (state left clean).
  const CLOSE_BAD = Symbol('close-bad');
  function applyEdgeCells(k, dir) {
    for (const j of cellsByEdge[k]) { cellPresent[j] += dir; cellDecided[j] += dir; }
  }
  function setEdge(k, v) {
    const { a, b } = edges[k];
    if (v === 1) {
      // Activate endpoints BEFORE union so the merge sees correct component sizes.
      const newA = activate(a), newB = activate(b);
      const undoUnion = union(a, b);
      if (undoUnion === null) {
        // a & b already connected → adding this edge closes a loop. Legal ONLY as the FINAL closure:
        // the resulting cycle must already contain EVERY active dot. With component sizes maintained,
        // that's an O(1) test: this component must already hold all active dots.
        if (compSize[find(a)] !== activeDots) {
          // revert the activations — neither endpoint had its degree bumped, so undo them directly.
          if (newB) { compSize[b] = 0; activeDots--; }
          if (newA) { compSize[a] = 0; activeDots--; }
          return CLOSE_BAD;
        }
        present[k] = 1; degree[a]++; degree[b]++; decided[a]++; decided[b]++; applyEdgeCells(k, +1);
        return () => {
          applyEdgeCells(k, -1); degree[a]--; degree[b]--; decided[a]--; decided[b]--; present[k] = -1;
          deactivate(b); deactivate(a);
        };
      }
      present[k] = 1; degree[a]++; degree[b]++; decided[a]++; decided[b]++; applyEdgeCells(k, +1);
      return () => {
        applyEdgeCells(k, -1); degree[a]--; degree[b]--; decided[a]--; decided[b]--; present[k] = -1;
        undoUnion(); deactivate(b); deactivate(a);
      };
    } else {
      present[k] = 0; decided[a]++; decided[b]++;
      for (const j of cellsByEdge[k]) cellDecided[j]++;
      return () => { for (const j of cellsByEdge[k]) cellDecided[j]--; decided[a]--; decided[b]--; present[k] = -1; };
    }
  }

  // Choose the next undecided edge. LOCALITY is what keeps this fast: extending a contiguous partial
  // path lets degree-1 forcing and the union-find early-closure prune fire constantly. So we prefer:
  //   1. an edge incident to a degree-1 dot → its second edge is FORCED (completes that dot), nearly
  //      deterministic — branch here first;
  //   2. else an edge touching a clue cell that already has ≥2 decided edges (its remaining edges are
  //      tightly constrained by the clue value), keeping the frontier near settled clues;
  //   3. else the first undecided edge (a stable, cache-friendly order).
  function pickEdge() {
    let fallback = -1;
    let clueK = -1;
    for (let k = 0; k < m; k++) {
      if (present[k] !== -1) continue;
      if (fallback === -1) fallback = k;
      const { a, b } = edges[k];
      if (degree[a] === 1 || degree[b] === 1) return k;
      if (clueK === -1) {
        for (const j of cellsByEdge[k]) if (clueOf[j] >= 0 && cellDecided[j] >= 2) { clueK = k; break; }
      }
    }
    if (clueK !== -1) return clueK;
    return fallback;
  }

  let stop = false;
  function recurse() {
    if (stop) return;
    if (++nodes > nodeBudget) { aborted = true; stop = true; return; } // budget tripwire
    const k = pickEdge();
    if (k === -1) {
      if (fullValidate()) { if (onSolution(present)) stop = true; }
      return;
    }
    const { a, b } = edges[k];
    for (const v of [1, 0]) { // try present first → finds loops sooner, prunes the absent tail
      if (v === 1 && (degree[a] === 2 || degree[b] === 2)) continue;
      // pre-check clue ceiling for present (cheap)
      if (v === 1) {
        let bad = false;
        for (const j of cellsByEdge[k]) if (clueOf[j] >= 0 && cellPresent[j] + 1 > clueOf[j]) { bad = true; break; }
        if (bad) continue;
      }
      const undo = setEdge(k, v);
      if (undo === CLOSE_BAD) continue; // premature closure pruned (state clean)
      let ok = dotCloseOk(a) && dotCloseOk(b);
      if (ok) for (const j of cellsByEdge[k]) if (!clueOk(j)) { ok = false; break; }
      if (ok) recurse();
      undo();
      if (stop) return;
    }
  }
  recurse();
  return { aborted };
}

// Materialise the present-edge boolean array into a loop object { edgeKey:1 } over DOT ids.
function presentToLoop(graph, present) {
  const { dc, edges } = graph;
  const loop = {};
  for (let k = 0; k < edges.length; k++) {
    if (present[k] === 1) {
      const ed = edges[k];
      const ra = Math.floor(ed.a / dc), ca = ed.a % dc;
      const rb = Math.floor(ed.b / dc), cb = ed.b % dc;
      loop[edgeKeyOf(dotId(ra, ca), dotId(rb, cb))] = 1;
    }
  }
  return loop;
}

// --- public API -------------------------------------------------------------------------------

// Count solutions, capped at `limit` (default 2 — all uniqueness needs). `clues` = [{ r, c, n }].
// EXACT (no node budget): used by tests and final verification. Returns a plain number.
export function countSolutions(rows, cols, clues, limit = 2) {
  const graph = buildGraph(rows, cols);
  let count = 0;
  runSearch(graph, clues || [], () => { count++; return count >= limit; });
  return count;
}

// Bounded uniqueness check for the GENERATOR's inner loop: counts solutions capped at `limit`, but
// aborts after `nodeBudget` search nodes. Returns { count, aborted }. When aborted, `count` is a
// lower bound — the caller must treat an aborted check as "NOT safely unique" (so it keeps the clue),
// never as confirmed-unique. This keeps generation fast and always correct (it only ever errs toward
// a more-clued, still-unique puzzle, verified exactly at the end).
export function countSolutionsBounded(rows, cols, clues, limit = 2, nodeBudget = 200000) {
  const graph = buildGraph(rows, cols);
  let count = 0;
  const { aborted } = runSearch(graph, clues || [], () => { count++; return count >= limit; }, nodeBudget);
  return { count, aborted };
}

// Find one solution loop. Returns the loop object { edgeKey:1 } over dot ids, or null if none.
export function solveLoop(rows, cols, clues) {
  const graph = buildGraph(rows, cols);
  let found = null;
  runSearch(graph, clues || [], (present) => { found = presentToLoop(graph, present); return true; });
  return found;
}
