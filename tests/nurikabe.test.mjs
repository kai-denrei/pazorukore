// tests/nurikabe.test.mjs — headless verification of the Nurikabe back-end.
// Run: node --test tests/nurikabe.test.mjs
//
// Asserts, across several seeds and difficulties:
//   • generate() bundles a valid solution satisfying ALL THREE WIN rules — verified by an
//     INDEPENDENT in-test validator (islands one-clue-each + sized, sea connected, no 2×2);
//   • the solver finds the puzzle UNIQUE (countSolutions === 1) for several seeds;
//   • reproducibility: same seed → identical clues + shaded;
//   • applyMove purity (no mutation of prior shaded) + no-op returns same reference; toggle twice
//     returns to empty;
//   • validateMove rejects shading a clue cell + bad types;
//   • isSolved false on empty/partial/2×2-violating/wrong-island-size;
//   • encodeDesc → decodeDesc round-trips the clue layout;
//   • presets generate unique puzzles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nurikabe from '../src/games/nurikabe/index.js';
import { countSolutions } from '../src/games/nurikabe/solver.js';
import { ROLES, getCellAt } from '../src/core/grid.js';

// --- INDEPENDENT validator ------------------------------------------------------------------
// Deliberately separate from src/games/nurikabe (no shared code) so it's a genuine cross-check.
// Given a playState grid and a shaded object, it verifies the three WIN rules from scratch.
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function independentSolved(grid, shaded) {
  const rows = grid.rows, cols = grid.cols, N = rows * cols;
  const sh = (r, c) => !!shaded[`r${r}c${c}`];

  // clues from the grid
  const clueVal = new Map(); // "r,c" -> n
  for (const cell of grid.cells) {
    if (cell.role === ROLES.clue) clueVal.set(`${cell.row},${cell.col}`, parseInt(cell.value, 10));
  }
  if (clueVal.size === 0) return false;

  // no clue may be shaded
  for (const cell of grid.cells) {
    if (cell.role === ROLES.clue && sh(cell.row, cell.col)) return false;
  }

  // rule 3: no fully-shaded 2×2
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (sh(r, c) && sh(r + 1, c) && sh(r, c + 1) && sh(r + 1, c + 1)) return false;
    }
  }

  // gather shaded / unshaded
  const shadedCells = [], unshadedCells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    (sh(r, c) ? shadedCells : unshadedCells).push([r, c]);
  }
  if (shadedCells.length === 0) return false;

  // total shaded == N - sum(clues)
  let clueTotal = 0;
  for (const v of clueVal.values()) clueTotal += v;
  if (shadedCells.length !== N - clueTotal) return false;

  const key = (r, c) => r * cols + c;

  // rule 2: shaded sea is ONE 4-connected region
  {
    const set = new Set(shadedCells.map(([r, c]) => key(r, c)));
    const seen = new Set([key(shadedCells[0][0], shadedCells[0][1])]);
    const stack = [shadedCells[0]];
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const k = key(nr, nc);
        if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push([nr, nc]); }
      }
    }
    if (seen.size !== shadedCells.length) return false;
  }

  // rule 1: each island = one 4-connected unshaded group with exactly one clue, size === clue
  {
    const visited = new Set();
    for (const [r0, c0] of unshadedCells) {
      if (visited.has(key(r0, c0))) continue;
      const island = [];
      const stack = [[r0, c0]];
      visited.add(key(r0, c0));
      while (stack.length) {
        const [r, c] = stack.pop();
        island.push([r, c]);
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          if (sh(nr, nc)) continue;
          const k = key(nr, nc);
          if (!visited.has(k)) { visited.add(k); stack.push([nr, nc]); }
        }
      }
      let count = 0, val = -1;
      for (const [r, c] of island) {
        const v = clueVal.get(`${r},${c}`);
        if (v != null) { count++; val = v; }
      }
      if (count !== 1) return false;
      if (val !== island.length) return false;
    }
  }
  return true;
}

// --- helpers --------------------------------------------------------------------------------
function clueCount(playState) {
  return playState.grid.cells.filter((c) => c.role === ROLES.clue).length;
}
function cluesFromGrid(grid) {
  const out = [];
  for (const cell of grid.cells) {
    if (cell.role === ROLES.clue) out.push({ r: cell.row, c: cell.col, n: parseInt(cell.value, 10) });
  }
  return out;
}

const SEEDS = [1, 2, 3, 7, 42, 99, 123, 1000];

// --- tests ----------------------------------------------------------------------------------

