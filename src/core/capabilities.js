// src/core/capabilities.js — capability negotiation between a game and a skin (§8.5).
// In v1 every pairing passes; the seam exists so v2 alnum word-games can't land on a
// digits-only display. The picker greys out a failing pair and shows the reason.

// glyphSet hierarchy: a skin advertising the wider set satisfies a game needing a narrower one.
const GLYPH_RANK = { digits: 1, alnum: 2 };

export function negotiate(game, skin) {
  const req = (game.meta && game.meta.requirements) || {};
  const cap = (skin.meta && skin.meta.capabilities) || {};
  const reasons = [];

  // requirements.glyphSet ⊆ skin.capabilities.glyphSet
  const need = GLYPH_RANK[req.glyphSet || 'digits'] || 1;
  const have = GLYPH_RANK[cap.glyphSet || 'digits'] || 1;
  if (need > have) {
    reasons.push(`needs ${req.glyphSet} glyphs; ${skin.meta.name} renders ${cap.glyphSet || 'digits'} only`);
  }
  // needsOffState ⇒ supportsOffState
  if (req.needsOffState && !cap.supportsOffState) {
    reasons.push(`needs an explicit OFF state; ${skin.meta.name} can't show "present but blank"`);
  }
  // needsRegionFill ⇒ supportsRegionFill
  if (req.needsRegionFill && !cap.supportsRegionFill) {
    reasons.push(`needs region fills; ${skin.meta.name} has no region styling`);
  }

  return { ok: reasons.length === 0, reasons };
}
