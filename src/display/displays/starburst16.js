// src/display/displays/starburst16.js — VENDORED renderer module (dexipurei-galore).
import { stageSize, vignette, hex2rgb, rgba } from '../core.js';

// starburst16.js — 16-Segment Starburst (emissive). HANDOVER §6.04.
// Same emissive bar physics as sevenseg.js — elongated-hex bars, multi-pass glow + white hot core,
// off-segment ghost, junction bleed, per-segment variance — but with 14/16 segments (split horizontals
// + four diagonals + two center verticals) so the display is FULL ALPHANUMERIC. The real work is the
// segment GEOMETRY (SEG16) and a legible GLYPH map covering 0-9 and A-Z. A toggle drops the two center
// verticals (i & l) for the common 14-segment part. Segment bars still cannot form kanji — keep content
// alphanumeric; unknown chars render as '-'.


// 16-segment labels. Outer ring (like 7-seg but horizontals split):
//   a1 a2 = top (L,R) · d1 d2 = bottom (L,R) · b,c = right verticals (top,bottom) · f,e = left (top,bottom)
// Inner star: g1 g2 = center horizontals (L,R) · the diagonals/verticals fill the gaps:
//   h = TL->center · i = top-center vertical · j = TR->center
//   k = BL->center · l = bottom-center vertical · m = BR->center
const SEG_ALL = ['a1', 'a2', 'b', 'c', 'd1', 'd2', 'e', 'f', 'g1', 'g2', 'h', 'i', 'j', 'k', 'l', 'm'];
const CENTER_VERTS = ['i', 'l']; // dropped in 14-segment mode

// which segments light per character (uppercased on lookup). chosen for legibility on a real starburst.
const GLYPH = {
  '0': 'a1 a2 b c d1 d2 e f j k',          // slashed zero (diagonals = the slash)
  '1': 'b c',                               // two right verticals only — a 7-seg-style "1" (2 segments)
  '2': 'a1 a2 b g1 g2 e d1 d2',
  '3': 'a1 a2 b c d1 d2 g2',
  '4': 'f g1 g2 b c',
  '5': 'a1 a2 f g1 g2 c d1 d2',
  '6': 'a1 a2 f g1 g2 e c d1 d2',
  '7': 'a1 a2 b c',
  '8': 'a1 a2 b c d1 d2 e f g1 g2',
  '9': 'a1 a2 b c d1 d2 f g1 g2',
  'A': 'a1 a2 b c e f g1 g2',
  'B': 'a1 a2 b c d1 d2 g2 i l',            // verticals split the closed loop
  'C': 'a1 a2 f e d1 d2',
  'D': 'a1 a2 b c d1 d2 i l',
  'E': 'a1 a2 f e g1 d1 d2',
  'F': 'a1 a2 f e g1',
  'G': 'a1 a2 f e c d1 d2 g2',
  'H': 'b c e f g1 g2',
  'I': 'a1 a2 d1 d2 i l',
  'J': 'b c d1 d2 e',
  'K': 'f e g1 j m',                        // arms via diagonals
  'L': 'f e d1 d2',
  'M': 'b c e f h j',                        // outer verts + two top diagonals
  'N': 'b c e f h m',                        // verts + TL & BR diagonals
  'O': 'a1 a2 b c d1 d2 e f',
  'P': 'a1 a2 b f e g1 g2',
  'Q': 'a1 a2 b c d1 d2 e f m',             // O with a tail
  'R': 'a1 a2 b f e g1 g2 m',               // P with a diagonal leg
  'S': 'a1 a2 f g1 g2 c d1 d2',
  'T': 'a1 a2 i l',                         // top bar + center mast
  'U': 'b c d1 d2 e f',
  'V': 'f e k j',                           // left verts + two diagonals meeting low
  'W': 'b c e f k m',                       // verts + two bottom diagonals
  'X': 'h j k m',                           // pure diagonal cross
  'Y': 'h j l',                             // upper diagonals into the center mast
  'Z': 'a1 a2 j k d1 d2',                   // top + diagonal + bottom
  '-': 'g1 g2', '_': 'd1 d2', '=': 'g1 g2 d1 d2', '+': 'g1 g2 i l',
  '/': 'j k', '\\': 'h m', '*': 'g1 g2 h i j k l m', '°': 'a1 a2 b f g1 g2', ' ': '',
};

