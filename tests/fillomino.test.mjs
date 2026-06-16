// tests/fillomino.test.mjs — headless verification of the Fillomino back end (§5).
// Run: node --test tests/fillomino.test.mjs
//
// Asserts, across several seeds:
//   • generate()'s solution is a VALID Fillomino fill — verified with an INDEPENDENT in-test
//     region-flood validator (no shared code with the production solver).
//   • the production solver confirms UNIQUE (countSolutions === 1) for several seeds.
//   • reproducibility (same seed → identical givens + solution).
//   • applyMove purity + no-op same-reference; pencil toggling; placing clears pencil.
//   • isSolved true on the solution, FALSE on empty/partial/a wrong fill.
//   • findConflicts flags an over-grown region.
//   • validateMove caps the digit range and rejects given-cell edits.
//   • encodeDesc → decodeDesc round-trips the givens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fillomino from '../src/games/fillomino/index.js';
import { generate } from '../src/games/fillomino/generator.js';
import { countSolutions } from '../src/games/fillomino/solver.js';
import { makeGenRng } from '../src/core/rng.js';
import { getCell } from '../src/core/grid.js';

const SEEDS = [1, 2, 3, 7, 42, 99, 1000, 1337, 31337];

// --- INDEPENDENT region-flood Fillomino validator -------------------------------------------
// Deliberately separate from src/games/fillomino/solver.js so it is a genuine cross-check.
// Given a flat value grid, returns { valid, regions } where valid is true iff every maximal
// orthogonally-connected equal-value region has size === value (equivalently: no two distinct
// same-size regions touch). Empty cells (0/null) make it invalid.
function independentValidate(rows, cols, vals) {
  const N = rows * cols;
  const seen = new Array(N).fill(false);
  const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const regions = [];
  for (let start = 0; start < N; start++) {
    if (seen[start]) continue;
    const v = vals[start];
    if (!v || v <= 0) return { valid: false, regions };
    // BFS flood the equal-value region.
    const queue = [start];
    seen[start] = true;
    const members = [];
    while (queue.length) {
      const idx = queue.shift();
      members.push(idx);
      const r = Math.floor(idx / cols), c = idx % cols;
      for (const [dr, dc] of NB) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const nidx = nr * cols + nc;
        if (!seen[nidx] && vals[nidx] === v) { seen[nidx] = true; queue.push(nidx); }
      }
    }
    regions.push({ value: v, size: members.length, members });
    if (members.length !== v) return { valid: false, regions };
  }
  return { valid: true, regions };
}

// playState grid → flat value array (0 = empty).
function stateVals(playState) {
  const grid = playState.grid;
  const out = new Array(grid.rows * grid.cols).fill(0);
  for (let i = 0; i < grid.cells.length; i++) {
    const v = grid.cells[i].value;
    out[i] = v == null ? 0 : parseInt(v, 10);
  }
  return out;
}

// --- tests ----------------------------------------------------------------------------------

test('meta matches the contract', () => {
  assert.equal(fillomino.meta.id, 'fillomino');
  assert.equal(fillomino.meta.name, 'Fillomino');
  assert.equal(fillomino.meta.interaction, 'digit-entry');
  assert.deepEqual(fillomino.meta.requirements, { glyphSet: 'digits', needsOffState: true, needsRegionFill: false });
});

test('defaultParams', () => {
  const d = fillomino.defaultParams();
  assert.equal(d.seed, 1);
  assert.equal(d.size, 7);
  assert.equal(d.difficulty, 'easy');
});

for (const seed of SEEDS) {
  test(`seed ${seed}: generated solution is a VALID Fillomino fill (independent validator)`, () => {
    const out = generate({ seed, difficulty: 'easy' });
    const { valid, regions } = independentValidate(out.rows, out.cols, out.solution);
    assert.equal(valid, true, `seed ${seed}: solution must be a valid Fillomino fill`);
    // Spot-check: every region size === its value, and the regions tile the board.
    let covered = 0;
    for (const reg of regions) {
      assert.equal(reg.size, reg.value, `region of value ${reg.value} has size ${reg.size}`);
      covered += reg.size;
    }
    assert.equal(covered, out.rows * out.cols, 'regions tile the whole board');
    // No region exceeds the board side cap.
    const cap = Math.max(out.rows, out.cols);
    for (const reg of regions) assert.ok(reg.value <= cap, `value ${reg.value} within side cap ${cap}`);
  });
}

