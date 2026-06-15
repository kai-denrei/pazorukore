// src/games/sudoku/solver.js — Sudoku constraint solver (§12.1).
// Two layers, both operating on a flat Int8Array board (0 = empty, 1..N = digit):
//   1. A human-technique solver (naked/hidden singles, naked pairs, locked candidates) used to
//      GRADE difficulty — it reports the hardest technique it needed.
//   2. A bitmask backtracking solver used to (a) confirm a solution exists and (b) COUNT
//      solutions up to a cap, which is how the generator guarantees uniqueness while digging holes.
// No DOM, no rng, no engine knowledge — pure board arithmetic so it is fast and testable.

// Technique tiers, hardest-last. The grader reports the highest index it had to use.
export const TECHNIQUES = Object.freeze(['singles', 'pairs', 'locked', 'guess']);

// --- board geometry --------------------------------------------------------------------------

// A "geometry" caches the unit membership for an N×N board with bh×bw boxes so the hot loops
// never recompute row/col/box indices. N = size, boxes tile the grid.
export function makeGeometry(size, bh, bw) {
  const N = size;
  const boxesPerRow = N / bw;            // how many boxes across
  const cellBox = new Int16Array(N * N); // cell index -> box index
  const peers = new Array(N * N);        // cell index -> Int16Array of the (up to 20) peer cells
  const units = [];                      // every row, col, box as an Int16Array of cell indices

  // rows + cols
  for (let r = 0; r < N; r++) {
    const row = new Int16Array(N), col = new Int16Array(N);
    for (let c = 0; c < N; c++) { row[c] = r * N + c; col[c] = c * N + r; }
    units.push(row, col);
  }
  // boxes
  for (let br = 0; br < N; br += bh) {
    for (let bc = 0; bc < N; bc += bw) {
      const box = new Int16Array(N);
      let k = 0;
      for (let dr = 0; dr < bh; dr++) for (let dc = 0; dc < bw; dc++) {
        const idx = (br + dr) * N + (bc + dc);
        box[k++] = idx;
        cellBox[idx] = (br / bh) * boxesPerRow + (bc / bw);
      }
      units.push(box);
    }
  }
  // peers: union of row/col/box minus self
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N), c = i % N;
    const set = new Set();
    for (let c2 = 0; c2 < N; c2++) set.add(r * N + c2);
    for (let r2 = 0; r2 < N; r2++) set.add(r2 * N + c);
    const br = Math.floor(r / bh) * bh, bc = Math.floor(c / bw) * bw;
    for (let dr = 0; dr < bh; dr++) for (let dc = 0; dc < bw; dc++) set.add((br + dr) * N + (bc + dc));
    set.delete(i);
    peers[i] = Int16Array.from(set);
  }
  return { N, bh, bw, cellBox, peers, units, ALL: (1 << N) - 1 };
}

const bit = (d) => 1 << (d - 1);                 // digit 1..N -> bitmask
const popcount = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const lowestDigit = (m) => { let d = 1; while (!(m & 1)) { m >>= 1; d++; } return d; }; // m must be a single bit

// --- backtracking solution counter (uniqueness) ----------------------------------------------

