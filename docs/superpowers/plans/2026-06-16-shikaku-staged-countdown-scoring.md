# Shikaku Staged-Countdown Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Shikaku into a staged speed challenge — the 10-game run auto-ramps easy(15s)/medium(20s)/hard(25s), the timer counts down into the negative, and the clock value at solve is the score modifier (per-game floored at 0) — without changing Sudoku or Bridges.

**Architecture:** Shikaku opts into the new behavior by declaring a `meta.stages` descriptor (`{ time, curveForGame }`). App reads it to (a) pick the stage from the upcoming run position, (b) run a countdown timer, and (c) pass a `budget` to scoring. `ScoreKeeper.record()` gains a staged clock formula gated on an optional `budget`; games without a budget keep today's speed/fast formula bit-for-bit. The generator presets are inverted/retuned so easy = few big rectangles, hard = many small ones. Pure logic (stage curve, score math, clock formatting) is unit-tested; canvas/DOM glue is manually verified.

**Tech Stack:** Vanilla ES modules, no build step. Tests via the Node built-in test runner (`node --test tests/*.test.mjs`), `node:assert/strict`. Spec: `docs/superpowers/specs/2026-06-15-shikaku-staged-countdown-scoring-design.md`.

---

## File Structure

- `src/games/shikaku/index.js` — **modify**: add `meta.stages` (time table + `curveForGame`); drop the hard-coded default `size`.
- `src/games/shikaku/generator.js` — **modify**: invert/retune `PRESETS`; update the stale "smaller = easier" comment.
- `src/ui/score.js` — **modify**: add `clockPts` to `SCORE`; `record()` gains an optional `opts.budget` staged path; legacy path unchanged.
- `src/ui/clock-format.js` — **create**: pure `countUp(ms)` / `countDown(ms)` formatters (testable, no DOM).
- `src/ui/timer-display.js` — **modify**: `render(mmss, solved, over)` — draw a minus sign + alarm color when `over`.
- `src/ui/app.js` — **modify**: budget plumbing, countdown render branch, `record(..., { budget })`, HUD `OVER −Ns` hint, Shikaku Settings stage-curve readout.
- `tests/shikaku.test.mjs` — **modify**: add stage-curve + preset-shape tests.
- `tests/score.test.mjs` — **create**: staged + legacy scoring tests.
- `tests/clock-format.test.mjs` — **create**: formatter tests.

---

## Task 1: Shikaku stage descriptor + curve

**Files:**
- Modify: `src/games/shikaku/index.js` (the `meta` block ~lines 76-82, and `defaultParams` ~line 84-86)
- Test: `tests/shikaku.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/shikaku.test.mjs`:

```javascript
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
  // out-of-range upper values clamp to hard (defensive)
  assert.equal(curve(11), 'hard');
  assert.equal(curve(0), 'easy');
});

test('defaultParams no longer pins size (preset size wins)', () => {
  assert.equal(shikaku.defaultParams().size, undefined);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Dev/pazorukore && node --test tests/shikaku.test.mjs`
Expected: FAIL — `Cannot read properties of undefined (reading 'time')` (no `meta.stages`) and the `defaultParams` size assertion fails (currently `7`).

- [ ] **Step 3: Add `meta.stages` and trim `defaultParams`**

In `src/games/shikaku/index.js`, change the `meta` block to add `stages`:

```javascript
  meta: {
    id: 'shikaku',
    name: 'Shikaku',
    interaction: 'region-draw',
    requirements: { glyphSet: 'digits', needsOffState: false, needsRegionFill: true },
    // Staged-countdown opt-in (see docs/superpowers/specs/2026-06-15-...). Only games that
    // declare `stages` get the auto-ramp + countdown timer + clock scoring; others keep the
    // legacy count-up timer and manual difficulty.
    stages: {
      time: { easy: 15, medium: 20, hard: 25 },   // countdown budget per stage, seconds
      // Map the upcoming game-in-run index n (1..10) to a difficulty.
      curveForGame(n) {
        if (n <= 3) return 'easy';
        if (n <= 7) return 'medium';
        return 'hard';
      },
    },
  },
```

