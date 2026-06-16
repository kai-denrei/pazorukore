// src/games/masyu/solver.js — Masyu (Tatham "Pearl") self-solver + uniqueness counter.
// Pure logic, no DOM. The generator uses countSolutions() to guarantee a unique loop; solveLoop()
// returns one solution loop and the GameModule's solve()/hint() reuse it.
//
// Model. The board is rows×cols cells. The player draws a SINGLE closed loop through cell centres
// using only orthogonal segments between adjacent cells. A "loop" is a set of cell-edges; a cell on
// the loop has degree 2. A cell is STRAIGHT if its two loop-edges are opposite (both H or both V),
// a TURN if perpendicular. The loop need NOT visit every cell.
//
// Pearls (clues): each pearl sits on a cell and constrains the local loop shape:
//   • WHITE pearl at X: X is STRAIGHT, AND the loop TURNS in at least ONE of the two next cells
//     along the loop (one step away in each loop direction).
//   • BLACK pearl at X: X is a TURN, AND the loop goes STRAIGHT through BOTH next cells along the
//     loop (one step in each of X's two directions).
//
// A WIN: the chosen edges form exactly ONE closed loop (every used cell degree 2, all loop edges in
// a single cycle, no separate sub-loops) AND every pearl is on the loop and satisfies its rule.
//
// Geometry is precomputed once (the four orthogonal neighbours of every cell ⇒ a list of undirected
// edges) and the search is a backtracking CSP over edge present/absent. PRUNING (the difference
// between "minutes" and "milliseconds"):
//   • a cell's degree may never exceed 2 (eager branch cut);
//   • a fully-decided cell must have degree 0 or 2 (no dangling stubs);
//   • UNION-FIND on the partial path-segments forbids closing a sub-loop EARLY: an edge that joins
//     two cells already in the same component would close a cycle, which is only legal if that cycle
//     already contains every cell with a present edge AND every pearl — otherwise it strands an
//     endpoint/pearl and can never be a single loop;
//   • pearl-local shape checks the moment a pearl (or its neighbour) is fully decided.

// --- geometry ---------------------------------------------------------------------------------

