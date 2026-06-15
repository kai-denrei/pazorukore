# Attribution

## Simon Tatham's Portable Puzzle Collection

PazoruKore is **architecturally indebted** to
[Simon Tatham's Portable Puzzle Collection](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/)
(MIT licensed).

We are **not** porting his C code. Every line of JavaScript here is original. What we borrowed
is *structural*, openly and gratefully:

- **Four-way state separation** — splitting runtime state into params / play / UI / draw, decided
  by the rule *"would the player expect this restored on undo?"*
- **Universal undo as an append-only list of immutable play states** — undo/redo is just an index.
- **The `interpret_move` / `execute_move` split** — input produces a move *descriptor*; a pure
  function applies it to a state, returning a new state.
- **Game-ID serialization** — params + a specific-instance description, for share-by-link and fully
  reproducible generation from a seed.
- **Self-solving back ends** — each game can solve itself; the generator uses the solver to guarantee
  a unique solution, and the same solver powers hints.
- **Redraw by diffing** — compare the previous render state to the next and touch only changed cells.

In his collection, our two v1 games already exist as **Solo** (≈ Sudoku) and **Rectangles** / `rect`
(≈ Shikaku). **Filling** (≈ Fillomino) and **Palisade** are obvious future candidates.

What PazoruKore adds on top is the **skin/aesthetic dimension** (real display-device renderers,
themed regions, transition vocabularies), **mobile-first touch**, **semantic events → skin
transitions**, and **capability negotiation** between games and skins — none of which exist in the
original, whose rendering is intentionally utilitarian.

A visible "Inspired by Simon Tatham's Portable Puzzle Collection" line appears in the app's About panel.

## dexipurei-galore (display renderers)

The display-device renderers (16-segment starburst, Lixie tube, split-flap) are adapted from the
**dexipurei-galore** standalone display library. They are vendored under `src/display/` and wrapped
by thin adapters under `src/skins/*/`; the original render code is reused, not forked.