for (const seed of SEEDS) {
  test(`seed ${seed}: production solver confirms UNIQUE (countSolutions === 1)`, () => {
    const out = generate({ seed, difficulty: 'easy' });
    const n = countSolutions(out.rows, out.cols, out.givens, 2);
    assert.equal(n, 1, `seed ${seed}: expected exactly 1 solution, got ${n}`);
  });
}

test('newPuzzle builds the contract playState (given/fillable, string|null values)', () => {
  for (const seed of [1, 7, 42]) {
    const { playState, solution, params } = fillomino.newPuzzle({ seed, difficulty: 'easy' }, makeGenRng(seed));
    assert.ok(playState.grid && playState.pencil && typeof playState.pencil === 'object');
    assert.equal(playState.grid.cells.length, params.size * params.size);
    for (const c of playState.grid.cells) {
      assert.ok(c.value === null || typeof c.value === 'string', 'value is string|null');
      if (c.given) {
        assert.equal(c.role, 'given');
        assert.match(c.value, /^\d+$/);
      } else {
        assert.equal(c.role, 'fillable');
        assert.equal(c.value, null);
      }
    }
    // The bundled solution is a fully-filled valid Fillomino board.
    assert.equal(fillomino.isSolved(solution), true, 'bundled solution isSolved');
  }
});

test('reproducibility: same seed → identical givens + solution', () => {
  for (const seed of [5, 12345, 777]) {
    const a = generate({ seed, difficulty: 'easy' });
    const b = generate({ seed, difficulty: 'easy' });
    assert.deepEqual(a.givens, b.givens, 'givens reproduce');
    assert.deepEqual(a.solution, b.solution, 'solution reproduces');
    // Through the module too (encodeDesc must match).
    const pa = fillomino.newPuzzle({ seed, difficulty: 'easy' }, makeGenRng(seed));
    const pb = fillomino.newPuzzle({ seed, difficulty: 'easy' }, makeGenRng(seed));
    assert.equal(fillomino.encodeDesc(pa.playState), fillomino.encodeDesc(pb.playState));
  }
});

test('difficulty presets all generate unique, valid puzzles', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const seed = 314;
    const out = generate({ seed, difficulty });
    assert.equal(independentValidate(out.rows, out.cols, out.solution).valid, true, `${difficulty} solution valid`);
    assert.equal(countSolutions(out.rows, out.cols, out.givens, 2), 1, `${difficulty} unique`);
  }
});

test('solve() returns the unique filled solution (givens preserved)', () => {
  for (const seed of [1, 7, 42, 1000]) {
    const { playState, solution } = fillomino.newPuzzle({ seed, difficulty: 'easy' }, makeGenRng(seed));
    const solved = fillomino.solve(playState);
    assert.ok(solved, `seed ${seed}: solve() returned non-null`);
    assert.equal(fillomino.isSolved(solved), true, `seed ${seed}: solve() result isSolved`);
    // Agrees with the bundled solution everywhere.
    for (let i = 0; i < solved.grid.cells.length; i++) {
      assert.equal(solved.grid.cells[i].value, solution.grid.cells[i].value, `seed ${seed}: cell ${i} matches`);
    }
    // Givens preserved.
    for (let i = 0; i < playState.grid.cells.length; i++) {
      if (playState.grid.cells[i].given) {
        assert.equal(solved.grid.cells[i].given, true, 'given stays given');
        assert.equal(solved.grid.cells[i].value, playState.grid.cells[i].value, 'given value preserved');
      }
    }
  }
});

test('isSolved: true on solution, FALSE on empty/partial/wrong fill', () => {
  const seed = 7;
  const { playState, solution } = fillomino.newPuzzle({ seed, difficulty: 'easy' }, makeGenRng(seed));
  assert.equal(fillomino.isSolved(solution), true, 'solution isSolved');
  // Empty board (fresh puzzle has blank fillable cells) → not solved.
  assert.equal(fillomino.isSolved(playState), false, 'fresh puzzle not solved');
  // Partial: fill exactly one blank correctly → still not solved.
  const blank = playState.grid.cells.find((c) => !c.given);
  const idx = playState.grid.cells.indexOf(blank);
  const want = solution.grid.cells[idx].value;
  const partial = fillomino.applyMove(playState, { type: 'place', id: blank.id, value: want });
  assert.equal(fillomino.isSolved(partial), false, 'partial fill not solved');
  // Wrong full fill: take the solution and corrupt one non-given cell to a clearly wrong value.
  let wrong = solution;
  const target = solution.grid.cells.find((c) => !c.given);
  const cur = parseInt(target.value, 10);
  const bad = cur === 1 ? 2 : 1; // a different value, almost certainly breaks its region
  wrong = fillomino.applyMove(wrong, { type: 'place', id: target.id, value: bad });
  assert.equal(fillomino.isSolved(wrong), false, 'corrupted full fill not solved');
});

