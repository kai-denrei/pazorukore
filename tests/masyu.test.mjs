// tests/masyu.test.mjs — headless verification of the Masyu (Tatham "Pearl") back-end.
// Run: node --test tests/masyu.test.mjs
//
// Asserts, across several seeds and difficulties:
//   • generate() bundles a valid SINGLE closed loop satisfying every pearl (isSolved true on the
//     bundled { grid, loop:solution.loop }), verified by an INDEPENDENT loop validator here.
//   • the solver finds the puzzle UNIQUE (countSolutions === 1) for several seeds.
//   • reproducibility: same seed → identical pearls + loop.
//   • applyMove purity (no mutation of prior loop) + no-op returns same reference; toggling an edge
//     twice returns to empty.
//   • isSolved false on partial/empty and on a wrong loop.
//   • encodeDesc → decodeDesc round-trips the pearl layout.
//   • validateMove rejects non-adjacent edges and a===b.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import masyu from '../src/games/masyu/index.js';
import { countSolutions } from '../src/games/masyu/solver.js';
import { ROLES, getCellAt } from '../src/core/grid.js';

// --- INDEPENDENT loop validator -------------------------------------------------------------
// Deliberately separate from src/games/masyu (no shared code) so it's a genuine cross-check. Given a
// playState grid and a loop object, it verifies: every stored edge joins two orthogonally-adjacent
// real cells; every used cell has degree exactly 2; the used cells form exactly ONE cycle; and every
// pearl is on the loop and satisfies its rule. Returns true/false.
function independentSolved(grid, loop) {
  const rows = grid.rows, cols = grid.cols;
  const parse = (id) => { const m = /^r(\d+)c(\d+)$/.exec(id); return { r: +m[1], c: +m[2] }; };
  const keys = Object.keys(loop).filter((k) => loop[k]);
  if (keys.length === 0) return false;

  // adjacency + degree built from scratch
  const adj = new Map();
  const deg = new Map();
  const touch = (id) => { if (!adj.has(id)) { adj.set(id, []); deg.set(id, 0); } };
  for (const key of keys) {
    const [a, b] = key.split('|');
    const pa = parse(a), pb = parse(b);
    if (pa.r < 0 || pa.c < 0 || pa.r >= rows || pa.c >= cols) return false;
    if (pb.r < 0 || pb.c < 0 || pb.r >= rows || pb.c >= cols) return false;
    if (Math.abs(pa.r - pb.r) + Math.abs(pa.c - pb.c) !== 1) return false; // not adjacent
    touch(a); touch(b);
    adj.get(a).push(b); adj.get(b).push(a);
    deg.set(a, deg.get(a) + 1); deg.set(b, deg.get(b) + 1);
  }
  // every used cell degree 2
  for (const [, d] of deg) if (d !== 2) return false;

  // single cycle covering all used cells
  const used = [...deg.keys()];
  let prev = null, cur = used[0], steps = 0;
  do {
    const opts = adj.get(cur);
    const next = opts[0] === prev ? opts[1] : opts[0];
    prev = cur; cur = next; steps++;
    if (steps > used.length + 1) return false;
  } while (cur !== used[0]);
  if (steps !== used.length) return false;

  // shape of a used cell from scratch
  const shapeOf = (id) => {
    const nbs = adj.get(id);
    if (!nbs || nbs.length !== 2) return null;
    const s = parse(id);
    let h = 0, v = 0;
    for (const nb of nbs) { const p = parse(nb); if (p.r === s.r) h++; else v++; }
    return (h === 2 || v === 2) ? 'straight' : 'turn';
  };

  // pearls from the grid
  for (const cell of grid.cells) {
    if (cell.role !== ROLES.clue) continue;
    if (cell.value !== 'B' && cell.value !== 'W') continue;
    const id = cell.id;
    if ((deg.get(id) || 0) !== 2) return false;
    const nbs = adj.get(id);
    if (cell.value === 'W') {
      if (shapeOf(id) !== 'straight') return false;
      let anyTurn = false;
      for (const nb of nbs) if (shapeOf(nb) === 'turn') { anyTurn = true; break; }
      if (!anyTurn) return false;
    } else {
      if (shapeOf(id) !== 'turn') return false;
      for (const nb of nbs) if (shapeOf(nb) !== 'straight') return false;
    }
  }
  return true;
}

// --- helpers --------------------------------------------------------------------------------
function pearlCount(playState) {
  return playState.grid.cells.filter((c) => c.role === ROLES.clue).length;
}
function pearlsFromGrid(grid) {
  const out = [];
  for (const cell of grid.cells) {
    if (cell.role === ROLES.clue && (cell.value === 'B' || cell.value === 'W')) {
      out.push({ id: cell.id, r: cell.row, c: cell.col, kind: cell.value });
    }
  }
  return out;
}

const SEEDS = [1, 2, 3, 7, 42, 99, 123, 1000];

