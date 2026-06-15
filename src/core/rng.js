// src/core/rng.js — seedable PRNG for reproducible generation (share-by-gameId, §12.3).
// Re-uses the exact mulberry32/hash from the vendored display core so wear and puzzle
// generation share one deterministic stream; adds game-generation conveniences on top.

import { mulberry32, hash, makeRng } from '../display/core.js';

export { mulberry32, hash, makeRng };

// A small stateful RNG wrapper for generators: deterministic given a seed.
export function makeGenRng(seed) {
  const s = (seed >>> 0) || 1;
  const rand = mulberry32(s);
  return {
    seed: s,
    rand,                                            // () -> [0,1)
    int(n) { return Math.floor(rand() * n); },       // [0,n)
    range(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }, // inclusive
    pick(arr) { return arr[Math.floor(rand() * arr.length)]; },
    shuffle(arr) {                                   // Fisher–Yates, in place, returns arr
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
}

// Derive a fresh 32-bit seed from a string (e.g. a typed game-ID component).
export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A non-reproducible seed for "New Game" when the user hasn't pinned one.
// (We avoid Date.now()/Math.random() inside reproducible paths, but a fresh New Game
//  legitimately wants entropy; this is the ONE allowed entropy source, used only here.)
export function freshSeed() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}
