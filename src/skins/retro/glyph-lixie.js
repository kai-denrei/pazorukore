// src/skins/retro/glyph-lixie.js — GlyphRenderer adapter (§8.1 / §9.2) wrapping the vendored
// lixie module (edge-lit stacked-acrylic Lixie tube, read as Nixie warmth). Same reuse pattern as
// futuristic/glyph-16seg.js: render ONE digit into a reused transparent offscreen (p.transparent=true
// makes the module skip its full-canvas background + vignette), then blit that onto the board's
// shared glyph canvas at the cell box. No fork of the renderer; every lixie param stays live for the
// ?admin panel via params/getParams/setParams.

import lixie from '../../display/displays/lixie.js';
import { makeRng } from '../../display/core.js';
import { TRANSITIONS } from './transitions.js';
import { celebrate } from '../_celebrate.js';

// Default seed constant — uniform tubes (same wear/LED variance on every cell).
const SEED = 1971;

export function makeGlyphLixie(palette) {
  // resolve the module defaults, then tune for a single digit in a small cell (Amberglass direction:
  // warm-amber glow, warm-black bg, modest ghost so the unlit-tube off-state stays subtle).
  const p = { seed: SEED };
  for (const param of lixie.params) p[param.key] = param.default;
  Object.assign(p, {
    glow: 22, bloomInt: 60, coreWhite: 24, etchW: 13, offset: 50, ghost: 26,
    edgeBleed: 50, ledVary: 0, chroma: 18, dust: 14, scratch: 4, vignette: 0,
    source: 'text', color: palette.on, bg: palette.bg, edgeColor: palette.edge,
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
      case 'warmGlow':
        // tube warms up: glow + bloom ramp over the envelope.
        out.glow = base.glow * (1 + env * 1.3);
        out.bloomInt = Math.min(100, base.bloomInt + env * 30);
        out.coreWhite = Math.min(100, base.coreWhite + env * 18);
        break;
      case 'flicker': {
        // warm-red tube flicker: jitter brightness via glow + LED variance.
        const flick = Math.abs(Math.sin(anim.progress * Math.PI * 6));
        out.ledVary = Math.min(100, base.ledVary + flick * 55);
        out.glow = base.glow * (0.55 + flick * 1.1);
        out.bloomInt = Math.min(100, base.bloomInt + flick * 20);
        break;
      }
      case 'flush':
        // warm flush: a softer glow swell (region layer carries the rest).
        out.glow = base.glow * (1 + env * 1.0);
        out.edgeBleed = Math.min(100, base.edgeBleed + env * 24);
        break;
      case 'swell':
        // synchronized solved swell: full glow + bloom bloom.
        out.glow = base.glow * (1 + env * 1.9);
        out.bloomInt = Math.min(100, base.bloomInt + env * 36);
        out.coreWhite = Math.min(100, base.coreWhite + env * 24);
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
    id: 'glyph-lixie',
    params: lixie.params,
    measure: () => ({ aspect: 1 }),
    getParams: () => p,
    setParams: (ov) => Object.assign(p, ov),
    setColors: (pal) => { p.color = pal.on; p.bg = pal.bg; if (pal.edge) p.edgeColor = pal.edge; },
    transitionFor: (event) => TRANSITIONS[event] || null,

    paint(ctx, box, cell, view, anim) {
      // pencil-only cell (no value): show candidates instead of a device glyph
      if (cell.value == null && view.pencil && view.pencil.length) { drawPencil(ctx, box, view.pencil); return; }

      const dpr = ctx.canvas._dpr || 1;
      const kind = anim && TRANSITIONS[anim.event] && TRANSITIONS[anim.event].kind;

      // SOLVE celebration: swell to "0", then cycle 1→9 in unison (the tubes counting up), each
      // digit lit with a warm glow swell.
      if (kind === 'celebrate') {
        const { ch: cch, f } = celebrate(anim.progress);
        const env = Math.max(0.3, 1 - f);   // warm swell as each digit lights, settling
        const cp = { ...p, transparent: true, text: cch, color: palette.on,
          glow: p.glow * (1 + env * 1.4), bloomInt: Math.min(100, p.bloomInt + env * 32),
          coreWhite: Math.min(100, p.coreWhite + env * 22), edgeBleed: Math.min(100, p.edgeBleed + env * 18) };
        const oc2 = offCtx(box, dpr);
        lixie.render(oc2, cp, 0, makeRng(p.seed));
        ctx.drawImage(off, box.x, box.y, box.w, box.h);
        return;
      }

      const oc = offCtx(box, dpr);
      const ch = cell.value == null ? ' ' : String(cell.value);
      let pp = { ...p, transparent: true, text: ch };
      if (view.conflict) pp.color = palette.error;
      else if (cell.given) pp.color = palette.given;
      else pp.color = palette.on;
      // OFF device: lixie with text ' ' already shows the faint always-visible ghost panels = an
      // unlit tube. Keep the ghost modest so the off-state reads subtle, not busy.
      if (cell.value == null) pp.ghost = Math.min(p.ghost, 22);

      pp = withAnim(pp, anim);
      const t = anim ? anim.elapsed : 0;
      lixie.render(oc, pp, t, makeRng(p.seed));
      ctx.drawImage(off, box.x, box.y, box.w, box.h);
    },
  };
}
