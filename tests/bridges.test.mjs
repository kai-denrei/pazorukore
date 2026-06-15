// tests/bridges.test.mjs — headless verification of the Bridges (Hashiwokakero) back-end (§5, §12).
// Run: node --test tests/bridges.test.mjs
//
// Asserts, across several seeds and difficulties:
//   • newPuzzle() builds a valid blank playState (islands as clue anchors, empty bridges).
//   • solve() returns a fully-bridged solution and isSolved(solution) is true.
//   • the island layout has EXACTLY ONE solution — verified by an INDEPENDENT brute-force counter
//     written here (no shared code with src/games/bridges/solver.js), capped at 2.
//   • applyMove is pure (prior bridges object untouched) and cycling an edge 0→1→2→0 returns to
//     start; a no-op returns the same reference.
//   • validateMove rejects geometrically illegal edges.
//   • findConflicts flags over-budget / crossing islands.
//   • encodeDesc → decodeDesc round-trips the island layout exactly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import bridges from '../src/games/bridges/index.js';
import { ROLES, getCellAt } from '../src/core/grid.js';

// --- INDEPENDENT solution counter -----------------------------------------------------------
// Deliberately a separate, simple backtracker (no shared code with src/games/bridges/solver.js) so
// it is a genuine cross-check. It reads islands straight off a playState grid, derives the legal
// edges and crossings from scratch with its own geometry pass, then brute-forces every assignment
// of counts {0,1,2} per edge, checking per-island sums, no-crossing, and connectivity. Caps at `cap`.
function independentCount(playState, cap = 2) {
  const grid = playState.grid;
  const rows = grid.rows, cols = grid.cols;

  // gather islands
  const islands = [];
  const at = new Map();
  for (const cell of grid.cells) {
    if (cell.role === ROLES.clue) {
      const i = islands.length;
      islands.push({ id: cell.id, r: cell.row, c: cell.col, need: parseInt(cell.value, 10) });
      at.set(`${cell.row},${cell.col}`, i);
    }
  }
  const n = islands.length;

  // derive legal edges: from each island, scan in each direction; nearest island is a neighbour,
  // record the water cells between.
  const edges = [];
  const seenEdge = new Set();
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let i = 0; i < n; i++) {
    for (const [dr, dc] of DIRS) {
      let r = islands[i].r + dr, c = islands[i].c + dc;
      const between = [];
      while (r >= 0 && c >= 0 && r < rows && c < cols) {
        const j = at.get(`${r},${c}`);
        if (j !== undefined) {
          const a = Math.min(i, j), b = Math.max(i, j);
          const key = `${a}-${b}`;
          if (!seenEdge.has(key)) {
            seenEdge.add(key);
            edges.push({ a, b, orient: dr !== 0 ? 'v' : 'h', cells: between.slice() });
          }
          break;
        }
        between.push(`${r},${c}`);
        r += dr; c += dc;
      }
    }
  }

  // crossing pairs: two edges of opposite orientation sharing a water cell.
  const cellOwners = new Map();
  for (let k = 0; k < edges.length; k++) {
    for (const cell of edges[k].cells) {
      if (!cellOwners.has(cell)) cellOwners.set(cell, []);
      cellOwners.get(cell).push(k);
    }
  }
  const cross = edges.map(() => new Set());
  for (const owners of cellOwners.values()) {
    for (let x = 0; x < owners.length; x++) {
      for (let y = x + 1; y < owners.length; y++) {
        if (edges[owners[x]].orient !== edges[owners[y]].orient) {
          cross[owners[x]].add(owners[y]); cross[owners[y]].add(owners[x]);
        }
      }
    }
  }

  const m = edges.length;
  const counts = new Array(m).fill(0);
  let solutions = 0;

  // Running per-island partial sum + remaining capacity from edges not yet decided (index ≥ k).
  // These are plain, obviously-correct admissible bounds — they only PRUNE branches that can never
  // satisfy an island's exact need, so they change speed, not the count. (Still fully independent of
  // the game's solver: a separate fixed-edge-order backtracker.)
  const sum = new Array(n).fill(0);
  const remainCap = new Array(n).fill(0); // sum over edges k..m-1 of 2 per incident endpoint
  for (let k = 0; k < m; k++) { remainCap[edges[k].a] += 2; remainCap[edges[k].b] += 2; }

  function connectedFull() {
    const adj = Array.from({ length: n }, () => []);
    for (let k = 0; k < m; k++) if (counts[k] > 0) { adj[edges[k].a].push(edges[k].b); adj[edges[k].b].push(edges[k].a); }
    const seen = new Array(n).fill(false);
    const stack = [0]; seen[0] = true; let c = 1;
    while (stack.length) {
      const u = stack.pop();
      for (const v of adj[u]) if (!seen[v]) { seen[v] = true; c++; stack.push(v); }
    }
    return c === n;
  }

  function feasible() {
    for (let i = 0; i < n; i++) {
      if (sum[i] > islands[i].need) return false;
      if (sum[i] + remainCap[i] < islands[i].need) return false;
    }
    return true;
  }

  function rec(k) {
    if (solutions >= cap) return;
    if (!feasible()) return;
    if (k === m) {
      for (let i = 0; i < n; i++) if (sum[i] !== islands[i].need) return;
      if (connectedFull()) solutions++;
      return;
    }
    const a = edges[k].a, b = edges[k].b;
    // remove this edge's capacity from the remaining-capacity bound for both endpoints.
    remainCap[a] -= 2; remainCap[b] -= 2;
    for (let v = 0; v <= 2; v++) {
      // crossing constraint: if v > 0 and any crossing edge already decided (index < k) is > 0, skip.
      if (v > 0) {
        let crosses = false;
        for (const ck of cross[k]) { if (ck < k && counts[ck] > 0) { crosses = true; break; } }
        if (crosses) continue;
      }
      counts[k] = v; sum[a] += v; sum[b] += v;
      rec(k + 1);
      sum[a] -= v; sum[b] -= v; counts[k] = 0;
      if (solutions >= cap) break;
    }
    remainCap[a] += 2; remainCap[b] += 2;
    counts[k] = 0;
  }
  rec(0);
  return solutions;
}

