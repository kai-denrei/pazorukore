// src/display/displays/splitflap.js — VENDORED renderer module (dexipurei-galore).
import { stageSize, hex2rgb, mix, rgba, dust } from '../core.js';

// splitflap.js — Split-flap / Solari board (electromechanical). HANDOVER §6.05. A drum of printed cards
// per cell flips through the alphabet to a target string. Classic TWO-LEAF split: a horizontal seam cuts
// each cell across the middle; the TOP leaf of the current card folds DOWN past the seam, and as it sweeps
// through 90° the next card's top is revealed behind it. NOT emissive — aged off-white card stock with a
// dark printed glyph, ambient-lit (no bloom). Cells cascade to the target, flipping through intermediate
// chars with slight motion blur on fast flips and a settle overshoot/bounce; periodically the board
// re-scrambles so it's always "arriving". Wear (rng.hash): worn/misaligned cards, per-cell tint variance,
// an occasional STICKY card that lands a frame late, dust.


// the printable card alphabet (the physical drum order). Space + A-Z + 0-9 + a few marks, like a real board.
const CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-/'";
const IDX = (() => { const m = {}; for (let i = 0; i < CHARSET.length; i++) m[CHARSET[i]] = i; return m; })();
const BOARD_FONT = "'JetBrains Mono', 'Noto Sans JP', sans-serif";   // JP fallback so kana/kanji cards render

// content: text param (upper-cased to the drum charset) or a live clock.
function content(p) {
  if (p.source === 'clock') {
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
  }
  return (p.text || ' ').toString().toUpperCase();
}

// map any char to its index on the drum (unknowns land on space).
function drumIndex(ch) { return IDX[ch] != null ? IDX[ch] : 0; }

// forward distance (cards step one way only, wrapping past the end of the drum) from a→b.
function fwdDist(a, b, len) { return (b - a + len) % len; }

// per-render drum: the base latin charset + any extra glyphs in the content (kana/kanji) appended, so
// Japanese targets exist on the drum and the leaves can flip to them (drawn via the JP-fallback font).
function buildDrum(str) {
  let d = CHARSET;
  for (const ch of str) if (d.indexOf(ch) < 0) d += ch;
  return d;
}

