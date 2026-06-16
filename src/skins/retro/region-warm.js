// src/skins/retro/region-warm.js — the Retro signature (§8.6 / §9.2): warm panel divisions —
// soft amber gridlines (less neon than futuristic, more like the warm rails of a tube housing),
// with heavier bars on the 3×3 box dividers. For Shikaku it also draws the rectangle region
// membranes; validated regions get a soft amber flush + a warm outline.

// region colour-coding by clue value (§ user request): each area-size gets its own warm-leaning hue
// (kept within the tube-glow family so it still reads "retro").
const VAL_COLORS = {
  2: '#ffc24a', 3: '#ff7a3a', 4: '#ffd76a', 5: '#ff5a4a',
  6: '#e8a04a', 7: '#c2e07a', 8: '#7fd0c0', 9: '#ff9ad0',
};
const colorForValue = (v) => VAL_COLORS[v] || '#e0c08a';

export function makeRegionWarm(palette) {
  // a soft warm line: a faint wide halo pass, then a low-key core (gentler bloom than neon).
  function warmLine(ctx, x0, y0, x1, y1, color, core, halo) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = halo;
    ctx.globalAlpha = 0.32; ctx.lineWidth = core * 2.2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.globalAlpha = 0.85; ctx.shadowBlur = halo * 0.35; ctx.lineWidth = core;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }

  function warmRect(ctx, x, y, w, h, color, core, halo) {
    warmLine(ctx, x, y, x + w, y, color, core, halo);
    warmLine(ctx, x + w, y, x + w, y + h, color, core, halo);
    warmLine(ctx, x + w, y + h, x, y + h, color, core, halo);
    warmLine(ctx, x, y + h, x, y, color, core, halo);
  }

  // boundary x positions (cols+1) from the measured cell boxes, at the gap centres.
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
      const thin = Math.max(1, first.w * 0.032);
      const thick = Math.max(2, first.w * 0.07);

      // interior lines — soft amber, gentle halos
      for (let i = 1; i < xs.length - 1; i++) {
        const major = box && i % box === 0;
        warmLine(ctx, xs[i], y0, xs[i], y1, palette.grid, major ? thick : thin, major ? 9 : 4);
      }
      for (let i = 1; i < ys.length - 1; i++) {
        const major = box && i % box === 0;
        warmLine(ctx, x0, ys[i], x1, ys[i], palette.grid, major ? thick : thin, major ? 9 : 4);
      }
      // outer frame — warmest accent rail
      warmRect(ctx, x0, y0, x1 - x0, y1 - y0, palette.accent, thick, 12);

      // Shikaku region membranes (cells carrying a regionId)
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
        ctx.save();
        ctx.fillStyle = col; ctx.globalAlpha = ok ? 0.22 : 0.1;
        ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        ctx.restore();
        warmRect(ctx, r.x0 + 1, r.y0 + 1, r.x1 - r.x0 - 2, r.y1 - r.y0 - 2,
                 col, ok ? thick : thin + 0.5, ok ? 14 : 7);
      }
    },
  };
}
