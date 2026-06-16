// tests/slitherlink.test.mjs — headless verification of the Slitherlink (Tatham "Loopy") back-end.
// Run: node --test tests/slitherlink.test.mjs
//
// Asserts, across several seeds and difficulties:
//   • generate() bundles a valid SINGLE closed loop on the DOT LATTICE with every clue's edge-count
//     matching its value (isSolved true on the bundled { grid, loop:solution.loop }), verified by an
//     INDEPENDENT loop validator here (no shared code with src/games/slitherlink).
//   • the solver finds the puzzle UNIQUE (countSolutions === 1) for several seeds.
//   • reproducibility: same seed → identical clues + loop.
//   • applyMove purity (no mutation of prior loop) + no-op returns same reference; toggling an edge
//     twice returns to empty.
//   • isSolved false on empty / partial / two-disjoint-loops / figure-eight.
//   • validateMove rejects non-adjacent dots and a===b and wrong move types.
//   • encodeDesc → decodeDesc round-trips the clue layout.
//   • all presets generate unique puzzles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import slitherlink from '../src/games/slitherlink/index.js';
import { countSolutions } from '../src/games/slitherlink/solver.js';
import { ROLES, getCellAt } from '../src/core/grid.js';

// --- INDEPENDENT loop validator -------------------------------------------------------------
// Deliberately separate from src/games/slitherlink (no shared code) so it's a genuine cross-check.
// Given a playState grid (rows×cols CELLS) and a loop object over DOT-edge keys, it verifies: every
// stored edge joins two orthogonally-adjacent in-bounds DOTS (dots range 0..rows / 0..cols); every
// used dot has degree exactly 2; the used dots form exactly ONE cycle; and every clue cell's count
// of present surrounding edges equals its value. Returns true/false.
function independentSolved(grid, loop) {
  const rows = grid.rows, cols = grid.cols;
  const parse = (id) => { const m = /^d(\d+)c(\d+)$/.exec(id); return m ? { r: +m[1], c: +m[2] } : null; };
  const ek = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const dot = (r, c) => `d${r}c${c}`;
  const keys = Object.keys(loop).filter((k) => loop[k]);
  if (keys.length === 0) return false;

  const adj = new Map();
  const deg = new Map();
  const touch = (id) => { if (!adj.has(id)) { adj.set(id, []); deg.set(id, 0); } };
  for (const key of keys) {
    const [a, b] = key.split('|');
    const pa = parse(a), pb = parse(b);
    if (!pa || !pb) return false;
    if (pa.r < 0 || pa.c < 0 || pa.r > rows || pa.c > cols) return false; // dot out of lattice
    if (pb.r < 0 || pb.c < 0 || pb.r > rows || pb.c > cols) return false;
    if (Math.abs(pa.r - pb.r) + Math.abs(pa.c - pb.c) !== 1) return false; // not adjacent
    touch(a); touch(b);
    adj.get(a).push(b); adj.get(b).push(a);
    deg.set(a, deg.get(a) + 1); deg.set(b, deg.get(b) + 1);
  }
  // every used dot degree exactly 2
  for (const [, d] of deg) if (d !== 2) return false;

  // single cycle covering all used dots
  const used = [...deg.keys()];
  let prev = null, cur = used[0], steps = 0;
  do {
    const opts = adj.get(cur);
    const next = opts[0] === prev ? opts[1] : opts[0];
    prev = cur; cur = next; steps++;
    if (steps > used.length + 1) return false;
  } while (cur !== used[0]);
  if (steps !== used.length) return false;

  // every clue cell's edge-count equals its value (compute surrounding edges from scratch)
  const present = (a, b) => loop[ek(a, b)] === 1;
  for (const cell of grid.cells) {
    if (cell.role !== ROLES.clue || cell.value == null) continue;
    const cr = cell.row, cc = cell.col;
    const tl = dot(cr, cc), tr = dot(cr, cc + 1), bl = dot(cr + 1, cc), br = dot(cr + 1, cc + 1);
    let n = 0;
    if (present(tl, tr)) n++; // top
    if (present(bl, br)) n++; // bottom
    if (present(tl, bl)) n++; // left
    if (present(tr, br)) n++; // right
    if (n !== parseInt(cell.value, 10)) return false;
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
    if (cell.role === ROLES.clue && cell.value != null) {
      out.push({ r: cell.row, c: cell.col, n: parseInt(cell.value, 10) });
    }
  }
  return out;
}
const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const SEEDS = [1, 2, 3, 7, 42, 99, 123, 1000];

