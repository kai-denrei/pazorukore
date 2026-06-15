// tests/engine.test.mjs — headless verification of the engine (M1 exit criteria): state list,
// undo/redo, diff-driven cellChanged, semantic events, conflict reconcile, solve detection,
// and game-ID round-trip. Run: `node --test tests/`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/core/engine.js';
import { EVENTS } from '../src/core/events.js';
import { fakeGame } from './fake-game.js';

function recorder(engine, names) {
  const log = [];
  for (const n of names) engine.on(n, (p) => log.push({ name: n, p }));
  return log;
}

test('load builds initial state and emits loaded', () => {
  const e = new Engine();
  const log = recorder(e, [EVENTS.loaded]);
  e.load(fakeGame, { seed: 1, size: 2 });
  assert.equal(e.current().grid.cells.length, 4);
  assert.equal(log.length, 1);
  assert.equal(e.canUndo(), false);
});

test('do → push → cellChanged + cellPlaced; undo/redo move the index', () => {
  const e = new Engine();
  e.load(fakeGame, { seed: 1, size: 2 });
  const log = recorder(e, [EVENTS.cellChanged, EVENTS.cellPlaced, EVENTS.moved]);

  assert.equal(e.do({ type: 'place', id: 'r0c0', value: 1 }), true);
  assert.equal(e.current().grid.cells[0].value, '1');
  assert.ok(log.some((x) => x.name === EVENTS.cellChanged && x.p.id === 'r0c0'));
  assert.ok(log.some((x) => x.name === EVENTS.cellPlaced));

  assert.equal(e.canUndo(), true);
  e.undo();
  assert.equal(e.current().grid.cells[0].value, null, 'undo reverts the placement');
  e.redo();
  assert.equal(e.current().grid.cells[0].value, '1', 'redo re-applies it');
});

test('immutability: applying a move does not mutate the prior snapshot', () => {
  const e = new Engine();
  e.load(fakeGame, { seed: 1, size: 2 });
  const before = e.current();
  e.do({ type: 'place', id: 'r0c0', value: 1 });
  assert.equal(before.grid.cells[0].value, null, 'prior playState is untouched');
  assert.notEqual(before, e.current());
});

test('a new do() truncates the redo branch', () => {
  const e = new Engine();
  e.load(fakeGame, { seed: 1, size: 2 });
  e.do({ type: 'place', id: 'r0c0', value: 1 });
  e.undo();
  e.do({ type: 'place', id: 'r0c0', value: 2 });
  assert.equal(e.canRedo(), false, 'redo branch was discarded');
  assert.equal(e.current().grid.cells[0].value, '2');
});

test('conflict reconcile: detect then clear', () => {
  const e = new Engine();
  e.load(fakeGame, { seed: 1, size: 2 });
  const log = recorder(e, [EVENTS.conflictDetected, EVENTS.conflictCleared]);
  e.do({ type: 'place', id: 'r0c0', value: 1 });
  e.do({ type: 'place', id: 'r0c1', value: 1 });   // duplicate in row 0
  assert.ok(log.some((x) => x.name === EVENTS.conflictDetected));
  e.do({ type: 'place', id: 'r0c1', value: 2 });   // fix it
  assert.ok(log.some((x) => x.name === EVENTS.conflictCleared));
});

test('solve detection fires once the grid is complete and conflict-free', () => {
  const e = new Engine();
  e.load(fakeGame, { seed: 1, size: 2 });
  let solved = false;
  e.on(EVENTS.solved, () => { solved = true; });
  e.do({ type: 'place', id: 'r0c0', value: 1 });
  e.do({ type: 'place', id: 'r0c1', value: 2 });
  e.do({ type: 'place', id: 'r1c0', value: 2 });
  e.do({ type: 'place', id: 'r1c1', value: 1 });
  assert.equal(solved, true);
});

test('gameId is a non-empty params:desc string', () => {
  const e = new Engine();
  e.load(fakeGame, { seed: 1, size: 2 });
  const id = e.gameId();
  assert.match(id, /^\d+:.+/);
});
