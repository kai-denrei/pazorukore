// src/skins/pastel/skin.js — the Pastel skin bundle (§9.3). Electromechanical split-flap cards on a
// LIGHT, airy board: cream card stock with dark ink, soft pastel accents (cream/rose/sky/mint), gentle
// gridlines and rounded region panels. Mirrors the Futuristic bundle shape exactly so the board/admin/
// engine work with zero changes.

import { makeGlyphSplitflap, DEFAULT_SEED } from './glyph-splitflap.js';
import { makeRegionSoft } from './region-soft.js';

// canvas-side hex colors (the vendored renderer + region layer want hex / css colors).
//   card = cream card stock · ink = dark printed ink · bg = light board behind the cards.
const GLYPH = {
  card: '#f6efe2', ink: '#3a3530', bg: '#f3ece0',
  given: '#5a6b8c', error: '#e0314a', off: '#b9b0a2',
};
// soft region palette: gentle gridlines, pastel panel/fill, mint accents, mint-tinted validated wash.
const REGION = {
  grid: '#c9bfae', accent: '#9fc2b6', validated: '#a9d8c4',
  fill: '#e7d8e0', panel: '#fbf6ec',
};

// OKLCH chrome/board tokens (§8.3) — set on the board root by applyPalette. LIGHT surface (not dark!).
const TOKENS = {
  '--surface-bg': 'oklch(0.95 0.015 85)',
  '--surface-cell': 'transparent',
  '--surface-cell-active': 'oklch(0.86 0.04 25 / 0.35)',
  '--glyph-on': '#3a3530',
  '--glyph-off': '#b9b0a2',
  '--glyph-given': '#5a6b8c',
  '--glyph-error': '#e0314a',
  '--region-border': '#9fc2b6',
  '--region-fill': 'oklch(0.88 0.03 330 / 0.45)',
  '--region-validated': 'oklch(0.86 0.06 160 / 0.55)',
  '--accent': '#9fc2b6',
  '--halo': 'oklch(0.86 0.05 25 / 0.4)',
  '--select': '#6c5ce7',
  '--grid-line': 'oklch(0.80 0.02 85 / 0.6)',
  '--text-chrome': '#4a443d',
  '--cell-gap': '3px',
  '--board-pad': '9px',
};

const glyph = makeGlyphSplitflap(GLYPH);
const region = makeRegionSoft(REGION);

export const pastel = {
  meta: {
    id: 'pastel',
    name: 'Pastel',
    description: 'Electromechanical split-flap cards in cream stock with dark ink, soft pastel panels and gentle gridlines on a light board.',
    capabilities: { glyphSet: 'digits', supportsOffState: true, supportsRegionFill: true },
  },
  glyph,
  region,
  renderPolicy: (role) => (role === 'given' || role === 'fillable' || role === 'clue') ? 'device' : 'plain',
  applyPalette(rootEl) {
    for (const [k, v] of Object.entries(TOKENS)) rootEl.style.setProperty(k, v);
    rootEl.classList.add('skin-pastel');
  },
  background(boardEl) {
    boardEl.style.background =
      'radial-gradient(120% 120% at 50% 0%, #fbf6ec 0%, #f3ece0 60%, #efe7d8 100%)';
  },
};

export { DEFAULT_SEED };
export default pastel;
