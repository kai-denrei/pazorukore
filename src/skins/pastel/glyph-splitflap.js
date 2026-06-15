// src/skins/pastel/glyph-splitflap.js — GlyphRenderer adapter (§8.1) wrapping the vendored
// splitflap module. Same elegant reuse as glyph-16seg.js: render ONE card into a reused transparent
// offscreen (p.transparent=true makes the module skip its full-canvas background), then blit that onto
// the board's shared glyph canvas at the cell box. No fork of the renderer; every splitflap param stays
// live for the ?admin panel via params/getParams/setParams.
//
// THE HARD PART — the split-flap module is built around an INFINITE t-driven arrival cycle (flip the
// cascade, hold, re-scramble, arrive again). We do NOT want that loop on a Sudoku/Shikaku board. So we
// drive `t` ourselves, by hand, to get exactly two behaviours from the same render():
//   • AT REST (anim === null): feed a t value PAST the cascade but inside the hold window, so the card
//     renders FLAT and SETTLED on cell.value. value === null → feed text ' ' → a blank card.
//   • ON cellPlaced (anim != null): map anim.progress → a t that sweeps from 0 through the cascade, so
//     the single card flips ONCE and lands on cell.value by progress === 1.
// flipMs/cascade are kept modest (overrides below) so one cell flip feels tactile, not like a departures
// board re-scrambling.

import splitflap from '../../display/displays/splitflap.js';
import { makeRng } from '../../display/core.js';
import { TRANSITIONS } from './transitions.js';
import { celebrate as celebStep } from '../_celebrate.js';

export const DEFAULT_SEED = 7;

export function makeGlyphSplitflap(palette) {
  // resolve the module defaults, then tune for a SINGLE tactile card in one cell.
  const p = { seed: DEFAULT_SEED };
  for (const param of splitflap.params) p[param.key] = param.default;
  Object.assign(p, {
    // The module steps from a RANDOM start card (up to ~drum-length away) toward the target, so the
    // cascade must span the whole drum or a high-start card never reaches the target and freezes
    // mid-riffle. cascade ≥ drum length guarantees the card is settled at rest AND lands on flip-end;
    // a small flipMs keeps the riffle brisk so it still reads as a quick, tactile settle.
    flipMs: 34, cascade: 48, stagger: 0, bounce: 42, holdMs: 3200,
    // pastel card stock + dark ink; ambient, not emissive.
    gap: 6, radius: 16, seam: 44, wear: 18, misalign: 10, sticky: 0, dust: 0,
    card: palette.card, ink: palette.ink, bg: palette.bg, source: 'text',
  });

  // the resting t: past the cascade (flips finished) and into the hold window → flat settled card.
  const restT = () => p.cascade * Math.max(8, p.flipMs) + p.holdMs * 0.5;

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

  // map anim.progress → (t, params) for a ONE-SHOT flip that lands settled at progress === 1.
  // Returns { pp, t } so paint stays a thin blit. base is a COPY (resting p is never mutated).
  function withAnim(base, anim) {
    const cascade = Math.max(1, base.cascade | 0);
    const flipMs = Math.max(8, base.flipMs);
    if (!anim) return { pp: base, t: restT() };

    const prog = Math.min(1, Math.max(0, anim.progress));
    const out = { ...base };
    switch (anim.event && TRANSITIONS[anim.event] && TRANSITIONS[anim.event].kind) {
      case 'jitter': {
        // conflict: don't flip — show the settled card but shake it (crank misalign with a quick wobble),
        // a touch of bounce so the card never reads as calm during a bad placement.
        const wob = Math.abs(Math.sin(prog * Math.PI * 6)) * (1 - prog);
        out.misalign = Math.min(100, base.misalign + 70 * wob);
        out.bounce = Math.min(100, base.bounce + 30 * wob);
        return { pp: out, t: restT() };
      }
      case 'cascade': {
        // solve: a slightly longer sweep through more cards for a celebratory board-wide flap.
        out.cascade = Math.max(cascade, 10);
        const t = prog * out.cascade * flipMs;
        return { pp: out, t };
      }
      case 'settle':
      default: {
        // the one-shot flip: t sweeps 0 → cascade*flipMs so the card flips through the drum and seats
        // on the target by progress === 1. The module's own settle-bounce handles the tactile landing.
        const t = prog * cascade * flipMs;
        return { pp: out, t };
      }
    }
  }

  function drawPencil(ctx, box, pencil) {
    const n = box.w, cell = n / 3;
    ctx.save();
    ctx.fillStyle = palette.off;
    ctx.font = `${Math.round(cell * 0.6)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const d of pencil) {
      const v = parseInt(d, 10); if (!v) continue;
      const r = Math.floor((v - 1) / 3), c = (v - 1) % 3;
      ctx.fillText(d, box.x + cell * (c + 0.5), box.y + cell * (r + 0.5));
    }
    ctx.restore();
  }

  // SOLVE celebration choreography (unison across all cards — same progress + seed everywhere):
  // flip and land on "0", then cycle 1→9 quickly. Returns the displayed char + a vertical fold
  // amount (1 = full card, →0 = folded edge-on) so each change reads as a flap flip.
  function celebrate(progress) {
    // shared digit choreography; fold ramps 0→1 over the FIRST quarter of each beat (the quick
    // flip-in) then holds at 1 so the digit is legible. A sharp 1→0 jump at each beat reads as a flip.
    const { ch, f, phase } = celebStep(progress);
    return { ch, fold: Math.min(1, f * (phase === 1 ? 3.2 : 4)) };
  }

  return {
    id: 'glyph-splitflap',
    params: splitflap.params,
    measure: () => ({ aspect: 1 }),
    getParams: () => p,
    setParams: (ov) => Object.assign(p, ov),
    setColors: (pal) => { p.card = pal.card; p.ink = pal.ink; p.bg = pal.bg; },
    transitionFor: (event) => TRANSITIONS[event] || null,

    paint(ctx, box, cell, view, anim) {
      // pencil-only cell (no value): show candidates instead of a card
      if (cell.value == null && view.pencil && view.pencil.length) { drawPencil(ctx, box, view.pencil); return; }

      const dpr = ctx.canvas._dpr || 1;
      const kind = anim && TRANSITIONS[anim.event] && TRANSITIONS[anim.event].kind;

      // SOLVE celebration: ignore the cell's real value; render the unison flip-to-0-then-cycle-1→9.
      if (kind === 'celebrate') {
        const { ch, fold } = celebrate(anim.progress);
        const oc = offCtx(box, dpr);
        splitflap.render(oc, { ...p, transparent: true, text: ch, ink: palette.ink }, restT(), makeRng(p.seed));
        const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(1, Math.max(0.04, fold)); ctx.translate(-cx, -cy);
        ctx.drawImage(off, box.x, box.y, box.w, box.h);
        ctx.restore();
        return;
      }

      const oc = offCtx(box, dpr);
      const ch = cell.value == null ? ' ' : String(cell.value);
      let base = { ...p, transparent: true, text: ch };
      // ink colour reflects state: conflict → error ink, given → given ink, else the resting ink.
      if (view.conflict) base.ink = palette.error;
      else if (cell.given) base.ink = palette.given;
      else base.ink = palette.ink;

      const { pp, t } = withAnim(base, anim);
      splitflap.render(oc, pp, t, makeRng(p.seed));
      ctx.drawImage(off, box.x, box.y, box.w, box.h);
    },
  };
}
