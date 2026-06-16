// tests/shikaku.test.mjs — headless verification of the Shikaku back-end (§5, §12.2).
// Run: node --test tests/shikaku.test.mjs
//
// Asserts, across several seeds and difficulties:
//   • newPuzzle() builds a valid blank playState with clue anchors.
//   • solve() returns a fully-assigned solution and isSolved(solution) is true.
//   • the clue layout has EXACTLY ONE solution — verified by an INDEPENDENT brute-force counter
//     written here (not the game's own solver), capped at 2.
//   • encodeDesc → decodeDesc round-trips the clue layout exactly.
//   • applyMove is pure (prior snapshot untouched) and a no-op returns the same reference.
//   • validateMove / findConflicts behave on a hand-built case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import shikaku from '../src/games/shikaku/index.js';
import { ROLES, getCellAt } from '../src/core/grid.js';

// --- INDEPENDENT solution counter ----------------------------------------------------------
// Deliberately a separate, simple backtracker (no shared code with src/games/shikaku/solver.js)
// so it is a genuine cross-check. It reads clues straight off a playState grid, enumerates every
// rectangle of the right area per clue, and counts complete non-overlapping full tilings, bailing
// at `cap`.
function independentCount(playState, cap = 2) {
  const grid = playState.grid;
  const rows = grid.rows, cols = grid.cols;
  const clues = [];
  const clueAt = new Array(rows * cols).fill(-1);
  for (const cell of grid.cells) {
    if (cell.role === ROLES.clue) {
      const idx = clues.length;
      clues.push({ r: cell.row, c: cell.col, area: parseInt(cell.value, 10) });
      clueAt[cell.row * cols + cell.col] = idx;
    }
  }
  // Enumerate candidate rectangles per clue.
  const cands = clues.map((cl, ci) => {
    const list = [];
    for (let w = 1; w <= cl.area; w++) {
      if (cl.area % w !== 0) continue;
      const h = cl.area / w;
      if (w > cols || h > rows) continue;
      for (let r0 = Math.max(0, cl.r - h + 1); r0 <= Math.min(cl.r, rows - h); r0++) {
        for (let c0 = Math.max(0, cl.c - w + 1); c0 <= Math.min(cl.c, cols - w); c0++) {
          const r1 = r0 + h - 1, c1 = c0 + w - 1;
          const cells = [];
          let ok = true;
          for (let r = r0; r <= r1 && ok; r++) {
            for (let c = c0; c <= c1; c++) {
              const idx = r * cols + c;
              if (clueAt[idx] !== -1 && clueAt[idx] !== ci) { ok = false; break; }
              cells.push(idx);
            }
          }
          if (ok) list.push(cells);
        }
      }
    }
    return list;
  });

  const N = rows * cols;
  const cover = new Int8Array(N); // 0/1
  let count = 0;

  // Simple clue-by-clue backtracking in fixed order (no heuristic — independence over speed).
  function rec(ci) {
    if (count >= cap) return;
    if (ci === clues.length) {
      // all clues placed; areas sum to N so coverage is implied, but verify full coverage.
      for (let i = 0; i < N; i++) if (!cover[i]) return;
      count++;
      return;
    }
    for (const cells of cands[ci]) {
      let ok = true;
      for (const idx of cells) if (cover[idx]) { ok = false; break; }
      if (!ok) continue;
      for (const idx of cells) cover[idx] = 1;
      rec(ci + 1);
      for (const idx of cells) cover[idx] = 0;
      if (count >= cap) return;
    }
  }
  rec(0);
  return count;
}

// --- helpers --------------------------------------------------------------------------------
function clueCount(playState) {
  return playState.grid.cells.filter((c) => c.role === ROLES.clue).length;
}
function totalClueArea(playState) {
  return playState.grid.cells
    .filter((c) => c.role === ROLES.clue)
    .reduce((s, c) => s + parseInt(c.value, 10), 0);
}

// --- tests ----------------------------------------------------------------------------------

test('newPuzzle builds a blank playState whose clue areas tile the board', () => {
  for (const seed of [1, 2, 3, 7, 42, 99, 1000]) {
    const { playState } = shikaku.newPuzzle({ seed, size: 7, difficulty: 'easy' });
    assert.equal(playState.grid.rows, 7);
    assert.equal(playState.grid.cols, 7);
    assert.ok(clueCount(playState) >= 1, 'has at least one clue');
    assert.equal(totalClueArea(playState), 49, 'clue areas sum to board area (full tiling)');
    // Every clue anchor is given + a numeric string value.
    for (const cell of playState.grid.cells) {
      if (cell.role === ROLES.clue) {
        assert.equal(cell.given, true);
        assert.match(cell.value, /^\d+$/);
      } else {
        assert.equal(cell.value, null);
        assert.equal(cell.regionId, null);
      }
    }
  }
});