// --- tests ----------------------------------------------------------------------------------

test('newPuzzle builds a blank playState with pearl anchors and empty loop', () => {
  for (const seed of SEEDS) {
    const { playState } = masyu.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    assert.equal(playState.grid.rows, 6);
    assert.equal(playState.grid.cols, 6);
    assert.deepEqual(playState.loop, {}, 'fresh puzzle has no loop edges');
    assert.ok(pearlCount(playState) >= 1, 'has at least one pearl');
    for (const cell of playState.grid.cells) {
      if (cell.role === ROLES.clue) {
        assert.equal(cell.given, true);
        assert.match(cell.value, /^[BW]$/, "pearl value is 'B' or 'W'");
      } else {
        assert.equal(cell.role, ROLES.blank);
        assert.equal(cell.value, null);
      }
    }
  }
});

test('bundled solution is a valid single closed loop satisfying every pearl', () => {
  for (const seed of SEEDS) {
    const { playState, solution } = masyu.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    // engine says solved on the bundled solution loop
    const solvedState = { grid: playState.grid, loop: solution.loop };
    assert.equal(masyu.isSolved(solvedState), true, `seed ${seed}: engine isSolved on bundled loop`);
    // independent validator agrees
    assert.equal(independentSolved(playState.grid, solution.loop), true,
      `seed ${seed}: independent validator confirms the bundled loop`);
    assert.equal(masyu.findConflicts(solvedState).length, 0, `seed ${seed}: no conflicts in solution`);
  }
});

test('solve() reproduces a valid solution', () => {
  for (const seed of SEEDS) {
    const { playState } = masyu.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    const solved = masyu.solve(playState);
    assert.ok(solved, `seed ${seed}: solve() returned a solution`);
    assert.equal(masyu.isSolved(solved), true, `seed ${seed}: solve() output is solved`);
    assert.equal(independentSolved(solved.grid, solved.loop), true, `seed ${seed}: independent confirms solve()`);
  }
});

test('puzzle is UNIQUELY solvable (countSolutions === 1)', () => {
  for (const seed of SEEDS) {
    const { playState } = masyu.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    const pearls = pearlsFromGrid(playState.grid);
    const n = countSolutions(playState.grid.rows, playState.grid.cols, pearls, 2);
    assert.equal(n, 1, `seed ${seed}: expected exactly 1 solution, got ${n}`);
  }
});

test('reproducibility: same seed → identical pearls + loop', () => {
  for (const seed of [1, 7, 42, 1000]) {
    const a = masyu.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    const b = masyu.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    assert.equal(masyu.encodeDesc(a.playState), masyu.encodeDesc(b.playState),
      `seed ${seed}: identical pearl layout`);
    assert.deepEqual(a.solution.loop, b.solution.loop, `seed ${seed}: identical loop`);
  }
});

test('applyMove is pure: prior loop untouched; toggling an edge twice returns to empty', () => {
  const { playState, solution } = masyu.newPuzzle({ seed: 7, size: 6, difficulty: 'easy' });
  const hint = masyu.hint(playState, solution);
  assert.ok(hint, 'a hint edge exists on a fresh puzzle');
  assert.equal(hint.type, 'loop');
  assert.equal(masyu.validateMove(playState, hint), true, 'hint is a valid move');

  const before = playState;
  const beforeSnapshot = JSON.stringify(before.loop);

  const s1 = masyu.applyMove(before, hint);
  assert.notEqual(s1, before, 'toggle produced a new state');
  assert.notEqual(s1.loop, before.loop, 'new loop object (not the same reference)');
  assert.equal(JSON.stringify(before.loop), beforeSnapshot, 'prior loop object untouched');
  const key = hint.a < hint.b ? `${hint.a}|${hint.b}` : `${hint.b}|${hint.a}`;
  assert.equal(s1.loop[key], 1, 'edge present after first toggle');

  const s2 = masyu.applyMove(s1, hint);
  assert.equal(s2.loop[key], undefined, 'edge removed after second toggle');
  assert.deepEqual(s2.loop, before.loop, 'toggling twice returns to the starting (empty) loop');
  assert.equal(s1.loop[key], 1, 's1 untouched by s2');

  // A no-op (illegal move) returns the SAME reference.
  const noop = masyu.applyMove(before, { type: 'loop', a: 'r0c0', b: 'r0c0' });
  assert.equal(noop, before, 'self-edge no-op returns same reference');
  const noop2 = masyu.applyMove(before, { type: 'nonsense' });
  assert.equal(noop2, before, 'unknown move returns same reference');
  const noop3 = masyu.applyMove(before, { type: 'loop', a: 'r0c0', b: 'r2c2' });
  assert.equal(noop3, before, 'non-adjacent no-op returns same reference');
});

