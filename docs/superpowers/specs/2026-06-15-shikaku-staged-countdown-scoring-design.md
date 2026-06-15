# Shikaku Staged-Countdown Scoring — Design

Date: 2026-06-15
Status: approved (pending written-spec review)
Scope: Shikaku game only. Sudoku and Bridges are unchanged.

## Problem

Shikaku currently shares the generic run/score system: a count-**up** elapsed
timer, a flat "sub-15s + no undo = perfect" rule, and a manually-chosen
difficulty (easy/medium/hard) that stays fixed for a whole 10-game run. The
generator's `easy`/`medium`/`hard` presets are also semantically inverted from
the intended feel (today easy = many small rectangles, hard = few big ones).

We want Shikaku to play as a **staged speed challenge**: each 10-game run ramps
through easy → medium → hard, each stage gives a per-stage countdown budget, and
the clock value at the moment of solving is the score modifier.

## Goals

- Auto-ramp difficulty across the 10-game run (no manual toggle for Shikaku).
- Per-stage countdown timer that goes negative after the budget expires.
- Score = base + clock-as-modifier, with the per-game contribution floored at 0.
- Keep the combo/streak ladder, flawless-run bonus, and 10-game run intact.
- Invert + retune the generator presets to match the intended stage shapes.
- **Zero behavior change for Sudoku and Bridges.**

## Non-goals

- No auto-advance to the next puzzle on solve (player still presses **New**).
- No new difficulty modes beyond easy/medium/hard.
- No exact area-distribution guarantees — preset bands are a tendency (chosen
  approach), refined by eyeballing generated output.

## The stage model

Difficulty is derived from the **upcoming** game-in-run index `n` (1..10), which
`updateUpcomingRun()` already computes as `fresh ? 1 : gameInRun + 1`.

| Games in run | Stage   | Countdown |
|--------------|---------|-----------|
| 1–3          | easy    | 15s       |
| 4–7          | medium  | 20s       |
| 8–10         | hard    | 25s       |

`curveForGame(n)` returns the stage string for game `n`. The Shikaku Settings
sheet replaces the difficulty buttons with a read-only stage-curve readout.
Sudoku/Bridges keep the manual difficulty buttons.

## Isolation mechanism (keeps Sudoku/Bridges intact)

A game opts into the staged-countdown system by declaring a new optional
descriptor on its module:

```js
// shikaku.meta.stages (only Shikaku declares this)
stages: {
  time: { easy: 15, medium: 20, hard: 25 },   // countdown budget, seconds
  curveForGame(n) { /* 1..3 easy, 4..7 medium, 8..10 hard */ },
}
```

- If `game.meta.stages` is present → app drives countdown + auto-difficulty +
  clock scoring.
- If absent → app keeps today's count-up timer, manual difficulty, and the
  existing speed/fast scoring. Sudoku and Bridges do not declare `stages`, so
  they are untouched.

The branch lives in exactly two gated places: the app timer functions and
`ScoreKeeper.record()`.

## Countdown timer

`src/ui/timer-display.js` and the timer loop in `src/ui/app.js`:

- App tracks `budgetMs` for the mounted game (from `stages.time[difficulty]`,
  or `null` for non-staged games → count-up as today).
- Staged games render `remaining = budget − elapsed`:
  - `remaining > 0`: normal red, counting down.
  - `remaining <= 0`: **alarm red** + a drawn minus sign; the interval keeps
    ticking into negative until solve.
  - solved: green (as today).
- Display shows `|remaining|` as MMSS (existing 16-segment renderer). The minus
  sign is drawn the same way the colon dots already are (the starburst16 font
  has no `-` glyph).
- Non-staged games are unchanged: count-up MMSS, red→green on solve.

## Scoring (`src/ui/score.js`)

`record()` signature changes to `record(elapsedSeconds, budgetSeconds, undoUsed)`.
For non-staged games app passes the existing flat threshold as the budget
(`SCORE.fastUnder`, i.e. 15) **and uses the legacy raw formula** — see below.

Staged (Shikaku) formula:

```
timeLeft = budget − elapsed                      // seconds, may be negative
clock    = clamp(timeLeft, -base/CLOCK_PTS, +Inf) // so raw floors at 0 pre-mult
raw      = base + clock × CLOCK_PTS                // base = 100, CLOCK_PTS = 50
perfect  = timeLeft > 0 && !undoUsed
mult     = perfect ? 1 + SCORE.comboStep × (streak − 1) : 1
points   = max(0, round(raw × mult))               // per-game floor at 0
```