// segment endpoints inside a w×h box, bar thickness t. mirrors sevenseg's segEnds but for 16 cells.
function SEG16(seg, w, h, t) {
  const ht = t / 2, hw = w / 2, hh = h / 2;
  switch (seg) {
    case 'a1': return [t, ht, hw, ht];
    case 'a2': return [hw, ht, w - t, ht];
    case 'b': return [w - ht, t, w - ht, hh - ht];
    case 'c': return [w - ht, hh + ht, w - ht, h - t];
    case 'd1': return [t, h - ht, hw, h - ht];
    case 'd2': return [hw, h - ht, w - t, h - ht];
    case 'e': return [ht, hh + ht, ht, h - t];
    case 'f': return [ht, t, ht, hh - ht];
    case 'g1': return [t, hh, hw, hh];
    case 'g2': return [hw, hh, w - t, hh];
    case 'h': return [ht + t, t + ht, hw - ht, hh - ht];     // TL -> center
    case 'i': return [hw, t, hw, hh - ht];                    // top-center vertical
    case 'j': return [w - ht - t, t + ht, hw + ht, hh - ht];  // TR -> center
    case 'k': return [ht + t, h - t - ht, hw - ht, hh + ht];  // BL -> center
    case 'l': return [hw, hh + ht, hw, h - t];                // bottom-center vertical
    case 'm': return [w - ht - t, h - t - ht, hw + ht, hh + ht]; // BR -> center
  }
  return [0, 0, 0, 0];
}

