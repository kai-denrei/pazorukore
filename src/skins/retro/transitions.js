// src/skins/retro/transitions.js — semantic event → Lixie-tube motion (§8.4 / §9.2).
// The board ticker reads `duration`; glyph-lixie.js reads `kind` to shape the per-frame envelope.
// Warm-amber Nixie feel: glow ramps, validated flush, tube flicker on conflict, slow solved swell.
export const TRANSITIONS = {
  cellPlaced:       { duration: 380, kind: 'warmGlow' },  // ramp glow + bloom as the tube warms
  cellCleared:      { duration: 200, kind: 'fade' },
  conflictDetected: { duration: 480, kind: 'flicker' },   // warm-red tube flicker (jitter brightness)
  regionValidated:  { duration: 600, kind: 'flush' },     // warm flush (region layer also reacts)
  hintRevealed:     { duration: 760, kind: 'warmGlow' },
  solved:           { duration: 1750, kind: 'celebrate' }, // unison: swell to 0, then cycle 1→9 (tubes counting)
};
