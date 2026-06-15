// src/skins/futuristic/region-neon.js — the Futuristic signature (§8.6 / §9.1): the grid is drawn
// as 7/16-segment BARS. This renderer is PARAMETERIZED with its own schema (mirroring the relevant
// starburst16 params: bar width, glow, hot core, ghost, junction bleed, segment variance) so the
// GRID has its own admin panel separate from the numbers. Defaults are tuned from a saved preset.
//
// Each bar renders in the starburst idiom: an OFF bar shows only its faint "ghost" (Shikaku's
// structural lattice is all-off ghost); an ON bar gets glow + junction bleed + solid body + white
// hot core. Region membranes are ON, coloured by clue value. The glow gently PULSES (loops between
// glowMin and glowMax) so the lit segments breathe.

// region colour-coding by clue value: each area-size gets its own neon hue.
const VAL_COLORS = {
  2: '#1bf0c8', 3: '#ff5db0', 4: '#ffb000', 5: '#5cff7a',
  6: '#3aa0ff', 7: '#c77dff', 8: '#ff7a3a', 9: '#7dffe8',
};
const colorForValue = (v) => VAL_COLORS[v] || '#9fb6c8';

// GRID param schema → drives the "Grid" admin section. Mirrors starburst16's segment params; glow
// is pulsed between glowMin/glowMax when glowPulse is on (the static `glow` is used when it's off).
export const GRID_PARAMS = [
  { key: 'thickness', label: 'bar width', type: 'range', min: 1, max: 22, step: 1, default: 7, group: 'geometry' },
  { key: 'glow', label: 'glow (static)', type: 'range', min: 0, max: 34, step: 1, default: 19, group: 'glow' },
  { key: 'glowPulse', label: 'pulse glow', type: 'toggle', default: true, group: 'glow' },
  { key: 'glowMin', label: 'pulse min', type: 'range', min: 0, max: 34, step: 1, default: 10, group: 'glow' },
  { key: 'glowMax', label: 'pulse max', type: 'range', min: 0, max: 34, step: 1, default: 26, group: 'glow' },
  { key: 'pulseMs', label: 'pulse period', type: 'range', min: 800, max: 6000, step: 100, default: 2600, group: 'glow' },
  { key: 'coreWhite', label: 'hot core', type: 'range', min: 0, max: 100, step: 1, default: 75, group: 'glow' },
  { key: 'coreThick', label: 'core width', type: 'range', min: 20, max: 90, step: 1, default: 52, group: 'glow' },
  { key: 'ghost', label: 'ghost (off)', type: 'range', min: 0, max: 60, step: 1, default: 27, group: 'wear' },
  { key: 'bleed', label: 'junction bleed', type: 'range', min: 0, max: 100, step: 1, default: 10, group: 'wear' },
  { key: 'variance', label: 'seg variance', type: 'range', min: 0, max: 100, step: 1, default: 70, group: 'wear' },
];