// --- helpers --------------------------------------------------------------------------------
function islandCount(playState) {
  return playState.grid.cells.filter((c) => c.role === ROLES.clue).length;
}

// --- tests ----------------------------------------------------------------------------------

test('newPuzzle builds a blank playState with island anchors and empty bridges', () => {
  for (const seed of [1, 2, 3, 7, 42, 99, 1000]) {
    const { playState } = bridges.newPuzzle({ seed, size: 7, difficulty: 'easy' });
    assert.equal(playState.grid.rows, 7);
    assert.equal(playState.grid.cols, 7);
    assert.deepEqual(playState.bridges, {}, 'fresh puzzle has no bridges');
    assert.ok(islandCount(playState) >= 2, 'has at least two islands');
    for (const cell of playState.grid.cells) {
      if (cell.role === ROLES.clue) {
        assert.equal(cell.given, true);
        assert.match(cell.value, /^[1-8]$/, 'island label is 1..8');
      } else {
        assert.equal(cell.role, ROLES.blank);
        assert.equal(cell.value, null);
      }
    }
  }
});

test('solve() returns a solution and isSolved(solution) is true', () => {
  for (const seed of [1, 2, 3, 7, 42, 99, 123, 1000, 5555]) {
    const { playState, solution } = bridges.newPuzzle({ seed, size: 7, difficulty: 'easy' });
    const solved = bridges.solve(playState);
    assert.ok(solved, `seed ${seed}: solve() returned a solution`);
    assert.equal(bridges.isSolved(solved), true, `seed ${seed}: solve() output is solved`);
    assert.equal(bridges.findConflicts(solved).length, 0, `seed ${seed}: no conflicts in solution`);
    // The puzzle-bundled solution is also solved.
    assert.equal(bridges.isSolved(solution), true, `seed ${seed}: bundled solution is solved`);
  }
});

test('island layout has EXACTLY ONE solution (independent counter, capped at 2)', () => {
  for (const seed of [1, 2, 3, 7, 42, 99, 123, 1000, 5555, 31337]) {
    const { playState } = bridges.newPuzzle({ seed, size: 7, difficulty: 'easy' });
    const n = independentCount(playState, 2);
    assert.equal(n, 1, `seed ${seed}: expected exactly 1 solution, independent counter found ${n}`);
  }
});

test('medium and hard presets also generate unique puzzles', () => {
  for (const difficulty of ['medium', 'hard']) {
    for (const seed of [1, 7, 42]) {
      const { playState } = bridges.newPuzzle({ seed, difficulty });
      const n = independentCount(playState, 2);
      assert.equal(n, 1, `${difficulty}/${seed}: expected unique, got ${n}`);
      assert.ok(bridges.solve(playState), `${difficulty}/${seed}: solvable`);
    }
  }
});

