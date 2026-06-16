// src/skins/pastel/transitions.js — semantic event → split-flap motion (§8.4 / §9.3).
// The board ticker reads `duration`; glyph-splitflap.js reads `kind` to shape the per-frame envelope.
// Split-flap is tactile, not emissive: a placed cell does ONE flip-and-settle; conflicts jitter the
// card; a solve cascades the whole board through a flap sweep.
export const TRANSITIONS = {
  cellPlaced:       { duration: 480, kind: 'settle' },   // single card flips once and lands on the value
  cellCleared:      { duration: 260, kind: 'settle' },   // flip back to a blank card
  conflictDetected: { duration: 440, kind: 'jitter' },   // card shakes / misaligns on a bad placement
  regionValidated:  { duration: 560, kind: 'settle' },   // region cards re-seat with a soft bounce
  hintRevealed:     { duration: 600, kind: 'settle' },
  solved:           { duration: 3200, kind: 'celebrate' }, // unison: flip to 0, then cycle 1→9 (longer)
};
