// src/skins/_contract.js — the Skin + GlyphRenderer interfaces (§8). DOCUMENTATION ONLY: no
// logic ships here. This file is the source of truth that the board, picker, and each skin agree on.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RENDER MODEL (the one decision everything hangs off)
// ─────────────────────────────────────────────────────────────────────────────
// The board owns ONE <canvas> (one 2D context) overlaid on a CSS grid of <button> cells.
// Glyphs are NOT one-canvas-per-cell (§11.8 warns against N contexts). Instead each skin's
// GlyphRenderer wraps a vendored dexipurei display module and paints ONE cell by:
//   1. rendering the single glyph into a small REUSED offscreen canvas with `p.transparent = true`
//      (the module then skips its full-canvas background + vignette/dust self-suppress), so the
//      offscreen holds just the lit glyph on transparent alpha;
//   2. blitting that offscreen onto the board canvas at the cell's box.
// This reuses the dexipurei render() verbatim (no fork) yet keeps the board at a single context,
// and makes diff-and-patch trivial: on cellChanged, clear+repaint only that one box.
//
// ANIMATION: the board keeps a per-cell anim map. An rAF ticker runs ONLY while ≥1 cell animates,
// then stops. Each frame it calls glyph.paint(...) with an `anim` arg; at rest `anim` is null.
// Honors prefers-reduced-motion by collapsing anim to an instant final frame (§11.7).

/**
 * @typedef {{x:number,y:number,w:number,h:number}} Box   // cell rect in board-logical px
 * @typedef {{ value:string|null, role:string, given:boolean }} CellView
 * @typedef {{ selected?:boolean, conflict?:boolean, validated?:boolean, pencil?:string[], dim?:boolean }} VisualState
 * @typedef {null | { event:string, progress:number, elapsed:number, payload?:object }} Anim
 */

/**
 * GlyphRenderer — the §8.1 display-device contract, adapted to the shared-canvas model.
 *
 * @typedef {Object} GlyphRenderer
 * @property {string} id
 * @property {() => { aspect:number }} measure          // intrinsic cell aspect (w:h); 1 = square
 * @property {Param[]} params                            // the dexipurei module's param schema — drives the ?admin panel verbatim
 * @property {(overrides:object) => void} setParams      // merge live admin overrides into the resolved p
 * @property {() => object} getParams                    // current resolved p (for the admin panel to read)
 *
 * // paint ONE cell. value === null → renderOff() (device present, showing nothing — §8.1 rule 2).
 * // The skin's renderPolicy decides whether this cell gets a device at all (board skips 'plain').
 * @property {(ctx:CanvasRenderingContext2D, box:Box, cell:CellView, view:VisualState, anim:Anim) => void} paint
 *
 * // map a semantic event to a transition spec the board ticker will run (duration ms + easing).
 * // return null to render the event as an instant state change.
 * @property {(event:string, payload:object) => ({ duration:number } | null)} transitionFor
 */

/**
 * Skin bundle — fully determines board appearance (§8). Chrome is themed separately (§13).
 *
 * @typedef {Object} Skin
 * @property {{ id:string, name:string, description:string,
 *             capabilities:{ glyphSet:string, supportsOffState:boolean, supportsRegionFill:boolean } }} meta
 * @property {GlyphRenderer} glyph
 * @property {(role:string) => ('device'|'plain')} renderPolicy   // §8.2 device-per-cell vs anchor-only
 * @property {RegionStyle} region                                 // §8.6 borders/fills (Shikaku + Sudoku boxes)
 * @property {(rootEl:HTMLElement) => void} applyPalette          // set OKLCH custom props on the board root (§8.3)
 * @property {(boardEl:HTMLElement, ctx?:CanvasRenderingContext2D) => void} background  // backdrop (scanlines/vignette/paper)
 */

/**
 * RegionStyle — §8.6. Paints the Shikaku rectangle membrane / Sudoku box dividers for this skin.
 * @typedef {Object} RegionStyle
 * @property {(ctx:CanvasRenderingContext2D, geom:object, view:object) => void} paint  // draw gridlines/region borders onto the board canvas
 */

// The OKLCH palette token names every skin must define (§8.3). Documented here so all skins agree.
export const PALETTE_TOKENS = [
  '--surface-bg', '--surface-cell', '--surface-cell-active',
  '--glyph-on', '--glyph-off', '--glyph-given', '--glyph-error',
  '--region-border', '--region-fill', '--region-validated',
  '--accent', '--halo', '--grid-line', '--text-chrome',
];

// no runtime export beyond the token list — this module is a contract, not code.
