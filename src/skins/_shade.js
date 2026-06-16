// src/skins/_shade.js — Nurikabe "sea" renderer (skin-agnostic; painted by board.js on the grid
// layer, gated to nurikabe). Fills every shaded cell so adjacent shaded cells merge into one
// contiguous sea (the fill is expanded slightly to bridge the inter-cell gap). Unshaded cells
// (islands) stay on the board background and show their clue digit via the glyph layer. Reads
// playState.shaded ({cellId:1}); each skin supplies a { fill, glow } palette.

export function makeShadeRenderer() {
  return {
    paint(ctx, geom, shaded, palette) {
      const boxes = geom.boxes;
      const fill = (palette && palette.fill) || 'rgba(13,110,120,0.5)';
      const glow = (palette && palette.glow) || null;
      ctx.save();
      ctx.fillStyle = fill;
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 5; }
      for (const id of Object.keys(shaded)) {
        if (!shaded[id]) continue;
        const b = boxes.get(id); if (!b) continue;
        ctx.fillRect(b.x - 1.5, b.y - 1.5, b.w + 3, b.h + 3); // +gap so the sea reads contiguous
      }
      ctx.restore();
    },
  };
}

export default makeShadeRenderer;
