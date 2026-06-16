// src/skins/_slither.js — Slitherlink loop renderer (skin-agnostic; painted by board.js on the grid
// layer, like _cage/_region-tint). The loop lives in playState.loop keyed by dot-edge ("d{r}c{c}|…")
// over the (rows+1)×(cols+1) DOT lattice at cell corners. We draw a faint dot at every lattice point
// (so the grid of dots reads) and the player's present edges as bold neon lines between dots. Clue
// numbers (0-3) are rendered separately by the glyph layer. Each skin supplies a { line, dot } palette.

const parseDot = (id) => { const m = /^d(\d+)c(\d+)$/.exec(id); return m ? { r: +m[1], c: +m[2] } : null; };

export function makeSlitherRenderer() {
  // dot-lattice pixel coords from the measured cell boxes: xs[0..cols], ys[0..rows].
  function lattice(geom) {
    const { rows, cols, boxes } = geom;
    const xs = [], ys = [];
    for (let c = 0; c < cols; c++) { const b = boxes.get(`r0c${c}`); if (!b) return null; xs.push(b.x); }
    const lc = boxes.get(`r0c${cols - 1}`); if (!lc) return null; xs.push(lc.x + lc.w);
    for (let r = 0; r < rows; r++) { const b = boxes.get(`r${r}c0`); if (!b) return null; ys.push(b.y); }
    const lr = boxes.get(`r${rows - 1}c0`); if (!lr) return null; ys.push(lr.y + lr.h);
    return { xs, ys };
  }

  function neonLine(ctx, x1, y1, x2, y2, w, color, glow) {
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.lineCap = 'round'; ctx.lineWidth = w;
    ctx.shadowBlur = glow; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); // glow
    ctx.shadowBlur = 0; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();    // solid
  }

  return {
    paint(ctx, geom, loop, palette) {
      const L = lattice(geom); if (!L) return;
      const { xs, ys } = L;
      const cw = (geom.boxes.get('r0c0') || { w: 30 }).w;
      const line = (palette && palette.line) || '#1bf0c8';
      const dotCol = (palette && palette.dot) || 'rgba(150,200,210,0.4)';
      const lw = Math.max(2, cw * 0.075);
      const dotR = Math.max(1.1, cw * 0.045);
      ctx.save();
      // faint lattice dots at every corner
      ctx.fillStyle = dotCol;
      for (let r = 0; r < ys.length; r++) {
        for (let c = 0; c < xs.length; c++) { ctx.beginPath(); ctx.arc(xs[c], ys[r], dotR, 0, Math.PI * 2); ctx.fill(); }
      }
      // present loop edges as bold neon lines between dots
      for (const key of Object.keys(loop)) {
        if (!loop[key]) continue;
        const [a, b] = key.split('|');
        const pa = parseDot(a), pb = parseDot(b);
        if (!pa || !pb || pa.r >= ys.length || pa.c >= xs.length || pb.r >= ys.length || pb.c >= xs.length) continue;
        neonLine(ctx, xs[pa.c], ys[pa.r], xs[pb.c], ys[pb.r], lw, line, lw * 2.2);
      }
      ctx.restore();
    },
  };
}

export default makeSlitherRenderer;
