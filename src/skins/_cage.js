// src/skins/_cage.js — shared KenKen cage renderer (skin-agnostic; painted by board.js on the grid
// layer). KenKen cages are arbitrary connected polyominoes, not rectangles, so the rectangular
// region-membrane renderers are gated off for kenken (see each skin's region-*.js) and this draws
// the real thing: a bold outline traced along every cell-edge that borders a DIFFERENT cage (or the
// grid edge), plus the cage clue ("6×", "3-", "2÷", "5+", "4") in the anchor cell's top-left corner.
// Cages are static puzzle structure (they never change as the player fills digits), so it just rides
// the normal grid repaint. Each skin supplies a `cage` palette { line, text }.

import { getCellAt } from '../core/grid.js';

export function makeCageRenderer() {
  return {
    paint(ctx, geom, palette) {
      const grid = geom.grid, boxes = geom.boxes;
      if (!boxes.size) return;
      const first = boxes.get('r0c0'); if (!first) return;
      const line = (palette && palette.line) || '#00e5d0';
      const lw = Math.max(2, first.w * 0.045);
      const diff = (cell, r, c) => { const n = getCellAt(grid, r, c); return !n || n.regionId !== cell.regionId; };

      // bold cage outline — drawn ON the cell edges so adjacent segments align and corners meet.
      ctx.save();
      ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = line; ctx.shadowBlur = lw * 1.4;
      for (const cell of grid.cells) {
        if (cell.regionId == null) continue;
        const b = boxes.get(cell.id); if (!b) continue;
        ctx.beginPath();
        if (diff(cell, cell.row - 1, cell.col)) { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.w, b.y); }
        if (diff(cell, cell.row + 1, cell.col)) { ctx.moveTo(b.x, b.y + b.h); ctx.lineTo(b.x + b.w, b.y + b.h); }
        if (diff(cell, cell.row, cell.col - 1)) { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x, b.y + b.h); }
        if (diff(cell, cell.row, cell.col + 1)) { ctx.moveTo(b.x + b.w, b.y); ctx.lineTo(b.x + b.w, b.y + b.h); }
        ctx.stroke();
      }
      ctx.restore();
      // NOTE: cage CLUE LABELS are rendered as DOM spans (board.js .cell-label), not on canvas — on
      // opaque-tile skins (pastel split-flap) a grid-layer label would be covered by the card.
    },
  };
}

export default makeCageRenderer;