Change `defaultParams` to drop the fixed size so the per-stage preset size applies:

```javascript
  defaultParams() {
    return { seed: 1, difficulty: 'easy' };
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Dev/pazorukore && node --test tests/shikaku.test.mjs`
Expected: PASS (all tests, including the pre-existing ones — they pass `size` explicitly so they are unaffected).

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/pazorukore
git add src/games/shikaku/index.js tests/shikaku.test.mjs
git commit -m "Shikaku: add meta.stages curve + drop fixed default size"
```

---

## Task 2: Invert and retune the generator presets

**Files:**
- Modify: `src/games/shikaku/generator.js` (`PRESETS` ~lines 75-84 and its comment)
- Test: `tests/shikaku.test.mjs`

Today `PRESETS` makes easy = small grid + small areas and hard = big grid + big areas — the reverse of the intended feel. Because the guillotine tiling never keeps a piece larger than `maxArea` (a too-big piece always splits), the per-stage `maxArea` cap is a hard upper bound on every region's area — we lean on that for robust, non-flaky assertions.

- [ ] **Step 1: Write the failing tests**

Append to `tests/shikaku.test.mjs` (the helper `clueCount`/`totalClueArea` already exist in this file; reuse them):

```javascript
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

test('easy puzzles are few large rectangles (areas can reach ≥ 10, few regions)', () => {
  let sawBig = false;
  for (const seed of [1, 2, 7, 42, 99]) {
    const { playState } = shikaku.newPuzzle({ seed, difficulty: 'easy' });
    assert.ok(maxClueArea(playState) <= 12, `easy/${seed}: max area ${maxClueArea(playState)} should be ≤ 12`);
    assert.ok(clueCount(playState) <= 12, `easy/${seed}: expected few regions, got ${clueCount(playState)}`);
    if (maxClueArea(playState) >= 10) sawBig = true;
  }
  assert.ok(sawBig, 'at least one easy board has a large (≥10) rectangle across the sampled seeds');
});

