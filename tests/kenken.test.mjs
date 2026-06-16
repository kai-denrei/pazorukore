// tests/kenken.test.mjs — headless verification of the KenKen back end (§5).
// Mirrors the Sudoku/Shikaku tests. Builds puzzles across several seeds and asserts:
//   • the generated solution is a valid Latin square satisfying every cage (INDEPENDENT check).
//   • the cage layout has EXACTLY ONE solution (the game solver's countSolutions === 1).
//   • generation is reproducible from a seed.
//   • applyMove is pure (prior snapshot untouched) and a no-op returns the same reference.
//   • isSolved is true on the solution, false on a partial/wrong board.
//   • findConflicts flags a row duplicate and a wrong COMPLETE cage.
//   • validateMove caps placement at 1..N.
//   • encodeDesc → decodeDesc round-trips the cages + ops + targets.
//   • all 3 difficulty presets generate unique puzzles.
// Run: node --test tests/kenken.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import kenken from '../src/games/kenken/index.js';
import { countSolutions } from '../src/games/kenken/solver.js';
import { getCell } from '../src/core/grid.js';

const SEEDS = [1, 2, 7, 42, 1337, 99999];

// --- INDEPENDENT cage + Latin-square checks --------------------------------------------------
// Read cages straight off the playState grid (regionId groups, anchor label = clue) and verify a
// candidate value board independently of the game's solver.

function cagesFromGrid(grid) {
  const cols = grid.cols;
  const byRegion = new Map();
  for (const cell of grid.cells) {
    const id = cell.regionId;
    if (id == null) continue;
    if (!byRegion.has(id)) byRegion.set(id, { cells: [], op: null, target: null });
    const rec = byRegion.get(id);
    rec.cells.push(cell.row * cols + cell.col);
    if (cell.label != null) {
      const m = /^(\d+)([+\-×÷])?$/.exec(cell.label);
      assert.ok(m, `label parses: ${cell.label}`);
      rec.target = parseInt(m[1], 10);
      const g = m[2];
      rec.op = g == null ? null : (g === '×' ? 'x' : g === '÷' ? '/' : g);
    }
  }
  return [...byRegion.values()];
}

// Independently confirm op→target for a complete cage.
function cageOk(op, target, values) {
  if (op == null || values.length === 1) return values[0] === target;
  if (op === '+') return values.reduce((a, b) => a + b, 0) === target;
  if (op === 'x') return values.reduce((a, b) => a * b, 1) === target;
  if (op === '-') return values.length === 2 && Math.abs(values[0] - values[1]) === target;
  if (op === '/') {
    if (values.length !== 2) return false;
    const hi = Math.max(...values), lo = Math.min(...values);
    return lo !== 0 && hi % lo === 0 && hi / lo === target;
  }
  return false;
}

// A value board (flat) is a valid Latin square iff each row and column is a permutation of 1..N.
function isLatinSquare(vals, N) {
  for (let r = 0; r < N; r++) {
    const seen = new Set();
    for (let c = 0; c < N; c++) {
      const v = vals[r * N + c];
      if (v < 1 || v > N || seen.has(v)) return false;
      seen.add(v);
    }
  }
  for (let c = 0; c < N; c++) {
    const seen = new Set();
    for (let r = 0; r < N; r++) {
      const v = vals[r * N + c];
      if (seen.has(v)) return false;
      seen.add(v);
    }
  }
  return true;
}

function gridVals(grid) {
  return grid.cells.map((c) => (c.value == null ? 0 : parseInt(c.value, 10)));
}

// --- INDEPENDENT uniqueness counter (no shared code with the game solver) ---------------------
// Naive backtracking Latin-square fill honouring cages, counting solutions up to `cap`.
function independentCount(playState, cap = 2) {
  const grid = playState.grid;
  const N = grid.rows;
  const cages = cagesFromGrid(grid);
  const cellCage = new Array(N * N).fill(-1);
  cages.forEach((cage, ci) => { for (const idx of cage.cells) cellCage[idx] = ci; });

  const board = new Array(N * N).fill(0);
  const rowUsed = Array.from({ length: N }, () => new Set());
  const colUsed = Array.from({ length: N }, () => new Set());
  let count = 0;

  function cageStillOk(ci) {
    const cage = cages[ci];
    const vals = [];
    let complete = true;
    for (const idx of cage.cells) {
      if (board[idx] === 0) { complete = false; } else vals.push(board[idx]);
    }
    if (complete) return cageOk(cage.op, cage.target, cage.cells.map((idx) => board[idx]));
    // partial: only reject a clear overshoot for + and x.
    if (cage.op === '+') return vals.reduce((a, b) => a + b, 0) <= cage.target;
    if (cage.op === 'x') {
      const p = vals.reduce((a, b) => a * b, 1);
      return p !== 0 && cage.target % p === 0;
    }
    return true;
  }

  function rec(idx) {
    if (count >= cap) return;
    if (idx === N * N) { count++; return; }
    const r = (idx / N) | 0, c = idx % N;
    for (let v = 1; v <= N; v++) {
      if (rowUsed[r].has(v) || colUsed[c].has(v)) continue;
      board[idx] = v; rowUsed[r].add(v); colUsed[c].add(v);
      if (cageStillOk(cellCage[idx])) rec(idx + 1);
      board[idx] = 0; rowUsed[r].delete(v); colUsed[c].delete(v);
      if (count >= cap) return;
    }
  }
  rec(0);
  return count;
}