const __MOD__ = {
  id: 'splitflap',
  name: 'Split-flap (Solari)',
  category: 'electromechanical',
  physics: 'Printed cards on a per-cell drum step one-way through the alphabet; the top leaf folds down across a mid-cell seam to the target. Ambient-lit aged card stock, dark glyph, mechanical settle bounce.',
  USES: ['stageSize', 'hex2rgb', 'mix', 'rgba', 'dust'],
  params: [
    { key: 'text', label: 'text', type: 'text', max: 18, default: 'Split-Flap', group: 'content' },
    { key: 'source', label: 'source', type: 'select', options: ['text', 'clock'], default: 'text', group: 'content' },
    { key: 'card', label: 'card stock', type: 'color', default: '#141210', group: 'color' },
    { key: 'ink', label: 'printed ink', type: 'color', default: '#f3efe6', group: 'color' },
    { key: 'bg', label: 'background', type: 'color', default: '#0c0b0a', group: 'color' },
    { key: 'flipMs', label: 'flip speed', type: 'range', min: 30, max: 200, step: 5, default: 70, group: 'motion' },
    { key: 'cascade', label: 'flips to target', type: 'range', min: 1, max: 28, step: 1, default: 16, group: 'motion' },
    { key: 'stagger', label: 'cascade stagger', type: 'range', min: 0, max: 100, step: 1, default: 40, group: 'motion' },
    { key: 'bounce', label: 'settle bounce', type: 'range', min: 0, max: 100, step: 1, default: 46, group: 'motion' },
    { key: 'holdMs', label: 'arrival hold', type: 'range', min: 600, max: 6000, step: 100, default: 2600, group: 'motion' },
    { key: 'gap', label: 'cell gap', type: 'range', min: 2, max: 40, step: 1, default: 12, group: 'geometry' },
    { key: 'radius', label: 'card radius', type: 'range', min: 0, max: 30, step: 1, default: 9, group: 'geometry' },
    { key: 'seam', label: 'seam darkness', type: 'range', min: 0, max: 100, step: 1, default: 52, group: 'wear' },
    { key: 'wear', label: 'card wear', type: 'range', min: 0, max: 100, step: 1, default: 34, group: 'wear' },
    { key: 'misalign', label: 'misalign jitter', type: 'range', min: 0, max: 100, step: 1, default: 28, group: 'wear' },
    { key: 'sticky', label: 'sticky cards', type: 'range', min: 0, max: 60, step: 1, default: 14, group: 'wear' },
    { key: 'dust', label: 'dust', type: 'range', min: 0, max: 100, step: 1, default: 30, group: 'wear' },
  ],
  presets: {
    Solari: { card: '#e9e2d2', ink: '#1a1713', bg: '#0c0b0a', flipMs: 70, cascade: 16, stagger: 40, bounce: 46, holdMs: 2600, gap: 12, radius: 9, seam: 52, wear: 34, misalign: 28, sticky: 14, dust: 30 },
    Depot: { card: '#1c1a17', ink: '#f3c14a', bg: '#070605', flipMs: 60, cascade: 20, stagger: 55, bounce: 38, holdMs: 2200, gap: 10, radius: 6, seam: 70, wear: 48, misalign: 40, sticky: 22, dust: 44 },
    Pristine: { card: '#f4efe4', ink: '#15120e', bg: '#0e0d0c', flipMs: 90, cascade: 10, stagger: 24, bounce: 30, holdMs: 3400, gap: 16, radius: 12, seam: 36, wear: 8, misalign: 6, sticky: 0, dust: 8 },
    Frantic: { card: '#e4ddcc', ink: '#201b15', bg: '#0a0908', flipMs: 36, cascade: 26, stagger: 70, bounce: 64, holdMs: 1200, gap: 8, radius: 8, seam: 58, wear: 40, misalign: 34, sticky: 28, dust: 36 },
  },

  render(ctx, p, t, rng) {
    const { w, h } = stageSize(ctx);
    const cardC = hex2rgb(p.card), inkC = hex2rgb(p.ink), bgC = hex2rgb(p.bg);
    if (!p.transparent) { ctx.fillStyle = rgba(bgC, 1); ctx.fillRect(0, 0, w, h); }

    const str = content(p);
    const n = str.length;
    const DRUM = buildDrum(str), DLEN = DRUM.length;   // drum absorbs any non-latin glyphs in the target

    // --- fit a row of cells to the stage (real flap cells are taller than wide, ~0.66:1) ---
    const aspect = 0.66, pad = Math.min(w, h) * 0.12, gapPx = (p.gap / 100);
    let ch = h - pad * 2, cw = ch * aspect, gp = cw * gapPx;
    const maxW = w - pad * 2, total = (k) => cw * k + gp * (k - 1);
    if (total(n) > maxW) { const s = maxW / total(n); ch *= s; cw *= s; gp = cw * gapPx; }
    const startX = (w - total(n)) / 2, y0 = (h - ch) / 2;
    const fontPx = ch * 0.58, half = ch / 2;   // a touch smaller so full-width kana/kanji fit the card
    const rad = Math.min(cw, ch) * (p.radius / 100) * 0.5;

    // --- animation clock: one "arrival cycle" = cascade flips + a hold, then re-scramble & arrive again ---
    const flipMs = Math.max(8, p.flipMs);
    const cascadeN = Math.max(1, p.cascade | 0);
    const cycleMs = cascadeN * flipMs + p.holdMs;        // flips first, then the steady hold
    const cycle = Math.floor(t / cycleMs);               // which arrival we're on (integer, advances with t)
    const inCycle = t - cycle * cycleMs;                 // ms elapsed inside this arrival

    const bounceA = p.bounce / 100, wearA = p.wear / 100, misA = p.misalign / 100;
    const stickyP = p.sticky / 100, seamA = p.seam / 100, stagA = p.stagger / 100;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${fontPx}px ${BOARD_FONT}`;

    for (let i = 0; i < n; i++) {
      const cx = startX + cw * (i + 0.5) + gp * i;
      const cyTop = y0, mid = y0 + half;

      // target this cell must arrive at; a per-cell start char is picked from the *previous* cycle's seed so
      // each arrival genuinely flips through intermediates (stable per seed + cycle, so it's reproducible).
      const ti0 = DRUM.indexOf(str[i]); const tgt = ti0 < 0 ? 0 : ti0;
      const startOff = 1 + Math.floor(rng.hash(i + cycle * 13, 71) * (DLEN - 2)); // 1..len-1 cards back
      const fromIdx = (tgt - startOff + DLEN) % DLEN;
      const steps = fwdDist(fromIdx, tgt, DLEN) || DLEN;  // cards to flip this cycle (never zero)

      // cascade stagger: cells nearer the end start a touch later (sweep reads left→right then settling).
      const stag = stagA * (i / Math.max(1, n - 1)) * cascadeN * 0.5 * flipMs;
      // sticky cards land one flip late: stretch their step duration slightly (stable per seed).
      const stick = rng.hash(i + 200, 9) < stickyP ? 1.4 : 1;
      const localT = inCycle - stag;

      // current flip position: how many whole cards have settled + the in-progress fraction.
      let settled, frac, flipping;
      if (localT <= 0) { settled = 0; frac = 0; flipping = true; }
      else {
        const stepMs = flipMs * stick;
        const done = localT / stepMs;
        if (done >= steps) { settled = steps; frac = 0; flipping = false; }
        else { settled = Math.floor(done); frac = done - settled; flipping = true; }
      }
      const curIdx = (fromIdx + settled) % DLEN;        // card currently showing on the bottom leaf
      const nextIdx = (fromIdx + settled + 1) % DLEN;   // card about to drop in from above
      const curCh = DRUM[curIdx], nextCh = DRUM[flipping ? nextIdx : curIdx];

      // settle overshoot: on the very last seated card, add a small decaying bounce on the top leaf.
      let restAng = 0;
      if (!flipping && bounceA > 0) {
        const since = localT - steps * flipMs * stick;            // ms since it seated
        if (since >= 0 && since < 220) {
          const b = (1 - since / 220);
          restAng = Math.sin(since * 0.06) * b * b * bounceA * 0.20; // radians, decaying
        }
      }

      // per-cell lived-in: aged tint variance + a tiny static misalignment offset (stable per seed).
      const tint = mix(cardC, [0, 0, 0], wearA * 0.16 * rng.hash(i + 1, 3));
      const tintWarm = mix(tint, [120, 96, 60], wearA * 0.10 * rng.hash(i + 5, 7));
      const mx = (rng.hash(i + 11, 13) - 0.5) * misA * cw * 0.04;
      const my = (rng.hash(i + 17, 19) - 0.5) * misA * ch * 0.04;

      ctx.save();
      ctx.translate(mx, my);

      // helper: draw a rounded card body of the cell, clipped to either the top or bottom half.
      const cardBody = (fill) => { roundRect(ctx, cx - cw / 2, cyTop, cw, ch, rad); ctx.fillStyle = fill; ctx.fill(); };
      const clipHalf = (top) => { ctx.beginPath(); if (top) ctx.rect(cx - cw, cyTop - 2, cw * 2, half + 2); else ctx.rect(cx - cw, mid, cw * 2, half + 2); ctx.clip(); };
      const glyph = (cardCh, fill) => { ctx.fillStyle = fill; ctx.fillText(cardCh, cx, mid); };

      const bodyFill = rgba(tintWarm, 1);
      const inkFill = rgba(mix(inkC, tintWarm, wearA * 0.12 * rng.hash(i + 23, 29)), 1);

      // 1) BOTTOM leaf = the lower half of the NEXT card (already settling in beneath) once we're mid-flip,
      //    else the current card's bottom. Drawn first; the folding top leaf sweeps over it.
      ctx.save(); clipHalf(false);
      cardBody(bodyFill);
      glyph(flipping ? nextCh : curCh, inkFill);
      ctx.restore();

      // 2) STATIC top leaf = the top half of the CURRENT card, before the fold lifts it. While flipping the
      //    *next* card's top is revealed behind the falling leaf, so draw it here (it sits under the leaf).
      ctx.save(); clipHalf(true);
      cardBody(bodyFill);
      glyph(flipping ? nextCh : curCh, inkFill);
      ctx.restore();

      // 3) FOLDING leaf: the current card's TOP half rotates down about the seam (90°→ flat). We fake the
      //    3D fold by vertically scaling the top half toward the seam, plus a brightness ramp + motion blur.
      if (flipping) {
        const e = restAng ? 0 : frac;                 // 0 (upright) → 1 (flat at seam)
        const sweep = Math.min(1, e);
        const sc = Math.cos(sweep * Math.PI / 2);     // 1 → 0 vertical foreshorten of the falling leaf
        const fast = flipMs <= 60 ? 1 : 0;            // motion-blur the fast presets
        const shade = 0.35 + 0.65 * sc;               // leaf darkens as it tilts edge-on to ambient light
        ctx.save();
        ctx.translate(cx, mid);
        ctx.scale(1, Math.max(0.001, sc));            // foreshorten about the seam
        ctx.translate(-cx, -mid);
        ctx.save(); clipHalf(true);
        cardBody(rgba(mix(tintWarm, bgC, 1 - shade), 1));
        glyph(curCh, rgba(mix(inkC, bgC, 1 - shade), 1));
        ctx.restore();
        // a soft motion-blur ghost of the leaf one beat behind, on the quick presets only.
        if (fast && sc > 0.2) {
          ctx.globalAlpha = 0.18;
          ctx.save(); clipHalf(true); cardBody(rgba(mix(tintWarm, bgC, 0.4), 1)); ctx.restore();
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }

      // 4) settle bounce: nudge the seated top leaf with the decaying overshoot angle (tiny vertical squash).
      if (restAng) {
        ctx.save();
        ctx.translate(cx, mid); ctx.scale(1, Math.max(0.9, 1 - Math.abs(restAng))); ctx.translate(-cx, -mid);
        ctx.save(); clipHalf(true); cardBody(bodyFill); glyph(curCh, inkFill); ctx.restore();
        ctx.restore();
      }

      // 5) seam: the dark horizontal split line + a faint shadow the top leaf casts onto the bottom.
      ctx.fillStyle = rgba([0, 0, 0], 0.55 * seamA);
      ctx.fillRect(cx - cw / 2, mid - Math.max(1, ch * 0.012), cw, Math.max(1.5, ch * 0.024));
      if (seamA > 0) {
        const sg = ctx.createLinearGradient(0, mid, 0, mid + ch * 0.14);
        sg.addColorStop(0, rgba([0, 0, 0], 0.30 * seamA));
        sg.addColorStop(1, rgba([0, 0, 0], 0));
        ctx.save(); clipHalf(false); ctx.fillStyle = sg; ctx.fillRect(cx - cw / 2, mid, cw, ch * 0.16); ctx.restore();
      }

      // 6) card edge: thin worn outline + a top sheen so the stock reads as physical, ambient-lit.
      roundRect(ctx, cx - cw / 2, cyTop, cw, ch, rad);
      ctx.lineWidth = Math.max(0.5, cw * 0.01);
      ctx.strokeStyle = rgba(mix(tintWarm, [0, 0, 0], 0.5), 0.4 + wearA * 0.3 * rng.hash(i + 41, 43));
      ctx.stroke();
      const sheen = ctx.createLinearGradient(0, cyTop, 0, cyTop + ch * 0.4);
      sheen.addColorStop(0, rgba([255, 255, 255], 0.10));
      sheen.addColorStop(1, rgba([255, 255, 255], 0));
      ctx.save(); roundRect(ctx, cx - cw / 2, cyTop, cw, ch, rad); ctx.clip();
      ctx.fillStyle = sheen; ctx.fillRect(cx - cw / 2, cyTop, cw, ch * 0.4); ctx.restore();

      ctx.restore();
    }

    // settled dust over the whole board (stable per seed; never a full-canvas opaque paint).
    dust(ctx, rng, p.dust / 50, w, h);
  },
};

// rounded-rectangle path helper (kept at module scope so the offline exporter inlines it).
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default __MOD__;
