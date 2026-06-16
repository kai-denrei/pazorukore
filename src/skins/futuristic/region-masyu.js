// src/skins/futuristic/region-masyu.js — the Futuristic renderer for Masyu (Tatham "Pearl").
// Masyu is an EDGE game like Bridges: the playState carries a single closed LOOP of orthogonal
// segments through cell centres, plus B/W "pearl" clue cells. The board can't draw the loop with
// per-cell glyphs, so this paints, on the grid layer (gctx):
//   • the LOOP LINES first (glowing neon strokes, full centre-to-centre, so segments visibly join),
//     UNDER the pearls;
//   • then the PEARLS on top: a WHITE pearl is a hollow neon square (four white edge bars, like
//     region-neon's membrane block); a BLACK pearl is the same square in TEAL with a translucent
//     teal fill and a glowing teal-then-white centre dot (the starburst decimal-point idiom).
//
// The helpers segBarPath / drawSeg / glowAt / vary are COPIED from region-neon.js (they're
// module-private closures there) and backed by a local fixed param object `p` reusing region-neon's
// tuned defaults. lineSeg is COPIED from ../_bridge.js (glow stroke + solid + optional white core).

export function makeMasyuRenderer(palette, opts = {}) {
  // Fixed param object — region-neon's tuned defaults (no admin panel for Masyu).
  const p = {
    thickness: 7, glow: 19, glowMin: 10, glowMax: 26, pulseMs: 2600,
    coreWhite: 75, coreThick: 52, ghost: 27, bleed: 10, variance: 70,
  };

  // elongated-hex (rounded-tip) bar path — the vhex idiom. (copied from region-neon.js)
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

  // effective glow at time t (ms) — gently loops glowMin..glowMax (pulse always on here).
  // (copied from region-neon.js; pulseGlow is implicitly true for Masyu)
  function glowAt(t) {
    const ph = (Math.sin((t / Math.max(200, p.pulseMs)) * Math.PI * 2) + 1) / 2; // 0..1
    return p.glowMin + (p.glowMax - p.glowMin) * ph;
  }

  // stable per-bar brightness variance (same bar → same value across frames). (copied)
  function vary(idx) {
    let n = (Math.imul(idx | 0, 374761393) ^ 0x9e3779b1) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    const hsh = ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    return Math.max(0.12, 1 - (p.variance / 100) * hsh);
  }

  // one segment bar: off → faint ghost; on → glow pass, junction bleed, solid, white hot core.
  // (copied from region-neon.js)
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

  // neon line: glow stroke + solid + optional white core. (copied from ../_bridge.js lineSeg)
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

  // palette keys (with sensible Futuristic defaults if a key is absent).
  const C_LINE = palette.line || '#1bf0c8';
  const C_WHITE = palette.white || '#ffffff';
  const C_BLACK = palette.black || '#00e5d0';   // BLACK pearl = teal in this skin
  const C_ERROR = palette.error || '#ff556b';
  const lineCore = opts.core != null ? opts.core : 0.45;

  return {
    id: 'region-masyu',
    animated: true,

    paint(ctx, geom, loop, view) {
      if (!geom || !geom.boxes || !geom.boxes.size) return;
      const first = geom.boxes.get('r0c0');
      if (!first) return;
      const cw = first.w;
      const glow = glowAt(view && view.t != null ? view.t : 0);
      const conflicts = (view && view.conflicts) || new Set();
      let bi = 1;

      // 1) the LOOP — drawn first, UNDER the pearls. Full centre-to-centre so segments join.
      const lw = Math.max(1.5, cw * 0.075);
      for (const key of Object.keys(loop || {})) {
        const [idA, idB] = key.split('|');
        const ba = geom.boxes.get(idA), bb = geom.boxes.get(idB);
        if (!ba || !bb) continue;
        const ax = ba.x + ba.w / 2, ay = ba.y + ba.h / 2;
        const bx = bb.x + bb.w / 2, by = bb.y + bb.h / 2;
        lineSeg(ctx, ax, ay, bx, by, lw, C_LINE, glow, lineCore);
      }

      // 2) the PEARLS — on top of the loop. Number/glyph (if any) is drawn above by the skin glyph.
      for (const cell of geom.grid.cells) {
        if (cell.role !== 'clue') continue;
        const b = geom.boxes.get(cell.id); if (!b) continue;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const s = b.w * 0.22;                                   // half-extent of the pearl square
        const th = Math.max(1.5, b.w * (p.thickness / 100));    // bar thickness
        const ri = th;                                          // corner inset
        const conflict = conflicts.has(cell.id);
        const isBlack = cell.value === 'B';

        // square corners (centred on the cell).
        const x0 = cx - s, y0 = cy - s, x1 = cx + s, y1 = cy + s;

        // colour: error overrides; else white pearl = white, black pearl = teal.
        const col = conflict ? C_ERROR : (isBlack ? C_BLACK : C_WHITE);

        // BLACK: translucent teal fill UNDER the edge bars (skip if showing an error).
        if (isBlack && !conflict) {
          ctx.save();
          ctx.shadowBlur = 0; ctx.globalAlpha = 0.18; ctx.fillStyle = C_BLACK;
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
          ctx.restore();
        }

        // four edge bars (top/bottom/left/right), inset by ri at the corners — the membrane block.
        drawSeg(ctx, x0 + ri, y0, x1 - ri, y0, col, true, vary(bi++), th, glow);
        drawSeg(ctx, x0 + ri, y1, x1 - ri, y1, col, true, vary(bi++), th, glow);
        drawSeg(ctx, x0, y0 + ri, x0, y1 - ri, col, true, vary(bi++), th, glow);
        drawSeg(ctx, x1, y0 + ri, x1, y1 - ri, col, true, vary(bi++), th, glow);

        // BLACK: glowing centre dot — the starburst decimal-point idiom (teal glow, white core).
        if (isBlack && !conflict) {
          const dotR = th * 0.6;
          ctx.save();
          ctx.fillStyle = C_BLACK; ctx.shadowColor = C_BLACK; ctx.shadowBlur = glow;
          ctx.beginPath(); ctx.arc(cx, cy, dotR, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.globalAlpha = p.coreWhite / 100;
          ctx.beginPath(); ctx.arc(cx, cy, dotR * 0.5, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.restore();
        }

        // safety: never leak shadow/alpha state to the next pearl or the next renderer.
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
    },
  };
}
