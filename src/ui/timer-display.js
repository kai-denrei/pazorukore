// src/ui/timer-display.js — the elapsed-time clock rendered as an old-school 16-segment display
// (red), reusing the vendored starburst16 renderer. Time is shown as MMSS digits with a hand-drawn
// colon at the centre (16-seg has no colon glyph); off-segments keep their faint "ghost" so it reads
// like a real segment clock. Turns green when the puzzle is solved.

import starburst16 from '../display/displays/starburst16.js';
import { makeRng } from '../display/core.js';

const RUN = '#ff2a2a';     // running — old-school red
const DONE = '#37e0a0';    // solved — green

export class TimerDisplay {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.p = { seed: 5 };
    for (const param of starburst16.params) this.p[param.key] = param.default;
    Object.assign(this.p, {
      seg16: true, gap: 26, thickness: 17, glow: 11, coreWhite: 24, coreThick: 50,
      bleed: 16, ghost: 8, variance: 7, dimSeg: 'none', vignette: 0,
      color: RUN, bg: '#0a0203',
    });
    this._sized = false;
  }

  size() {
    const r = this.cv.getBoundingClientRect();
    if (!r.width) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.cv.width = Math.max(1, Math.round(r.width * dpr));
    this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.cv._dpr = dpr;
    this.cv._transparent = true;
    this._sized = true;
    return true;
  }

  // mmss = 4 chars (zero-padded minutes + seconds), e.g. "0042" → renders 00:42.
  render(mmss, solved) {
    if (!this.size()) return;
    const ctx = this.ctx, dpr = this.cv._dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = this.cv.width / dpr, h = this.cv.height / dpr;
    ctx.clearRect(0, 0, w, h);
    this.cv._transparent = true;
    const color = solved ? DONE : RUN;
    starburst16.render(ctx, { ...this.p, transparent: true, text: mmss, color }, 0, makeRng(this.p.seed));
    // colon: two dots at the horizontal centre (= the gap between the 2nd and 3rd digit of MMSS).
    const cx = w / 2, rad = Math.max(1.3, h * 0.05);
    ctx.save();
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = this.p.glow;
    for (const dy of [-h * 0.14, h * 0.14]) { ctx.beginPath(); ctx.arc(cx, h / 2 + dy, rad, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
}