test('newPuzzle builds a blank playState with clue anchors and empty shaded', () => {
  for (const seed of SEEDS) {
    const { playState } = nurikabe.newPuzzle({ seed, size: 5, difficulty: 'easy' });
    assert.equal(playState.grid.rows, 5);
    assert.equal(playState.grid.cols, 5);
    assert.deepEqual(playState.shaded, {}, 'fresh puzzle has no shaded cells');
    assert.ok(clueCount(playState) >= 1, 'has at least one clue');
    for (const cell of playState.grid.cells) {
      if (cell.role === ROLES.clue) {
        assert.equal(cell.given, true);
        assert.match(cell.value, /^\d+$/, 'clue value is a positive integer string');
        assert.ok(parseInt(cell.value, 10) >= 1, 'clue value >= 1');
      } else {
        assert.equal(cell.role, ROLES.blank);
        assert.equal(cell.value, null);
      }
    }
  }
});

test('bundled solution satisfies all three rules (independent validator + engine agree)', () => {
  for (const seed of SEEDS) {
    const { playState, solution } = nurikabe.newPuzzle({ seed, size: 5, difficulty: 'easy' });
    const solvedState = { grid: playState.grid, shaded: solution.shaded };
    assert.equal(nurikabe.isSolved(solvedState), true, `seed ${seed}: engine isSolved on bundled solution`);
    assert.equal(independentSolved(playState.grid, solution.shaded), true,
      `seed ${seed}: independent validator confirms the bundled solution`);
    assert.equal(nurikabe.findConflicts(solvedState).length, 0, `seed ${seed}: no conflicts in solution`);
  }
});

test('solve() reproduces a valid solution', () => {
  for (const seed of SEEDS) {
    const { playState } = nurikabe.newPuzzle({ seed, size: 5, difficulty: 'easy' });
    const solved = nurikabe.solve(playState);
    assert.ok(solved, `seed ${seed}: solve() returned a solution`);
    assert.equal(nurikabe.isSolved(solved), true, `seed ${seed}: solve() output is solved`);
    assert.equal(independentSolved(solved.grid, solved.shaded), true, `seed ${seed}: independent confirms solve()`);
  }
});

test('puzzle is UNIQUELY solvable (countSolutions === 1)', () => {
  for (const seed of SEEDS) {
    const { playState } = nurikabe.newPuzzle({ seed, size: 5, difficulty: 'easy' });
    const clues = cluesFromGrid(playState.grid);
    const n = countSolutions(playState.grid.rows, playState.grid.cols, clues, 2);
    assert.equal(n, 1, `seed ${seed}: expected exactly 1 solution, got ${n}`);
  }
});

test('reproducibility: same seed → identical clues + shaded', () => {
  for (const seed of [1, 7, 42, 1000]) {
    const a = nurikabe.newPuzzle({ seed, size: 6, difficulty: 'medium' });
    const b = nurikabe.newPuzzle({ seed, size: 6, difficulty: 'medium' });
    assert.equal(nurikabe.encodeDesc(a.playState), nurikabe.encodeDesc(b.playState),
      `seed ${seed}: identical clue layout`);
    assert.deepEqual(a.solution.shaded, b.solution.shaded, `seed ${seed}: identical shaded`);
  }
});

test('applyMove is pure: prior shaded untouched; toggling a cell twice returns to empty', () => {
  const { playState, solution } = nurikabe.newPuzzle({ seed: 7, size: 5, difficulty: 'easy' });
  const hint = nurikabe.hint(playState, solution);
  assert.ok(hint, 'a hint exists on a fresh puzzle');
  assert.equal(hint.type, 'shade');
  assert.equal(nurikabe.validateMove(playState, hint), true, 'hint is a valid move');

  const before = playState;
  const beforeSnapshot = JSON.stringify(before.shaded);

  const s1 = nurikabe.applyMove(before, hint);
  assert.notEqual(s1, before, 'toggle produced a new state');
  assert.notEqual(s1.shaded, before.shaded, 'new shaded object (not the same reference)');
  assert.equal(JSON.stringify(before.shaded), beforeSnapshot, 'prior shaded object untouched');
  assert.equal(s1.shaded[hint.id], 1, 'cell present after first toggle');

  const s2 = nurikabe.applyMove(s1, hint);
  assert.equal(s2.shaded[hint.id], undefined, 'cell removed after second toggle');
  assert.deepEqual(s2.shaded, before.shaded, 'toggling twice returns to the starting (empty) shaded');
  assert.equal(s1.shaded[hint.id], 1, 's1 untouched by s2');

  // No-ops return the SAME reference.
  const cluedId = playState.grid.cells.find((c) => c.role === ROLES.clue).id;
  const noopClue = nurikabe.applyMove(before, { type: 'shade', id: cluedId });
  assert.equal(noopClue, before, 'shading a clue cell is a no-op (same reference)');
  const noopType = nurikabe.applyMove(before, { type: 'nonsense', id: 'r0c0' });
  assert.equal(noopType, before, 'unknown move type returns same reference');
  const noopMissing = nurikabe.applyMove(before, { type: 'shade', id: 'r99c99' });
  assert.equal(noopMissing, before, 'off-grid cell returns same reference');
});