test('easy has fewer regions than hard on the same seed', () => {
  for (const seed of [1, 7, 42]) {
    const easy = clueCount(shikaku.newPuzzle({ seed, difficulty: 'easy' }).playState);
    const hard = clueCount(shikaku.newPuzzle({ seed, difficulty: 'hard' }).playState);
    assert.ok(easy < hard, `seed ${seed}: easy ${easy} should be < hard ${hard}`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Dev/pazorukore && node --test tests/shikaku.test.mjs`
Expected: FAIL — current presets give easy size 8 / hard size 11, and hard areas exceed 4.

- [ ] **Step 3: Rewrite `PRESETS` (invert + retune)**

In `src/games/shikaku/generator.js`, replace the `PRESETS` object and the comment directly above it:

```javascript
// Difficulty presets → grid size + size band for the random tiling. NOTE (staged-countdown rework):
// difficulty now reads "fewer, larger rectangles = easier; many small rectangles = harder", the
// REVERSE of the original engine default. easy = a few big anchors (fast to scan); hard = lots of
// 2/3/4s (many deductions). Because a piece larger than maxArea always splits, maxAreaHi is a hard
// upper bound on every region's area.
// Each preset gives a grid size + a RANGE for the per-puzzle maximum rectangle area. generate()
// picks a random maxArea in [maxAreaLo, maxAreaHi] per puzzle (seeded), so size/number of anchors
// varies board to board within the stage's character.
export const PRESETS = {
  easy: { size: 6, minArea: 5, maxAreaLo: 8, maxAreaHi: 12 },
  medium: { size: 8, minArea: 2, maxAreaLo: 5, maxAreaHi: 9 },
  hard: { size: 9, minArea: 2, maxAreaLo: 3, maxAreaHi: 4 },
};
```

- [ ] **Step 4: Run the full suite to verify pass + uniqueness still holds**

Run: `cd ~/Dev/pazorukore && node --test tests/*.test.mjs`
Expected: PASS — the new shape tests pass AND the pre-existing uniqueness tests (`medium and hard presets also generate unique puzzles`, the independent-counter test) still pass. If the hard preset ever fails uniqueness or times out, widen the band slightly (`maxAreaHi: 5`) and re-run; record the change in the commit message.

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/pazorukore
git add src/games/shikaku/generator.js tests/shikaku.test.mjs
git commit -m "Shikaku: invert/retune generator presets (easy=big, hard=small)"
```

---

## Task 3: Staged clock scoring in ScoreKeeper

**Files:**
- Modify: `src/ui/score.js` (`SCORE` const ~lines 6-16; `record()` ~lines 45-84)
- Test: `tests/score.test.mjs` (create)

`record()` gains an optional third arg `opts`. When `opts.budget` is a number (staged games), it uses the clock formula; otherwise it runs the existing speed/fast formula unchanged. Legacy call sites (`record(secs, undoUsed)`) keep working untouched.

- [ ] **Step 1: Write the failing tests**

Create `tests/score.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Dev/pazorukore && node --test tests/score.test.mjs`
Expected: FAIL — `record()` ignores the 3rd arg today, so the staged assertions are wrong and `r.overBy` is `undefined`.

- [ ] **Step 3: Add `clockPts` to `SCORE` and branch `record()`**

In `src/ui/score.js`, add `clockPts` to the `SCORE` config object:

```javascript
export const SCORE = {
  base: 100,
  speedCap: 60,     // seconds beyond which the speed bonus is 0 (legacy path)
  speedMax: 700,    // speed points at an instant solve (legacy path)
  fastUnder: 15,    // the "under 15 seconds" threshold (legacy path)
  fastBonus: 250,
  clockPts: 50,     // staged path: score points per second of clock remaining/over
  comboStep: 0.5,   // multiplier gained per consecutive perfect (1.0, 1.5, 2.0, …)
  flawlessBonus: 5000,
  perfectRunStep: 250,
  runLen: 10,
};
```

Replace the body of `record()` from its start through the `const raw`/`const perfect` lines so both paths are computed, then keep the rest identical. The full new `record()`:

```javascript
  // record a solved game. Legacy signature record(seconds, undoUsed) keeps the speed/fast formula.
  // Staged signature record(seconds, undoUsed, { budget }) uses the countdown clock as the modifier.
  record(seconds, undoUsed, opts = {}) {
    if (this.gameInRun >= SCORE.runLen) this._newRun();   // previous run finished → fresh run

    const t = Math.max(0, seconds);
    const staged = typeof opts.budget === 'number';

    let raw, perfect, overBy = 0, parts;
    if (staged) {
      const timeLeft = opts.budget - t;                   // may be negative
      const clock = Math.max(timeLeft, -SCORE.base / SCORE.clockPts); // clamp so raw floors at 0
      raw = SCORE.base + clock * SCORE.clockPts;          // ≥ 0
      perfect = timeLeft > 0 && !undoUsed;
      overBy = Math.max(0, -timeLeft);
      parts = { base: SCORE.base, clock: Math.round(clock * SCORE.clockPts) };
    } else {
      const speed = Math.round(Math.max(0, SCORE.speedCap - t) / SCORE.speedCap * SCORE.speedMax);
      const fast = t < SCORE.fastUnder ? SCORE.fastBonus : 0;
      raw = SCORE.base + speed + fast;
      perfect = t < SCORE.fastUnder && !undoUsed;
      parts = { base: SCORE.base, speed, fast };
    }

    if (perfect) this.streak += 1; else this.streak = 0;
    const mult = perfect ? (1 + SCORE.comboStep * (this.streak - 1)) : 1;
    const points = Math.max(0, Math.round(raw * mult));

    this.gameInRun += 1;
    this.runTotal += points;
    if (perfect) this.perfectsInRun += 1;

    const runComplete = this.gameInRun >= SCORE.runLen;
    let flawless = false, runBonus = 0, summary = null;
    if (runComplete) {
      flawless = this.perfectsInRun >= SCORE.runLen;
      runBonus = flawless ? SCORE.flawlessBonus : this.perfectsInRun * SCORE.perfectRunStep;
      this.runTotal += runBonus;
      summary = { total: this.runTotal, perfects: this.perfectsInRun, flawless, bonus: runBonus, best: this.best.runScore || 0 };
    }

    if (this.streak > (this.best.streak || 0)) this.best.streak = this.streak;
    if (runComplete && this.runTotal > (this.best.runScore || 0)) this.best.runScore = this.runTotal;
    this._saveBest();

    const tier = perfect ? Math.min(this.streak, HYPE.length - 1) : 0;
    return {
      t, points, perfect, mult, streak: this.streak, overBy,
      runTotal: this.runTotal, gameInRun: this.gameInRun, perfectsInRun: this.perfectsInRun,
      tier, callout: perfect ? { tier, label: HYPE[tier].label } : null,
      overlay: (perfect && this.streak >= SCORE.runLen) || (runComplete && flawless),
      runComplete, flawless, runBonus, summary,
      parts,
    };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Dev/pazorukore && node --test tests/score.test.mjs`
Expected: PASS (all six tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/pazorukore
git add src/ui/score.js tests/score.test.mjs
git commit -m "Scoring: staged clock-budget path in ScoreKeeper.record (legacy unchanged)"
```

---

## Task 4: Pure clock formatters

**Files:**
- Create: `src/ui/clock-format.js`
- Test: `tests/clock-format.test.mjs` (create)

Extract the MMSS formatting (and the new countdown/over logic) into pure functions so it is testable without a canvas.

- [ ] **Step 1: Write the failing tests**

Create `tests/clock-format.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Dev/pazorukore && node --test tests/clock-format.test.mjs`
Expected: FAIL — `Cannot find module '.../src/ui/clock-format.js'`.

- [ ] **Step 3: Create the formatters**

Create `src/ui/clock-format.js`:

```javascript
// src/ui/clock-format.js — pure MMSS formatting for the timer display. No DOM/canvas, so it is
// unit-testable. countUp() is the legacy elapsed clock; countDown() drives the staged countdown
// (which keeps going past zero into the negative).

// Zero-padded MMSS for a whole number of seconds, minutes clamped to 99.
function mmssOf(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.min(99, Math.floor(s / 60));
  return `${String(m).padStart(2, '0')}${String(s % 60).padStart(2, '0')}`;
}

// Elapsed time → "MMSS".
export function countUp(elapsedMs) {
  return mmssOf(elapsedMs / 1000);
}

// Remaining time → { mmss, over }. `over` flips true once the budget is spent (remaining ≤ 0);
// mmss always shows the absolute value so the display reads the magnitude of the overrun.
export function countDown(remainingMs) {
  const over = remainingMs <= 0;
  return { mmss: mmssOf(Math.abs(remainingMs) / 1000), over };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Dev/pazorukore && node --test tests/clock-format.test.mjs`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/pazorukore
git add src/ui/clock-format.js tests/clock-format.test.mjs
git commit -m "Add pure clock-format util (countUp/countDown)"
```

---

## Task 5: Timer display — negative/over rendering

**Files:**
- Modify: `src/ui/timer-display.js` (`render()` ~lines 39-54)

Canvas drawing has no unit-test harness in this repo, so this task is verified manually in Task 7. The change adds an `over` parameter: when true, render in alarm color and draw a leading minus sign (the 16-segment font has no `-` glyph, so it is drawn manually, the same way the colon dots already are).

- [ ] **Step 1: Add the alarm color constant**

In `src/ui/timer-display.js`, add a constant next to `RUN`/`DONE`:

```javascript
const RUN = '#ff2a2a';     // running — old-school red
const DONE = '#37e0a0';    // solved — green
const OVER = '#ff8a1e';    // over budget — alarm amber
```

- [ ] **Step 2: Update `render()` to honor `over`**

Replace the `render()` method body with:

```javascript
  // mmss = 4 chars (zero-padded minutes + seconds), e.g. "0042" → renders 00:42.
  // over = the staged countdown has passed zero → alarm color + a drawn leading minus sign.
  render(mmss, solved, over) {
    if (!this.size()) return;
    const ctx = this.ctx, dpr = this.cv._dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = this.cv.width / dpr, h = this.cv.height / dpr;
    ctx.clearRect(0, 0, w, h);
    this.cv._transparent = true;
    const color = solved ? DONE : (over ? OVER : RUN);
    starburst16.render(ctx, { ...this.p, transparent: true, text: mmss, color }, 0, makeRng(this.p.seed));
    // colon: two dots at the horizontal centre (= the gap between the 2nd and 3rd digit of MMSS).
    const cx = w / 2, rad = Math.max(1.3, h * 0.05);
    ctx.save();
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = this.p.glow;
    for (const dy of [-h * 0.14, h * 0.14]) { ctx.beginPath(); ctx.arc(cx, h / 2 + dy, rad, 0, Math.PI * 2); ctx.fill(); }
    // minus sign for the over-budget (negative) countdown — a short bar to the left of the digits.
    if (over && !solved) {
      const barW = w * 0.05, barH = Math.max(2, h * 0.045), mx = w * 0.06, my = h / 2 - barH / 2;
      ctx.fillRect(mx, my, barW, barH);
    }
    ctx.restore();
  }
```

- [ ] **Step 3: Commit**

```bash
cd ~/Dev/pazorukore
git add src/ui/timer-display.js
git commit -m "TimerDisplay: alarm color + minus sign for over-budget countdown"
```

---

## Task 6: App wiring — budget, countdown, scoring opts, Settings readout

**Files:**
- Modify: `src/ui/app.js` (imports; `mountGame`; `startTimer`/`renderTimer`; `onSolved`; `updateScoreHUD`; `openSettings`)

DOM/canvas glue — verified manually in Task 7. Make these edits exactly.

- [ ] **Step 1: Import the formatters**

In `src/ui/app.js`, add to the imports near the top:

```javascript
import { countUp, countDown } from './clock-format.js';
```

- [ ] **Step 2: Derive the stage + budget in `mountGame`**

The game module is loaded by the existing `Promise.all([...])`, so read `game.meta.stages` after that resolves. Locate the line `if (!game || !skin || !Board) { showStatus(missing); return; }` and insert immediately AFTER it:

```javascript
  // Staged-countdown auto-ramp (Shikaku declares game.meta.stages). Apply to a FRESH puzzle only
  // (object/undefined params), never to an explicit shared game-ID string — that carries its own
  // encoded difficulty.
  const stages = game.meta && game.meta.stages;
  if (stages && (params == null || typeof params === 'object')) {
    const n = app.score ? (app.score.gameInRun >= 10 ? 1 : app.score.gameInRun + 1) : 1;
    params = { ...(params || game.defaultParams()), difficulty: stages.curveForGame(n) };
  }
```

Then, AFTER the `try { app.engine.load(...) } catch {...}` block, set the budget from the engine's resolved difficulty (this reuses the `stages` const declared just above):

```javascript
  // Countdown budget (ms) for staged games, from the difficulty the engine actually loaded
  // (covers both fresh ramps and explicit game-IDs); null → legacy count-up timer.
  const stageSecs = stages ? stages.time[app.engine.params.difficulty] : null;
  app.budgetMs = stageSecs ? stageSecs * 1000 : null;
```

- [ ] **Step 3: Branch the timer on the budget**

In `src/ui/app.js`, update the `_timer` initializer and the timer functions. Change the `_timer` literal to include `budgetMs`:

```javascript
let _timer = { start: 0, interval: 0, stopped: false, elapsed: 0, disp: null, budgetMs: null };
```

Replace `startTimer()` and `renderTimer()` with:

```javascript
function startTimer() {
  clearInterval(_timer.interval);
  _timer.start = performance.now(); _timer.stopped = false; _timer.elapsed = 0;
  _timer.budgetMs = app.budgetMs || null;
  renderTimer();
  _timer.interval = setInterval(renderTimer, 1000);
}
function stopTimer() {
  if (_timer.stopped) return;
  _timer.elapsed = performance.now() - _timer.start; _timer.stopped = true;
  clearInterval(_timer.interval);
  renderTimer();
}
function renderTimer() {
  const ms = _timer.stopped ? _timer.elapsed : (performance.now() - _timer.start);
  const d = timerDisp(); if (!d) return;
  if (_timer.budgetMs != null) {
    const { mmss, over } = countDown(_timer.budgetMs - ms);
    d.render(mmss, _timer.stopped, over);
  } else {
    d.render(countUp(ms), _timer.stopped, false);
  }
}
```

(Delete the OLD `stopTimer`/`renderTimer` definitions so they are not duplicated — `stopTimer` is unchanged in behavior but shown here for locality.)

- [ ] **Step 4: Pass the budget to scoring in `onSolved`**

Replace `onSolved()` with:

```javascript
function onSolved() {
  stopTimer();
  if (app.scored || !app.score) return;
  app.scored = true;
  const elapsedMs = _timer.stopped ? _timer.elapsed : (performance.now() - _timer.start);
  const secs = elapsedMs / 1000;
  const opts = _timer.budgetMs != null ? { budget: _timer.budgetMs / 1000 } : undefined;
  const r = app.score.record(secs, app.undoUsed, opts);
  updateScoreHUD(r);
  if (r.callout) showStreak(r.callout, r.tier);
  if (r.overlay) showPerfectOverlay(r);
}
```

- [ ] **Step 5: Show the OVER hint in the HUD**

In `updateScoreHUD(r)`, replace the `#score-lbl` line:

```javascript
  const lbl = document.getElementById('score-lbl');
  if (lbl) {
    lbl.textContent = r.perfect
      ? `+${r.points} ·×${r.mult.toFixed(1)}`
      : (r.overBy > 0 ? `+${r.points} · OVER −${Math.ceil(r.overBy)}s` : `+${r.points}`);
  }
```

- [ ] **Step 6: Replace Shikaku's difficulty buttons with a stage-curve readout**

In `openSettings()`, replace the difficulty section. Find the block that builds the `<h2>Settings</h2>` sheet and its `difficulty` row, and make the difficulty portion conditional:

```javascript
function openSettings() {
  const params = app.game ? app.game.defaultParams() : {};
  const diffs = ['easy', 'medium', 'hard'];
  const gid = (app.engine && app.game) ? app.engine.gameId() : '';
  const stages = app.game && app.game.meta && app.game.meta.stages;
  const diffSection = stages
    ? `<p class="muted">stage — auto-ramps across the 10-game run</p>
       <div class="stage-curve">
         <span>1–3 <b>easy</b> ${stages.time.easy}s</span>
         <span>4–7 <b>medium</b> ${stages.time.medium}s</span>
         <span>8–10 <b>hard</b> ${stages.time.hard}s</span>
       </div>`
    : `<p class="muted">difficulty — starts a new puzzle</p>
       <div class="pick-row">${diffs.map((d) => `<button class="pick" data-diff="${d}"${params.difficulty === d ? ' aria-pressed="true"' : ''}>${d}</button>`).join('')}</div>`;
  openSheet('settings', `
    <h2>Settings</h2>
    ${diffSection}
    <p class="muted">game ID — share or enter a puzzle</p>
    <div class="gid-row"><input id="gid-in" class="gid-input" value="${gid}" spellcheck="false" autocapitalize="off"><button class="pick" data-a="gid-copy">copy</button><button class="pick" data-a="gid-load">load</button></div>
    <p class="muted">accessibility</p>
    <div class="pick-row">
      <button class="pick" data-a="rm" aria-pressed="${document.body.classList.contains('force-reduced')}">reduce motion</button>
      <button class="pick" data-a="haptics" aria-pressed="${app.haptics !== false}">haptics</button>
    </div>`);
  const s = document.getElementById('settings');
  s.querySelectorAll('[data-diff]').forEach((b) => b.onclick = () => { s.hidden = true; newGameWith({ difficulty: b.dataset.diff }); });
  s.querySelector('[data-a="gid-copy"]').onclick = () => { const v = document.getElementById('gid-in').value; if (navigator.clipboard) navigator.clipboard.writeText(v); };
  s.querySelector('[data-a="gid-load"]').onclick = () => { const v = document.getElementById('gid-in').value.trim(); if (v) { s.hidden = true; mountGame(app.gameId, app.skinId, v); } };
  s.querySelector('[data-a="rm"]').onclick = (e) => { document.body.classList.toggle('force-reduced'); e.target.setAttribute('aria-pressed', String(document.body.classList.contains('force-reduced'))); };
  s.querySelector('[data-a="haptics"]').onclick = (e) => { app.haptics = app.haptics === false; e.target.setAttribute('aria-pressed', String(app.haptics !== false)); };
}
```

(`querySelectorAll('[data-diff]')` returns empty for the staged readout, so the difficulty handler is a harmless no-op there.)

- [ ] **Step 7: Commit**

```bash
cd ~/Dev/pazorukore
git add src/ui/app.js
git commit -m "App: stage budget plumbing, countdown timer, OVER hint, Shikaku stage readout"
```

---

## Task 7: Cache-bust, full suite, manual playthrough

**Files:**
- Modify: `index.html` etc. (via `scripts/bust.sh`)

- [ ] **Step 1: Run the full test suite**

Run: `cd ~/Dev/pazorukore && npm test`
Expected: PASS — `tests/shikaku.test.mjs`, `tests/score.test.mjs`, `tests/clock-format.test.mjs`, plus the untouched `sudoku`/`bridges`/`engine` suites.

- [ ] **Step 2: Manual playthrough (the part tests can't cover)**

Run: `cd ~/Dev/pazorukore && npm run serve` then open `http://localhost:8173/?game=shikaku`.
Verify:
1. Game 1 of the run is **easy** (6×6, a few big rectangles); timer starts at **00:15** and counts down.
2. Let the clock pass zero once: digits turn **amber** with a leading **minus sign** and keep counting.
3. Solve before zero → timer turns **green**, a `PĀFEKUTO!` callout fires, score label shows `+NNN ·×1.0`.
4. Solve after zero → score label shows `+0 · OVER −Ns`; the big run total does **not** decrease.
5. Press **New** several times: games 4–7 are **medium** (00:20), games 8–10 **hard** (9×9, many small clues, 00:25).
6. Open **Settings** on Shikaku → difficulty buttons are replaced by the stage-curve readout.
7. Open `http://localhost:8173/?game=sudoku` → timer still **counts up** from 00:00, Settings still shows difficulty buttons (legacy unchanged).

- [ ] **Step 3: Bump the cache-bust token**

Run: `cd ~/Dev/pazorukore && npm run bust`
Expected: prints a fresh token; `index.html` (and any fingerprinted assets) updated so the PWA rolls its cache.

- [ ] **Step 4: Commit**

```bash
cd ~/Dev/pazorukore
git add -A
git commit -m "Bump cache-bust token for staged-countdown Shikaku"
```

---

## Notes / risks

- **Hard-preset uniqueness:** 9×9 with areas 2–4 yields ~20–30 regions; the generator's 400-attempt / 600ms budget plus the `knownGood` fallback guarantee a unique layout is always returned, but if it falls back often the puzzles get boring. If the uniqueness test is flaky or slow, widen `hard.maxAreaHi` to 5 (Task 2, Step 4) and re-run.
- **Legacy isolation:** the only behavioral fork is `opts.budget` in `record()` and `budgetMs` in the timer. Sudoku/Bridges never set either, so their scoring and timer are unchanged — the legacy scoring test in Task 3 locks this.
- **Signature change:** `record()` now takes `(seconds, undoUsed, opts?)`. The spec wrote `record(elapsed, budget, undoUsed)`; this `opts`-based form is equivalent and keeps every legacy call site (`record(secs, undoUsed)`) working untouched — a deliberate, smaller-blast-radius deviation.