// Count solutions of `board` (Int8Array, 0 = empty) up to `limit` (default 2 — enough to test
// uniqueness). Returns the count, stopping early once it reaches the limit. Uses MRV + bitmask
// candidate tracking. Does NOT mutate the input.
export function countSolutions(geom, board, limit = 2) {
  const work = Int8Array.from(board);
  let found = 0;

  // candidate bitmasks per cell, derived once then maintained incrementally
  const cand = new Int32Array(geom.N * geom.N);
  for (let i = 0; i < work.length; i++) {
    if (work[i] !== 0) { cand[i] = 0; continue; }
    let used = 0;
    const peers = geom.peers[i];
    for (let p = 0; p < peers.length; p++) { const v = work[peers[p]]; if (v) used |= bit(v); }
    cand[i] = geom.ALL & ~used;
  }

  const recurse = () => {
    // pick the empty cell with the fewest candidates (MRV)
    let best = -1, bestCount = geom.N + 1;
    for (let i = 0; i < work.length; i++) {
      if (work[i] !== 0) continue;
      const cnt = popcount(cand[i]);
      if (cnt === 0) return;            // dead end
      if (cnt < bestCount) { bestCount = cnt; best = i; if (cnt === 1) break; }
    }
    if (best === -1) { found++; return; }      // no empties → a complete solution

    let m = cand[best];
    const peers = geom.peers[best];
    while (m && found < limit) {
      const b = m & -m; m ^= b;                // lowest set bit
      const d = lowestDigit(b);
      // place d
      work[best] = d;
      const touched = [];
      for (let p = 0; p < peers.length; p++) {
        const j = peers[p];
        if (work[j] === 0 && (cand[j] & b)) { cand[j] &= ~b; touched.push(j); }
      }
      const savedBest = cand[best]; cand[best] = 0;
      recurse();
      // undo
      cand[best] = savedBest; work[best] = 0;
      for (let t = 0; t < touched.length; t++) cand[touched[t]] |= b;
      if (found >= limit) return;
    }
  };

  recurse();
  return found;
}

// Solve fully (first solution) or return null. Used by index.solve() for self-solve + hints.
export function solveBoard(geom, board) {
  const work = Int8Array.from(board);
  const cand = new Int32Array(geom.N * geom.N);
  for (let i = 0; i < work.length; i++) {
    if (work[i] !== 0) { cand[i] = 0; continue; }
    let used = 0;
    const peers = geom.peers[i];
    for (let p = 0; p < peers.length; p++) { const v = work[peers[p]]; if (v) used |= bit(v); }
    cand[i] = geom.ALL & ~used;
  }
  const recurse = () => {
    let best = -1, bestCount = geom.N + 1;
    for (let i = 0; i < work.length; i++) {
      if (work[i] !== 0) continue;
      const cnt = popcount(cand[i]);
      if (cnt === 0) return false;
      if (cnt < bestCount) { bestCount = cnt; best = i; if (cnt === 1) break; }
    }
    if (best === -1) return true;
    let m = cand[best];
    const peers = geom.peers[best];
    while (m) {
      const b = m & -m; m ^= b;
      const d = lowestDigit(b);
      work[best] = d;
      const touched = [];
      for (let p = 0; p < peers.length; p++) {
        const j = peers[p];
        if (work[j] === 0 && (cand[j] & b)) { cand[j] &= ~b; touched.push(j); }
      }
      const savedBest = cand[best]; cand[best] = 0;
      if (recurse()) return true;
      cand[best] = savedBest; work[best] = 0;
      for (let t = 0; t < touched.length; t++) cand[touched[t]] |= b;
    }
    return false;
  };
  return recurse() ? work : null;
}

// --- human-technique grader ------------------------------------------------------------------

// Try to solve `board` using only human techniques; report the hardest tier reached.
// Returns { solved, board, hardest } where hardest is a TECHNIQUES index (0..2) or
// 3 ('guess') if logic alone could not finish. Used at gen time to grade difficulty.
export function gradeBoard(geom, board) {
  const N = geom.N;
  const work = Int8Array.from(board);
  const cand = new Int32Array(N * N);
  for (let i = 0; i < work.length; i++) cand[i] = work[i] ? 0 : geom.ALL;
  // initial candidate pruning from givens
  for (let i = 0; i < work.length; i++) if (work[i]) eliminateFromPeers(geom, cand, i, bit(work[i]));

  let hardest = -1;

  const assign = (i, d) => {
    work[i] = d; cand[i] = 0;
    eliminateFromPeers(geom, cand, i, bit(d));
  };

  for (;;) {
    let progressed = false;

    // tier 0a: naked singles
    for (let i = 0; i < N * N; i++) {
      if (work[i] === 0 && popcount(cand[i]) === 1) {
        assign(i, lowestDigit(cand[i])); hardest = Math.max(hardest, 0); progressed = true;
      }
    }
    if (progressed) continue;

    // tier 0b: hidden singles (a digit with only one home in some unit)
    if (hiddenSingles(geom, work, cand, assign)) { hardest = Math.max(hardest, 0); continue; }

    // tier 1: naked pairs
    if (nakedPairs(geom, work, cand)) { hardest = Math.max(hardest, 1); progressed = true; }
    if (progressed) continue;

    // tier 2: locked candidates (pointing / claiming)
    if (lockedCandidates(geom, work, cand)) { hardest = Math.max(hardest, 2); continue; }

    break; // no technique made progress
  }

  const solved = work.every((v) => v !== 0);
  return { solved, board: work, hardest: solved ? Math.max(hardest, 0) : 3 };
}