const cellId = (r, c) => `r${r}c${c}`;
function edgeKeyOf(idA, idB) { return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`; }

// Build the edge graph for a rows×cols board.
//   edges[k]       = { a, b }          (a<b are cell indices = r*cols+c)
//   edgeOrient[k]  = 'h'|'v'           orientation of edge k
//   edgesByCell[i] = [edgeIndex...]    the ≤4 incident edges of cell i
function buildGraph(rows, cols) {
  const n = rows * cols;
  const idx = (r, c) => r * cols + c;
  const edges = [];
  const edgeOrient = [];
  const edgeKeyToIdx = new Map();
  const edgesByCell = Array.from({ length: n }, () => []);

  function addEdge(ia, ib, orient) {
    const a = Math.min(ia, ib), b = Math.max(ia, ib);
    const key = `${a}-${b}`;
    if (edgeKeyToIdx.has(key)) return;
    const k = edges.length;
    edgeKeyToIdx.set(key, k);
    edges.push({ a, b });
    edgeOrient.push(orient);
    edgesByCell[a].push(k);
    edgesByCell[b].push(k);
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = idx(r, c);
      if (c + 1 < cols) addEdge(i, idx(r, c + 1), 'h'); // right
      if (r + 1 < rows) addEdge(i, idx(r + 1, c), 'v'); // down
    }
  }
  return { rows, cols, n, idx, edges, edgeOrient, edgesByCell };
}

// --- the search -------------------------------------------------------------------------------
// A single backtracking engine shared by countSolutions() and solveLoop(). `onSolution(present)`
// is called with the boolean present-edge array on each complete valid solution; return true to
// stop early.
function runSearch(graph, pearls, onSolution) {
  const { rows, cols, n, idx, edges, edgeOrient, edgesByCell } = graph;
  const m = edges.length;

  const pearlAt = new Map(); // cellIndex -> 'B'|'W'
  for (const p of pearls) pearlAt.set(idx(p.r, p.c), p.kind);
  const pearlCells = [...pearlAt.keys()];

  const present = new Int8Array(m).fill(-1); // -1 undecided, 0 absent, 1 present
  const degree = new Int32Array(n);
  const decided = new Int32Array(n);

  // Union-Find over cells, tracking only cells that have at least one PRESENT edge. We maintain it
  // incrementally: setEdge(present) unions; undo must reverse it, so we use a versioned UF with an
  // explicit undo log (no path compression so unions are trivially reversible).
  const parent = new Int32Array(n);
  const rank = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  function find(x) { while (parent[x] !== x) x = parent[x]; return x; }
  // union returns an undo closure (or null if a/b were already joined → caller treats as a closure).
  function union(a, b) {
    let ra = find(a), rb = find(b);
    if (ra === rb) return null; // already connected → this edge closes a cycle
    if (rank[ra] < rank[rb]) { const t = ra; ra = rb; rb = t; }
    const prevParent = parent[rb];
    const bumped = rank[ra] === rank[rb];
    parent[rb] = ra;
    if (bumped) rank[ra]++;
    return () => { parent[rb] = prevParent; if (bumped) rank[ra]--; };
  }

  function shapeOf(i) {
    if (degree[i] !== 2) return null;
    let h = 0, v = 0;
    for (const k of edgesByCell[i]) {
      if (present[k] === 1) { if (edgeOrient[k] === 'h') h++; else v++; }
    }
    return (h === 2 || v === 2) ? 'straight' : 'turn';
  }
  function loopNeighbors(i) {
    const out = [];
    for (const k of edgesByCell[i]) {
      if (present[k] === 1) { const ed = edges[k]; out.push(ed.a === i ? ed.b : ed.a); }
    }
    return out;
  }

  // Pearl early-prune: once a pearl cell is fully decided it must be on the loop with the right
  // self-shape (W=straight, B=turn). Neighbour-shape conditions wait for full validation.
  function pearlEarlyOk(i) {
    const kind = pearlAt.get(i);
    if (kind === undefined) return true;
    if (decided[i] === edgesByCell[i].length) {
      if (degree[i] !== 2) return false;
      const sh = shapeOf(i);
      if (kind === 'W' && sh !== 'straight') return false;
      if (kind === 'B' && sh !== 'turn') return false;
    }
    return true;
  }
  function cellCloseOk(i) {
    if (decided[i] !== edgesByCell[i].length) return true;
    return degree[i] === 0 || degree[i] === 2;
  }

  // Full validation once every edge is decided: single closed loop + all pearls satisfied.
  function fullValidate() {
    for (let i = 0; i < n; i++) if (degree[i] !== 0 && degree[i] !== 2) return false;
    let start = -1, used = 0;
    for (let i = 0; i < n; i++) if (degree[i] === 2) { used++; if (start === -1) start = i; }
    if (start === -1) return false;
    let prevEdge = -1, cur = start, steps = 0;
    do {
      let nextEdge = -1;
      for (const k of edgesByCell[cur]) if (present[k] === 1 && k !== prevEdge) { nextEdge = k; break; }
      if (nextEdge === -1) return false;
      const ed = edges[nextEdge];
      cur = ed.a === cur ? ed.b : ed.a;
      prevEdge = nextEdge;
      steps++;
      if (steps > used + 1) return false;
    } while (cur !== start);
    if (steps !== used) return false; // multiple disjoint loops
    for (const pi of pearlCells) {
      const kind = pearlAt.get(pi);
      if (degree[pi] !== 2) return false;
      const sh = shapeOf(pi);
      if (kind === 'W') {
        if (sh !== 'straight') return false;
        const nbs = loopNeighbors(pi);
        let anyTurn = false;
        for (const nb of nbs) if (shapeOf(nb) === 'turn') { anyTurn = true; break; }
        if (!anyTurn) return false;
      } else {
        if (sh !== 'turn') return false;
        const nbs = loopNeighbors(pi);
        if (nbs.length !== 2) return false;
        for (const nb of nbs) if (shapeOf(nb) !== 'straight') return false;
      }
    }
    return true;
  }

  // Set edge k = v (0|1). Returns an undo closure. On a present edge that would CLOSE a cycle
  // prematurely, returns the sentinel CLOSE_BAD so the caller prunes immediately.
  const CLOSE_BAD = Symbol('close-bad');
  function setEdge(k, v) {
    const { a, b } = edges[k];
    if (v === 1) {
      // would this close a cycle?
      const undoUnion = union(a, b);
      if (undoUnion === null) {
        // a and b already connected → adding this edge closes a loop. Legal ONLY if it is the FINAL
        // closure: the resulting cycle must already contain every cell that has a present edge and
        // every pearl. We test that by: after tentatively marking the edge, the component of `a`
        // must include all present-degree>0 cells and all pearls, AND no other edge remains that
        // is forced present elsewhere. Cheap sufficient check: every degree>0 cell shares a's root,
        // every pearl shares a's root, and every still-undecided edge touches only cells that are
        // already degree 2 (so cannot be forced present). If any of these fail → prune.
        const root = find(a);
        // all present-degree cells in a's component?
        for (let i = 0; i < n; i++) {
          if (degree[i] > 0 && find(i) !== root) return CLOSE_BAD;
        }
        for (const pi of pearlCells) {
          if (find(pi) !== root) return CLOSE_BAD;
          // a pearl not yet on the loop (degree<2) can't be added after closure
          if (degree[pi] + (pi === a || pi === b ? 1 : 0) < 2) return CLOSE_BAD;
        }
        // Closing is acceptable structurally. Mark present (no union needed — same component).
        present[k] = 1; decided[a]++; decided[b]++; degree[a]++; degree[b]++;
        return () => { degree[a]--; degree[b]--; decided[a]--; decided[b]--; present[k] = -1; };
      }
      present[k] = 1; decided[a]++; decided[b]++; degree[a]++; degree[b]++;
      return () => { degree[a]--; degree[b]--; decided[a]--; decided[b]--; present[k] = -1; undoUnion(); };
    } else {
      present[k] = 0; decided[a]++; decided[b]++;
      return () => { decided[a]--; decided[b]--; present[k] = -1; };
    }
  }

  // Choose the next undecided edge: prefer one incident to a degree-1 cell (forced completion) or a
  // pearl (resolve constraints early), else the first undecided edge.
  function pickEdge() {
    let fallback = -1;
    for (let k = 0; k < m; k++) {
      if (present[k] !== -1) continue;
      if (fallback === -1) fallback = k;
      const { a, b } = edges[k];
      if (degree[a] === 1 || degree[b] === 1) return k;
      if (pearlAt.has(a) || pearlAt.has(b)) return k;
    }
    return fallback;
  }

  let stop = false;
  function recurse() {
    if (stop) return;
    const k = pickEdge();
    if (k === -1) {
      if (fullValidate()) { if (onSolution(present)) stop = true; }
      return;
    }
    const { a, b } = edges[k];
    for (const v of [1, 0]) { // try present first → finds loops sooner, prunes the huge "absent" tail
      if (v === 1 && (degree[a] === 2 || degree[b] === 2)) continue;
      const undo = setEdge(k, v);
      if (undo === CLOSE_BAD) { continue; } // premature closure pruned (setEdge left state clean)
      if (cellCloseOk(a) && cellCloseOk(b) && pearlEarlyOk(a) && pearlEarlyOk(b)) recurse();
      undo();
      if (stop) return;
    }
  }
  recurse();
}

// Materialise the present-edge boolean array into a loop object { edgeKey:1 }.
function presentToLoop(graph, present) {
  const { cols, edges } = graph;
  const loop = {};
  for (let k = 0; k < edges.length; k++) {
    if (present[k] === 1) {
      const ed = edges[k];
      const ra = Math.floor(ed.a / cols), ca = ed.a % cols;
      const rb = Math.floor(ed.b / cols), cb = ed.b % cols;
      loop[edgeKeyOf(cellId(ra, ca), cellId(rb, cb))] = 1;
    }
  }
  return loop;
}

// --- public API -------------------------------------------------------------------------------

// Count solutions, capped at `limit` (default 2 — all uniqueness needs).
export function countSolutions(rows, cols, pearls, limit = 2) {
  const graph = buildGraph(rows, cols);
  let count = 0;
  runSearch(graph, pearls || [], () => { count++; return count >= limit; });
  return count;
}

// Find one solution loop. Returns the loop object { edgeKey:1 } or null if none.
export function solveLoop(rows, cols, pearls) {
  const graph = buildGraph(rows, cols);
  let found = null;
  runSearch(graph, pearls || [], (present) => { found = presentToLoop(graph, present); return true; });
  return found;
}