// --- tests -----------------------------------------------------------------------------------

test('meta matches the contract', () => {
  assert.equal(kenken.meta.id, 'kenken');
  assert.equal(kenken.meta.name, 'KenKen');
  assert.equal(kenken.meta.interaction, 'digit-entry');
  assert.equal(kenken.meta.requirements.glyphSet, 'digits');
  assert.equal(kenken.meta.requirements.needsOffState, true);
  assert.equal(kenken.meta.requirements.needsRegionFill, false);
  assert.equal(kenken.meta.fixedDigitCounts, true);
});

test('newPuzzle builds an all-fillable grid with cages + one label per cage', () => {
  for (const seed of SEEDS) {
    const { playState, params } = kenken.newPuzzle({ seed, difficulty: 'medium' });
    const N = params.size;
    assert.equal(playState.grid.rows, N);
    assert.equal(playState.grid.cols, N);
    const labelCount = playState.grid.cells.filter((c) => c.label != null).length;
    const cageIds = new Set(playState.grid.cells.map((c) => c.regionId));
    assert.equal(labelCount, cageIds.size, 'exactly one label per cage');
    for (const cell of playState.grid.cells) {
      assert.equal(cell.role, 'fillable', 'every cell is fillable');
      assert.equal(cell.value, null, 'no given digits — board starts blank');
      assert.equal(cell.given, false);
      assert.notEqual(cell.regionId, null, 'every cell belongs to a cage');
    }
  }
});

test('generated solution is a valid Latin square satisfying every cage (INDEPENDENT check)', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (const seed of SEEDS) {
      const { solution, params } = kenken.newPuzzle({ seed, difficulty });
      const N = params.size;
      const vals = gridVals(solution.grid);
      assert.ok(isLatinSquare(vals, N), `${difficulty}/${seed}: solution is a Latin square`);
      for (const cage of cagesFromGrid(solution.grid)) {
        const cv = cage.cells.map((idx) => vals[idx]);
        assert.ok(cageOk(cage.op, cage.target, cv),
          `${difficulty}/${seed}: cage op=${cage.op} target=${cage.target} vals=${cv} satisfied`);
      }
    }
  }
});

test('cage layout has EXACTLY ONE solution (game solver + independent counter, capped at 2)', () => {
  for (const seed of SEEDS) {
    const { playState } = kenken.newPuzzle({ seed, difficulty: 'medium' });
    const N = playState.grid.rows;
    const cages = cagesFromGrid(playState.grid);
    // game solver
    const n = countSolutions(N, N, cages, 2);
    assert.equal(n, 1, `seed ${seed}: game solver expected exactly 1, got ${n}`);
    // independent counter
    const m = independentCount(playState, 2);
    assert.equal(m, 1, `seed ${seed}: independent counter expected exactly 1, got ${m}`);
  }
});

test('generation is reproducible from a seed', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (const seed of SEEDS) {
      const a = kenken.newPuzzle({ seed, difficulty });
      const b = kenken.newPuzzle({ seed, difficulty });
      assert.equal(kenken.encodeDesc(a.playState), kenken.encodeDesc(b.playState),
        `${difficulty}/${seed}: same cage layout`);
      // same solution too
      const av = gridVals(a.solution.grid).join('');
      const bv = gridVals(b.solution.grid).join('');
      assert.equal(av, bv, `${difficulty}/${seed}: same solution`);
    }
  }
});

test('solve() reproduces the unique solution; isSolved(solution) is true', () => {
  for (const seed of SEEDS) {
    const { playState, solution } = kenken.newPuzzle({ seed, difficulty: 'medium' });
    const solved = kenken.solve(playState);
    assert.ok(solved, `seed ${seed}: solve() returned a board`);
    assert.equal(kenken.isSolved(solved), true, `seed ${seed}: solve() output is solved`);
    assert.equal(kenken.findConflicts(solved).length, 0, `seed ${seed}: no conflicts`);
    // matches the bundled solution
    assert.equal(gridVals(solved.grid).join(''), gridVals(solution.grid).join(''),
      `seed ${seed}: solve() === bundled solution`);
    assert.equal(kenken.isSolved(solution), true, `seed ${seed}: bundled solution is solved`);
  }
});