test('validateMove rejects shading a clue cell and bad move types', () => {
  const { playState } = nurikabe.newPuzzle({ seed: 1, size: 5, difficulty: 'easy' });
  const clueId = playState.grid.cells.find((c) => c.role === ROLES.clue).id;
  const blankId = playState.grid.cells.find((c) => c.role === ROLES.blank).id;
  assert.equal(nurikabe.validateMove(playState, { type: 'shade', id: blankId }), true, 'shading a blank cell is legal');
  assert.equal(nurikabe.validateMove(playState, { type: 'shade', id: clueId }), false, 'shading a clue cell is rejected');
  assert.equal(nurikabe.validateMove(playState, { type: 'shade', id: 'r99c99' }), false, 'off-grid rejected');
  assert.equal(nurikabe.validateMove(playState, { type: 'loop', id: blankId }), false, 'wrong move type rejected');
  assert.equal(nurikabe.validateMove(playState, { type: 'shade' }), false, 'missing id rejected');
  assert.equal(nurikabe.validateMove(playState, null), false, 'null move rejected');
});

test('isSolved false on empty, partial, 2×2-violating, and wrong-island-size states', () => {
  const { playState, solution } = nurikabe.newPuzzle({ seed: 3, size: 5, difficulty: 'easy' });
  const grid = playState.grid;

  // empty
  assert.equal(nurikabe.isSolved(playState), false, 'empty is not solved');

  // partial: solution minus one shaded cell
  const solIds = Object.keys(solution.shaded);
  const partial = { ...solution.shaded };
  delete partial[solIds[0]];
  assert.equal(nurikabe.isSolved({ grid, shaded: partial }), false, 'partial sea not solved');

  // 2×2-violating: shade an entire 2×2 block of blank cells (and nothing else) — fails rule 3 and
  // also island sizes, so definitely not solved.
  let blockShaded = null;
  for (let r = 0; r < grid.rows - 1 && !blockShaded; r++) {
    for (let c = 0; c < grid.cols - 1; c++) {
      const ids = [`r${r}c${c}`, `r${r + 1}c${c}`, `r${r}c${c + 1}`, `r${r + 1}c${c + 1}`];
      const allBlank = ids.every((id) => grid.cells.find((x) => x.id === id).role === ROLES.blank);
      if (allBlank) { blockShaded = {}; for (const id of ids) blockShaded[id] = 1; break; }
    }
  }
  assert.ok(blockShaded, 'found a 2×2 of blank cells to over-shade');
  assert.equal(nurikabe.isSolved({ grid, shaded: blockShaded }), false, 'a fully-shaded 2×2 is not solved');

  // wrong-island-size: take the solution but UNSHADE one sea cell that is adjacent to a clue's
  // island, growing that island past its clue value (island now too big). This breaks rule 1.
  const wrong = { ...solution.shaded };
  // find a shaded cell orthogonally adjacent to an unshaded cell — unshading it merges/oversizes.
  const sh = (r, c) => !!wrong[`r${r}c${c}`];
  let flipped = false;
  for (let r = 0; r < grid.rows && !flipped; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (!sh(r, c)) continue;
      // adjacent to an unshaded non-shaded cell?
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= grid.rows || nc >= grid.cols) continue;
        if (!sh(nr, nc)) { delete wrong[`r${r}c${c}`]; flipped = true; break; }
      }
      if (flipped) break;
    }
  }
  assert.ok(flipped, 'found a sea cell to unshade adjacent to an island');
  assert.equal(nurikabe.isSolved({ grid, shaded: wrong }), false, 'an oversized island is not solved');
});

