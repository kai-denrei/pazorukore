// src/display/displays/lixie.js — VENDORED renderer module (dexipurei-galore).
import { stageSize, bloom, vignette, hex2rgb, mix, rgba, dust, scratches } from '../core.js';

// lixie.js — Lixie Tube (emissive). HANDOVER §6.08. Edge-lit engraved acrylic: per digit position there
// are EXACTLY 10 stacked transparent panels, each etched with one numeral 0-9 and lit edge-on. The active
// numeral's etched lines scatter the edge-LED light and the glyph appears to float inside the stack; the
// other nine are faint ALWAYS-VISIBLE ghosts — all ten overlap, and that layered overlap IS the signature
// look. Deeper panels are pushed back/down (Z/parallax). Edge-LEDs bleed colour along the panel borders.
// Wear (rng.hash): dust + scratches on the panels, uneven per-layer LED brightness, a slight chromatic edge.


// Etch each numeral with a thin condensed font so the engraved lines read like scattered light, not paint.
const ETCH_FONT = "'Cormorant Garamond', 'JetBrains Mono', serif";
// Physical panel stacking order (front-to-back) — NOT numeric, so neighbouring digits don't line up and the
// overlap stays believable. Earlier = closer to the viewer (drawn last, least parallax push).
const PANEL_ORDER = [4, 7, 1, 9, 2, 6, 0, 8, 3, 5];
const LAYERS = 10; // EXACTLY ten panels per digit — the whole point of a Lixie.

// digit string from text or a live clock
function content(p) {
  if (p.source === 'clock') {
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    return z(d.getHours()) + ':' + z(d.getMinutes());
  }
  return (p.text || ' ').toString();
}