export function makeRegionNeon(palette) {
  const p = {};
  for (const param of GRID_PARAMS) p[param.key] = param.default;

  // elongated-hex (rounded-tip) bar path — the vhex idiom.
  function segBarPath(ctx, x1, y1, x2, y2, th) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux, h = th / 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + ux * h - px * h, y1 + uy * h - py * h);
    ctx.lineTo(x2 - ux * h - px * h, y2 - uy * h - py * h);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - ux * h + px * h, y2 - uy * h + py * h);
    ctx.lineTo(x1 + ux * h + px * h, y1 + uy * h + py * h);
    ctx.closePath();
  }

  // effective glow at time t (ms) — gently loops glowMin..glowMax when pulsing.
  function glowAt(t) {
    if (!p.glowPulse) return p.glow;
    const ph = (Math.sin((t / Math.max(200, p.pulseMs)) * Math.PI * 2) + 1) / 2; // 0..1
    return p.glowMin + (p.glowMax - p.glowMin) * ph;
  }

  // stable per-bar brightness variance (same bar → same value across frames).
  function vary(idx) {
    let n = (Math.imul(idx | 0, 374761393) ^ 0x9e3779b1) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    const hsh = ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    return Math.max(0.12, 1 - (p.variance / 100) * hsh);
  }

  // one segment bar: off → faint ghost; on → glow pass, junction bleed, solid, white hot core.
  function drawSeg(ctx, x1, y1, x2, y2, color, on, bright, th, glow) {
    if (!on) {
      const gA = p.ghost / 100;
      if (gA <= 0) return;
      ctx.shadowBlur = 0; ctx.globalAlpha = gA * bright; ctx.fillStyle = color;
      segBarPath(ctx, x1, y1, x2, y2, th * 0.9); ctx.fill(); ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = color; ctx.shadowColor = color;
    segBarPath(ctx, x1, y1, x2, y2, th);
    ctx.globalAlpha = 0.55 * bright; ctx.shadowBlur = glow; ctx.fill();                 // glow
    if (p.bleed > 0) { ctx.globalAlpha = 0.16 * (p.bleed / 100) * bright; ctx.shadowBlur = glow * (1 + p.bleed / 60); ctx.fill(); } // junction bleed
    ctx.globalAlpha = Math.min(1, bright); ctx.shadowBlur = 0; ctx.fill();              // solid body
    if (p.coreWhite > 0) { ctx.globalAlpha = Math.min(1, (p.coreWhite / 100) * bright); ctx.fillStyle = '#fff'; segBarPath(ctx, x1, y1, x2, y2, th * (p.coreThick / 100)); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  function boundaries(geom, axis) {
    const n = axis === 'x' ? geom.cols : geom.rows;
    const at = (i) => axis === 'x' ? geom.boxes.get(`r0c${i}`) : geom.boxes.get(`r${i}c0`);
    const lo = (b) => axis === 'x' ? b.x : b.y;
    const hi = (b) => axis === 'x' ? b.x + b.w : b.y + b.h;
    const out = [lo(at(0))];
    for (let i = 1; i < n; i++) out.push((hi(at(i - 1)) + lo(at(i))) / 2);
    out.push(hi(at(n - 1)));
    return out;
  }

  return {
    id: 'region-neon',
    params: GRID_PARAMS,
    animated: true,
    getParams: () => p,
    setParams: (ov) => Object.assign(p, ov),

    paint(ctx, geom, t) {
      if (!geom.boxes.size) return;
      const first = geom.boxes.get('r0c0');
      if (!first) return;
      const xs = boundaries(geom, 'x'), ys = boundaries(geom, 'y');
      const box = geom.box || (geom.rows % 3 === 0 ? 3 : 0);
      const sudoku = geom.game === 'sudoku', shikaku = geom.game === 'shikaku';
      const TH = Math.max(1.5, first.w * (p.thickness / 100));
      const ins = TH;                       // notch inset at vertices
      const glow = glowAt(t == null ? 0 : t);
      let bi = 1;

      const isMajor = (i, n) => i === 0 || i === n || (box && i % box === 0);
      const gridBar = (x1, y1, x2, y2, major, outer) => {
        let on, th, col;
        if (shikaku) { on = false; th = TH * 0.7; col = palette.grid; }            // all OFF → ghost lattice
        else if (sudoku) { if (major) { on = true; th = TH * 1.5; col = outer ? palette.accent : palette.grid; } else { on = false; th = TH * 0.5; col = palette.grid; } }
        else { on = true; th = major ? TH * 1.8 : TH; col = outer ? palette.accent : palette.grid; }
        drawSeg(ctx, x1, y1, x2, y2, col, on, vary(bi++), th, glow);
      };

      for (let i = 0; i < ys.length; i++) {
        const major = isMajor(i, ys.length - 1), outer = i === 0 || i === ys.length - 1;
        for (let c = 0; c < geom.cols; c++) { const xa = xs[c] + ins, xb = xs[c + 1] - ins; if (xb > xa) gridBar(xa, ys[i], xb, ys[i], major, outer); }
      }
      for (let j = 0; j < xs.length; j++) {
        const major = isMajor(j, xs.length - 1), outer = j === 0 || j === xs.length - 1;
        for (let r = 0; r < geom.rows; r++) { const ya = ys[r] + ins, yb = ys[r + 1] - ins; if (yb > ya) gridBar(xs[j], ya, xs[j], yb, major, outer); }
      }

      // Shikaku region membranes — ON, coloured by clue value (the pulsing lit segments).
      const regions = new Map();
      for (const cell of geom.grid.cells) {
        if (cell.regionId == null) continue;
        const b = geom.boxes.get(cell.id); if (!b) continue;
        const r = regions.get(cell.regionId) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, val: null };
        r.x0 = Math.min(r.x0, b.x); r.y0 = Math.min(r.y0, b.y);
        r.x1 = Math.max(r.x1, b.x + b.w); r.y1 = Math.max(r.y1, b.y + b.h);
        if (cell.role === 'clue') r.val = parseInt(cell.value, 10);
        regions.set(cell.regionId, r);
      }
      for (const [id, r] of regions) {
        const ok = geom.validated && geom.validated.has(id);
        const col = colorForValue(r.val);
        ctx.save(); ctx.fillStyle = col; ctx.globalAlpha = ok ? 0.2 : 0.1; ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); ctx.restore();
        const th = ok ? TH * 1.7 : TH * 1.25, ri = th;
        const x0 = r.x0 + 1.5, y0 = r.y0 + 1.5, x1 = r.x1 - 1.5, y1 = r.y1 - 1.5;
        drawSeg(ctx, x0 + ri, y0, x1 - ri, y0, col, true, vary(bi++), th, glow);
        drawSeg(ctx, x0 + ri, y1, x1 - ri, y1, col, true, vary(bi++), th, glow);
        drawSeg(ctx, x0, y0 + ri, x0, y1 - ri, col, true, vary(bi++), th, glow);
        drawSeg(ctx, x1, y0 + ri, x1, y1 - ri, col, true, vary(bi++), th, glow);
      }
    },
  };
}
