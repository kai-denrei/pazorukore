// tests/starbattle.test.mjs — headless verification of the Star Battle back-end.
// Run: node --test tests/starbattle.test.mjs
//
// Asserts, across several seeds and difficulties:
//   • generate() bundles a valid solution satisfying the WIN rule — verified by an INDEPENDENT
//     in-test validator (exactly 1 star per row/col/region, no 8-adjacency), with CONNECTED regions;
//   • the solver finds the puzzle UNIQUE (countSolutions === 1) for several seeds;
//   • reproducibility: same seed → identical regions + stars;
//   • applyMove purity (no mutation of prior stars) + no-op returns same reference; toggle twice
//     returns to empty;
//   • validateMove rejects bad types / off-grid;
//   • isSolved false on empty / partial / adjacent-stars / wrong-counts states;
//   • encodeDesc → decodeDesc round-trips the REGION layout;
//   • presets generate unique, valid puzzles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import starbattle from '../src/games/starbattle/index.js';
import { countSolutions, solveStars } from '../src/games/starbattle/solver.js';
import { ROLES, getCellAt } from '../src/core/grid.js';

// --- INDEPENDENT validator ------------------------------------------------------------------
// Deliberately separate from src/games/starbattle (no shared code) so it's a genuine cross-check.
// Given a playState grid and a stars object, it verifies the WIN rule from scratch: exactly K stars
// in every row, every column, and every region; no two stars 8-adjacent. Also (separately) that
// every region is 4-CONNECTED.
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function independentSolved(grid, stars, k = 1) {
  const rows = grid.rows, cols = grid.cols;
  const star = (r, c) => !!stars[`r${r}c${c}`];

  // region id per cell
  const regOf = (r, c) => getCellAt(grid, r, c).regionId;
  const regionIds = new Set();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) regionIds.add(regOf(r, c));

  // counts
  const rowCount = new Array(rows).fill(0);
  const colCount = new Array(cols).fill(0);
  const regionCount = new Map();
  let total = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!star(r, c)) continue;
      total++;
      rowCount[r]++;
      colCount[c]++;
      const g = regOf(r, c);
      regionCount.set(g, (regionCount.get(g) || 0) + 1);
    }
  }
  if (total !== k * rows) return false;
  for (let r = 0; r < rows; r++) if (rowCount[r] !== k) return false;
  for (let c = 0; c < cols; c++) if (colCount[c] !== k) return false;
  for (const g of regionIds) if ((regionCount.get(g) || 0) !== k) return false;

  // no two stars 8-adjacent
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!star(r, c)) continue;
      for (const [dr, dc] of KING) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        if (star(nr, nc)) return false;
      }
    }
  }
  return true;
}

// Independent connectivity check: every region is one 4-connected group covering all its cells.
function regionsConnected(grid) {
  const rows = grid.rows, cols = grid.cols, N = rows * cols;
  const regOf = (r, c) => getCellAt(grid, r, c).regionId;
  const sizes = new Map();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const g = regOf(r, c);
    sizes.set(g, (sizes.get(g) || 0) + 1);
  }
  for (const [g, size] of sizes) {
    // find a start cell in region g
    let start = null;
    for (let r = 0; r < rows && !start; r++) for (let c = 0; c < cols; c++) if (regOf(r, c) === g) { start = [r, c]; break; }
    const seen = new Set([start[0] * cols + start[1]]);
    const stack = [start];
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [dr, dc] of DIRS4) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        if (regOf(nr, nc) !== g) continue;
        const key = nr * cols + nc;
        if (!seen.has(key)) { seen.add(key); stack.push([nr, nc]); }
      }
    }
    if (seen.size !== size) return false;
  }
  return true;
}

// --- helpers --------------------------------------------------------------------------------
function regionOfFromGrid(grid) {
  const arr = new Array(grid.rows * grid.cols);
  for (const cell of grid.cells) arr[cell.row * grid.cols + cell.col] = cell.regionId;
  return arr;
}

const SEEDS = [1, 2, 3, 7, 42, 99, 123, 1000];

// --- tests ----------------------------------------------------------------------------------

