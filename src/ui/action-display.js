// src/ui/action-display.js — the START / NEW (and message) button rendered as a 16-segment display,
// twin to timer-display.js but in neon GREEN. One fixed spot, always present: it shows START before a
// round begins, NEW when a round is over and a new game can be triggered, or any short message. When
// it isn't actionable (mid-play) the same label renders as a dim "ghost" so the display reads as a
// real segment panel that's simply unlit. Reuses the vendored starburst16 renderer (A–Z capable).

import starburst16 from '../display/displays/starburst16.js';
import { makeRng } from '../display/core.js';

const ON = '#2bff84';      // actionable — neon green, lit
const DIM = '#1f6b40';     // not actionable — dim green ghost

export class ActionDisplay {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.p = { seed: 7 };
    for (const param of starburst16.params) this.p[param.key] = param.default;
    Object.assign(this.p, {
      seg16: true, gap: 26, thickness: 16, glow: 13, coreWhite: 22, coreThick: 50,
      bleed: 16, ghost: 9, variance: 7, dimSeg: 'none', vignette: 0,
      color: ON, bg: '#02110a',
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

  // render(text, active): active → lit neon green with full glow; inactive → a dim ghost of the same
  // label (less glow, lower brightness) so the panel stays "present but unlit".
  render(text, active = true) {
    // The action display only repaints on state change (unlike the timer's 1s interval), so if it's
    // asked to paint before its canvas has been laid out (size 0 — e.g. the synchronous setReady()
    // inside mountGame), retry on the next frame until the layout settles, painting the latest state.
    this._last = { text, active };
    if (!this.size()) {
      this._retries = (this._retries || 0) + 1;
      if (this._retries <= 30) requestAnimationFrame(() => { const l = this._last; this.render(l.text, l.active); });
      return;
    }
    this._retries = 0;
    const ctx = this.ctx, dpr = this.cv._dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = this.cv.width / dpr, h = this.cv.height / dpr;
    ctx.clearRect(0, 0, w, h);
    this.cv._transparent = true;
    const color = active ? ON : DIM;
    const glow = active ? this.p.glow : 2;
    const coreWhite = active ? this.p.coreWhite : 0;
    ctx.save();
    if (!active) ctx.globalAlpha = 0.7;
    starburst16.render(ctx, { ...this.p, transparent: true, text: String(text || ''), color, glow, coreWhite }, 0, makeRng(this.p.seed));
    ctx.restore();
  }
}

export default ActionDisplay;