// elongated hex (rounded-tip bar) path between two points — identical idiom to sevenseg.vhex.
function vhex(ctx, x1, y1, x2, y2, th) {
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

// split a glyph string into a Set of segment labels. unknown -> '-'.
function segsFor(ch, has16) {
  const key = GLYPH[ch] != null ? ch : '-';
  let list = GLYPH[key].split(' ').filter(Boolean);
  if (!has16) list = list.filter((s) => CENTER_VERTS.indexOf(s) < 0);
  return new Set(list);
}

function parse(str) {
  const toks = [];
  for (const ch of String(str)) {
    if (ch === '.') { const last = toks[toks.length - 1]; if (last && !last.dp) { last.dp = true; continue; } }
    toks.push({ ch: ch === ' ' ? ' ' : ch.toUpperCase(), dp: false });
  }
  return toks.length ? toks : [{ ch: ' ', dp: false }];
}

const __MOD__ = {
  id: 'starburst16',
  name: '16-Segment Starburst',
  category: 'emissive',
  physics: 'Emissive bar segments like a VFD/LED 7-seg, but 14/16 bars (split horizontals + four diagonals + two center verts) for full alphanumeric: hex bars, multi-pass glow + white hot core, off-segment ghost, junction bleed, per-segment variance. Segment bars cannot form kanji — content is alphanumeric.',
  USES: ['stageSize', 'vignette', 'hex2rgb', 'rgba'],
  params: [
    { key: 'text', label: 'text', type: 'text', max: 16, default: '16 SEGMENTS', group: 'content' },
    { key: 'source', label: 'source', type: 'select', options: ['text', 'clock'], default: 'text', group: 'content' },
    { key: 'seg16', label: '16 segments', type: 'toggle', default: true, group: 'content' },
    { key: 'color', label: 'segment', type: 'color', default: '#ffb000', group: 'color' },
    { key: 'bg', label: 'background', type: 'color', default: '#0c0702', group: 'color' },
    { key: 'thickness', label: 'bar width', type: 'range', min: 6, max: 22, step: 1, default: 13, group: 'geometry' },
    { key: 'gap', label: 'char gap', type: 'range', min: 10, max: 55, step: 1, default: 30, group: 'geometry' },
    { key: 'glow', label: 'glow', type: 'range', min: 0, max: 34, step: 1, default: 15, group: 'glow' },
    { key: 'coreWhite', label: 'hot core', type: 'range', min: 0, max: 100, step: 1, default: 78, group: 'glow' },
    { key: 'coreThick', label: 'core width', type: 'range', min: 20, max: 90, step: 1, default: 54, group: 'glow' },
    { key: 'ghost', label: 'ghost all-on', type: 'range', min: 0, max: 30, step: 1, default: 5, group: 'wear' },
    { key: 'bleed', label: 'junction bleed', type: 'range', min: 0, max: 100, step: 1, default: 34, group: 'wear' },
    { key: 'variance', label: 'seg variance', type: 'range', min: 0, max: 100, step: 1, default: 22, group: 'wear' },
    { key: 'dimSeg', label: 'dim segment', type: 'select', options: ['none', ...SEG_ALL], default: 'h', group: 'wear' },
    { key: 'vignette', label: 'vignette', type: 'range', min: 0, max: 100, step: 1, default: 40, group: 'wear' },
  ],
  presets: {
    Amber: { color: '#ffb000', bg: '#0c0702', seg16: true, thickness: 13, glow: 15, coreWhite: 78, coreThick: 54, ghost: 5, bleed: 34, variance: 22, dimSeg: 'h', vignette: 40 },
    Cyan: { color: '#1bf0c8', bg: '#04100e', seg16: true, thickness: 12, glow: 17, coreWhite: 88, coreThick: 56, ghost: 6, bleed: 30, variance: 24, dimSeg: 'k', vignette: 36 },
    'Depot 14': { color: '#ff5a1f', bg: '#0a0402', seg16: false, thickness: 15, glow: 13, coreWhite: 36, coreThick: 50, ghost: 8, bleed: 40, variance: 34, dimSeg: 'e', vignette: 50 },
    Clean: { color: '#bfeaff', bg: '#03080c', seg16: true, thickness: 10, glow: 7, coreWhite: 66, coreThick: 60, ghost: 2, bleed: 10, variance: 5, dimSeg: 'none', vignette: 18 },
  },

  render(ctx, p, t, rng) {
    const { w, h } = stageSize(ctx);
    const segColor = p.color, has16 = !!p.seg16;
    if (!p.transparent) { ctx.fillStyle = rgba(hex2rgb(p.bg), 1); ctx.fillRect(0, 0, w, h); }

    let str = p.text || ' ';
    if (p.source === 'clock') {
      const d = new Date(), z = (n) => String(n).padStart(2, '0');
      str = z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds());
    }
    const tokens = parse(str);
    const n = tokens.length;

    // fit-to-stage: digit box aspect like sevenseg, scale down if the row overflows the padded width.
    const aspect = 1.55, pad = Math.min(w, h) * 0.14, gapFrac = p.gap / 100;
    let dh = h - pad * 2, dw = dh / aspect, gp = dw * gapFrac;
    let tw = dw * n + gp * (n - 1);
    const maxW = w - pad * 2;
    if (tw > maxW) { const s = maxW / tw; dw *= s; dh *= s; gp = dw * gapFrac; tw = dw * n + gp * (n - 1); }
    const th = dw * (p.thickness / 100);
    const ghostA = p.ghost / 100, varA = p.variance / 100, dim = p.dimSeg, coreW = p.coreWhite / 100;
    let x = (w - tw) / 2;
    const y = (h - dh) / 2;

    // one segment bar: off -> faint ghost; on -> glow pass, junction bleed, solid, white hot core.
    const drawSeg = (x1, y1, x2, y2, bright, on) => {
      if (!on) {
        if (ghostA <= 0) return;
        ctx.shadowBlur = 0; ctx.globalAlpha = ghostA; ctx.fillStyle = segColor;
        vhex(ctx, x1, y1, x2, y2, th * 0.9); ctx.fill(); ctx.globalAlpha = 1;
        return;
      }
      ctx.fillStyle = segColor; ctx.shadowColor = segColor;
      vhex(ctx, x1, y1, x2, y2, th);
      ctx.globalAlpha = 0.55 * bright; ctx.shadowBlur = p.glow; ctx.fill();                         // glow pass
      if (p.bleed > 0) { ctx.globalAlpha = 0.16 * (p.bleed / 100) * bright; ctx.shadowBlur = p.glow * (1 + p.bleed / 60); ctx.fill(); } // junction bleed
      ctx.globalAlpha = Math.min(1, bright); ctx.shadowBlur = 0; ctx.fill();                        // solid
      if (coreW > 0) {
        ctx.globalAlpha = Math.min(1, coreW * bright); ctx.fillStyle = '#fff';
        vhex(ctx, x1, y1, x2, y2, th * (p.coreThick / 100)); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    };

    for (let ti = 0; ti < n; ti++) {
      const tk = tokens[ti];
      const on = segsFor(tk.ch, has16);
      ctx.save(); ctx.translate(x, y);
      for (let i = 0; i < SEG_ALL.length; i++) {
        const seg = SEG_ALL[i];
        if (!has16 && CENTER_VERTS.indexOf(seg) >= 0) continue; // 14-seg: skip i & l entirely
        const [x1, y1, x2, y2] = SEG16(seg, dw, dh, th);
        let bright = 1 - varA * rng.hash(ti * 17 + i, 5);
        if (seg === dim) bright *= 0.34;
        drawSeg(x1, y1, x2, y2, Math.max(0.12, bright), on.has(seg));
      }
      if (tk.dp) { // decimal point: a lit dot at the bottom-right corner
        const r = th * 0.6;
        ctx.fillStyle = segColor; ctx.shadowColor = segColor; ctx.shadowBlur = p.glow;
        ctx.beginPath(); ctx.arc(dw - r, dh - r, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.globalAlpha = coreW;
        ctx.beginPath(); ctx.arc(dw - r, dh - r, r * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.restore();
      x += dw + gp;
    }

    ctx.shadowBlur = 0;
    vignette(ctx, w, h, p.vignette / 100);
  },
};

export default __MOD__;