test('findConflicts flags an over-grown region', () => {
  // 3×3 board, all blank via decodeDesc, fill four cells with value 3 forming an L of size 4 > 3.
  const grid = fillomino.decodeDesc({ size: 3 }, '.'.repeat(9));
  let s = grid;
  // cells (0,0),(0,1),(0,2),(1,0) all value 3 → one connected region of size 4, value 3 → over-grown.
  for (const id of ['r0c0', 'r0c1', 'r0c2', 'r1c0']) {
    s = fillomino.applyMove(s, { type: 'place', id, value: 3 });
  }
  const conflicts = fillomino.findConflicts(s);
  for (const id of ['r0c0', 'r0c1', 'r0c2', 'r1c0']) {
    assert.ok(conflicts.includes(id), `over-grown cell ${id} flagged`);
  }
  // A correctly-sized region is NOT flagged: three cells of value 3.
  let ok = fillomino.decodeDesc({ size: 3 }, '.'.repeat(9));
  for (const id of ['r2c0', 'r2c1', 'r2c2']) ok = fillomino.applyMove(ok, { type: 'place', id, value: 3 });
  assert.deepEqual(fillomino.findConflicts(ok), [], 'correctly-sized region not flagged');
});

test('validateMove caps digit range and rejects given-cell edits', () => {
  const { playState } = fillomino.newPuzzle({ seed: 5, difficulty: 'easy' }, makeGenRng(5));
  const given = playState.grid.cells.find((c) => c.given);
  const blank = playState.grid.cells.find((c) => !c.given);
  const N = playState.grid.rows;
  assert.equal(fillomino.validateMove(playState, { type: 'place', id: given.id, value: 1 }), false, 'reject given edit');
  assert.equal(fillomino.validateMove(playState, { type: 'place', id: blank.id, value: 1 }), true, 'accept 1');
  assert.equal(fillomino.validateMove(playState, { type: 'place', id: blank.id, value: N }), true, `accept ${N}`);
  assert.equal(fillomino.validateMove(playState, { type: 'place', id: blank.id, value: N + 1 }), false, 'reject > rows');
  assert.equal(fillomino.validateMove(playState, { type: 'place', id: blank.id, value: 0 }), false, 'reject 0');
  assert.equal(fillomino.validateMove(playState, { type: 'clear', id: blank.id }), true, 'accept clear');
  assert.equal(fillomino.validateMove(playState, { type: 'pencil', id: blank.id, value: 2 }), true, 'accept pencil');
  assert.equal(fillomino.validateMove(playState, { type: 'clear', id: given.id }), false, 'reject clear on given');
});

test('applyMove is pure (prior snapshot untouched) and no-ops return the same object', () => {
  const { playState } = fillomino.newPuzzle({ seed: 8, difficulty: 'easy' }, makeGenRng(8));
  const blank = playState.grid.cells.find((c) => !c.given);
  const before = playState;
  const next = fillomino.applyMove(playState, { type: 'place', id: blank.id, value: 3 });
  assert.notEqual(next, before, 'returns a new state');
  assert.equal(getCell(before.grid, blank.id).value, null, 'prior snapshot untouched');
  assert.equal(getCell(next.grid, blank.id).value, '3');
  // re-placing the same value is a no-op → SAME object.
  assert.equal(fillomino.applyMove(next, { type: 'place', id: blank.id, value: 3 }), next);
  // editing a given is a no-op → SAME object.
  const given = playState.grid.cells.find((c) => c.given);
  assert.equal(fillomino.applyMove(playState, { type: 'place', id: given.id, value: 1 }), playState);
  // clearing an already-empty blank is a no-op.
  assert.equal(fillomino.applyMove(playState, { type: 'clear', id: blank.id }), playState);
});

