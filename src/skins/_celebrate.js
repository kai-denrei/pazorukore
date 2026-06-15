// src/skins/_celebrate.js — the shared solve-celebration choreography used by every skin's glyph
// adapter. In unison across all cells: phase 1 lands on "0", phase 2 cycles 1→9 quickly. Each skin
// renders the returned char with its own flourish (split-flap fold, 16-seg bloom-strike, Lixie glow
// swell). Returns { ch, f, phase }: ch = displayed digit, f = within-beat fraction 0..1 (drives the
// flip/strike envelope), phase = 1 (to-zero) or 2 (cycling).
export function celebrate(progress) {
  if (progress < 0.30) { return { ch: '0', f: progress / 0.30, phase: 1 }; }
  const p2 = (progress - 0.30) / 0.70 * 9;       // 0..9 across phase 2
  const step = Math.min(8, Math.floor(p2));
  return { ch: String(step + 1), f: p2 - step, phase: 2 };
}