test('newPuzzle builds a blank playState: every cell is a region member, empty stars', () => {
  for (const seed of SEEDS) {
    const { playState } = starbattle.newPuzzle({ seed, size: 5, difficulty: 'easy' });
    assert.equal(playState.grid.rows, 5);
    assert.equal(playState.grid.cols, 5);
    assert.deepEqual(playState.stars, {}, 'fresh puzzle has no stars');
    const regions = new Set();
    for (const cell of playState.grid.cells) {
      assert.equal(cell.role, ROLES.member, 'every cell is a member');
      assert.equal(cell.value, null, 'no number clues');
      assert.ok(cell.regionId != null && cell.regionId >= 0, 'cell carries a region id');
      regions.add(cell.regionId);
    }
    assert.equal(regions.size, 5, 'exactly N regions');
  }
});

test('bundled solution satisfies the WIN rule (independent validator + engine agree)', () => {
  for (const seed of SEEDS) {
    const { playState, solution } = starbattle.newPuzzle({ seed, size: 5, difficulty: 'easy' });
    const solvedState = { grid: playState.grid, stars: solution.stars, k: 1 };
    assert.equal(starbattle.isSolved(solvedState), true, `seed ${seed}: engine isSolved on bundled solution`);
    assert.equal(independentSolved(playState.grid, solution.stars, 1), true,
      `seed ${seed}: independent validator confirms the bundled solution`);
    assert.equal(starbattle.findConflicts(solvedState).length, 0, `seed ${seed}: no conflicts in solution`);
  }
});

test('regions are CONNECTED (independent flood-fill check)', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (const seed of SEEDS) {
      const { playState } = starbattle.newPuzzle({ seed, difficulty });
      assert.equal(regionsConnected(playState.grid), true, `${difficulty}/${seed}: every region 4-connected`);
    }
  }
});

test('solve() reproduces a valid solution', () => {
  for (const seed of SEEDS) {
    const { playState } = starbattle.newPuzzle({ seed, size: 5, difficulty: 'easy' });
    const solved = starbattle.solve(playState);
    assert.ok(solved, `seed ${seed}: solve() returned a solution`);
    assert.equal(starbattle.isSolved(solved), true, `seed ${seed}: solve() output is solved`);
    assert.equal(independentSolved(solved.grid, solved.stars, 1), true, `seed ${seed}: independent confirms solve()`);
  }
});

test('puzzle is UNIQUELY solvable (countSolutions === 1)', () => {
  for (const seed of SEEDS) {
    const { playState } = starbattle.newPuzzle({ seed, size: 5, difficulty: 'easy' });
    const regionOf = regionOfFromGrid(playState.grid);
    const n = countSolutions(playState.grid.rows, playState.grid.cols, regionOf, 1, 2);
    assert.equal(n, 1, `seed ${seed}: expected exactly 1 solution, got ${n}`);
  }
});

test('solver: countSolutions and solveStars agree and finish 7×7 well under 1s', () => {
  const { playState } = starbattle.newPuzzle({ seed: 2, difficulty: 'hard' });
  const regionOf = regionOfFromGrid(playState.grid);
  const t0 = Date.now();
  const n = countSolutions(7, 7, regionOf, 1, 2);
  const ms = Date.now() - t0;
  assert.equal(n, 1, '7×7 puzzle is unique');
  assert.ok(ms < 1000, `7×7 uniqueness check took ${ms}ms (must be < 1000)`);
  const stars = solveStars(7, 7, regionOf, 1);
  assert.ok(stars, 'solveStars returns a solution');
  assert.equal(independentSolved(playState.grid, stars, 1), true, 'solveStars solution is valid');
});

test('reproducibility: same seed → identical regions + stars', () => {
  for (const seed of [1, 7, 42, 1000]) {
    const a = starbattle.newPuzzle({ seed, size: 6, difficulty: 'medium' });
    const b = starbattle.newPuzzle({ seed, size: 6, difficulty: 'medium' });
    assert.equal(starbattle.encodeDesc(a.playState), starbattle.encodeDesc(b.playState),
      `seed ${seed}: identical region layout`);
    assert.deepEqual(a.solution.stars, b.solution.stars, `seed ${seed}: identical stars`);
  }
});