test('applyMove is pure (prior snapshot untouched) and a no-op returns the same reference', () => {
  const { playState } = kenken.newPuzzle({ seed: 7, difficulty: 'medium' });
  const id = 'r0c0';
  const before = playState;
  const beforeCell = getCell(before.grid, id);

  const next = kenken.applyMove(playState, { type: 'place', id, value: '3' });
  assert.notEqual(next, before, 'place produced a new state');
  assert.equal(getCell(before.grid, id).value, beforeCell.value, 'prior snapshot untouched');
  assert.equal(getCell(next.grid, id).value, '3', 'new state has the placed value');

  // Re-placing the same value is a no-op → SAME reference.
  const again = kenken.applyMove(next, { type: 'place', id, value: '3' });
  assert.equal(again, next, 'idempotent place returns the same state object');

  // Clearing an empty cell with no pencil is a no-op → SAME reference.
  const emptyId = 'r1c1';
  const ps2 = kenken.applyMove(playState, { type: 'clear', id: emptyId });
  assert.equal(ps2, playState, 'clearing an empty cell is a no-op');

  // Pencil toggle on/off.
  const p1 = kenken.applyMove(playState, { type: 'pencil', id: emptyId, value: '2' });
  assert.deepEqual(p1.pencil[emptyId], ['2'], 'pencil added');
  const p2 = kenken.applyMove(p1, { type: 'pencil', id: emptyId, value: '2' });
  assert.equal(p2.pencil[emptyId], undefined, 'pencil toggled off');
});

test('isSolved is false on a partial board and on a wrong-but-full board', () => {
  const { playState, solution } = kenken.newPuzzle({ seed: 2, difficulty: 'easy' });
  // partial: empty board
  assert.equal(kenken.isSolved(playState), false, 'empty board is not solved');
  // wrong-but-full: take the solution and corrupt one cell to break a row.
  const N = solution.grid.rows;
  // find a value to swap in the first row that creates a duplicate
  const wrong = kenken.applyMove(solution, { type: 'place', id: 'r0c0', value: String(parseInt(getCell(solution.grid, 'r0c1').value, 10)) });
  assert.equal(kenken.isSolved(wrong), false, 'full board with a row duplicate is not solved');
});

test('findConflicts flags a row duplicate and a wrong COMPLETE cage', () => {
  // Hand-built 2×2 layout via decodeDesc. Cells r0c0,r0c1,r1c0,r1c1 → flat 0,1,2,3.
  // Cage layout: cage0 = {r0c0,r0c1} (a "+" cage target 3), cage1 = {r1c0,r1c1} ("+" target 3).
  // gridStr (base36 cage index per cell, row-major): "0011"; clues "p3,p3".
  const desc = '0011;p3,p3';
  const ps = kenken.decodeDesc({ size: 2 }, desc);
  // Place a row duplicate: r0c0=1, r0c1=1 → row 0 duplicate; cage0 sum 2 ≠ 3 (complete cage wrong).
  let s = kenken.applyMove(ps, { type: 'place', id: 'r0c0', value: '1' });
  s = kenken.applyMove(s, { type: 'place', id: 'r0c1', value: '1' });
  const conflicts = new Set(kenken.findConflicts(s));
  assert.ok(conflicts.has('r0c0') && conflicts.has('r0c1'), 'row duplicate flagged');
  // cage0 is now complete (both cells filled) and sum 2 ≠ target 3 → also flagged (same cells).
  // Build a complete-cage-only violation without a row dup: r0c0=1, r0c1=2 → no row dup, sum 3 OK.
  let ok = kenken.applyMove(ps, { type: 'place', id: 'r0c0', value: '1' });
  ok = kenken.applyMove(ok, { type: 'place', id: 'r0c1', value: '2' });
  // cage0 complete and correct → no conflict from cage0; no row dup.
  assert.equal(kenken.findConflicts(ok).length, 0, 'a correct complete cage with no dup has no conflicts');
  // Now make cage0 complete but WRONG with distinct values: r0c0=2, r0c1=1 → sum 3 OK still.
  // Use a different target to force a wrong cage: decode a "+" target 4 cage of size 2 on a 2-board
  // is impossible (max 1+2=3), so use target 3 correct and corrupt to sum 4 via values 2,2 — but
  // that's a row dup. Instead test a wrong cage on a non-row pair: cage spanning r0c0 & r1c0 (a col),
  // values 1 then 1 is a col dup. Use distinct values 2,2 impossible. So: target-mismatch cage:
  const desc2 = '0101;p4,p2'; // cage0={r0c0,r1c0} sum target 4, cage1={r0c1,r1c1} sum target 2
  const ps2 = kenken.decodeDesc({ size: 2 }, desc2);
  // Fill cage0 with 1,2 (sum 3 ≠ 4) → distinct values (col), complete cage wrong, no dup.
  let w = kenken.applyMove(ps2, { type: 'place', id: 'r0c0', value: '1' });
  w = kenken.applyMove(w, { type: 'place', id: 'r1c0', value: '2' });
  const wc = new Set(kenken.findConflicts(w));
  assert.ok(wc.has('r0c0') && wc.has('r1c0'), 'wrong complete cage (sum 3 ≠ 4) is flagged');
});

