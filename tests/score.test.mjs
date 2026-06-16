// tests/score.test.mjs — ScoreKeeper, both the staged (clock-budget) and legacy paths.
// Run: node --test tests/score.test.mjs
// ScoreKeeper persists "best" to localStorage; under node localStorage is undefined and the class
// guards with try/catch, so each `new ScoreKeeper()` starts from defaults — tests are isolated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScoreKeeper, SCORE } from '../src/ui/score.js';

test('staged: positive clock is a perfect solve with a clock bonus', () => {
  const sk = new ScoreKeeper();
  const r = sk.record(5, false, { budget: 15 });      // timeLeft = 10
  assert.equal(r.perfect, true);
  assert.equal(r.streak, 1);
  assert.equal(r.points, SCORE.base + 10 * SCORE.clockPts);  // 100 + 500 = 600
  assert.equal(r.overBy, 0);
});

test('staged: consecutive perfects build the combo multiplier', () => {
  const sk = new ScoreKeeper();
  sk.record(5, false, { budget: 15 });                // streak 1, mult 1.0
  const r = sk.record(3, false, { budget: 15 });      // timeLeft 12, streak 2, mult 1.5
  assert.equal(r.streak, 2);
  assert.equal(r.mult, 1.5);
  assert.equal(r.points, Math.round((SCORE.base + 12 * SCORE.clockPts) * 1.5));  // round(700*1.5)=1050
});

test('staged: solving exactly at 0 is base points, not perfect', () => {
  const sk = new ScoreKeeper();
  const r = sk.record(15, false, { budget: 15 });     // timeLeft = 0
  assert.equal(r.perfect, false);
  assert.equal(r.points, SCORE.base);                 // 100
  assert.equal(r.streak, 0);
});

test('staged: over budget floors points at 0 and reports overBy', () => {
  const sk = new ScoreKeeper();
  const r = sk.record(20, false, { budget: 15 });     // timeLeft = -5, clamped clock = -2 → raw 0
  assert.equal(r.points, 0);
  assert.equal(r.perfect, false);
  assert.equal(r.overBy, 5);
});

test('staged: undo blocks perfect but the clock bonus still counts', () => {
  const sk = new ScoreKeeper();
  const r = sk.record(5, true, { budget: 15 });       // timeLeft 10, undo used
  assert.equal(r.perfect, false);
  assert.equal(r.mult, 1);
  assert.equal(r.points, SCORE.base + 10 * SCORE.clockPts);  // 600 — clock bonus intact
});

test('legacy: no budget keeps the original speed/fast formula', () => {
  const sk = new ScoreKeeper();
  const r = sk.record(10, false);                     // t=10 < fastUnder(15)
  const speed = Math.round((SCORE.speedCap - 10) / SCORE.speedCap * SCORE.speedMax);  // 583
  assert.equal(r.points, SCORE.base + speed + SCORE.fastBonus);  // 100 + 583 + 250 = 933
  assert.equal(r.perfect, true);
  assert.equal(r.overBy, 0);
});
