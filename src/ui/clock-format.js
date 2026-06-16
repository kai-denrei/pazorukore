// src/ui/clock-format.js — pure MMSS formatting for the timer display. No DOM/canvas, so it is
// unit-testable. countUp() is the legacy elapsed clock; countDown() drives the staged countdown
// (which keeps going past zero into the negative).

// Zero-padded MMSS for a whole number of seconds, clamped at 99:59.
function mmssOf(totalSeconds) {
  let s = Math.max(0, Math.floor(totalSeconds));
  // Clamp total to 99:59 = 5999 seconds
  s = Math.min(s, 5999);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}${String(s % 60).padStart(2, '0')}`;
}

// Elapsed time → "MMSS".
export function countUp(elapsedMs) {
  return mmssOf(elapsedMs / 1000);
}

// Remaining time → { mmss, over }. `over` flips true once the budget is spent (remaining ≤ 0);
// mmss always shows the absolute value so the display reads the magnitude of the overrun.
export function countDown(remainingMs) {
  const over = remainingMs <= 0;
  return { mmss: mmssOf(Math.abs(remainingMs) / 1000), over };
}