test('applyMove is pure: prior bridges object untouched; cycle 0→1→2→0 returns to start', () => {
  const { playState, solution } = bridges.newPuzzle({ seed: 7, size: 7, difficulty: 'easy' });
  // Take a legal edge from the solution.
  const hint = bridges.hint(playState, solution);
  assert.ok(hint, 'a hint edge exists on a fresh puzzle');
  assert.equal(hint.type, 'bridge');
  assert.equal(bridges.validateMove(playState, hint), true, 'hint is a valid move');

  const before = playState;
  const beforeBridgesSnapshot = JSON.stringify(before.bridges);

  const s1 = bridges.applyMove(before, hint);
  assert.notEqual(s1, before, '0→1 produced a new state');
  assert.notEqual(s1.bridges, before.bridges, 'new bridges object (not the same reference)');
  assert.equal(JSON.stringify(before.bridges), beforeBridgesSnapshot, 'prior bridges object untouched');
  const key = hint.a < hint.b ? `${hint.a}|${hint.b}` : `${hint.b}|${hint.a}`;
  assert.equal(s1.bridges[key], 1, 'count is 1 after first cycle');

  const s2 = bridges.applyMove(s1, hint);
  assert.equal(s2.bridges[key], 2, 'count is 2 after second cycle');
  assert.equal(s1.bridges[key], 1, 's1 untouched by s2');

  const s3 = bridges.applyMove(s2, hint);
  assert.equal(s3.bridges[key], undefined, 'edge removed (back to 0) after third cycle');
  assert.deepEqual(s3.bridges, before.bridges, 'cycling 0→1→2→0 returns to the starting bridges');

  // A no-op (illegal move) returns the SAME reference.
  const noop = bridges.applyMove(before, { type: 'bridge', a: 'r0c0', b: 'r0c0' });
  assert.equal(noop, before, 'self-edge no-op returns same reference');
  const noop2 = bridges.applyMove(before, { type: 'nonsense' });
  assert.equal(noop2, before, 'unknown move returns same reference');
});

test('validateMove rejects geometrically illegal edges', () => {
  // A 1×5 row: islands at c0 and c4, water between. The only legal edge is r0c0|r0c4.
  const state = bridges.decodeDesc({ size: 5 }, '1...1');
  assert.equal(state.grid.rows, 1);
  assert.equal(bridges.validateMove(state, { type: 'bridge', a: 'r0c0', b: 'r0c4' }), true, 'collinear clear pair is legal');
  // Non-island target.
  assert.equal(bridges.validateMove(state, { type: 'bridge', a: 'r0c0', b: 'r0c2' }), false, 'water cell is not an island');
  // Same island.
  assert.equal(bridges.validateMove(state, { type: 'bridge', a: 'r0c0', b: 'r0c0' }), false, 'self edge rejected');

  // Three collinear islands: r0c0, r0c2, r0c4. r0c0|r0c4 is NOT legal (blocked by r0c2).
  const three = bridges.decodeDesc({ size: 5 }, '1.2.1');
  assert.equal(bridges.validateMove(three, { type: 'bridge', a: 'r0c0', b: 'r0c2' }), true, 'adjacent pair legal');
  assert.equal(bridges.validateMove(three, { type: 'bridge', a: 'r0c2', b: 'r0c4' }), true, 'adjacent pair legal');
  assert.equal(bridges.validateMove(three, { type: 'bridge', a: 'r0c0', b: 'r0c4' }), false, 'pair blocked by middle island is illegal');
});

test('validateMove rejects an edge that would cross a live bridge', () => {
  // Plus-shape: islands at the four arms and center, so a horizontal edge and a vertical edge cross.
  //   .A.
  //   BCD     (rows of 3)
  //   .E.
  // A=r0c1, B=r1c0, C=r1c1, D=r1c2, E=r2c1.  Edge B|D (horizontal, through r1c1?) — no, C sits at
  // r1c1 so B|D is blocked. Use a layout where a crossing genuinely exists:
  //   A.B
  //   ...
  //   C.D   with an extra island pair that forms crossing runs.
  // Simpler explicit crossing: islands at r0c1, r2c1 (vertical pair through r1c1) and r1c0, r1c2
  // (horizontal pair through r1c1). These two edges cross at r1c1.
  const state = bridges.decodeDesc({ size: 3 }, '.1./2.2/.1.');
  const vKey = { type: 'bridge', a: 'r0c1', b: 'r2c1' }; // vertical through r1c1
  const hKey = { type: 'bridge', a: 'r1c0', b: 'r1c2' }; // horizontal through r1c1
  assert.equal(bridges.validateMove(state, vKey), true, 'vertical edge legal initially');
  assert.equal(bridges.validateMove(state, hKey), true, 'horizontal edge legal initially');
  // Place the vertical bridge, then the horizontal one must be rejected (would cross).
  const afterV = bridges.applyMove(state, vKey);
  assert.equal(bridges.validateMove(afterV, hKey), false, 'horizontal edge now crosses a live bridge → rejected');
});

