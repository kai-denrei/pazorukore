// src/skins/_bridge.js — shared Bridges renderer, parameterized per skin. Bridges are EDGES, not
// cell values, so the board can't draw them with per-cell glyphs. This paints, on the grid layer:
//   • the bridge LINES (1 or 2 parallel glowing lines) between connected islands, stopping at each
//     island's rim so the number stays readable;
//   • an island DISC + RING around every island cell (satisfied islands read the "done" colour,
//     over-budget / crossing islands read the error colour).
// The island NUMBER itself is drawn on top by the skin's glyph (the clue cell). Each skin supplies
// its palette + style (glow/core/soft) so Bridges wears the same three looks as the other games.

export function makeBridgeRenderer(palette, opts = {}) {
  const O = { glow: 12, core: 0, lineWidth: 0.075, ringWidth: 0.05, ringR: 0.40, gap: 0.22, ...opts };

  function lineSeg(ctx, x1, y1, x2, y2, w, color, glow, core) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = color; ctx.shadowColor = color;
    ctx.globalAlpha = 0.5; ctx.lineWidth = w * 2.3; ctx.shadowBlur = glow;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = w; ctx.shadowBlur = glow * 0.4;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    if (core > 0) { ctx.shadowBlur = 0; ctx.strokeStyle = '#fff'; ctx.globalAlpha = core; ctx.lineWidth = Math.max(0.6, w * 0.42); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    ctx.restore();
  }

  return {
    paint(ctx, geom, bridges, view) {
      const first = geom.boxes.get('r0c0'); if (!first) return;
      const cw = first.w;
      const lw = Math.max(1.5, cw * O.lineWidth);
      const ringR = cw * O.ringR;
      const conflicts = (view && view.conflicts) || new Set();
      const sums = (view && view.sums) || new Map();

      // 1) bridge lines (drawn first, under the island discs).
      for (const [key, count] of Object.entries(bridges || {})) {
        if (!count) continue;
        const [idA, idB] = key.split('|');
        const ba = geom.boxes.get(idA), bb = geom.boxes.get(idB);
        if (!ba || !bb) continue;
        const ax = ba.x + ba.w / 2, ay = ba.y + ba.h / 2;
        const bx = bb.x + bb.w / 2, by = bb.y + bb.h / 2;
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const x1 = ax + ux * ringR, y1 = ay + uy * ringR, x2 = bx - ux * ringR, y2 = by - uy * ringR;
        const color = (conflicts.has(idA) || conflicts.has(idB)) ? palette.error : palette.line;
        if (count === 1) {
          lineSeg(ctx, x1, y1, x2, y2, lw, color, O.glow, O.core);
        } else {
          const off = cw * O.gap * 0.5, px = -uy * off, py = ux * off;
          lineSeg(ctx, x1 + px, y1 + py, x2 + px, y2 + py, lw, color, O.glow, O.core);
          lineSeg(ctx, x1 - px, y1 - py, x2 - px, y2 - py, lw, color, O.glow, O.core);
        }
      }

      // 2) island discs + rings (on top of the bridge ends; number is drawn above by the glyph).
      for (const cell of geom.grid.cells) {
        if (cell.role !== 'clue') continue;
        const b = geom.boxes.get(cell.id); if (!b) continue;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const need = parseInt(cell.value, 10);
        const sum = sums.get(cell.id) || 0;
        const over = conflicts.has(cell.id);
        const done = !over && sum === need;
        const color = over ? palette.error : (done ? palette.ringDone : palette.ring);
        ctx.save();
        ctx.fillStyle = palette.disc;
        ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = Math.max(1.5, b.w * O.ringWidth);
        ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = done ? O.glow : O.glow * 0.45;
        ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    },
  };
}