test('isSolved is false on empty, partial, and wrong loops', () => {
  const { playState, solution } = masyu.newPuzzle({ seed: 3, size: 6, difficulty: 'easy' });
  // empty
  assert.equal(masyu.isSolved(playState), false, 'empty loop is not solved');
  // partial: solution minus one edge
  const solKeys = Object.keys(solution.loop);
  const partial = { ...solution.loop };
  delete partial[solKeys[0]];
  assert.equal(masyu.isSolved({ grid: playState.grid, loop: partial }), false, 'partial loop not solved');
  // wrong: a single tiny 2-cell "edge" is not a closed loop
  const wrong = { 'r0c0|r0c1': 1 };
  assert.equal(masyu.isSolved({ grid: playState.grid, loop: wrong }), false, 'a lone edge is not a loop');
});

test('validateMove rejects non-adjacent edges and a===b', () => {
  const { playState } = masyu.newPuzzle({ seed: 1, size: 6, difficulty: 'easy' });
  assert.equal(masyu.validateMove(playState, { type: 'loop', a: 'r0c0', b: 'r0c1' }), true, 'adjacent horizontal legal');
  assert.equal(masyu.validateMove(playState, { type: 'loop', a: 'r0c0', b: 'r1c0' }), true, 'adjacent vertical legal');
  assert.equal(masyu.validateMove(playState, { type: 'loop', a: 'r0c0', b: 'r0c0' }), false, 'self edge rejected');
  assert.equal(masyu.validateMove(playState, { type: 'loop', a: 'r0c0', b: 'r0c2' }), false, 'distance-2 rejected');
  assert.equal(masyu.validateMove(playState, { type: 'loop', a: 'r0c0', b: 'r1c1' }), false, 'diagonal rejected');
  assert.equal(masyu.validateMove(playState, { type: 'loop', a: 'r0c0', b: 'r9c9' }), false, 'off-grid rejected');
  assert.equal(masyu.validateMove(playState, { type: 'bridge', a: 'r0c0', b: 'r0c1' }), false, 'wrong move type rejected');
});

test('encodeDesc → decodeDesc round-trips the pearl layout', () => {
  for (const seed of SEEDS) {
    const { playState, params } = masyu.newPuzzle({ seed, size: 6, difficulty: 'easy' });
    const desc = masyu.encodeDesc(playState);
    const rebuilt = masyu.decodeDesc(params, desc);
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
    assert.equal(masyu.encodeDesc(rebuilt), desc, `seed ${seed}: encode is stable`);
  }
});

test('encodeParams full vs not-full; decodeParams round-trip', () => {
  const p = { seed: 1, size: 7, difficulty: 'medium' };
  assert.equal(masyu.encodeParams(p, false), '7');
  assert.match(masyu.encodeParams(p, true), /^7dmedium$/);
  const d = masyu.decodeParams(masyu.encodeParams(p, true));
  assert.equal(d.size, 7);
  assert.equal(d.difficulty, 'medium');
});

test('full solve path: applying hints reaches isSolved', () => {
  const { playState, solution } = masyu.newPuzzle({ seed: 42, size: 6, difficulty: 'easy' });
  let state = playState;
  let guard = 0;
  while (!masyu.isSolved(state) && guard++ < 500) {
    const h = masyu.hint(state, solution);
    if (!h) break;
    assert.equal(masyu.validateMove(state, h), true, 'each hint is valid');
    state = masyu.applyMove(state, h);
  }
  assert.equal(masyu.isSolved(state), true, 'applying hints solves the puzzle');
});

test('eventsFor maps a loop move to cellPlaced / cellCleared with both cell ids', () => {
  const { playState } = masyu.newPuzzle({ seed: 1, size: 6, difficulty: 'easy' });
  const move = { type: 'loop', a: 'r0c0', b: 'r0c1' };
  const s1 = masyu.applyMove(playState, move);
  const ev1 = masyu.eventsFor(playState, move, s1);
  assert.equal(ev1.length, 1);
  assert.equal(ev1[0].name, 'cellPlaced');
  assert.deepEqual(ev1[0].payload.cells.sort(), ['r0c0', 'r0c1']);
  const s2 = masyu.applyMove(s1, move);
  const ev2 = masyu.eventsFor(s1, move, s2);
  assert.equal(ev2[0].name, 'cellCleared');
  assert.deepEqual(ev2[0].payload.cells.sort(), ['r0c0', 'r0c1']);
});

test('medium and hard presets also generate unique puzzles', () => {
  for (const difficulty of ['medium', 'hard']) {
    for (const seed of [1, 7, 42]) {
      const { playState, solution } = masyu.newPuzzle({ seed, difficulty });
      const pearls = pearlsFromGrid(playState.grid);
      const n = countSolutions(playState.grid.rows, playState.grid.cols, pearls, 2);
      assert.equal(n, 1, `${difficulty}/${seed}: expected unique, got ${n}`);
      assert.equal(independentSolved(playState.grid, solution.loop), true, `${difficulty}/${seed}: bundled loop valid`);
    }
  }
});