test('applyMove is pure: prior stars untouched; toggling a cell twice returns to empty', () => {
  const { playState, solution } = starbattle.newPuzzle({ seed: 7, size: 5, difficulty: 'easy' });
  const hint = starbattle.hint(playState, solution);
  assert.ok(hint, 'a hint exists on a fresh puzzle');
  assert.equal(hint.type, 'star');
  assert.equal(starbattle.validateMove(playState, hint), true, 'hint is a valid move');

  const before = playState;
  const beforeSnapshot = JSON.stringify(before.stars);

  const s1 = starbattle.applyMove(before, hint);
  assert.notEqual(s1, before, 'toggle produced a new state');
  assert.notEqual(s1.stars, before.stars, 'new stars object (not the same reference)');
  assert.equal(JSON.stringify(before.stars), beforeSnapshot, 'prior stars object untouched');
  assert.equal(s1.stars[hint.id], 1, 'cell present after first toggle');

  const s2 = starbattle.applyMove(s1, hint);
  assert.equal(s2.stars[hint.id], undefined, 'cell removed after second toggle');
  assert.deepEqual(s2.stars, before.stars, 'toggling twice returns to the starting (empty) stars');
  assert.equal(s1.stars[hint.id], 1, 's1 untouched by s2');

  // No-ops return the SAME reference.
  const noopType = starbattle.applyMove(before, { type: 'nonsense', id: 'r0c0' });
  assert.equal(noopType, before, 'unknown move type returns same reference');
  const noopMissing = starbattle.applyMove(before, { type: 'star', id: 'r99c99' });
  assert.equal(noopMissing, before, 'off-grid cell returns same reference');
  const noopNoId = starbattle.applyMove(before, { type: 'star' });
  assert.equal(noopNoId, before, 'missing id returns same reference');
});

test('validateMove rejects bad move types and off-grid cells', () => {
  const { playState } = starbattle.newPuzzle({ seed: 1, size: 5, difficulty: 'easy' });
  const realId = playState.grid.cells[0].id;
  assert.equal(starbattle.validateMove(playState, { type: 'star', id: realId }), true, 'starring a real cell is legal');
  assert.equal(starbattle.validateMove(playState, { type: 'star', id: 'r99c99' }), false, 'off-grid rejected');
  assert.equal(starbattle.validateMove(playState, { type: 'shade', id: realId }), false, 'wrong move type rejected');
  assert.equal(starbattle.validateMove(playState, { type: 'star' }), false, 'missing id rejected');
  assert.equal(starbattle.validateMove(playState, null), false, 'null move rejected');
});

test('isSolved false on empty, partial, adjacent-stars, and wrong-count states', () => {
  const { playState, solution } = starbattle.newPuzzle({ seed: 3, size: 5, difficulty: 'easy' });
  const grid = playState.grid;

  // empty
  assert.equal(starbattle.isSolved(playState), false, 'empty is not solved');

  // partial: solution minus one star
  const solIds = Object.keys(solution.stars);
  const partial = { ...solution.stars };
  delete partial[solIds[0]];
  assert.equal(starbattle.isSolved({ grid, stars: partial, k: 1 }), false, 'partial placement not solved');

  // wrong-count: solution PLUS an extra star somewhere (now a row/col/region exceeds 1)
  const extra = { ...solution.stars };
  // find a cell not already starred
  let extraId = null;
  for (const cell of grid.cells) { if (!extra[cell.id]) { extraId = cell.id; break; } }
  extra[extraId] = 1;
  assert.equal(starbattle.isSolved({ grid, stars: extra, k: 1 }), false, 'over-count is not solved');

  // adjacent-stars: two 8-adjacent stars (and nothing else) — fails adjacency + counts.
  const adj = { r0c0: 1, r1c1: 1 }; // diagonally adjacent
  assert.equal(starbattle.isSolved({ grid, stars: adj, k: 1 }), false, 'two adjacent stars not solved');
});

test('findConflicts flags adjacent stars and over-full rows/cols/regions', () => {
  const { playState } = starbattle.newPuzzle({ seed: 1, size: 5, difficulty: 'easy' });
  const grid = playState.grid;

  // two diagonally-adjacent stars → both flagged for adjacency.
  const adjConf = starbattle.findConflicts({ grid, stars: { r0c0: 1, r1c1: 1 }, k: 1 });
  assert.ok(adjConf.includes('r0c0') && adjConf.includes('r1c1'), 'adjacent stars flagged');

  // two stars in the same ROW (far apart, not adjacent) → row exceeds k → both flagged.
  const rowConf = starbattle.findConflicts({ grid, stars: { r0c0: 1, r0c3: 1 }, k: 1 });
  assert.ok(rowConf.includes('r0c0') && rowConf.includes('r0c3'), 'over-full row flagged');

  // a single star → no conflict.
  assert.deepEqual(starbattle.findConflicts({ grid, stars: { r2c2: 1 }, k: 1 }), [], 'a lone star is fine');
});