- `CLOCK_PTS = 50` per second. Easy instant solve ≈ +750 clock, comparable to
  today's `speedMax = 700`.
- **Per-game floor at 0**: a slow/negative solve contributes 0 to the run total,
  never decreases the visible big number. Because `clock` is clamped at
  `−base/CLOCK_PTS` (= −2s), the most a single game can lose is its whole base —
  it bottoms out at 0 points, never below. The per-solve label keeps the existing
  `+points` format (`+975 ·×1.5` when perfect, `+0` when over budget); an
  over-budget solve additionally shows a small `OVER −Ns` hint so the miss is
  legible without the run total dropping.
- `perfect = timeLeft > 0 && !undoUsed` — per-stage replacement for the old flat
  `t < fastUnder && !undoUsed`. Combo streak, callout ladder (PĀFEKUTO →
  DABURU → …), flawless-run bonus, run-of-10, and best-score persistence are
  **unchanged**.

Legacy (non-staged) path keeps today's exact behavior:
`speed`/`fast`/`raw = base + speed + fast`, `perfect = t < fastUnder && !undoUsed`.
This preserves Sudoku/Bridges scoring bit-for-bit.

### HUD

`updateScoreHUD()` keeps the existing `+points` text in `#score-lbl`, adding the
`OVER −Ns` hint for over-budget solves. `#run-prog` (`n/10`) and `#run-best` are
unchanged. The run total holds on a floored solve.

## Generator presets (`src/games/shikaku/generator.js`)

Invert and retune `PRESETS` so difficulty matches the intended shape. Today's
comment ("smaller maxArea ⇒ easier") is reversed by this change.

| Stage  | Board | minArea | maxArea band | Intended result               |
|--------|-------|---------|--------------|-------------------------------|
| easy   | 6×6   | 5       | 8–12         | one big (≈12) + a few 6s, few regions, fast |
| medium | 8×8   | 2       | 5–9          | mixed sizes                   |
| hard   | 9×9   | 2       | 3–4          | lots of 2/3/4, many regions   |

- `presetFor()` continues to let an explicit `params.size` override, but app no
  longer passes a fixed size for Shikaku — the preset's per-stage size wins.
  `shikaku.defaultParams()` drops the hard-coded `size: 7` (or sets it `null`).
- The per-puzzle `maxArea ∈ [maxAreaLo, maxAreaHi]` randomization is retained for
  board-to-board variety.
- Bands are a starting point; verify with the generator tests + ad-hoc area
  histograms and refine before finalizing. The uniqueness machinery
  (`countSolutions`, retry budget, `knownGood` fallback) is untouched.
- Risk: hard 9×9 with areas 2–4 yields ~20–30 regions; confirm the generator
  still converges to a unique layout within the existing 400-attempt / 600ms
  budget. If not, nudge the band (e.g. allow some 5s) or the budget.

## Wiring (`src/ui/app.js`)

- On `mountGame`, compute the upcoming game number `n` and, if
  `game.meta.stages` exists, derive `difficulty = stages.curveForGame(n)` and set
  `params.difficulty`; record `budgetMs = stages.time[difficulty] × 1000`.
- `startTimer()`/`renderTimer()` branch on `budgetMs != null` for countdown vs
  count-up.
- `onSolved()` calls `record(elapsedSeconds, budgetSeconds, undoUsed)` where
  `budgetSeconds = budgetMs/1000` for staged games, or `SCORE.fastUnder` for
  legacy games.
- Shikaku Settings sheet: swap difficulty buttons for the stage-curve readout.

## Testing

- Generator: extend existing Shikaku generator tests to assert per-stage board
  size and that the area distribution trends to the intended shape (e.g. easy
  has a max area ≥ ~10 and few regions; hard's areas are mostly ≤ 4 with many
  regions). Confirm uniqueness still holds for all three stages.
- Scoring: unit-test `record()` for staged inputs — positive clock (bonus +
  perfect + combo), zero clock (base), negative clock (floored at 0, combo
  reset), and confirm the legacy path is unchanged for a no-budget call.
- Manual: play a full run; verify the 1–3 / 4–7 / 8–10 ramp, the countdown going
  red→alarm→green, and the run total never decreasing.

## Files touched

- `src/games/shikaku/index.js` — add `meta.stages`; drop fixed default size.
- `src/games/shikaku/generator.js` — invert/retune `PRESETS`.
- `src/ui/score.js` — staged clock formula + legacy branch; new `record()` sig.
- `src/ui/timer-display.js` — minus sign + alarm color for negative.
- `src/ui/app.js` — budget plumbing, countdown render branch, Settings readout.
- tests — generator + scoring coverage.
