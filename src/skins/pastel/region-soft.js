// src/skins/pastel/region-soft.js — the Pastel signature (§8.6 / §9.3): soft colored panels with
// rounded corners instead of neon tubes. Gridlines are gentle and light (no bloom/halo); the 3×3
// Sudoku box dividers read a touch heavier. Shikaku region membranes are rounded pastel panels; a
// validated region tints its card field with a soft accent wash and a slightly firmer rounded border.

// region colour-coding by clue value (§ user request): each area-size gets its own soft hue,
// so 2-regions read as one colour, 3-regions another, etc.
const VAL_COLORS = {
  2: '#e79db1', 3: '#8fbfe6', 4: '#9fd3a8', 5: '#f0c38a',
  6: '#c2a3e0', 7: '#d9cf84', 8: '#7fcfc6', 9: '#ec9d86',
};
const colorForValue = (v) => VAL_COLORS[v] || '#b6aec2';

export function makeRegionSoft(palette) {
  // rounded-rectangle path helper (kept local; same shape the module uses).
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // a gentle hairline: flat stroke, no shadow/bloom. width + alpha set by the caller.
  function softLine(ctx, x0, y0, x1, y1, color, width, alpha) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }

  function softRect(ctx, x, y, w, h, r, color, width, alpha) {
    ctx.save();
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.lineJoin = 'round';
    roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
    ctx.restore();
  }

  // boundary positions (cols+1 / rows+1) from the measured cell boxes, at the gap centres.
  function boundaries(geom, axis) {
    const n = axis === 'x' ? geom.cols : geom.rows;
    const at = (i) => axis === 'x' ? geom.boxes.get(`r0c${i}`) : geom.boxes.get(`r${i}c0`);
    const lo = (b) => axis === 'x' ? b.x : b.y;
    const hi = (b) => axis === 'x' ? b.x + b.w : b.y + b.h;
    const out = [];
    out.push(lo(at(0)));
    for (let i = 1; i < n; i++) out.push((hi(at(i - 1)) + lo(at(i))) / 2);
    out.push(hi(at(n - 1)));
    return out;
  }

  return {
    paint(ctx, geom) {
      if (!geom.boxes.size) return;
      const first = geom.boxes.get('r0c0');
      if (!first) return;
      const xs = boundaries(geom, 'x'), ys = boundaries(geom, 'y');
      const x0 = xs[0], x1 = xs[xs.length - 1], y0 = ys[0], y1 = ys[ys.length - 1];
      const box = geom.box || (geom.rows % 3 === 0 ? 3 : 0); // 3×3 emphasis for Sudoku
      const thin = Math.max(1, first.w * 0.02);
      const thick = Math.max(1.5, first.w * 0.045);

      // soft backing panel for the whole board field (a faint rounded surface behind the cards).
      ctx.save();
      ctx.fillStyle = palette.panel; ctx.globalAlpha = 0.5;
      roundRectPath(ctx, x0, y0, x1 - x0, y1 - y0, Math.max(8, first.w * 0.18));
      ctx.fill();
      ctx.restore();

      // interior gridlines — gentle/light; box dividers a touch heavier (still no glow).
      for (let i = 1; i < xs.length - 1; i++) {
        const major = box && i % box === 0;
        softLine(ctx, xs[i], y0, xs[i], y1, palette.grid, major ? thick : thin, major ? 0.5 : 0.3);
      }
      for (let i = 1; i < ys.length - 1; i++) {
        const major = box && i % box === 0;
        softLine(ctx, x0, ys[i], x1, ys[i], palette.grid, major ? thick : thin, major ? 0.5 : 0.3);
      }
      // outer frame — a soft rounded border in the accent tint.
      softRect(ctx, x0, y0, x1 - x0, y1 - y0, Math.max(8, first.w * 0.18), palette.accent, thick, 0.55);

      // Shikaku region membranes (cells carrying a regionId) → rounded pastel panels.
      const regions = new Map();
      for (const cell of geom.grid.cells) {
        if (cell.regionId == null || geom.game === 'kenken') continue; // kenken cages → _cage.js
        const b = geom.boxes.get(cell.id); if (!b) continue;
        const r = regions.get(cell.regionId) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, val: null };
        r.x0 = Math.min(r.x0, b.x); r.y0 = Math.min(r.y0, b.y);
        r.x1 = Math.max(r.x1, b.x + b.w); r.y1 = Math.max(r.y1, b.y + b.h);
        if (cell.role === 'clue') r.val = parseInt(cell.value, 10);
        regions.set(cell.regionId, r);
      }
      for (const [id, r] of regions) {
        const ok = geom.validated && geom.validated.has(id);
        const col = colorForValue(r.val);           // colour by area size (2/3/4/…)
        const rad = Math.max(6, first.w * 0.16);
        const rx = r.x0 + 2, ry = r.y0 + 2, rw = r.x1 - r.x0 - 4, rh = r.y1 - r.y0 - 4;
        // fill the region in its value colour; a validated region reads firmer + more saturated.
        ctx.save();
        ctx.fillStyle = col;
        ctx.globalAlpha = ok ? 0.36 : 0.18;
        roundRectPath(ctx, rx, ry, rw, rh, rad); ctx.fill();
        ctx.restore();
        softRect(ctx, rx, ry, rw, rh, rad, col, ok ? thick + 0.5 : thin + 0.6, ok ? 0.9 : 0.6);
      }
    },
  };
}