test('encodeDesc → decodeDesc round-trips the clue layout', () => {
  for (const seed of SEEDS) {
    const { playState, params } = nurikabe.newPuzzle({ seed, size: 5, difficulty: 'easy' });
    const desc = nurikabe.encodeDesc(playState);
    const rebuilt = nurikabe.decodeDesc(params, desc);
    assert.equal(rebuilt.grid.rows, playState.grid.rows);
    assert.equal(rebuilt.grid.cols, playState.grid.cols);
    assert.deepEqual(rebuilt.shaded, {}, 'rebuilt has empty shaded');
    for (let r = 0; r < playState.grid.rows; r++) {
      for (let c = 0; c < playState.grid.cols; c++) {
        const a = getCellAt(playState.grid, r, c);
        const b = getCellAt(rebuilt.grid, r, c);
        assert.equal(b.role, a.role, `cell ${a.id} role`);
        assert.equal(b.value, a.value, `cell ${a.id} value`);
      }
    }
    assert.equal(nurikabe.encodeDesc(rebuilt), desc, `seed ${seed}: encode is stable`);
  }
});

test('encodeParams full vs not-full; decodeParams round-trip', () => {
  const p = { seed: 1, size: 7, difficulty: 'hard' };
  assert.equal(nurikabe.encodeParams(p, false), '7');
  assert.match(nurikabe.encodeParams(p, true), /^7dhard$/);
  const d = nurikabe.decodeParams(nurikabe.encodeParams(p, true));
  assert.equal(d.size, 7);
  assert.equal(d.difficulty, 'hard');
});

test('full solve path: applying hints reaches isSolved', () => {
  const { playState, solution } = nurikabe.newPuzzle({ seed: 42, size: 5, difficulty: 'easy' });
  let state = playState;
  let guard = 0;
  while (!nurikabe.isSolved(state) && guard++ < 500) {
    const h = nurikabe.hint(state, solution);
    if (!h) break;
    assert.equal(nurikabe.validateMove(state, h), true, 'each hint is valid');
    state = nurikabe.applyMove(state, h);
  }
  assert.equal(nurikabe.isSolved(state), true, 'applying hints solves the puzzle');
});

test('eventsFor maps a shade move to cellPlaced / cellCleared with the cell id', () => {
  const { playState } = nurikabe.newPuzzle({ seed: 1, size: 5, difficulty: 'easy' });
  const blankId = playState.grid.cells.find((c) => c.role === ROLES.blank).id;
  const move = { type: 'shade', id: blankId };
  const s1 = nurikabe.applyMove(playState, move);
  const ev1 = nurikabe.eventsFor(playState, move, s1);
  assert.equal(ev1.length, 1);
  assert.equal(ev1[0].name, 'cellPlaced');
  assert.deepEqual(ev1[0].payload.cells, [blankId]);
  const s2 = nurikabe.applyMove(s1, move);
  const ev2 = nurikabe.eventsFor(s1, move, s2);
  assert.equal(ev2[0].name, 'cellCleared');
  assert.deepEqual(ev2[0].payload.cells, [blankId]);
  // no-op yields no events
  assert.deepEqual(nurikabe.eventsFor(playState, move, playState), []);
});

test('findConflicts flags cells in a fully-shaded 2×2 block', () => {
  const { playState } = nurikabe.newPuzzle({ seed: 1, size: 5, difficulty: 'easy' });
  const grid = playState.grid;
  // find a 2×2 of blank cells, shade all four, expect those four flagged
  let ids = null;
  for (let r = 0; r < grid.rows - 1 && !ids; r++) {
    for (let c = 0; c < grid.cols - 1; c++) {
      const four = [`r${r}c${c}`, `r${r + 1}c${c}`, `r${r}c${c + 1}`, `r${r + 1}c${c + 1}`];
      if (four.every((id) => grid.cells.find((x) => x.id === id).role === ROLES.blank)) { ids = four; break; }
    }
  }
  assert.ok(ids, 'found a blank 2×2');
  const shaded = {};
  for (const id of ids) shaded[id] = 1;
  const conflicts = nurikabe.findConflicts({ grid, shaded });
  for (const id of ids) assert.ok(conflicts.includes(id), `${id} flagged as a 2×2 conflict`);
});

test('medium and hard presets also generate unique, valid puzzles', () => {
  for (const difficulty of ['medium', 'hard']) {
    for (const seed of [1, 7, 42]) {
      const { playState, solution } = nurikabe.newPuzzle({ seed, difficulty });
      const clues = cluesFromGrid(playState.grid);
      const n = countSolutions(playState.grid.rows, playState.grid.cols, clues, 2);
      assert.equal(n, 1, `${difficulty}/${seed}: expected unique, got ${n}`);
      assert.equal(independentSolved(playState.grid, solution.shaded), true, `${difficulty}/${seed}: bundled solution valid`);
    }
  }
});
