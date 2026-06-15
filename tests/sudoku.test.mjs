// tests/sudoku.test.mjs — headless verification of the Sudoku back end (§5 / §12.1).
// Builds puzzles across several seeds and asserts: solve() returns a solution, that solution
// isSolved, the generated puzzle has EXACTLY ONE solution (via an INDEPENDENT counter written
// here, capped at 2), hints are correct forced placements, conflict detection works, applyMove
// is pure, and encodeDesc→decodeDesc round-trips. Run: `node --test tests/sudoku.test.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import sudoku from '../src/games/sudoku/index.js';
import { makeGenRng } from '../src/core/rng.js';
import { getCell } from '../src/core/grid.js';

const SEEDS = [1, 2, 7, 42, 1337, 99999];
const N = 9;

// --- an INDEPENDENT solution counter (does not import the game's solver) ----------------------
// Plain recursive backtracking over a 9×9 String/array board, counting solutions up to `cap`.
// Deliberately naive so it can't share a bug with the production solver.
function independentCount(board, cap = 2) {
  const b = board.slice();
  let count = 0;

  const box = (r, c) => Math.floor(r / 3) * 3 + Math.floor(c / 3);
  const ok = (i, d) => {
    const r = Math.floor(i / 9), c = i % 9, bx = box(r, c);
    for (let k = 0; k < 9; k++) {
      if (b[r * 9 + k] === d) return false;          // row
      if (b[k * 9 + c] === d) return false;          // col
      const rr = Math.floor(k / 3) + Math.floor(r / 3) * 3;
      const cc = (k % 3) + Math.floor(c / 3) * 3;
      if (b[rr * 9 + cc] === d) return false;         // box
    }
    return true;
  };

  const rec = (start) => {
    let i = start;
    while (i < 81 && b[i] !== 0) i++;
    if (i === 81) { count++; return; }
    for (let d = 1; d <= 9 && count < cap; d++) {
      if (ok(i, d)) { b[i] = d; rec(i + 1); b[i] = 0; }
    }
  };
  rec(0);
  return count;
}

function descToBoard(desc) {
  const b = new Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = desc[i];
    b[i] = ch && ch !== '.' ? parseInt(ch, 10) : 0;
  }
  return b;
}

// --- tests ------------------------------------------------------------------------------------

test('meta matches the contract', () => {
  assert.equal(sudoku.meta.id, 'sudoku');
  assert.equal(sudoku.meta.interaction, 'digit-entry');
  assert.deepEqual(sudoku.meta.requirements, { glyphSet: 'digits', needsOffState: true, needsRegionFill: false });
});

for (const seed of SEEDS) {
  test(`seed ${seed}: generate → solve → unique`, () => {
    const params = { ...sudoku.defaultParams(), seed };
    const { playState, solution } = sudoku.newPuzzle(params, makeGenRng(seed));

    // playState shape
    assert.ok(playState.grid && playState.pencil && typeof playState.pencil === 'object');
    assert.equal(playState.grid.cells.length, 81);
    for (const c of playState.grid.cells) {
      assert.ok(c.value === null || typeof c.value === 'string', 'value is string|null');
    }

    // solution provided by the game is itself solved
    assert.ok(solution, 'newPuzzle returns a solution');
    assert.equal(sudoku.isSolved(solution), true, 'provided solution isSolved');

    // solve() returns a solution that isSolved
    const solved = sudoku.solve(playState);
    assert.ok(solved, 'solve() returns non-null');
    assert.equal(sudoku.isSolved(solved), true, 'solve() result isSolved');

    // solve() must agree with the generator's solution everywhere
    for (let i = 0; i < 81; i++) {
      assert.equal(solved.grid.cells[i].value, solution.grid.cells[i].value, `cell ${i} matches solution`);
    }

    // EXACTLY ONE solution — independent counter, capped at 2
    const board = descToBoard(sudoku.encodeDesc(playState));
    const givenCount = board.filter((d) => d !== 0).length;
    assert.ok(givenCount >= 17, `at least 17 givens (got ${givenCount})`);
    assert.equal(independentCount(board, 2), 1, 'puzzle has exactly one solution');
  });
}

test('reproducibility: same seed → identical puzzle', () => {
  const a = sudoku.newPuzzle({ ...sudoku.defaultParams(), seed: 12345 }, makeGenRng(12345));
  const b = sudoku.newPuzzle({ ...sudoku.defaultParams(), seed: 12345 }, makeGenRng(12345));
  assert.equal(sudoku.encodeDesc(a.playState), sudoku.encodeDesc(b.playState));
});

test('difficulty presets all generate unique puzzles', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const seed = 314;
    const { playState } = sudoku.newPuzzle({ ...sudoku.defaultParams(), seed, difficulty }, makeGenRng(seed));
    const board = descToBoard(sudoku.encodeDesc(playState));
    assert.equal(independentCount(board, 2), 1, `${difficulty} is unique`);
  }
});

test('validateMove rejects edits to given cells and out-of-range digits', () => {
  const { playState } = sudoku.newPuzzle({ ...sudoku.defaultParams(), seed: 5 }, makeGenRng(5));
  const given = playState.grid.cells.find((c) => c.given);
  const blank = playState.grid.cells.find((c) => !c.given);
  assert.equal(sudoku.validateMove(playState, { type: 'place', id: given.id, value: 1 }), false);
  assert.equal(sudoku.validateMove(playState, { type: 'place', id: blank.id, value: 5 }), true);
  assert.equal(sudoku.validateMove(playState, { type: 'place', id: blank.id, value: 10 }), false);
  assert.equal(sudoku.validateMove(playState, { type: 'place', id: blank.id, value: 0 }), false);
});

