// src/skins/_stars.js — Star Battle star renderer (skin-agnostic; painted by board.js on the grid
// layer, gated to starbattle). Draws a glowing 5-point star in each cell of playState.stars
// ({cellId:1}). Region outlines are drawn by the shared _cage renderer (regionId outlines); stars are
// this. Each skin supplies a { fill, glow } palette.

export function makeStarsRenderer() {
  function starPath(ctx, cx, cy, rOuter, rInner) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? rOuter : rInner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  return {
    paint(ctx, geom, stars, palette) {
      const boxes = geom.boxes;
      const fill = (palette && palette.fill) || '#ffd54a';
      const glow = (palette && palette.glow) || fill;
      ctx.save();
      ctx.lineJoin = 'round';
      for (const id of Object.keys(stars)) {
        if (!stars[id]) continue;
        const b = boxes.get(id); if (!b) continue;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const rO = Math.min(b.w, b.h) * 0.34, rI = rO * 0.42;
        ctx.fillStyle = fill; ctx.shadowColor = glow; ctx.shadowBlur = rO * 0.85;
        starPath(ctx, cx, cy, rO, rI); ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    },
  };
}

export default makeStarsRenderer;