// --- tests ----------------------------------------------------------------------------------

test('newPuzzle builds a blank playState with clue anchors and empty loop', () => {
  for (const seed of SEEDS) {
    const { playState, params } = slitherlink.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    assert.equal(playState.grid.rows, params.size);
    assert.equal(playState.grid.cols, params.size);
    assert.deepEqual(playState.loop, {}, 'fresh puzzle has no loop edges');
    assert.ok(clueCount(playState) >= 1, 'has at least one clue');
    for (const cell of playState.grid.cells) {
      if (cell.role === ROLES.clue) {
        assert.equal(cell.given, true);
        assert.match(cell.value, /^[0-3]$/, 'clue value is a digit 0..3');
      } else {
        assert.equal(cell.role, ROLES.blank);
        assert.equal(cell.value, null);
      }
    }
  }
});

test('bundled solution is a valid single closed loop satisfying every clue', () => {
  for (const seed of SEEDS) {
    const { playState, solution } = slitherlink.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    const solvedState = { grid: playState.grid, loop: solution.loop };
    assert.equal(slitherlink.isSolved(solvedState), true, `seed ${seed}: engine isSolved on bundled loop`);
    assert.equal(independentSolved(playState.grid, solution.loop), true,
      `seed ${seed}: independent validator confirms the bundled loop`);
    assert.equal(slitherlink.findConflicts(solvedState).length, 0, `seed ${seed}: no conflicts in solution`);
  }
});

test('solve() reproduces a valid solution', () => {
  for (const seed of SEEDS) {
    const { playState } = slitherlink.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    const solved = slitherlink.solve(playState);
    assert.ok(solved, `seed ${seed}: solve() returned a solution`);
    assert.equal(slitherlink.isSolved(solved), true, `seed ${seed}: solve() output is solved`);
    assert.equal(independentSolved(solved.grid, solved.loop), true, `seed ${seed}: independent confirms solve()`);
  }
});

test('puzzle is UNIQUELY solvable (countSolutions === 1)', () => {
  for (const seed of SEEDS) {
    const { playState } = slitherlink.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    const clues = cluesFromGrid(playState.grid);
    const n = countSolutions(playState.grid.rows, playState.grid.cols, clues, 2);
    assert.equal(n, 1, `seed ${seed}: expected exactly 1 solution, got ${n}`);
  }
});

test('reproducibility: same seed → identical clues + loop', () => {
  for (const seed of [1, 7, 42, 1000]) {
    const a = slitherlink.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    const b = slitherlink.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    assert.equal(slitherlink.encodeDesc(a.playState), slitherlink.encodeDesc(b.playState),
      `seed ${seed}: identical clue layout`);
    assert.deepEqual(a.solution.loop, b.solution.loop, `seed ${seed}: identical loop`);
  }
});

test('applyMove is pure: prior loop untouched; toggling an edge twice returns to empty', () => {
  const { playState, solution } = slitherlink.newPuzzle({ seed: 7, size: 6, difficulty: 'easy' });
  const hint = slitherlink.hint(playState, solution);
  assert.ok(hint, 'a hint edge exists on a fresh puzzle');
  assert.equal(hint.type, 'edge');
  assert.equal(slitherlink.validateMove(playState, hint), true, 'hint is a valid move');

  const before = playState;
  const beforeSnapshot = JSON.stringify(before.loop);

  const s1 = slitherlink.applyMove(before, hint);
  assert.notEqual(s1, before, 'toggle produced a new state');
  assert.notEqual(s1.loop, before.loop, 'new loop object (not the same reference)');
  assert.equal(JSON.stringify(before.loop), beforeSnapshot, 'prior loop object untouched');
  const key = edgeKey(hint.a, hint.b);
  assert.equal(s1.loop[key], 1, 'edge present after first toggle');

  const s2 = slitherlink.applyMove(s1, hint);
  assert.equal(s2.loop[key], undefined, 'edge removed after second toggle');
  assert.deepEqual(s2.loop, before.loop, 'toggling twice returns to the starting (empty) loop');
  assert.equal(s1.loop[key], 1, 's1 untouched by s2');

  // No-ops return the SAME reference.
  const noop1 = slitherlink.applyMove(before, { type: 'edge', a: 'd0c0', b: 'd0c0' });
  assert.equal(noop1, before, 'self-edge no-op returns same reference');
  const noop2 = slitherlink.applyMove(before, { type: 'nonsense' });
  assert.equal(noop2, before, 'unknown move returns same reference');
  const noop3 = slitherlink.applyMove(before, { type: 'edge', a: 'd0c0', b: 'd2c2' });
  assert.equal(noop3, before, 'non-adjacent no-op returns same reference');
});