const __MOD__ = {
  id: 'lixie',
  name: 'Lixie Tube',
  category: 'emissive',
  physics: 'Edge-lit engraved acrylic: ten stacked transparent panels, each etched with one numeral 0-9; the energized panel\'s etched lines scatter edge-LED light so the active glyph floats in the stack while nine faint ghosts always overlap.',
  USES: ['stageSize', 'bloom', 'vignette', 'hex2rgb', 'mix', 'rgba', 'dust', 'scratches'],
  params: [
    { key: 'text', label: 'text', type: 'text', max: 12, default: '1971', group: 'content' },
    { key: 'source', label: 'source', type: 'select', options: ['text', 'clock'], default: 'text', group: 'content' },
    { key: 'color', label: 'glow', type: 'color', default: '#36d6ff', group: 'color' },
    { key: 'bg', label: 'background', type: 'color', default: '#04080c', group: 'color' },
    { key: 'edgeColor', label: 'edge LED', type: 'color', default: '#1a8cff', group: 'color' },
    { key: 'glow', label: 'glow radius', type: 'range', min: 0, max: 50, step: 1, default: 20, group: 'glow' },
    { key: 'bloomInt', label: 'bloom', type: 'range', min: 0, max: 100, step: 1, default: 58, group: 'glow' },
    { key: 'coreWhite', label: 'hot core', type: 'range', min: 0, max: 100, step: 1, default: 34, group: 'glow' },
    { key: 'etchW', label: 'etch width', type: 'range', min: 4, max: 26, step: 1, default: 12, group: 'stack' },
    { key: 'offset', label: 'layer offset', type: 'range', min: 0, max: 100, step: 1, default: 46, group: 'stack' },
    { key: 'ghost', label: 'ghost panels', type: 'range', min: 0, max: 100, step: 1, default: 30, group: 'stack' },
    { key: 'edgeBleed', label: 'edge bleed', type: 'range', min: 0, max: 100, step: 1, default: 44, group: 'stack' },
    { key: 'ledVary', label: 'LED variance', type: 'range', min: 0, max: 100, step: 1, default: 30, group: 'wear' },
    { key: 'chroma', label: 'chromatic', type: 'range', min: 0, max: 100, step: 1, default: 24, group: 'wear' },
    { key: 'dust', label: 'dust', type: 'range', min: 0, max: 100, step: 1, default: 26, group: 'wear' },
    { key: 'scratch', label: 'scratches', type: 'range', min: 0, max: 40, step: 1, default: 10, group: 'wear' },
    { key: 'vignette', label: 'vignette', type: 'range', min: 0, max: 100, step: 1, default: 48, group: 'wear' },
  ],
  presets: {
    'B-7971': { color: '#36d6ff', bg: '#04080c', edgeColor: '#1a8cff', glow: 20, bloomInt: 58, coreWhite: 34, etchW: 12, offset: 46, ghost: 30, edgeBleed: 44, ledVary: 30, chroma: 24, dust: 26, scratch: 10, vignette: 48 },
    Pristine: { color: '#7fe8ff', bg: '#03060a', edgeColor: '#2aa0ff', glow: 16, bloomInt: 44, coreWhite: 26, etchW: 9, offset: 34, ghost: 16, edgeBleed: 30, ledVary: 8, chroma: 8, dust: 6, scratch: 2, vignette: 30 },
    Amberglass: { color: '#ffc24a', bg: '#0a0702', edgeColor: '#ff8a1a', glow: 24, bloomInt: 66, coreWhite: 20, etchW: 14, offset: 56, ghost: 40, edgeBleed: 58, ledVary: 36, chroma: 30, dust: 34, scratch: 16, vignette: 54 },
    Foggy: { color: '#9affd0', bg: '#040a08', edgeColor: '#2affb0', glow: 30, bloomInt: 78, coreWhite: 14, etchW: 18, offset: 70, ghost: 56, edgeBleed: 70, ledVary: 48, chroma: 42, dust: 52, scratch: 26, vignette: 62 },
  },

  render(ctx, p, t, rng) {
    const { w, h } = stageSize(ctx);
    const glowC = hex2rgb(p.color), bg = hex2rgb(p.bg), edgeC = hex2rgb(p.edgeColor);
    const coreC = mix(glowC, [255, 255, 255], p.coreWhite / 100);
    if (!p.transparent) { ctx.fillStyle = rgba(bg, 1); ctx.fillRect(0, 0, w, h); }

    const str = content(p);
    const n = str.length;
    const pad = Math.min(w, h) * 0.13;

    // size each digit cell to fit the stage (acrylic block aspect ~ 0.66 wide : 1 tall)
    const aspect = 0.66, gapFrac = 0.3;
    let dh = h - pad * 2, dw = dh * aspect, gp = dw * gapFrac;
    const maxW = w - pad * 2, total = (k) => dw * k + gp * (k - 1);
    if (total(n) > maxW) { const s = maxW / total(n); dw *= s; dh *= s; gp = dw * gapFrac; }
    const fontPx = dh * 0.74;
    const startX = (w - total(n)) / 2, y = h / 2;

    // parallax push per stack layer: deeper panels sink down & back-right, fanning the etched ghosts.
    const push = (p.offset / 100) * fontPx * 0.085;
    const ghostA = p.ghost / 100, ledV = p.ledVary / 100, chroma = (p.chroma / 100) * fontPx * 0.012;
    const etchPx = Math.max(1, fontPx * (p.etchW / 1000)); // etch-line width tracks the slider + font scale

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // draw one etched numeral as a thin stroked + faintly filled glyph at (gx,gy)
    const etch = (g, ch, gx, gy, stroke, fill, lw) => {
      g.font = `${fontPx}px ${ETCH_FONT}`;
      g.lineWidth = lw; g.lineJoin = 'round';
      if (fill) { g.fillStyle = fill; g.fillText(ch, gx, gy); }
      if (stroke) { g.strokeStyle = stroke; g.strokeText(ch, gx, gy); }
    };

    const lit = []; // active glyphs collected for one additive bloom pass at the end

    for (let i = 0; i < n; i++) {
      const ch = str[i];
      const cx = startX + dw * (i + 0.5) + gp * i;

      // clock colon — two small edge-lit dots, not a panel stack
      if (ch === ':' || ch === ' ') {
        if (ch === ':') {
          for (const dy of [-fontPx * 0.2, fontPx * 0.2]) {
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = rgba(glowC, 0.85); ctx.shadowColor = rgba(glowC, 1); ctx.shadowBlur = p.glow * 0.6;
            ctx.beginPath(); ctx.arc(cx, y + dy, fontPx * 0.05, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          }
          ctx.shadowBlur = 0;
        }
        continue;
      }

      // per-digit edge-LED brightness is uneven (stable per seed) — some panels are lit a touch dimmer.
      const ledB = Math.max(0.4, 1 - ledV * rng.hash(i + 5, 71));

      // 1) edge-LED color bleed along the panel border: a soft frame glow behind the whole stack.
      if (p.edgeBleed > 0) {
        const bw = dw * 0.5, bh = dh * 0.5, bx = cx, by = y;
        const eb = (p.edgeBleed / 100) * ledB;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        // top/bottom edges glow strongest (the LEDs sit on those rails), fading inward
        for (const side of [-1, 1]) {
          const gy = by + side * bh;
          const grd = ctx.createLinearGradient(bx, gy, bx, by);
          grd.addColorStop(0, rgba(edgeC, 0.5 * eb));
          grd.addColorStop(1, rgba(edgeC, 0));
          ctx.fillStyle = grd; ctx.fillRect(bx - bw, Math.min(gy, by), bw * 2, bh);
        }
        ctx.restore();
      }

      // 2) ghost stack: ALL ten etched numerals, faint & always visible, back-to-front with Z/parallax.
      //    deeper panels (later in PANEL_ORDER) sink down/right and dim — the fanned overlap reads as depth.
      if (ghostA > 0) {
        for (let s = 0; s < LAYERS; s++) {
          const gnum = PANEL_ORDER[s];
          if (String(gnum) === ch) continue;                 // active panel drawn bright below
          const z = s / (LAYERS - 1);                          // 0 = closest, 1 = deepest panel
          const dz = push * s;                                 // cumulative parallax push
          const a = ghostA * (0.05 + 0.13 * (1 - z)) * ledB;   // nearer ghosts read slightly stronger
          const gx = cx + dz * 0.5, gy = y + dz;
          etch(ctx, String(gnum), gx, gy, rgba(mix(bg, glowC, 0.55), a), rgba(mix(bg, glowC, 0.32), a * 0.4), etchPx * 0.7);
        }
      }

      // 3) active numeral: bright edge-lit etch sitting at the front layer, glow halo + hot core.
      const bright = ledB;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // chromatic edge: a faint red/blue split of the etch (worn acrylic refracts unevenly)
      if (chroma > 0) {
        etch(ctx, ch, cx - chroma, y, rgba([255, 40, 40], 0.28 * bright), null, etchPx);
        etch(ctx, ch, cx + chroma, y, rgba([40, 80, 255], 0.28 * bright), null, etchPx);
      }
      // glow halo (via shadow), then the crisp etched body, then a faint hot core down the etch lines.
      ctx.shadowColor = rgba(glowC, 1); ctx.shadowBlur = p.glow;
      etch(ctx, ch, cx, y, rgba(glowC, 0.55 * bright), rgba(glowC, 0.12 * bright), etchPx);
      ctx.shadowBlur = p.glow * 0.4;
      etch(ctx, ch, cx, y, rgba(glowC, 0.9 * bright), null, etchPx * 0.85);
      if (p.coreWhite > 0) {
        ctx.shadowBlur = 0;
        etch(ctx, ch, cx, y, rgba(coreC, 0.7 * bright), null, etchPx * 0.45);
      }
      ctx.restore();
      ctx.shadowBlur = 0;

      lit.push({ ch, x: cx, y, bright });
    }

    // 4) one soft additive bloom over all lit numerals (light scattering out of the acrylic faces)
    bloom(ctx, (g) => {
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.font = `${fontPx}px ${ETCH_FONT}`;
      for (const L of lit) {
        g.strokeStyle = rgba(glowC, 0.9 * L.bright); g.lineWidth = etchPx;
        g.strokeText(L.ch, L.x, L.y);
      }
    }, p.glow * 0.85, p.bloomInt / 100);

    // 5) panel wear: dust + hairline scratches across the acrylic faces (deterministic per seed).
    dust(ctx, rng, p.dust / 25, w, h);
    scratches(ctx, rng, p.scratch, w, h);

    vignette(ctx, w, h, p.vignette / 100);
  },
};

export default __MOD__;