function eliminateFromPeers(geom, cand, i, b) {
  const peers = geom.peers[i];
  for (let p = 0; p < peers.length; p++) cand[peers[p]] &= ~b;
}

function hiddenSingles(geom, work, cand, assign) {
  let changed = false;
  for (const unit of geom.units) {
    for (let d = 1; d <= geom.N; d++) {
      const b = bit(d);
      let home = -1, count = 0, alreadyPlaced = false;
      for (let k = 0; k < unit.length; k++) {
        const i = unit[k];
        if (work[i] === d) { alreadyPlaced = true; break; }
        if (work[i] === 0 && (cand[i] & b)) { home = i; count++; }
      }
      if (!alreadyPlaced && count === 1) { assign(home, d); changed = true; }
    }
  }
  return changed;
}

function nakedPairs(geom, work, cand) {
  let changed = false;
  for (const unit of geom.units) {
    for (let a = 0; a < unit.length; a++) {
      const ia = unit[a];
      if (work[ia] !== 0 || popcount(cand[ia]) !== 2) continue;
      for (let b = a + 1; b < unit.length; b++) {
        const ib = unit[b];
        if (work[ib] !== 0 || cand[ib] !== cand[ia]) continue;
        const pair = cand[ia];
        for (let k = 0; k < unit.length; k++) {
          const i = unit[k];
          if (i === ia || i === ib || work[i] !== 0) continue;
          if (cand[i] & pair) { cand[i] &= ~pair; changed = true; }
        }
      }
    }
  }
  return changed;
}

// Locked candidates: if a digit's only homes in a box share a row/col, eliminate it elsewhere in
// that row/col (pointing); and the mirror (claiming) for rows/cols confined to a box.
function lockedCandidates(geom, work, cand) {
  const N = geom.N;
  let changed = false;
  // box index of a cell
  const boxOf = (i) => geom.cellBox[i];
  const rowOf = (i) => Math.floor(i / N);
  const colOf = (i) => i % N;

  // box -> line elimination
  // collect box units = those after 2*N entries in units list
  const boxUnits = geom.units.slice(2 * N);
  for (const box of boxUnits) {
    for (let d = 1; d <= N; d++) {
      const b = bit(d);
      let rows = new Set(), cols = new Set(), any = false, placed = false;
      for (let k = 0; k < box.length; k++) {
        const i = box[k];
        if (work[i] === d) { placed = true; break; }
        if (work[i] === 0 && (cand[i] & b)) { rows.add(rowOf(i)); cols.add(colOf(i)); any = true; }
      }
      if (placed || !any) continue;
      if (rows.size === 1) {
        const r = [...rows][0];
        for (let c = 0; c < N; c++) { const i = r * N + c; if (boxOf(i) !== boxOf(box[0]) && work[i] === 0 && (cand[i] & b)) { cand[i] &= ~b; changed = true; } }
      }
      if (cols.size === 1) {
        const c = [...cols][0];
        for (let r = 0; r < N; r++) { const i = r * N + c; if (boxOf(i) !== boxOf(box[0]) && work[i] === 0 && (cand[i] & b)) { cand[i] &= ~b; changed = true; } }
      }
    }
  }
  return changed;
}
