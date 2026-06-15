// src/skins/futuristic/transitions.js — semantic event → 16-segment motion (§8.4).
// The board ticker reads `duration`; glyph-16seg.js reads `kind` to shape the per-frame envelope.
export const TRANSITIONS = {
  cellPlaced:       { duration: 340, kind: 'strike' },   // segments strike on with bloom
  cellCleared:      { duration: 180, kind: 'fade' },
  conflictDetected: { duration: 460, kind: 'stutter' },  // red segment stutter
  regionValidated:  { duration: 560, kind: 'halo' },     // border halo pulse (region layer also reacts)
  hintRevealed:     { duration: 700, kind: 'strike' },
  solved:           { duration: 1750, kind: 'celebrate' }, // unison: strike to 0, then cycle 1→9 with bloom
};