test('applyMove is pure (no mutation of prior state) and no-ops return the same object', () => {
  const { playState } = sudoku.newPuzzle({ ...sudoku.defaultParams(), seed: 8 }, makeGenRng(8));
  const blank = playState.grid.cells.find((c) => !c.given);
  const before = playState;
  const next = sudoku.applyMove(playState, { type: 'place', id: blank.id, value: 3 });
  assert.notEqual(next, before, 'returns a new state');
  assert.equal(getCell(before.grid, blank.id).value, null, 'prior snapshot untouched');
  assert.equal(getCell(next.grid, blank.id).value, '3');
  // re-placing the same value is a no-op (=== same object so the engine skips it)
  assert.equal(sudoku.applyMove(next, { type: 'place', id: blank.id, value: 3 }), next);
  // editing a given is a no-op
  const given = playState.grid.cells.find((c) => c.given);
  assert.equal(sudoku.applyMove(playState, { type: 'place', id: given.id, value: 9 }), playState);
});

test('pencil marks toggle and stay sorted; placing a value clears them', () => {
  const { playState } = sudoku.newPuzzle({ ...sudoku.defaultParams(), seed: 9 }, makeGenRng(9));
  const blank = playState.grid.cells.find((c) => !c.given);
  let s = sudoku.applyMove(playState, { type: 'pencil', id: blank.id, value: 5 });
  s = sudoku.applyMove(s, { type: 'pencil', id: blank.id, value: 2 });
  assert.deepEqual(s.pencil[blank.id], ['2', '5'], 'sorted candidates');
  s = sudoku.applyMove(s, { type: 'pencil', id: blank.id, value: 5 });
  assert.deepEqual(s.pencil[blank.id], ['2'], 'toggle removes');
  s = sudoku.applyMove(s, { type: 'place', id: blank.id, value: 7 });
  assert.equal(s.pencil[blank.id], undefined, 'placing clears pencil');
});

test('findConflicts flags row/col/box duplicates', () => {
  const { playState } = sudoku.newPuzzle({ ...sudoku.defaultParams(), seed: 3 }, makeGenRng(3));
  // find two blanks in the same row and place the same digit
  const grid = playState.grid;
  let a = null, b = null;
  for (let r = 0; r < 9 && !b; r++) {
    const blanks = [];
    for (let c = 0; c < 9; c++) { const cell = grid.cells[r * 9 + c]; if (!cell.given) blanks.push(cell); }
    if (blanks.length >= 2) { a = blanks[0]; b = blanks[1]; }
  }
  let s = sudoku.applyMove(playState, { type: 'place', id: a.id, value: 4 });
  s = sudoku.applyMove(s, { type: 'place', id: b.id, value: 4 });
  const conflicts = sudoku.findConflicts(s);
  assert.ok(conflicts.includes(a.id) && conflicts.includes(b.id), 'both duplicates flagged');
});

test('hint returns a correct forced placement from the solution', () => {
  const seed = 21;
  const { playState, solution } = sudoku.newPuzzle({ ...sudoku.defaultParams(), seed }, makeGenRng(seed));
  const h = sudoku.hint(playState, solution);
  assert.ok(h && h.type === 'place', 'hint is a place move');
  const cell = getCell(playState.grid, h.id);
  assert.equal(cell.given, false, 'hint targets a non-given cell');
  assert.equal(cell.value, null, 'hint targets an empty cell');
  // hint value matches the unique solution
  const idx = playState.grid.cells.indexOf(cell);
  assert.equal(h.value, solution.grid.cells[idx].value, 'hint value is correct');
});

test('encodeDesc → decodeDesc round-trips the clue layout', () => {
  for (const seed of [1, 42, 777]) {
    const params = { ...sudoku.defaultParams(), seed };
    const { playState } = sudoku.newPuzzle(params, makeGenRng(seed));
    const desc = sudoku.encodeDesc(playState);
    assert.equal(desc.length, 81);
    const rebuilt = sudoku.decodeDesc(params, desc);
    assert.equal(sudoku.encodeDesc(rebuilt), desc, 'desc round-trips');
    // givens preserved as given:true; blanks as fillable
    for (let i = 0; i < 81; i++) {
      const orig = playState.grid.cells[i], re = rebuilt.grid.cells[i];
      assert.equal(re.given, orig.given, `cell ${i} given flag`);
      if (orig.given) assert.equal(re.value, orig.value, `cell ${i} given value`);
      else assert.equal(re.value, null, `cell ${i} blank`);
    }
  }
});

test('encodeParams: full includes difficulty, non-full omits it; decodeParams round-trips', () => {
  const params = { seed: 1, size: 9, box: 3, difficulty: 'hard' };
  const full = sudoku.encodeParams(params, true);
  const slim = sudoku.encodeParams(params, false);
  assert.ok(full.includes('d'), 'full encodes difficulty');
  assert.ok(!slim.includes('d'), 'non-full omits difficulty');
  const back = sudoku.decodeParams(full);
  assert.equal(back.size, 9);
  assert.equal(back.box, 3);
  assert.equal(back.difficulty, 'hard');
});