test('solve() returns a fully-assigned solution and isSolved(solution) is true', () => {
  for (const seed of [1, 2, 3, 7, 42, 99, 123, 1000, 5555]) {
    const { playState, solution } = shikaku.newPuzzle({ seed, size: 7, difficulty: 'easy' });
    const solved = shikaku.solve(playState);
    assert.ok(solved, `seed ${seed}: solve() returned a solution`);
    // every cell assigned to a region
    for (const cell of solved.grid.cells) {
      assert.notEqual(cell.regionId, null, `seed ${seed}: cell ${cell.id} unassigned`);
    }
    assert.equal(shikaku.isSolved(solved), true, `seed ${seed}: solve() output is solved`);
    assert.equal(shikaku.findConflicts(solved).length, 0, `seed ${seed}: no conflicts`);
    // The puzzle-bundled solution is also solved.
    assert.equal(shikaku.isSolved(solution), true, `seed ${seed}: bundled solution is solved`);
  }
});

test('clue layout has EXACTLY ONE solution (independent counter, capped at 2)', () => {
  for (const seed of [1, 2, 3, 7, 42, 99, 123, 1000, 5555, 31337]) {
    const { playState } = shikaku.newPuzzle({ seed, size: 7, difficulty: 'easy' });
    const n = independentCount(playState, 2);
    assert.equal(n, 1, `seed ${seed}: expected exactly 1 solution, independent counter found ${n}`);
  }
});

test('medium and hard presets also generate unique puzzles', () => {
  for (const difficulty of ['medium', 'hard']) {
    for (const seed of [1, 7, 42]) {
      const { playState, params } = shikaku.newPuzzle({ seed, difficulty });
      assert.equal(totalClueArea(playState), params.size * params.size, `${difficulty}/${seed}: tiles board`);
      const n = independentCount(playState, 2);
      assert.equal(n, 1, `${difficulty}/${seed}: expected unique, got ${n}`);
      assert.ok(shikaku.solve(playState), `${difficulty}/${seed}: solvable`);
    }
  }
});

test('encodeDesc → decodeDesc round-trips the clue layout', () => {
  for (const seed of [1, 2, 3, 7, 42, 99, 1000]) {
    const { playState, params } = shikaku.newPuzzle({ seed, size: 7, difficulty: 'easy' });
    const desc = shikaku.encodeDesc(playState);
    const rebuilt = shikaku.decodeDesc(params, desc);
    // Same dimensions
    assert.equal(rebuilt.grid.rows, playState.grid.rows);
    assert.equal(rebuilt.grid.cols, playState.grid.cols);
    // Same clue anchors (role + value) cell-for-cell.
    for (let r = 0; r < playState.grid.rows; r++) {
      for (let c = 0; c < playState.grid.cols; c++) {
        const a = getCellAt(playState.grid, r, c);
        const b = getCellAt(rebuilt.grid, r, c);
        assert.equal(b.role, a.role, `cell ${a.id} role`);
        assert.equal(b.value, a.value, `cell ${a.id} value`);
      }
    }
    // Re-encoding the rebuilt state yields the identical string.
    assert.equal(shikaku.encodeDesc(rebuilt), desc, `seed ${seed}: encode is stable`);
  }
});

test('encodeParams full vs not-full; decodeParams round-trip', () => {
  const p = { seed: 1, size: 9, difficulty: 'medium' };
  assert.equal(shikaku.encodeParams(p, false), '9');           // gen-only difficulty omitted
  assert.match(shikaku.encodeParams(p, true), /^9dmedium$/);    // full keeps difficulty
  const d = shikaku.decodeParams(shikaku.encodeParams(p, true));
  assert.equal(d.size, 9);
  assert.equal(d.difficulty, 'medium');
});

test('applyMove is pure (prior snapshot untouched) and no-op returns same reference', () => {
  const { playState, solution } = shikaku.newPuzzle({ seed: 7, size: 7, difficulty: 'easy' });
  // Take a correct region from the solution to commit.
  const hint = shikaku.hint(playState, solution);
  assert.ok(hint, 'a hint region exists on a fresh puzzle');
  assert.equal(hint.type, 'region-commit');
  assert.equal(shikaku.validateMove(playState, hint), true, 'hint is a valid move');

  const before = playState;
  const next = shikaku.applyMove(playState, hint);
  assert.notEqual(next, before, 'commit produced a new state');
  // prior snapshot untouched
  for (const id of hint.cells) {
    const wasMember = before.grid.cells.find((c) => c.id === id);
    if (wasMember.role !== ROLES.clue) {
      assert.equal(wasMember.regionId, null, 'prior snapshot region unchanged');
    }
  }
  // Re-applying the same commit is a no-op → SAME reference (§5).
  const again = shikaku.applyMove(next, hint);
  assert.equal(again, next, 'idempotent commit returns the same state object');

  // Clearing the region restores blanks.
  const cleared = shikaku.applyMove(next, { type: 'region-clear', clueId: hint.clueId });
  for (const id of hint.cells) {
    const cell = cleared.grid.cells.find((c) => c.id === id);
    if (cell.role !== ROLES.clue) assert.equal(cell.regionId, null);
  }
});

