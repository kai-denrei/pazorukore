# Masyu / Pearl — Futuristic rendering spec

Build-ready design for the upcoming Masyu (Tatham's "Pearl") game. Produced and adversarially
verified against the real renderers (2026-06-16). **Spec only — no code shipped yet.**

## Look (owner's direction)

Reuse the existing Futuristic grid (the neon segment idiom), but **no digit glyphs**. At each
grid cell holding a pearl, draw a small **square built from segment strokes**:

- **White pearl** = a *hollow* square: four white segment-stroke edges, empty centre.
- **Black pearl** = a *solid* square: four teal segment-stroke edges + translucent teal fill +
  a pulsing glowing centre dot.

The single closed loop is drawn as neon lines through **cell centres** (a grid-layer overlay,
mirroring how bridges are drawn).

## Data model

- **Pearls** are `given` clue cells, exactly like Bridges islands (`games/bridges/index.js`
  `gridFromLayout`): `role = ROLES.clue`, `value = 'B' | 'W'` (string — `grid.js` coerces and
  asserts string-or-null), `regionId = null` (Masyu has no regions). `encodeDesc`/`decodeDesc`
  mirror Bridges: one char per cell (`B`/`W`/`.`), rows joined by `/`.
- **Loop segments** live in playState as a new `loop` field — a plain object keyed by the
  canonical sorted edge key `` `${idLo}|${idHi}` `` over two orthogonally-adjacent cells (reuse
  Bridges' `edgeKey`). **Binary**, not counted: present → `1`, absent → key omitted. Keep it a
  distinct field from `bridges` so the board's bridge hook/`_bridgeSums` don't collide.

## Rendering recipe

New module `src/skins/futuristic/region-masyu.js`, factory `makeRegionMasyu(palette)`, built from
the same primitives as `region-neon.js`. `segBarPath` / `drawSeg` are module-private there
(~30 lines, no external deps) → **copy them** into the new module, or factor both into a shared
`futuristic/_segbar.js` imported by both. Reuse `GRID_PARAMS`, `glowAt(t)`, `vary(idx)` unchanged
so pearls pulse in lockstep with the grid; set the renderer `animated: true` so `board.js`'s
grid-pulse drives it.

Square geometry per pearl cell `id`: box `b = geom.boxes.get(id)`, centre `(cx,cy)`, half-extent
`s = b.w * 0.22`, thickness `th = max(1.5, b.w * p.thickness/100)` (same formula as the region
membrane), corner inset `ri = th`.

- **White**: four `drawSeg(...)` edge strokes (top/bottom/left/right, inset by `ri` at corners —
  same four-edge pattern as `region-neon.js`) with `col = '#fff'`, `on = true`. Hollow centre.
- **Black**: Pass A — the same four strokes with `col = palette.accent` (teal `#00e5d0`). Pass B —
  translucent fill `ctx.fillRect(x0,y0,…)` at alpha ~0.18, then a glowing centre dot copied from
  the starburst16 decimal-point idiom (arc glow + white core; `shadowBlur = glow`, reset
  `shadowBlur`/`globalAlpha` after).

## Loop rendering

Reuse `_bridge.js`'s `lineSeg` neon-line body (glow stroke + solid + optional white core). Build a
fresh `makeLoopRenderer(palette, opts)` — **do not reuse the `skin.bridge` slot** (see blocker #3).
Per loop edge: take both cells' centres and `lineSeg(ctx, ax, ay, bx, by, lw, palette.line, glow,
core)` full centre-to-centre (no `ringR` trim). `lineCap='round'` makes adjacent segments join into
a continuous loop. Draw the loop layer *under* the pearl squares.

## Interaction — `loop-draw`

Game meta `interaction: 'loop-draw'`, modelled on `bridge-draw` but a **binary toggle**:
- Drag from cell A to an orthogonally-adjacent cell B → move `{ type:'loop', a, b }`.
- `validateMove`: reject `a===b`, missing cell, or non-adjacent (Manhattan distance ≠ 1). Pearls
  are passable (loop runs *through* them).
- `applyMove`: pure; toggle `cur ? delete : set 1`; no-op returns the SAME reference (Bridges
  contract). Lay-vs-lift decided by the first edge's state, applied consistently along the drag.
- `eventsFor`: edge added → `cellPlaced`, removed → `cellCleared`, both endpoint ids in
  `payload.cells` so the board repaints.
- **Reuse the hardened pointer-drag scaffolding** from `bridge-draw.js` (pointerId tracking,
  ignore secondary pointerdowns, `pointercancel` teardown) — see the dev-role lesson from the
  Bridges-UI review.
- `isSolved` does the Masyu logic (single closed loop; white = straight-through + a turn on a
  neighbour; black = turn here + straight through both neighbours). Out of scope for rendering.

## Integration

Add to the futuristic skin export: `region: makeRegionMasyu(REGION)`, a `loop` renderer slot, and
palette `LOOP = { line:'#1bf0c8', core:0.45 }`. In `board.js` `repaintGrid`, add a `loop` paint
hook right after the bridges block, and extend the `moved` `'do'` repaint condition to also fire
when `engine.current().loop` exists.

## ⚠ Fix these BEFORE implementing (from adversarial verification)

The spec is feasible — every named symbol exists with the cited signature — but three real
blockers must be handled, or the build silently renders wrong:

1. **Gridline branch (`region-neon.js`).** The on/off "ghost lattice" is gated by
   `shikaku = geom.game === 'shikaku' || geom.game === 'bridges'`. A new game id `'masyu'` falls
   into the ELSE branch and draws **fully-lit** neon gridlines, not the dim ghost lattice the look
   needs. Fix: add `'masyu'` to that ternary, **or** have `makeRegionMasyu` render its own
   gridlines and not delegate.
2. **`renderPolicy(role)` signature.** It receives only the role string — no game id, no cell
   value — so a single futuristic skin **cannot** route pearl clues to `'plain'` (no glyph) while
   keeping Shikaku/Bridges clues as `'device'`. Fix: a dedicated Masyu skin variant whose
   `renderPolicy` returns `'plain'` for `'clue'`, **or** change the signature to pass the cell/game.
   Without this, pearls get a digit glyph drawn over them.
3. **Don't reuse the bridge renderer.** `makeBridgeRenderer.paint` trims lines to `ringR` *and*
   draws island discs+rings over every `role==='clue'` cell — both wrong for Masyu (the discs would
   cover the pearls). Build `makeLoopRenderer` as new code: copy only the `lineSeg` body, full
   centre-to-centre, and **no** disc/ring loop.

Cosmetic: the centre-dot radius is `th * 0.6` in `starburst16.js` (the spec's `0.9` is a choice,
not the shipped value); and `starburst16.js` is a vendored module exporting only its default — the
dot recipe must be **copied** (~6 lines), not imported.
