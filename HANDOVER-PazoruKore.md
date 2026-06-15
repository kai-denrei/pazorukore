# PazoruKore — Handover

> Codename gloss: パズル + コア — "puzzle core." A small, skinnable engine for grid
> deduction puzzles, where the *look* (Nixie tubes, 16-segment displays, split-flap)
> is a first-class, swappable layer rather than an afterthought.

**Status:** greenfield. This document is the spec; no code exists yet.
**Target runtime:** Claude Code (CLI). Build the project incrementally, committing per milestone (§15).
**Discipline:** vanilla ES modules, **no build step**, **no bundler**, **no framework**. Runs by opening `index.html` (served over a static file server for ES module CORS; `python3 -m http.server` is fine for dev).
**Primary constraint:** **mobile-first**. Phone portrait is the design target; desktop is the graceful upscale, not the reverse.
**Output hygiene:** keep all generated files anonymous/generic. No personal names, no real infrastructure hostnames, no handles in committed code or docs.

---

## 1. Mission

Build a puzzle platform with **three independent axes**:

- **A — Game type** (the rules + generator + solver). v1: **Sudoku** and **Shikaku**.
- **B — Skin** (the entire look & feel: glyph rendering, region/border styling, palette, background, transition vocabulary). v1: **Futuristic**, **Retro**, **Pastel**.
- **C — Interaction model** (how input becomes moves). Binds to game type, *not* to skin. v1: **digit-entry** (Sudoku) and **region-draw** (Shikaku).

The defining bet: **any skin × any game just works**, mediated by a capability negotiation (§8.5). A skin is a costume the engine wears; the game logic never knows whether a cell is a Nixie tube or a split-flap card.

---

## 2. Provenance & licence (read first)

This project is **architecturally indebted to Simon Tatham's Portable Puzzle Collection**
(https://www.chiark.greenend.org.uk/~sgtatham/puzzles/, MIT licensed). We are **not** porting
his C code — we write fresh JavaScript — but we borrow his structural ideas openly.

In his collection, our two v1 games already exist: **Solo** (= Sudoku) and **Rectangles** /
`rect` (= Shikaku, "divide the grid into rectangles with areas equal to the numbers").
**Filling** (= Fillomino) and **Palisade** are the obvious v2 candidates.

### What we adopt from Tatham (proven, do not reinvent)

1. **Four-way state separation.** His back end splits state into four structures, and the
   decision rule is the gift: *"would the player expect this restored on undo?"* → it's play
   state; otherwise it's UI state. We map this onto §3.
2. **Universal undo as a state list.** The engine keeps an append-only list of immutable play
   states; undo/redo just moves an index. Free, robust, no per-game undo code.
3. **`interpret_move` / `execute_move` split.** Input handling produces a *move descriptor*;
   a pure function applies a move descriptor to a state, returning a new state. Decouples
   interaction from mutation and makes moves serializable/replayable.
4. **Game-ID serialization** (params + specific-instance description). Enables share-by-link,
   "enter a game ID", and fully reproducible generation from a seed.
5. **Self-solving back ends.** Each game can solve itself; the generator uses the solver to
   guarantee a unique solution, and the same solver powers hints.
6. **Redraw by diffing.** Compare previous render-state to next; only touch changed cells.
   This *is* our animation trigger — a diff that changes a cell fires a transition.

### What we deliberately improve / add (our differentiator)

- **The skin/aesthetic dimension.** Tatham's rendering is intentionally utilitarian. Ours is
  the whole point: real display-device renderers, themed regions, transition vocabularies.
- **Mobile-first touch.** His games are desktop-origin (mouse-and-keyboard), ported to phones
  by third parties. We design for the thumb from line one (§11).
- **Semantic events → skin transitions.** His `anim_length`/`flash_length` is minimal. We emit
  rich semantic events and let each skin own the animation (§8.4).
- **Capability negotiation** between games and skins (§8.5) — he has no skins, so this is new.

### Attribution requirements (must ship)

- `ATTRIBUTION.md` crediting Simon Tatham's Portable Puzzle Collection, linking the site, and
  stating we took architectural inspiration only and wrote original code.
- Our own `LICENSE` (recommend MIT, for compatibility and in the same spirit).
- A visible "Inspired by Simon Tatham's Portable Puzzle Collection" line in the app's About panel.

---

## 3. The state model (adopted from Tatham, four buckets)

Every game's runtime state divides into four, by the undo-rule above:

| Bucket | Holds | Undoable? | Examples |
|---|---|---|---|
| **params** | generation inputs | n/a (set at New Game) | grid size, difficulty, symmetry, seed |
| **playState** | the position the player is solving | **yes** — snapshotted per move | cell values, drawn regions, pencil marks |
| **uiState** | transient/persistent UI not on the undo chain | **no** | current selection, active drag, hint-reveal count, last-event-for-flash |
| **drawState** | what is currently *rendered* (per-cell mirror) | **no** | last-rendered glyph value & cell visual state, for diffing |

**Rules of thumb for the CLI when assigning a datum:**
- "Would the player be annoyed if Undo reverted this?" → if yes it's UI, not play. (Selection,
  cursor, an in-progress drag, a revealed-hint counter all belong in `uiState`.)
