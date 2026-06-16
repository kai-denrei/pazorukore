// tests/clock-format.test.mjs — pure MMSS formatters used by the timer.
// Run: node --test tests/clock-format.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countUp, countDown } from '../src/ui/clock-format.js';

test('countUp formats elapsed ms as zero-padded MMSS, capped at 99 minutes', () => {
  assert.equal(countUp(0), '0000');
  assert.equal(countUp(42_000), '0042');
  assert.equal(countUp(65_000), '0105');           // 1:05
  assert.equal(countUp(100 * 60_000), '9959');      // clamps minutes to 99
});

test('countDown shows remaining MMSS while positive, over=false', () => {
  assert.deepEqual(countDown(15_000), { mmss: '0015', over: false });
  assert.deepEqual(countDown(8_400), { mmss: '0008', over: false });  // floor seconds
});

test('countDown at/under zero shows |remaining| and over=true', () => {
  assert.deepEqual(countDown(0), { mmss: '0000', over: true });
  assert.deepEqual(countDown(-5_000), { mmss: '0005', over: true });
  assert.deepEqual(countDown(-65_000), { mmss: '0105', over: true });
});