test('full solve path: applying hints reaches isSolved', () => {
  const { playState, solution } = starbattle.newPuzzle({ seed: 42, size: 5, difficulty: 'easy' });
  let state = playState;
  let guard = 0;
  while (!starbattle.isSolved(state) && guard++ < 500) {
    const h = starbattle.hint(state, solution);
    if (!h) break;
    assert.equal(starbattle.validateMove(state, h), true, 'each hint is valid');
    state = starbattle.applyMove(state, h);
  }
  assert.equal(starbattle.isSolved(state), true, 'applying hints solves the puzzle');
});

test('eventsFor maps a star move to cellPlaced / cellCleared with the cell id', () => {
  const { playState } = starbattle.newPuzzle({ seed: 1, size: 5, difficulty: 'easy' });
  const id = playState.grid.cells[0].id;
  const move = { type: 'star', id };
  const s1 = starbattle.applyMove(playState, move);
  const ev1 = starbattle.eventsFor(playState, move, s1);
  assert.equal(ev1.length, 1);
  assert.equal(ev1[0].name, 'cellPlaced');
  assert.deepEqual(ev1[0].payload.cells, [id]);
  assert.equal(ev1[0].payload.id, id);
  const s2 = starbattle.applyMove(s1, move);
  const ev2 = starbattle.eventsFor(s1, move, s2);
  assert.equal(ev2[0].name, 'cellCleared');
  assert.deepEqual(ev2[0].payload.cells, [id]);
  // no-op yields no events
  assert.deepEqual(starbattle.eventsFor(playState, move, playState), []);
});

test('encodeDesc → decodeDesc round-trips the region layout', () => {
  for (const seed of SEEDS) {
    const { playState, params } = starbattle.newPuzzle({ seed, size: 5, difficulty: 'easy' });
    const desc = starbattle.encodeDesc(playState);
    const rebuilt = starbattle.decodeDesc(params, desc);
    assert.equal(rebuilt.grid.rows, playState.grid.rows);
    assert.equal(rebuilt.grid.cols, playState.grid.cols);
    assert.deepEqual(rebuilt.stars, {}, 'rebuilt has empty stars');
    for (let r = 0; r < playState.grid.rows; r++) {
      for (let c = 0; c < playState.grid.cols; c++) {
        const a = getCellAt(playState.grid, r, c);
        const b = getCellAt(rebuilt.grid, r, c);
        assert.equal(b.role, a.role, `cell ${a.id} role`);
        assert.equal(b.regionId, a.regionId, `cell ${a.id} regionId`);
      }
    }
    assert.equal(starbattle.encodeDesc(rebuilt), desc, `seed ${seed}: encode is stable`);
    // and the rebuilt regions remain solvable to the same unique solution
    const regionOf = regionOfFromGrid(rebuilt.grid);
    assert.equal(countSolutions(rebuilt.grid.rows, rebuilt.grid.cols, regionOf, 1, 2), 1,
      `seed ${seed}: rebuilt regions still uniquely solvable`);
  }
});

test('encodeParams full vs not-full; decodeParams round-trip', () => {
  const p = { seed: 1, size: 7, difficulty: 'hard' };
  assert.equal(starbattle.encodeParams(p, false), '7');
  assert.match(starbattle.encodeParams(p, true), /^7dhard$/);
  const d = starbattle.decodeParams(starbattle.encodeParams(p, true));
  assert.equal(d.size, 7);
  assert.equal(d.difficulty, 'hard');
  assert.equal(d.stars, 1);
});

test('all presets (easy/medium/hard) generate unique, valid, connected puzzles', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (const seed of [1, 7, 42]) {
      const { playState, solution } = starbattle.newPuzzle({ seed, difficulty });
      const regionOf = regionOfFromGrid(playState.grid);
      const n = countSolutions(playState.grid.rows, playState.grid.cols, regionOf, 1, 2);
      assert.equal(n, 1, `${difficulty}/${seed}: expected unique, got ${n}`);
      assert.equal(independentSolved(playState.grid, solution.stars, 1), true, `${difficulty}/${seed}: bundled solution valid`);
      assert.equal(regionsConnected(playState.grid), true, `${difficulty}/${seed}: regions connected`);
    }
  }
});
