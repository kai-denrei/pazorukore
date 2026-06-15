// src/skins/futuristic/glyph-16seg.js — GlyphRenderer adapter (§8.1) wrapping the vendored
// starburst16 module. The elegant reuse: render ONE digit into a reused transparent offscreen
// (p.transparent=true makes the module skip its full-canvas background + vignette), then blit that
// onto the board's shared glyph canvas at the cell box. No fork of the renderer; every starburst
// param stays live for the ?admin panel via params/getParams/setParams.

import starburst16 from '../../display/displays/starburst16.js';
import { makeRng } from '../../display/core.js';
import { TRANSITIONS } from './transitions.js';
import { celebrate } from '../_celebrate.js';

export function makeGlyph16(palette) {
  // resolve the module defaults, then tune for a single digit in a small square cell.
  const p = { seed: 7 };
  for (const param of starburst16.params) p[param.key] = param.default;
  Object.assign(p, {
    gap: 0, vignette: 0, thickness: 15, glow: 13, coreWhite: 72, coreThick: 52,
    bleed: 22, ghost: 7, variance: 14, dimSeg: 'none', seg16: true,
    color: palette.on, bg: palette.bg,
  });

  let off = null;
  function offCtx(box, dpr) {
    const W = Math.max(1, Math.round(box.w * dpr)), H = Math.max(1, Math.round(box.h * dpr));
    if (!off) off = document.createElement('canvas');
    if (off.width !== W || off.height !== H) { off.width = W; off.height = H; }
    off._dpr = dpr; off._transparent = true;
    const c = off.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, box.w, box.h);
    return c;
  }

  // per-event envelope applied to a COPY of p so the resting params are never mutated.
  function withAnim(base, anim) {
    if (!anim) return base;
    const env = Math.sin(Math.min(1, anim.progress) * Math.PI); // 0→1→0
    const out = { ...base };
    switch (anim.event && TRANSITIONS[anim.event] && TRANSITIONS[anim.event].kind) {
      case 'strike':
        out.glow = base.glow * (1 + env * 1.6);
        out.coreWhite = Math.min(100, base.coreWhite + env * 26);
        out.bleed = Math.min(100, base.bleed + env * 30);
        break;
      case 'stutter': {
        const flick = Math.abs(Math.sin(anim.progress * Math.PI * 5));
        out.variance = Math.min(100, base.variance + flick * 60);
        out.glow = base.glow * (0.5 + flick * 1.2);
        break;
      }
      case 'sweep':
        out.glow = base.glow * (1 + env * 2.2);
        out.coreWhite = Math.min(100, base.coreWhite + env * 28);
        break;
      case 'halo':
        out.glow = base.glow * (1 + env * 1.2);
        break;
      case 'fade':
      default:
        break;
    }
    return out;
  }

  function drawPencil(ctx, box, pencil) {
    const n = box.w, cell = n / 3;
    ctx.save();
    ctx.fillStyle = palette.on; ctx.globalAlpha = 0.5;   // legible candidate marks, dimmer than placed values
    ctx.font = `${Math.round(cell * 0.58)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const d of pencil) {
      const v = parseInt(d, 10); if (!v) continue;
      const r = Math.floor((v - 1) / 3), c = (v - 1) % 3;
      ctx.fillText(d, box.x + cell * (c + 0.5), box.y + cell * (r + 0.5));
    }
    ctx.restore();
  }

  return {
    id: 'glyph-16seg',
    params: starburst16.params,
    measure: () => ({ aspect: 1 }),
    getParams: () => p,
    setParams: (ov) => Object.assign(p, ov),
    setColors: (pal) => { p.color = pal.on; p.bg = pal.bg; },
    transitionFor: (event) => TRANSITIONS[event] || null,

    paint(ctx, box, cell, view, anim) {
      // pencil-only cell (no value): show candidates instead of a device glyph
      if (cell.value == null && view.pencil && view.pencil.length) { drawPencil(ctx, box, view.pencil); return; }

      const dpr = ctx.canvas._dpr || 1;
      const kind = anim && TRANSITIONS[anim.event] && TRANSITIONS[anim.event].kind;

      // SOLVE celebration as a SCANLINE SWEEP (§9.1): each cell's strike-to-0-then-cycle is staggered
      // by its diagonal position, so the bloom rolls diagonally across the board instead of firing all
      // at once. A bright leading edge sharpens the scanline.
      if (kind === 'celebrate') {
        const diag = (((cell.row || 0) + (cell.col || 0)) / 16);   // 0..~1 along the TL→BR diagonal
        const spread = 0.42;                                       // fraction of the timeline the sweep spans
        const cellProg = Math.max(0, Math.min(1, (anim.progress - diag * spread) / (1 - spread)));
        const { ch: cch, f } = celebrate(cellProg);
        const env = Math.max(0.2, 1 - f);
        const edge = Math.max(0, 1 - Math.abs(anim.progress - diag * spread) * 6); // crisp leading edge
        const cp = { ...p, transparent: true, text: cch, color: palette.on,
          glow: p.glow * (1 + env * 1.7 + edge * 1.3),
          coreWhite: Math.min(100, p.coreWhite + env * 22 + edge * 22),
          bleed: Math.min(100, p.bleed + env * 34) };
        const oc2 = offCtx(box, dpr);
        starburst16.render(oc2, cp, 0, makeRng(p.seed));
        ctx.drawImage(off, box.x, box.y, box.w, box.h);
        return;
      }

      const oc = offCtx(box, dpr);
      const ch = cell.value == null ? ' ' : String(cell.value);
      let pp = { ...p, transparent: true, text: ch };
      if (view.conflict) pp.color = palette.error;
      else if (cell.given) pp.color = palette.given;
      else pp.color = palette.on;
      if (cell.value == null) pp.ghost = 9;     // OFF device: faint unlit ghost only

      pp = withAnim(pp, anim);
      const t = anim ? anim.elapsed : 0;
      starburst16.render(oc, pp, t, makeRng(p.seed));
      ctx.drawImage(off, box.x, box.y, box.w, box.h);
    },
  };
}