test('findConflicts flags an over-budget island', () => {
  // r0c0 has label 1 but we force two bridges onto it (impossible legally, but findConflicts is
  // about the player's CURRENT state). Use a row "1...2": one legal edge, double it → r0c0 sum 2 > 1.
  let state = bridges.decodeDesc({ size: 5 }, '1...2');
  state = bridges.applyMove(state, { type: 'bridge', a: 'r0c0', b: 'r0c4' }); // count 1
  state = bridges.applyMove(state, { type: 'bridge', a: 'r0c0', b: 'r0c4' }); // count 2
  const conflicts = bridges.findConflicts(state);
  assert.ok(conflicts.includes('r0c0'), 'over-budget island (label 1, sum 2) is flagged');
});

test('encodeDesc → decodeDesc round-trips the island layout', () => {
  for (const seed of [1, 2, 3, 7, 42, 99, 1000]) {
    const { playState, params } = bridges.newPuzzle({ seed, size: 7, difficulty: 'easy' });
    const desc = bridges.encodeDesc(playState);
    const rebuilt = bridges.decodeDesc(params, desc);
    assert.equal(rebuilt.grid.rows, playState.grid.rows);
    assert.equal(rebuilt.grid.cols, playState.grid.cols);
    assert.deepEqual(rebuilt.bridges, {}, 'rebuilt has empty bridges');
    for (let r = 0; r < playState.grid.rows; r++) {
      for (let c = 0; c < playState.grid.cols; c++) {
        const a = getCellAt(playState.grid, r, c);
        const b = getCellAt(rebuilt.grid, r, c);
        assert.equal(b.role, a.role, `cell ${a.id} role`);
        assert.equal(b.value, a.value, `cell ${a.id} value`);
      }
    }
    assert.equal(bridges.encodeDesc(rebuilt), desc, `seed ${seed}: encode is stable`);
  }
});

test('encodeParams full vs not-full; decodeParams round-trip', () => {
  const p = { seed: 1, size: 9, difficulty: 'medium' };
  assert.equal(bridges.encodeParams(p, false), '9');
  assert.match(bridges.encodeParams(p, true), /^9dmedium$/);
  const d = bridges.decodeParams(bridges.encodeParams(p, true));
  assert.equal(d.size, 9);
  assert.equal(d.difficulty, 'medium');
});

test('full solve path: applying hints reaches isSolved', () => {
  const { playState, solution } = bridges.newPuzzle({ seed: 3, size: 7, difficulty: 'easy' });
  let state = playState;
  let guard = 0;
  while (!bridges.isSolved(state) && guard++ < 500) {
    const h = bridges.hint(state, solution);
    if (!h) break;
    assert.equal(bridges.validateMove(state, h), true, 'each hint is valid');
    // a hint raises an edge toward the solution; apply until it reaches the wanted count.
    state = bridges.applyMove(state, h);
  }
  assert.equal(bridges.isSolved(state), true, 'applying hints solves the puzzle');
});

test('eventsFor maps a bridge move to cellPlaced / cellCleared with both island ids', () => {
  const state = bridges.decodeDesc({ size: 5 }, '1...1');
  const move = { type: 'bridge', a: 'r0c0', b: 'r0c4' };
  const s1 = bridges.applyMove(state, move);
  const ev1 = bridges.eventsFor(state, move, s1);
  assert.equal(ev1.length, 1);
  assert.equal(ev1[0].name, 'cellPlaced');
  assert.deepEqual(ev1[0].payload.cells.sort(), ['r0c0', 'r0c4']);
  // cycle up to 2, then to 0 → cellCleared
  const s2 = bridges.applyMove(s1, move);
  const s3 = bridges.applyMove(s2, move);
  const ev3 = bridges.eventsFor(s2, move, s3);
  assert.equal(ev3[0].name, 'cellCleared');
  assert.deepEqual(ev3[0].payload.cells.sort(), ['r0c0', 'r0c4']);
});