- `playState` objects are **immutable**; a move produces a *new* `playState`. This is what makes
  the undo list trivial and safe.
- `drawState` may be torn down and rebuilt on a forced full redraw — never store anything there
  that isn't reconstructible from `playState` + `uiState`.

---

## 4. Domain model

A single board abstraction serves both games. The engine holds a grid of cells:

```
Cell {
  id:        "r{row}c{col}"      // stable key
  row, col:  int
  role:      Role                // see below — drives render policy
  value:     string | null       // ALWAYS a string ("0".."9" in v1), null = empty. See §8.1.
  regionId:  string | null       // which region this cell belongs to (Shikaku); null if none
  given:     boolean             // true = puzzle-supplied (immutable), false = user-entered
}
```

### Roles (the key to "device-per-cell" vs "anchor-only")

We do **not** branch on game mode. Every cell has a **role**, and the *skin's render policy*
(§8.2) decides which roles get a display device:

- `given` — a clue/number fixed by the puzzle (Sudoku givens; Shikaku area-anchors)
- `fillable` — empty cell the player fills with a digit (Sudoku blanks)
- `clue` — an anchor carrying a number that defines a region (Shikaku's `5`, `12`, `9`…)
- `member` — a non-clue cell belonging to a drawn region (Shikaku rectangle interior)
- `blank` — structurally empty / not yet assigned

Then:
- **Sudoku** render policy = "device on every `given` and `fillable` cell." → *device-per-cell.*
- **Shikaku** render policy = "device only on `clue` cells; `member`/`blank` are plain tiles." → *anchor-only.*

Both are the same engine. Mode is a lookup table, never an `if`.

### Derived visual states (computed, not stored in playState)

`selected`, `error`/`conflict`, `pencil` (candidate marks), `validated` (region complete & correct).
These feed the renderer and the event system but are derived from play + UI state.

---

## 5. Game-module contract (the "back end")

One module per game, exporting a single object (Tatham's `thegame`). Pure logic; **no DOM, no
rendering, no input handling**. Lives at `src/games/{name}/index.js`.

```
GameModule {
  meta: {
    id:               "sudoku" | "shikaku",
    name:             "Sudoku",
    interaction:      "digit-entry" | "region-draw",   // §7
    requirements: {                                     // §8.5 negotiation
      glyphSet:       "digits",        // v1 always "digits"; v2 may need "alnum"
      needsOffState:  true,            // empty cells need "device present, showing nothing"
      needsRegionFill: true|false,     // shikaku true, sudoku false
    },
  },

  // --- generation & validation ---
  defaultParams(): Params
  newPuzzle(params, rng): { params, playState, solution }   // rng seeded for reproducibility
  validateMove(playState, move): boolean
  applyMove(playState, move): playState        // PURE. returns NEW immutable playState (execute_move)
  isSolved(playState): boolean
  findConflicts(playState): CellId[]           // for live error highlighting
  solve(playState): playState | null           // self-solve (hints + uniqueness checks)

  // --- serialization (game IDs) ---
  encodeParams(params, full): string           // full=false omits gen-only fields (e.g. difficulty)
  decodeParams(string): Params
  encodeDesc(playState): string                // the specific instance (clue layout)
  decodeDesc(params, string): playState
}
```

Notes:
- `applyMove` is the heart. It takes `(playState, moveDescriptor)` → new `playState`. The engine
  pushes the result onto the undo list. **Never mutate in place.**
- `findConflicts` runs after every move for live feedback (a Sudoku duplicate in a row/box; a
  Shikaku overlap or an area that can't match its clue). The engine turns the returned ids into
  `conflictDetected` events for the skin to flash.

---

## 6. Engine contract (the "mid-end")

Game-agnostic. Owns the state list, undo/redo, serialization round-trips, and the **semantic
event bus**. `src/core/engine.js`.

```
Engine {
  load(gameModule, params|gameId)        // builds initial playState, resets undo list
  current(): playState                    // head of the list
  do(move)                                // validate → applyMove → push → diff → emit events
  undo() / redo()                         // move the list index; diff; emit cellChanged events
  restart()                               // back to move 0 (keeps uiState, per Tatham)
  gameId(): string                        // params + desc, for sharing
  on(eventName, handler) / off(...)       // subscribe
}
```

### Semantic events (the engine never says "animate"; it says what happened)

Emit these; skins decide what they *mean* visually (§8.4):

`selectionChanged`, `cellPlaced`, `cellCleared`, `pencilToggled`,
`regionStarted`, `regionPreview`, `regionCommitted`, `regionValidated`, `regionInvalid`,
`conflictDetected`, `conflictCleared`, `mistake`, `hintRevealed`, `solved`.

Each event carries the affected cell/region ids + minimal payload. The renderer diffs and the
skin maps event → transition. This is where "everything clicks into place" lives.

---

## 7. Interaction models

Bind to game type. Live in `src/interaction/`. They translate raw pointer/key input into
**move descriptors** (Tatham's `interpret_move`), which the engine feeds to `applyMove`.

### 7.1 `digit-entry` (Sudoku)

- Tap a `fillable` cell → it becomes `selected` (emit `selectionChanged`).
- Choose a digit from the **on-screen numpad** (§11.4) → emits a `place` move.
- Long-press numpad digit or a "pencil" toggle → candidate marks instead of a value.
- **Do not summon the native keyboard.** Custom numpad only — predictable, one-handed, themable.

### 7.2 `region-draw` (Shikaku)

- Touch-down **on or near a `clue`** → `regionStarted` from that anchor.
- Drag → live rectangle preview snapped to the grid; emit `regionPreview` continuously.
- Release → `regionCommitted` (a move). Engine validates: rectangle area == clue, no overlap,
  covers exactly one clue. If correct → `regionValidated`; else `regionInvalid`.
- Tap an existing region to clear it (a move). Dragging from an empty cell can be disallowed in
  v1 (anchor-rooted drawing only) to keep the interaction unambiguous on touch.

**The touch hard problem (solve it properly — see §11.3):** the finger occludes the very cells
being drawn. Mitigations are specified in the UX section; the interaction layer must surface a
**live dimension readout** (`W × H = area`, e.g. `3 × 3 = 9`) and a snapped, offset preview.

---

## 8. Skin-bundle contract (the "front end", but aesthetic)

A skin is **not** "pick a font." It is a **bundle** that fully determines appearance:

```
Skin {
  meta: {
    id: "futuristic" | "retro" | "pastel",
    name, description,
    capabilities: {                  // §8.5
      glyphSet:        "digits",     // v1; "alnum" reserved for v2
      supportsOffState: true,
      supportsRegionFill: true,
    },
  },
  palette: PaletteTokens,            // §8.3 — OKLCH tokens
  glyph:   GlyphRenderer,            // §8.1 — the display-device renderer
  region:  RegionStyle,              // §8.6 — borders/fills for Shikaku & Sudoku boxes
  renderPolicy(role): "device" | "plain",   // §4 — device-per-cell vs anchor-only, per skin if needed
  transitions: TransitionTable,      // §8.4 — semantic event → animation
  background: BackgroundStyle,       // board backdrop (CRT scanlines, warm vignette, paper, …)
  // optional, later:
  sound?: SoundTable,
}
```

### 8.1 Glyph contract (display-device renderer)

Every display renderer — Nixie/Lixie, 16-segment, split-flap, dot-matrix, odometer — conforms
to one interface. This is the adapter boundary onto **dexipurei-galore** (§10).

```
GlyphRenderer {
  mount(cellEl): handle              // attach to a cell container
  render(handle, value: string)     // value is ALWAYS a string. v1: "0".."9".
  renderOff(handle)                  // explicit OFF/blank state — unlit tube, blank flap card.
                                     //   distinct from "no device". Empty Sudoku cells and
                                     //   non-clue Shikaku cells both need this.
  transition(handle, event, payload) // play the device-native animation for a semantic event
  measure(): { aspect }              // intrinsic aspect ratio so the board can size cells
}
```

**Two contract rules that cost nothing now and save a v2 rewrite:**
1. `value` is a **string**, even though v1 only feeds `"0".."9"`. v2 word games (16-seg/dot-matrix)
   then drop in with no signature change.
2. **OFF state is explicit and first-class.** "device present, showing nothing" ≠ "no device."

### 8.2 Render policy (per role, possibly per skin)

The engine asks the skin `renderPolicy(role)` for each cell. Default policies:
- Sudoku: `given`→device(bright), `fillable`→device(dim/empty via `renderOff`), others→plain.
- Shikaku: `clue`→device, everything else→plain tile.

A skin *may* override (e.g. a skin that wants Shikaku members faintly lit), but the default lives
with the game's role assignment so all three v1 skins behave identically without extra code.

### 8.3 Palette tokens (OKLCH)

All color expressed as CSS custom properties in **OKLCH** (perceptual uniformity; clean lightness
ramps for glow/halo). Each skin defines the same token names so the chrome and board recolor by
swapping one stylesheet:

```
--surface-bg, --surface-cell, --surface-cell-active,
--glyph-on, --glyph-off, --glyph-given, --glyph-error,
--region-border, --region-fill, --region-validated,
--accent, --halo, --grid-line, --text-chrome
```

### 8.4 Transition vocabulary (event → device animation)

Each skin maps semantic events to device-native motion. This is the free game-feel layer:

| Event | Futuristic (16-seg) | Retro (Lixie) | Pastel (split-flap) |
|---|---|---|---|
| `cellPlaced` | segments strike on with bloom | tube warm-glow ramp | flap settles (1–2 cards) |
| `regionValidated` | border halo pulse | warm flush across tubes | row of cards riffles & locks |
| `conflictDetected` | red segment stutter | tube flicker | card jitter |
| `solved` | scanline sweep + full bloom | synchronized glow swell | full-board flap cascade |

Honor `prefers-reduced-motion`: collapse these to instant state changes with at most a brief
opacity fade (§11.7).

### 8.5 Capability negotiation (build in v1 even though all v1 pairings pass)

When a `(game, skin)` pair is selected, the app checks `game.meta.requirements` against
`skin.meta.capabilities`:
- `requirements.glyphSet ⊆ skin.capabilities.glyphSet` (digits ⊆ digits ✔ in v1; alnum needs an
  alnum-capable skin in v2).
- `requirements.needsOffState ⇒ skin.supportsOffState`.
- `requirements.needsRegionFill ⇒ skin.supportsRegionFill`.

On mismatch, grey out the pairing in the picker with a one-line reason. In v1 everything passes
trivially — but this is exactly the seam that lets v2's 16-seg/dot-matrix word games drop in
without touching the engine, and prevents nonsense like a digits-only Nixie hosting a word game.

### 8.6 Region style (skinned, shares geometry where it can)

The Shikaku rectangle membrane and the Sudoku 3×3 box dividers are part of the skin:
- **Futuristic:** region borders **reuse the 16-segment bar geometry** as grid edges/vertices in
  an accent color with halo/bloom, turning on/off like segments (see §9.1 — this is the signature
  visual). Validated regions get a neon-tube outline.
- **Retro:** warm panel divisions; validated region = soft amber flush.
- **Pastel:** soft colored panels with rounded corners; validated region tints the card field.

---

## 9. The three v1 skins

> **Reference skin = Futuristic.** It is the most demanding (segment-geometry-as-gridlines, halos,
> off-state, region styling), so contracts are validated against it first. Palette tokens are
> structured so an amber/teal house theme can later drop in as a fourth "dev" skin without code
> changes.

### 9.1 Futuristic — 16-segment (Tron-adjacent)

- Glyphs rendered as **16-segment displays** (handles full alnum later; v1 digits only).
- **Signature move:** the grid's cell **edges and vertices reuse the segment bar shapes** — the
  same straight/diagonal primitives that compose a digit — drawn in a second accent color, with
  **halo/bloom** on activation and animated on/off. The board literally looks built from the same
  segments as the numbers. Lean into this; it's the look that sells the skin.
- Dark near-black background; optional faint scanline/grid glow. Neon-tube region outlines on
  validation.

### 9.2 Retro — Lixie tubes (Nixie heritage)

- Glyphs as **Lixie-style** edge-lit stacked-acrylic digits (RGB-tunable), evoking **Nixie**
  cold-cathode tubes. Note the visual distinction for the renderer:
  - *Nixie* = real depth/parallax of stacked wire numerals, warm orange neon glow.
  - *Lixie* = coplanar stacked etched panels lit from below, RGB controllable.
  The renderer should target Lixie (per spec) but expose a warm-amber default that reads as Nixie
  warmth. If dexipurei-galore already ships a Nixie renderer (§10), adapt it and add the Lixie
  RGB/flat variant rather than starting over.
- Deep warm-black background, vignette. Warm panel region divisions. Warm-glow ramp transitions.

### 9.3 Pastel — split-flap

- Glyphs as **split-flap** cards in a soft pastel palette (cream/rose/sky/mint). Light background.
- The **settle animation is the personality** — the satisfying "click into place." Tie
  `cellPlaced`/`regionValidated` to flap cascades. This is the most tactile-feeling skin.

### 9.4 Odometer (transition flavor / candidate v1.5)

The odometer "rolling into place" feel is a great transition vocabulary and an easy fourth skin
or a Pastel/Retro variant. Implement as a GlyphRenderer if time allows; otherwise note it as the
first post-v1 skin. Its rolling digit change is a strong fit for `cellPlaced`.

---

## 10. dexipurei-galore reuse (do not rebuild renderers)

The display renderers are an **existing asset** (dexipurei-galore: dot-matrix, Nixie, VFD,
split-flap, etc., with a HANDOVER.md). The plan:

1. **Audit** dexipurei-galore for renderers that already satisfy or can satisfy the §8.1 glyph
   contract. Likely direct adapts: **split-flap** (Pastel), **Nixie** (Retro base).
2. **Adapt** each via a thin adapter exposing `mount/render/renderOff/transition/measure`. Do not
   fork or rewrite the renderers; wrap them.
3. **Build the gaps to contract:** **16-segment** (Futuristic) and the **Lixie** variant if
   dexipurei-galore has only Nixie. Build these new but to the *same* interface so they're
   interchangeable.
4. Vendor dexipurei-galore under `src/display/` (or a submodule) and keep the adapter layer in
   `src/skins/*/glyph-*.js`. The skin imports the adapter, never the raw renderer.

If dexipurei-galore's inventory differs from the above, the contract is the source of truth: any
renderer that satisfies §8.1 is usable; anything that doesn't gets an adapter or a small shim.

---

## 11. Mobile-first UX spec (SOTA — this is a hard requirement)

Design for **phone portrait, one thumb**. Desktop is the upscale.

### 11.1 Layout & viewport
- Board is **square**, sized to `min(100vw, available height above controls)`; never let cells
  shrink below a comfortable touch size.
- **Portrait-first:** board on top, controls docked at the bottom (thumb zone). Landscape:
  controls move to the side.
- Honor **safe areas**: `padding: env(safe-area-inset-*)`; nothing critical under the notch or
  home indicator.
- Lock against accidental zoom/selection on the board: `touch-action: manipulation;`
  `user-select: none;` `-webkit-tap-highlight-color: transparent;`. Prevent double-tap-to-zoom.

### 11.2 Touch targets & thumb zones
- Minimum interactive target **≥ 44–48 px** (Apple HIG 44 pt / Material 48 dp). Numpad keys and
  undo/redo sit in the bottom reachable arc; nothing essential top-corner.
- No hover-dependent affordances — everything must work from a single tap/drag.

### 11.3 Shikaku on touch — the finger-occlusion problem (solve it, don't ignore it)
The finger covers the cells being drawn. Required mitigations:
- **Offset, snapped preview:** show the rubber-band rectangle snapped to whole cells, with the
  growing edge offset/visible above the fingertip.
- **Live dimension readout:** a small HUD shows `W × H = area` (e.g. `3 × 3 = 9`) in real time and
  **turns to the validated color when area == clue**. Bonus: render this readout *in the active
  skin's glyph tech* — a tiny strip of the same tubes/segments — so feedback is on-theme.
- **Snap + haptic** on each cell-boundary crossing and a distinct haptic on a valid-area match.
- Anchor-rooted drawing only in v1 (drag must originate on the clue), removing ambiguity about
  which clue a rectangle belongs to.

### 11.4 Digit entry (Sudoku) on touch
- Custom **bottom-docked numpad**, not the native keyboard. Tap-cell-then-tap-digit.
- Show **remaining-count** per digit (how many of each are still placeable) — standard SOTA aid.
- Pencil-mark mode toggle adjacent to the pad; long-press a digit as a shortcut to pencil it.

### 11.5 Haptics
- Use `navigator.vibrate()` where available (Android/Chromium). iOS Safari support is limited and
  inconsistent — **feature-detect and degrade silently**; never depend on haptics for correctness.
- Map: light tick on placement/snap; sharper buzz on conflict; celebratory pattern on solve.

### 11.6 Undo / redo (prominent)
- First-class, always-visible buttons in the thumb zone (the universal undo from §3/§6 makes this
  cheap). This matches the engine's state-list model and is a known UX win for deduction puzzles.

### 11.7 Motion & accessibility
- Respect `prefers-reduced-motion`: collapse halos/blooms/flap cascades to instant state changes
  with at most a short opacity fade.
- Respect `prefers-color-scheme` for the **chrome** (skins set their own board palette).
- Animate with **transforms/opacity** only (compositor-friendly); drive with `requestAnimationFrame`
  / CSS transitions. Target 60 fps; never animate layout-affecting properties on the hot path.
- ARIA: the board is largely visual, but give cells accessible labels (`row/col, value or empty`),
  expose the dimension readout to assistive tech, and make the numpad real buttons.

### 11.8 Performance
- Per-cell **diff-and-patch** (from drawState, §3/§6): only re-render cells that changed. Do not
  rebuild the board each move.
- Lazy-init off-screen device renderers if a grid is large; keep the WebGL/Canvas context count
  sane (one shared context per skin where the renderer allows, rather than one per cell).

---

## 12. Generation & solving

Keep v1 algorithms known-good and uniqueness-guaranteed; do not over-engineer.

### 12.1 Sudoku
- Generate a complete valid solution (randomized backtracking / dancing-links).
- **Dig holes** while a solver confirms the solution stays **unique**; stop at target clue count.
- **Difficulty** = the hardest deduction technique required by the solver (naked/hidden singles →
  pairs → … ). Grade by technique tier; expose as a `params` field (gen-only, omit from non-full
  game IDs per §2 adopt-list / Tatham's `encode_params(full=false)`).
- Hints reuse `solve()`.

### 12.2 Shikaku
- Generate by **randomly rectangulating** the grid into a full tiling of non-overlapping
  rectangles; place each rectangle's **area as a clue** in one chosen cell (the anchor).
- **Uniqueness is non-trivial** — a Shikaku clue layout can admit multiple tilings. Run a
  **solver/uniqueness check** (backtracking over candidate rectangles per clue, or exact-cover) and
  regenerate/adjust anchors until the solution is unique. This is the main algorithmic effort in v1;
  budget for it.
- Difficulty ≈ grid size + how forced the early deductions are. Keep grading simple in v1.

### 12.3 Shared
- Seed the RNG so a `gameId` reproduces the exact puzzle (share-by-link).
- Solver is also the **hint** engine: reveal the next forced cell/region, not the whole solution.

---

## 13. App shell / chrome

- **Chrome ≠ skin.** The app shell (menus, picker, settings, About) uses a stable house identity —
  serif display type for headings (an EB Garamond / Cormorant-class face), monospace for UI labels
  and any code-like text (a JetBrains Mono–class face). The **skins theme only the board.**
- **Picker:** choose Game (A) × Skin (B). Show the capability-negotiation greying (§8.5). Remember
  last selection (in memory only — no browser storage assumptions; if persisting, gate behind a
  feature check and degrade).
- **Settings:** difficulty, new game, enter game ID, reduced-motion override, haptics toggle, sound
  (later).
- **About:** the Tatham attribution line (§2).

---

## 14. Directory layout

```
/index.html
/manifest.json                 # versioned; bump on each milestone (see below)
/LICENSE                       # MIT (recommended)
/ATTRIBUTION.md                # Tatham homage (required)
/HANDOVER-PazoruKore.md        # this file
/src/
  core/
    engine.js                  # mid-end: state list, undo/redo, gameId, event bus
    grid.js                    # cell model, roles, regions
    events.js                  # semantic event names + tiny emitter
    capabilities.js            # game.requirements ↔ skin.capabilities negotiation
    rng.js                     # seedable PRNG
  games/
    sudoku/{index.js,generator.js,solver.js}
    shikaku/{index.js,generator.js,solver.js}
  interaction/
    digit-entry.js
    region-draw.js
  skins/
    _contract.js               # documents the Skin + GlyphRenderer interfaces (no logic)
    futuristic/{skin.js,glyph-16seg.js,region-neon.js,palette.css,transitions.js}
    retro/{skin.js,glyph-lixie.js,region-warm.js,palette.css,transitions.js}
    pastel/{skin.js,glyph-splitflap.js,region-soft.js,palette.css,transitions.js}
  display/                     # vendored dexipurei-galore (renderers); adapters live in skins/*
  ui/
    app.js                     # bootstrap: picker → engine.load → bind interaction + skin
    board.js                   # cell DOM, diff-and-patch render
    controls.js                # numpad, undo/redo, dimension HUD
    picker.js                  # game × skin selection + negotiation greying
/assets/
```

**manifest.json:** include `name`, `version` (semver), `games[]`, `skins[]`, and the
dexipurei-galore version pinned. Bump version per milestone; this is the project's source of
truth for "what's in v1."

---

## 15. Build order (milestones — commit at each)

1. **M0 — Scaffold.** Repo, `index.html`, ES-module dev server note, `LICENSE`, `ATTRIBUTION.md`,
   `manifest.json` v0.1.0, empty contracts in `_contract.js`.
2. **M1 — Engine + grid + events.** `grid.js`, `engine.js` (state list, undo/redo, event bus),
   `rng.js`. Unit-testable with a trivial fake game.
3. **M2 — Sudoku logic.** `games/sudoku/*` (generate, solve, validate, conflicts, serialize).
   Headless-testable: generate → solve → assert unique.
4. **M3 — Board render + digit-entry + Futuristic skin (reference).** Diff-and-patch board,
   numpad, 16-seg glyph adapter, segment-geometry gridlines, off-state, transitions. **Sudoku is
   now playable on a phone in the Futuristic skin.** This validates the whole vertical slice.
5. **M4 — Shikaku logic.** `games/shikaku/*` incl. the uniqueness check (the hard part).
6. **M5 — region-draw interaction + region styling.** Anchor-rooted drag, snapped offset preview,
   live `W×H=area` HUD, haptics. **Shikaku playable in Futuristic.**
7. **M6 — Retro + Pastel skins.** Lixie and split-flap glyph adapters + region styles + palettes +
   transitions. Verify all 2×3 game×skin pairings via the picker.
8. **M7 — Polish.** Capability negotiation UI, reduced-motion, safe-area, game-ID share, hints,
   About panel, settings. Tag v1.0.0.

Throughout: **mobile-first** — test in a phone-width viewport at every milestone, not at the end.

---

## 16. Open decisions (confirm before/while building)

1. **Sudoku size:** classic 9×9 only for v1, or also offer 4×4/6×6 as easy presets? (9×9 is the
   safe default.)
2. **Shikaku default grid size** and clue density for "easy/medium/hard."
3. **Odometer:** ship as a v1 fourth skin, fold into Pastel/Retro as a transition variant, or defer
   to v1.5? (Defer is fine; it's noted as the first post-v1 add.)
4. **House amber/teal theme:** add now as a fourth "dev/reference" skin, or keep it as the chrome
   identity only until v2? (Spec assumes chrome-only for now.)
5. **Persistence:** is any cross-session save desired in v1 (resume a puzzle), or is share-by-game-ID
   enough? (No-build/no-storage-assumption discipline favors game-ID-only for v1.)
6. **dexipurei-galore inventory:** confirm which renderers exist so M6 knows what to adapt vs build
   (16-seg and possibly Lixie are the expected new builds).

---

## 17. Definition of done (v1)

- Both games generate **unique-solution** puzzles at ≥1 difficulty each, reproducible from a game ID.
- All **2 games × 3 skins = 6** pairings play correctly on a phone in portrait, one-handed.
- Universal undo/redo; live conflict highlighting; hints; solve-detection with a per-skin solve
  celebration.
- Capability negotiation present and correct (all v1 pairings pass; the seam exists for v2).
- `prefers-reduced-motion` and safe-area respected; targets ≥44 px; no native keyboard summoned.
- Tatham attribution shipped (file + About panel).
- Zero build step: clone, serve statically, play.

---

## 18. v2 horizon (design now, don't build)

- **Alphanumeric games** (word-fit, Latin-square variants) on glyph techs that support it:
  **16-segment**, **dot-matrix**, CRT — gated by the capability negotiation already built in §8.5.
- **More games** from the same engine: **Fillomino** (Tatham's *Filling* — every cell carries a
  digit; the densest glyph showcase), **KenKen/Killer** (cages over the Sudoku base),
  **Slitherlink** (needs a new **edge-draw** interaction), **Nurikabe**, **Star Battle**.
- **More skins:** Odometer, VFD, CRT/phosphor, a house amber/teal theme.
- **Sound** as a fourth element of the skin bundle (mechanical flap clack, tube hum, segment tick).
```
