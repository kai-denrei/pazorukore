// src/skins/retro/skin.js — the Retro skin bundle (§9.2). Warm-amber Lixie/Nixie: edge-lit
// stacked-acrylic tube glyphs with Nixie warmth, soft amber panel divisions, deep warm-black
// board with a vignette feel. Mirrors the Futuristic bundle shape so the board/admin/engine
// work with zero changes.

import { makeGlyphLixie } from './glyph-lixie.js';
import { makeRegionWarm } from './region-warm.js';
import { makeBridgeRenderer } from '../_bridge.js';

const BRIDGE = { line: '#ffc24a', ring: '#c8782a', ringDone: '#ffd27a', error: '#ff5a3c', disc: '#0c0803' };

// canvas-side hex colors (the vendored renderer wants hex; hex2rgb parses these).
// Amberglass direction: warm-amber glow on warm-black; given = brighter warm white, error = warm red.
const GLYPH = { on: '#ffc24a', given: '#ffe7c2', error: '#ff5a3c', off: '#5a3a16', bg: '#0a0702', edge: '#ff8a1a' };
const REGION = { grid: '#c8782a', accent: '#ff9a3a', validated: '#ffd27a', fill: '#3a2208', validatedFill: '#5a3410' };
// Fillomino value-region tint (skin-agnostic helper reads this): warm-amber hue per value, mirroring
// region-warm's VAL_COLORS so the Fillomino tint matches the rest of the Retro skin.
const TINT = {
  2: '#ffc24a', 3: '#ff7a3a', 4: '#ffd76a', 5: '#ff5a4a',
  6: '#e8a04a', 7: '#c2e07a', 8: '#7fd0c0', 9: '#ff9ad0',
  alpha: 0.15, edgeAlpha: 0.36,
};

// OKLCH chrome/board tokens (§8.3) — warm amber/orange hues. Set on the board root by applyPalette.
const TOKENS = {
  '--surface-bg': 'oklch(0.16 0.03 60)',
  '--surface-cell': 'transparent',
  '--surface-cell-active': 'oklch(0.46 0.10 65 / 0.16)',
  '--glyph-on': '#ffc24a',
  '--glyph-off': '#5a3a16',
  '--glyph-given': '#ffe7c2',
  '--glyph-error': '#ff5a3c',
  '--region-border': '#ff9a3a',
  '--region-fill': 'oklch(0.42 0.09 60 / 0.12)',
  '--region-validated': '#ffd27a',
  '--accent': '#ff9a3a',
  '--halo': '#ffb347',
  '--select': '#36d6ff',
  '--cage-text': '#ffe6c0',
  '--grid-line': 'oklch(0.64 0.11 62 / 0.5)',
  '--text-chrome': '#ffe7c2',
  '--cell-gap': '2px',
  '--board-pad': '7px',
};

const glyph = makeGlyphLixie(GLYPH);
const region = makeRegionWarm(REGION);
const bridge = makeBridgeRenderer(BRIDGE, { glow: 11, core: 0.25, lineWidth: 0.08, ringWidth: 0.055 });

export const retro = {
  meta: {
    id: 'retro',
    name: 'Retro',
    description: 'Warm-amber edge-lit Lixie-tube glyphs with Nixie warmth and soft amber panel divisions on deep warm-black.',
    capabilities: { glyphSet: 'digits', supportsOffState: true, supportsRegionFill: true },
  },
  glyph,
  region,
  bridge,
  tint: TINT,
  cage: { line: '#ffb86b', text: '#ffe6c0' },   // KenKen cage outline + clue label (warm)
  slither: { line: '#ffb86b', dot: 'rgba(255,200,140,0.5)' },   // Slitherlink loop + lattice dots (warm)
  shade: { fill: 'rgba(150,88,38,0.52)', glow: '#c8782a' },     // Nurikabe sea (warm amber ink)
  renderPolicy: (role) => (role === 'given' || role === 'fillable' || role === 'clue') ? 'device' : 'plain',
  applyPalette(rootEl) {
    for (const [k, v] of Object.entries(TOKENS)) rootEl.style.setProperty(k, v);
    rootEl.classList.add('skin-retro');
  },
  background(boardEl) {
    // deep warm-black board with a vignette feel (warm centre falling to near-black edges).
    boardEl.style.background =
      'radial-gradient(120% 120% at 50% 0%, #1a1006 0%, #0a0702 58%, #050301 100%)';
  },
};

export default retro;