test('isSolved is false on empty, partial, two-disjoint-loops, and figure-eight', () => {
  const { playState, solution } = slitherlink.newPuzzle({ seed: 3, size: 6, difficulty: 'easy' });
  const grid = playState.grid;
  // empty
  assert.equal(slitherlink.isSolved(playState), false, 'empty loop is not solved');
  // partial: solution minus one edge
  const solKeys = Object.keys(solution.loop);
  const partial = { ...solution.loop };
  delete partial[solKeys[0]];
  assert.equal(slitherlink.isSolved({ grid, loop: partial }), false, 'partial loop not solved');

  // two disjoint unit loops (two separate 1×1-cell squares) — every dot degree 2 but TWO cycles.
  const square = (r, c) => ({
    [edgeKey(`d${r}c${c}`, `d${r}c${c + 1}`)]: 1,       // top
    [edgeKey(`d${r + 1}c${c}`, `d${r + 1}c${c + 1}`)]: 1, // bottom
    [edgeKey(`d${r}c${c}`, `d${r + 1}c${c}`)]: 1,       // left
    [edgeKey(`d${r}c${c + 1}`, `d${r + 1}c${c + 1}`)]: 1, // right
  });
  const twoLoops = { ...square(0, 0), ...square(0, 2) };
  assert.equal(slitherlink.isSolved({ grid, loop: twoLoops }), false, 'two disjoint loops not solved');

  // figure-eight: two unit squares sharing a single dot → that shared dot has degree 4 (illegal).
  // squares (0,0)-(1,1)-area and (1,1)-(2,2)-area share dot d1c1.
  const fig8 = { ...square(0, 0), ...square(1, 1) };
  assert.equal(slitherlink.isSolved({ grid, loop: fig8 }), false, 'figure-eight (degree-4 dot) not solved');
});

test('validateMove rejects non-adjacent dots, a===b, and wrong types', () => {
  const { playState } = slitherlink.newPuzzle({ seed: 1, size: 6, difficulty: 'easy' });
  assert.equal(slitherlink.validateMove(playState, { type: 'edge', a: 'd0c0', b: 'd0c1' }), true, 'adjacent horizontal legal');
  assert.equal(slitherlink.validateMove(playState, { type: 'edge', a: 'd0c0', b: 'd1c0' }), true, 'adjacent vertical legal');
  assert.equal(slitherlink.validateMove(playState, { type: 'edge', a: 'd0c0', b: 'd0c0' }), false, 'self edge rejected');
  assert.equal(slitherlink.validateMove(playState, { type: 'edge', a: 'd0c0', b: 'd0c2' }), false, 'distance-2 rejected');
  assert.equal(slitherlink.validateMove(playState, { type: 'edge', a: 'd0c0', b: 'd1c1' }), false, 'diagonal rejected');
  assert.equal(slitherlink.validateMove(playState, { type: 'edge', a: 'd0c0', b: 'd9c9' }), false, 'off-lattice rejected');
  // last valid dot is d{size}c{size}; one past is invalid
  const N = playState.grid.rows;
  assert.equal(slitherlink.validateMove(playState, { type: 'edge', a: `d${N}c${N}`, b: `d${N}c${N - 1}` }), true, 'corner dot legal');
  assert.equal(slitherlink.validateMove(playState, { type: 'edge', a: `d${N}c${N}`, b: `d${N + 1}c${N}` }), false, 'past-edge dot rejected');
  assert.equal(slitherlink.validateMove(playState, { type: 'bridge', a: 'd0c0', b: 'd0c1' }), false, 'wrong move type rejected');
});

test('encodeDesc → decodeDesc round-trips the clue layout', () => {
  for (const seed of SEEDS) {
    const { playState, params } = slitherlink.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    const desc = slitherlink.encodeDesc(playState);
    const rebuilt = slitherlink.decodeDesc(params, desc);
    assert.equal(rebuilt.grid.rows, playState.grid.rows);
    assert.equal(rebuilt.grid.cols, playState.grid.cols);
    assert.deepEqual(rebuilt.loop, {}, 'rebuilt has empty loop');
    for (let r = 0; r < playState.grid.rows; r++) {
      for (let c = 0; c < playState.grid.cols; c++) {
        const a = getCellAt(playState.grid, r, c);
        const b = getCellAt(rebuilt.grid, r, c);
        assert.equal(b.role, a.role, `cell ${a.id} role`);
        assert.equal(b.value, a.value, `cell ${a.id} value`);
      }
    }
    assert.equal(slitherlink.encodeDesc(rebuilt), desc, `seed ${seed}: encode is stable`);
  }
});