test('findConflicts flags a wrong-area committed region', () => {
  // Build a tiny known layout via decodeDesc: a 2×2 board with one clue of area 4 (whole board).
  const grid = shikaku.decodeDesc({ size: 2 }, '4./..');
  // Commit only 2 of the 4 cells to the clue → area 2 ≠ clue 4 → conflict.
  const clueId = 'r0c0';
  const bad = shikaku.applyMove(grid, { type: 'region-commit', clueId, cells: ['r0c0', 'r0c1'] });
  // validateMove should REJECT this (area mismatch) — applyMove is permissive, conflicts catch it.
  assert.equal(shikaku.validateMove(grid, { type: 'region-commit', clueId, cells: ['r0c0', 'r0c1'] }), false);
  const conflicts = shikaku.findConflicts(bad);
  assert.ok(conflicts.includes('r0c0'), 'wrong-area region is flagged');
});

test('full solve path: committing every hint reaches isSolved', () => {
  const { playState, solution } = shikaku.newPuzzle({ seed: 3, size: 7, difficulty: 'easy' });
  let state = playState;
  let guard = 0;
  while (!shikaku.isSolved(state) && guard++ < 200) {
    const h = shikaku.hint(state, solution);
    if (!h) break;
    assert.equal(shikaku.validateMove(state, h), true, 'each hint is valid');
    state = shikaku.applyMove(state, h);
  }
  assert.equal(shikaku.isSolved(state), true, 'committing hints solves the puzzle');
});

test('meta.stages exposes per-stage countdown budgets', () => {
  assert.equal(shikaku.meta.stages.time.easy, 15);
  assert.equal(shikaku.meta.stages.time.medium, 20);
  assert.equal(shikaku.meta.stages.time.hard, 25);
});

test('meta.stages.curveForGame ramps easy(1-3) → medium(4-7) → hard(8-10)', () => {
  const curve = shikaku.meta.stages.curveForGame;
  assert.deepEqual([1, 2, 3].map(curve), ['easy', 'easy', 'easy']);
  assert.deepEqual([4, 5, 6, 7].map(curve), ['medium', 'medium', 'medium', 'medium']);
  assert.deepEqual([8, 9, 10].map(curve), ['hard', 'hard', 'hard']);
  assert.equal(curve(11), 'hard');
  assert.equal(curve(0), 'easy');
});

test('defaultParams no longer pins size (preset size wins)', () => {
  assert.equal(shikaku.defaultParams().size, undefined);
});

function maxClueArea(playState) {
  return Math.max(...playState.grid.cells
    .filter((c) => c.role === ROLES.clue)
    .map((c) => parseInt(c.value, 10)));
}

test('preset board sizes: easy 6×6, medium 8×8, hard 9×9', () => {
  const sizeOf = (difficulty) => shikaku.newPuzzle({ seed: 1, difficulty }).params.size;
  assert.equal(sizeOf('easy'), 6);
  assert.equal(sizeOf('medium'), 8);
  assert.equal(sizeOf('hard'), 9);
});

test('hard puzzles are many small rectangles (every area ≤ 4, many regions)', () => {
  for (const seed of [1, 2, 7, 42, 99]) {
    const { playState } = shikaku.newPuzzle({ seed, difficulty: 'hard' });
    assert.ok(maxClueArea(playState) <= 4, `hard/${seed}: max area ${maxClueArea(playState)} should be ≤ 4`);
    assert.ok(clueCount(playState) >= 15, `hard/${seed}: expected many regions, got ${clueCount(playState)}`);
  }
});

test('easy puzzles cap area at 12 and can reach large (≥10) rectangles', () => {
  let maxSeen = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { playState } = shikaku.newPuzzle({ seed, difficulty: 'easy' });
    assert.ok(maxClueArea(playState) <= 12, `easy/${seed}: max area ${maxClueArea(playState)} should be ≤ 12`);
    maxSeen = Math.max(maxSeen, maxClueArea(playState));
  }
  assert.ok(maxSeen >= 10, `expected some easy board with a ≥10 rectangle across seeds 1..30, max seen ${maxSeen}`);
});

test('easy has fewer regions than hard on the same seed', () => {
  for (const seed of [1, 7, 42]) {
    const easy = clueCount(shikaku.newPuzzle({ seed, difficulty: 'easy' }).playState);
    const hard = clueCount(shikaku.newPuzzle({ seed, difficulty: 'hard' }).playState);
    assert.ok(easy < hard, `seed ${seed}: easy ${easy} should be < hard ${hard}`);
  }
});