test('validateMove caps placement at 1..N', () => {
  const { playState } = kenken.newPuzzle({ seed: 1, difficulty: 'medium' }); // N=5
  const id = 'r0c0';
  assert.equal(kenken.validateMove(playState, { type: 'place', id, value: '1' }), true);
  assert.equal(kenken.validateMove(playState, { type: 'place', id, value: '5' }), true);
  assert.equal(kenken.validateMove(playState, { type: 'place', id, value: '0' }), false);
  assert.equal(kenken.validateMove(playState, { type: 'place', id, value: '6' }), false);
  assert.equal(kenken.validateMove(playState, { type: 'clear', id }), true);
  assert.equal(kenken.validateMove(playState, { type: 'pencil', id, value: '3' }), true);
  assert.equal(kenken.validateMove(playState, { type: 'place', id: 'rXcY', value: '1' }), false);
});

test('encodeDesc → decodeDesc round-trips cages + ops + targets', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (const seed of SEEDS) {
      const { playState, params } = kenken.newPuzzle({ seed, difficulty });
      const desc = kenken.encodeDesc(playState);
      const rebuilt = kenken.decodeDesc(params, desc);
      assert.equal(rebuilt.grid.rows, playState.grid.rows);
      assert.equal(rebuilt.grid.cols, playState.grid.cols);
      // Cell-for-cell: same regionId membership pattern + same labels.
      const origCages = cagesFromGrid(playState.grid);
      const rebuiltCages = cagesFromGrid(rebuilt.grid);
      assert.equal(rebuiltCages.length, origCages.length, `${difficulty}/${seed}: same cage count`);
      // Sort cages canonically by their cell list for comparison.
      const norm = (cs) => cs.map((c) => ({
        cells: c.cells.slice().sort((a, b) => a - b).join(','),
        op: c.op, target: c.target,
      })).sort((a, b) => a.cells.localeCompare(b.cells));
      assert.deepEqual(norm(rebuiltCages), norm(origCages), `${difficulty}/${seed}: cages+ops+targets identical`);
      // Re-encoding the rebuilt state yields the identical string (stable).
      assert.equal(kenken.encodeDesc(rebuilt), desc, `${difficulty}/${seed}: encode is stable`);
      // The rebuilt layout still has a unique solution and solve() reaches it.
      assert.ok(kenken.solve(rebuilt), `${difficulty}/${seed}: rebuilt is solvable`);
    }
  }
});

test('encodeParams full vs not-full; decodeParams round-trip', () => {
  const p = { seed: 1, size: 6, difficulty: 'hard' };
  assert.equal(kenken.encodeParams(p, false), '6');           // gen-only difficulty omitted
  assert.match(kenken.encodeParams(p, true), /^6dhard$/);     // full keeps difficulty
  const d = kenken.decodeParams(kenken.encodeParams(p, true));
  assert.equal(d.size, 6);
  assert.equal(d.difficulty, 'hard');
});

test('all 3 difficulty presets generate unique puzzles (size 4/5/6)', () => {
  const expectedSize = { easy: 4, medium: 5, hard: 6 };
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (const seed of [1, 7, 42]) {
      const { playState, params } = kenken.newPuzzle({ seed, difficulty });
      assert.equal(params.size, expectedSize[difficulty], `${difficulty}: size ${expectedSize[difficulty]}`);
      assert.equal(independentCount(playState, 2), 1, `${difficulty}/${seed}: independently unique`);
    }
  }
});

test('hint fills the next empty cell with the correct value, leading to a solve', () => {
  const { playState, solution } = kenken.newPuzzle({ seed: 3, difficulty: 'easy' });
  let state = playState;
  let guard = 0;
  while (!kenken.isSolved(state) && guard++ < 100) {
    const h = kenken.hint(state, solution);
    if (!h) break;
    assert.equal(h.type, 'place');
    assert.equal(kenken.validateMove(state, h), true, 'each hint is a valid move');
    state = kenken.applyMove(state, h);
  }
  assert.equal(kenken.isSolved(state), true, 'applying hints solves the puzzle');
});
