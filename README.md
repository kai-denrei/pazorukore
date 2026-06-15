# PazoruKore — パズルコア

A small, **skinnable engine for grid-deduction puzzles**. The defining bet: *any skin × any game
just works*. Three independent axes — **game** (Sudoku, Shikaku), **skin** (Futuristic 16-segment,
Retro Lixie tube, Pastel split-flap), and **interaction** (digit-entry, region-draw) — meet through
a capability negotiation. Vanilla ES modules, **no build step, no bundler, no framework**,
mobile-first.

Architecturally indebted to [Simon Tatham's Portable Puzzle Collection](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/)
(four-bucket state, universal undo, interpret/execute split, self-solving back ends, redraw-by-diff).
See `ATTRIBUTION.md`.

## Run it

```sh
python3 scripts/serve.py 8173      # dev server: correct ES-module MIME + no-store (always fresh)
# then open http://127.0.0.1:8173/
```

Any static file server works (`python3 -m http.server` is fine); `serve.py` just adds no-cache so
edited modules never go stale in dev. Zero install, zero build.

### URL switches
- `?game=sudoku|shikaku` · `?skin=futuristic|retro|pastel` — pick a pairing directly.
- `?admin` (or the **+** button) — open the live tuning panel: every display-renderer variable
  (color, glow, bar width, flip speed…) as a slider, grouped, with **copy params** to capture a
  tuned look as new defaults.
- `?sheet=about|settings` — open a panel on load.

## Test

```sh
node --test tests/*.test.mjs       # engine + sudoku + shikaku (uniqueness, purity, round-trips)
```

## Cache-busting / versioning

```sh
./scripts/bust.sh                  # bump the build token everywhere (asset ?v=, <meta cb>, the 3-glyph badge)
```

The three small glyphs top-left (next to the パ logo) are the build indicator — derived from the
token, they change shape+color on each bump so you can eyeball whether a fresh build reached the
browser. See the cache-busting toolkit under `scripts/` and `public/` (if present).

## Layout

```
index.html  manifest.json  styles.css
src/
  core/     engine, grid, events, capabilities, rng        (the mid-end + state model)
  games/    sudoku/* shikaku/*                              (pure logic: generate, solve, validate, serialize)
  interaction/ digit-entry.js  region-draw.js              (input → move descriptors)
  display/  core.js  displays/*                             (vendored dexipurei renderers)
  skins/    _contract.js  futuristic/* retro/* pastel/*     (glyph adapters + region + palette + transitions)
  ui/       app.js board.js controls.js admin.js version-badge.js
```

MIT licensed (`LICENSE`).