test('pencil marks toggle, stay sorted, and placing a value clears them', () => {
  const { playState } = fillomino.newPuzzle({ seed: 9, difficulty: 'easy' }, makeGenRng(9));
  const blank = playState.grid.cells.find((c) => !c.given);
  let s = fillomino.applyMove(playState, { type: 'pencil', id: blank.id, value: 5 });
  s = fillomino.applyMove(s, { type: 'pencil', id: blank.id, value: 2 });
  assert.deepEqual(s.pencil[blank.id], ['2', '5'], 'sorted candidates');
  s = fillomino.applyMove(s, { type: 'pencil', id: blank.id, value: 5 });
  assert.deepEqual(s.pencil[blank.id], ['2'], 'toggle removes');
  s = fillomino.applyMove(s, { type: 'place', id: blank.id, value: 4 });
  assert.equal(s.pencil[blank.id], undefined, 'placing clears pencil');
});

test('hint returns a correct forced placement from the solution', () => {
  const seed = 21;
  const { playState, solution } = fillomino.newPuzzle({ seed, difficulty: 'easy' }, makeGenRng(seed));
  const h = fillomino.hint(playState, solution);
  assert.ok(h && h.type === 'place', 'hint is a place move');
  const cell = getCell(playState.grid, h.id);
  assert.equal(cell.given, false, 'hint targets a non-given cell');
  assert.equal(cell.value, null, 'hint targets an empty cell');
  const idx = playState.grid.cells.indexOf(cell);
  assert.equal(h.value, solution.grid.cells[idx].value, 'hint value is correct');
});

test('full solve path: committing every hint reaches isSolved', () => {
  const { playState, solution } = fillomino.newPuzzle({ seed: 3, difficulty: 'easy' }, makeGenRng(3));
  let state = playState;
  let guard = 0;
  while (!fillomino.isSolved(state) && guard++ < 200) {
    const h = fillomino.hint(state, solution);
    if (!h) break;
    assert.equal(fillomino.validateMove(state, h), true, 'each hint is valid');
    state = fillomino.applyMove(state, h);
  }
  assert.equal(fillomino.isSolved(state), true, 'committing hints solves the puzzle');
});

test('eventsFor maps move types to semantic events', () => {
  const { playState } = fillomino.newPuzzle({ seed: 2, difficulty: 'easy' }, makeGenRng(2));
  const blank = playState.grid.cells.find((c) => !c.given);
  const placed = fillomino.applyMove(playState, { type: 'place', id: blank.id, value: 2 });
  assert.deepEqual(
    fillomino.eventsFor(playState, { type: 'place', id: blank.id, value: 2 }, placed),
    [{ name: 'cellPlaced', payload: { id: blank.id, value: '2' } }],
  );
  const cleared = fillomino.applyMove(placed, { type: 'clear', id: blank.id });
  assert.deepEqual(
    fillomino.eventsFor(placed, { type: 'clear', id: blank.id }, cleared),
    [{ name: 'cellCleared', payload: { id: blank.id } }],
  );
  // no-op (same ref) → no events.
  assert.deepEqual(fillomino.eventsFor(playState, { type: 'place', id: blank.id, value: 2 }, playState), []);
});

test('encodeParams: full includes difficulty, non-full omits it; decodeParams round-trips', () => {
  const params = { seed: 1, size: 7, difficulty: 'hard' };
  const full = fillomino.encodeParams(params, true);
  const slim = fillomino.encodeParams(params, false);
  assert.ok(full.includes('d'), 'full encodes difficulty');
  assert.ok(!slim.includes('d'), 'non-full omits difficulty');
  const back = fillomino.decodeParams(full);
  assert.equal(back.size, 7);
  assert.equal(back.difficulty, 'hard');
});

test('encodeDesc → decodeDesc round-trips the givens', () => {
  for (const seed of [1, 42, 777]) {
    const params = { seed, size: 7, difficulty: 'easy' };
    const { playState } = fillomino.newPuzzle(params, makeGenRng(seed));
    const desc = fillomino.encodeDesc(playState);
    assert.equal(desc.length, 49, 'desc is N² chars');
    const rebuilt = fillomino.decodeDesc(params, desc);
    assert.equal(fillomino.encodeDesc(rebuilt), desc, 'desc round-trips');
    for (let i = 0; i < 49; i++) {
      const orig = playState.grid.cells[i], re = rebuilt.grid.cells[i];
      assert.equal(re.given, orig.given, `cell ${i} given flag`);
      if (orig.given) assert.equal(re.value, orig.value, `cell ${i} given value`);
      else assert.equal(re.value, null, `cell ${i} blank`);
    }
  }
});
