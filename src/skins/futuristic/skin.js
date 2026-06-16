// src/skins/futuristic/skin.js — the Futuristic skin bundle (§9.1). Tron-adjacent: 16-segment
// glyphs, neon segment-geometry gridlines, dark near-black board. The reference skin — contracts
// are validated against it first.

import { makeGlyph16 } from './glyph-16seg.js';
import { makeRegionNeon } from './region-neon.js';
import { makeBridgeRenderer } from '../_bridge.js';
import { makeMasyuRenderer } from './region-masyu.js';

// canvas-side hex colors (the vendored renderer wants hex; hex2rgb parses these).
const GLYPH = { on: '#1bf0c8', given: '#cdeeff', error: '#ff556b', off: '#2c4f4b', bg: '#070b0c' };
const REGION = { grid: '#0db3a3', accent: '#00e5d0', validated: '#8affe8', fill: '#0c3a35' };
const BRIDGE = { line: '#1bf0c8', ring: '#0db3a3', ringDone: '#8affe8', error: '#ff556b', disc: '#091013' };
// Masyu: loop line + pearl square colours (black pearl rendered in teal per the design).
const MASYU = { line: '#1bf0c8', white: '#eaffff', black: '#00e5d0', error: '#ff556b' };

// OKLCH chrome/board tokens (§8.3) — set on the board root by applyPalette.
const TOKENS = {
  '--surface-bg': 'oklch(0.135 0.02 200)',
  '--surface-cell': 'transparent',
  '--surface-cell-active': 'oklch(0.40 0.10 195 / 0.16)',
  '--glyph-on': '#1bf0c8',
  '--glyph-off': '#2c4f4b',
  '--glyph-given': '#cdeeff',
  '--glyph-error': '#ff556b',
  '--region-border': '#00e5d0',
  '--region-fill': 'oklch(0.42 0.10 190 / 0.12)',
  '--region-validated': '#8affe8',
  '--accent': '#00e5d0',
  '--halo': '#00e5d0',
  '--select': '#ffb000',
  '--grid-line': 'oklch(0.62 0.13 190 / 0.55)',
  '--text-chrome': '#cdeeff',
  '--cell-gap': '2px',
  '--board-pad': '7px',
};

const glyph = makeGlyph16(GLYPH);
const region = makeRegionNeon(REGION);
const bridge = makeBridgeRenderer(BRIDGE, { glow: 13, core: 0.45, lineWidth: 0.075, ringWidth: 0.055 });
const loop = makeMasyuRenderer(MASYU, { core: 0.45 });

export const futuristic = {
  meta: {
    id: 'futuristic',
    name: 'Futuristic',
    description: '16-segment starburst glyphs and neon segment-geometry gridlines on near-black.',
    capabilities: { glyphSet: 'digits', supportsOffState: true, supportsRegionFill: true },
  },
  glyph,
  region,
  bridge,
  loop,
  // Masyu pearls (role 'clue' with value 'B'/'W') are drawn on the grid layer by the loop renderer,
  // NOT as glyphs — route them to 'plain' so no 16-seg glyph is painted over them (the 16-seg glyph
  // can't render 'B'/'W' anyway). Bridges islands (numeric clue value) still get a 'device' glyph.
  renderPolicy: (role, cell) =>
    (role === 'clue' && cell && (cell.value === 'B' || cell.value === 'W')) ? 'plain'
      : (role === 'given' || role === 'fillable' || role === 'clue') ? 'device' : 'plain',
  applyPalette(rootEl) {
    for (const [k, v] of Object.entries(TOKENS)) rootEl.style.setProperty(k, v);
    rootEl.classList.add('skin-futuristic');
  },
  background(boardEl) {
    boardEl.style.background =
      'radial-gradient(120% 120% at 50% 0%, #0c1416 0%, #070b0c 60%, #04080a 100%)';
  },
};

export default futuristic;