test('encodeParams full vs not-full; decodeParams round-trip', () => {
  const p = { seed: 1, size: 7, difficulty: 'medium' };
  assert.equal(slitherlink.encodeParams(p, false), '7');
  assert.match(slitherlink.encodeParams(p, true), /^7dmedium$/);
  const d = slitherlink.decodeParams(slitherlink.encodeParams(p, true));
  assert.equal(d.size, 7);
  assert.equal(d.difficulty, 'medium');
});

test('findConflicts flags over-budget clues and degree>2 dots', () => {
  const { playState } = slitherlink.newPuzzle({ seed: 1, size: 6, difficulty: 'easy' });
  const grid = playState.grid;
  // Find a clue cell with value 0 and draw one of its edges → over budget.
  let zeroCell = null;
  for (const cell of grid.cells) if (cell.role === ROLES.clue && cell.value === '0') { zeroCell = cell; break; }
  if (zeroCell) {
    const cr = zeroCell.row, cc = zeroCell.col;
    const over = { [edgeKey(`d${cr}c${cc}`, `d${cr}c${cc + 1}`)]: 1 }; // top edge of a 0-clue
    const conflicts = slitherlink.findConflicts({ grid, loop: over });
    assert.ok(conflicts.includes(zeroCell.id), 'a drawn edge on a 0-clue is flagged');
  }
  // A degree-3 dot (three edges meeting) is flagged.
  const deg3 = {
    [edgeKey('d1c1', 'd1c0')]: 1,
    [edgeKey('d1c1', 'd1c2')]: 1,
    [edgeKey('d1c1', 'd0c1')]: 1,
  };
  const c2 = slitherlink.findConflicts({ grid, loop: deg3 });
  assert.ok(c2.includes('d1c1'), 'a degree-3 dot is flagged');
});

test('eventsFor maps an edge move to cellPlaced / cellCleared with both dot ids', () => {
  const { playState } = slitherlink.newPuzzle({ seed: 1, size: 6, difficulty: 'easy' });
  const move = { type: 'edge', a: 'd0c0', b: 'd0c1' };
  const s1 = slitherlink.applyMove(playState, move);
  const ev1 = slitherlink.eventsFor(playState, move, s1);
  assert.equal(ev1.length, 1);
  assert.equal(ev1[0].name, 'cellPlaced');
  assert.deepEqual(ev1[0].payload.cells.slice().sort(), ['d0c0', 'd0c1']);
  const s2 = slitherlink.applyMove(s1, move);
  const ev2 = slitherlink.eventsFor(s1, move, s2);
  assert.equal(ev2[0].name, 'cellCleared');
  assert.deepEqual(ev2[0].payload.cells.slice().sort(), ['d0c0', 'd0c1']);
  // a no-op yields no events
  assert.deepEqual(slitherlink.eventsFor(playState, move, playState), []);
});

test('full solve path: applying hints reaches isSolved', () => {
  const { playState, solution } = slitherlink.newPuzzle({ seed: 42, size: 6, difficulty: 'easy' });
  let state = playState;
  let guard = 0;
  while (!slitherlink.isSolved(state) && guard++ < 1000) {
    const h = slitherlink.hint(state, solution);
    if (!h) break;
    assert.equal(slitherlink.validateMove(state, h), true, 'each hint is valid');
    state = slitherlink.applyMove(state, h);
  }
  assert.equal(slitherlink.isSolved(state), true, 'applying hints solves the puzzle');
});

test('all presets (easy/medium/hard) generate unique, valid puzzles', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (const seed of [1, 7, 42]) {
      const { playState, solution } = slitherlink.newPuzzle({ seed, difficulty });
      const clues = cluesFromGrid(playState.grid);
      const n = countSolutions(playState.grid.rows, playState.grid.cols, clues, 2);
      assert.equal(n, 1, `${difficulty}/${seed}: expected unique, got ${n}`);
      assert.equal(independentSolved(playState.grid, solution.loop), true, `${difficulty}/${seed}: bundled loop valid`);
      assert.equal(slitherlink.isSolved({ grid: playState.grid, loop: solution.loop }), true,
        `${difficulty}/${seed}: engine isSolved on bundled loop`);
    }
  }
});
