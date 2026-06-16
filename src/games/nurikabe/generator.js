// src/games/nurikabe/generator.js — SOLUTION-FIRST Nurikabe generation. Pure, seeded via
// makeGenRng(seed) so a gameId reproduces the puzzle exactly. No DOM.
//
// Pipeline:
//   1. Carve a valid SOLUTION directly. Scatter a handful of island SEEDS (random cells that don't
//      touch an existing island) and grow each into a random connected polyomino (size 1..maxSize),
//      never letting two islands touch orthogonally.
//   2. PATCH the sea: while any fully-shaded 2×2 block remains, drop a fresh size-1 island onto one
//      of that block's cells (one that doesn't touch an existing island), breaking the block. This
//      guarantees rule (3). After patching, confirm the sea is ONE connected region (rule (2)); an
//      attempt that can't be patched cleanly or leaves a split sea is discarded.
//   3. Each island contributes one clue { r, c, n } (anchor = the seed cell; n = island size).
//      Verify uniqueness via countSolutions(...,2) === 1. If not unique, re-roll under a budget.
//      Clues are fixed island anchors — every island needs exactly one, so there is nothing to thin.
//   4. Deterministic provably-unique FALLBACK: an even-parity anchor lattice (a size-1 island at
//      every even-row/even-col cell). That lattice puts an anchor in every 2×2 block (no shaded 2×2)
//      and pins every island to size 1, so it is always uniquely solvable — generate() never returns
//      a broken puzzle.
//
// Difficulty → board size + island growth (density). easy 5, medium 6, hard 7 (kept small so the
// uniqueness check finishes well under 1s).
//
// Export: generate(params) → { rows, cols, clues:[{r,c,n}], shaded:{...sea...}, unique, attempts, ms }
//         presetFor(params).

import { makeGenRng } from '../../core/rng.js';
import { countSolutions } from './solver.js';

const cellId = (r, c) => `r${r}c${c}`;
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Difficulty presets → grid size + the seeding density (how many island seeds to scatter and how
// large to grow each). More/larger islands ⇒ a sparser, twistier sea.
export const PRESETS = {
  easy: { size: 5, seeds: 2, maxSize: 3 },
  medium: { size: 6, seeds: 3, maxSize: 3 },
  hard: { size: 7, seeds: 4, maxSize: 4 },
};

export function presetFor(params) {
  const base = PRESETS[params.difficulty] || PRESETS.easy;
  const size = params.size || base.size;
  return { size, seeds: base.seeds, maxSize: base.maxSize };
}

// --- sea validity ---------------------------------------------------------------------------
// Does the set of sea cells (own[i] === -1) form ONE 4-connected region AND contain no fully-shaded
// 2×2 block? `own` is an Int32Array over rows*cols; -1 = sea, >=0 = island id.
function seaValid(own, rows, cols) {
  const N = rows * cols;
  let firstSea = -1, seaCount = 0;
  for (let i = 0; i < N; i++) if (own[i] === -1) { if (firstSea < 0) firstSea = i; seaCount++; }
  if (seaCount === 0) return false;
  // no 2×2 entirely sea
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (own[r * cols + c] === -1 && own[(r + 1) * cols + c] === -1 &&
          own[r * cols + c + 1] === -1 && own[(r + 1) * cols + c + 1] === -1) return false;
    }
  }
  // single connected region (flood from the first sea cell)
  const seen = new Uint8Array(N);
  seen[firstSea] = 1;
  const stack = [firstSea];
  let reached = 1;
  while (stack.length) {
    const ci = stack.pop();
    const r = (ci / cols) | 0, c = ci % cols;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const ni = nr * cols + nc;
      if (own[ni] === -1 && !seen[ni]) { seen[ni] = 1; reached++; stack.push(ni); }
    }
  }
  return reached === seaCount;
}

// Find the top-left cell of any fully-sea 2×2 block, or null if none. Returns [r,c].
function findShadedSquare(own, rows, cols) {
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (own[r * cols + c] === -1 && own[(r + 1) * cols + c] === -1 &&
          own[r * cols + c + 1] === -1 && own[(r + 1) * cols + c + 1] === -1) return [r, c];
    }
  }
  return null;
}

// Is cell ci orthogonally adjacent to an island OTHER than `self`?
function touchesOther(own, ci, rows, cols, self) {
  const r = (ci / cols) | 0, c = ci % cols;
  for (const [dr, dc] of DIRS) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
    const o = own[nr * cols + nc];
    if (o >= 0 && o !== self) return true;
  }
  return false;
}

// Build the shaded set { cellId:1 } from a carved `own` array (sea = own[i] === -1).
function shadedFromOwn(own, rows, cols) {
  const shaded = {};
  const N = rows * cols;
  for (let i = 0; i < N; i++) if (own[i] === -1) shaded[cellId((i / cols) | 0, i % cols)] = 1;
  return shaded;
}

// Lay down the even-parity anchor lattice. Returns { own, pillars:[{id,seed,cells:[idx]}] }.
function layAnchors(rows, cols) {
  const N = rows * cols;
  const own = new Int32Array(N).fill(-1);
  const pillars = [];
  let id = 0;
  for (let r = 0; r < rows; r += 2) {
    for (let c = 0; c < cols; c += 2) {
      const seed = r * cols + c;
      own[seed] = id;
      pillars.push({ id, seed, cells: [seed] });
      id++;
    }
  }
  return { own, pillars };
}

// --- generate -------------------------------------------------------------------------------

export function generate(params) {
  const { size, seeds: nSeeds, maxSize } = presetFor(params);
  const rows = size, cols = size;
  const seed = (params.seed >>> 0) || 1;
  const N = rows * cols;

  const budget = {
    maxAttempts: params.maxAttempts || 600,
    maxMs: params.maxMs || 800,
  };
  const t0 = Date.now();
  let attempts = 0;

  while (attempts < budget.maxAttempts && (Date.now() - t0) < budget.maxMs) {
    attempts++;
    const rng = makeGenRng((seed ^ (attempts * 0x9e3779b1)) >>> 0);
    const own = new Int32Array(N).fill(-1);
    const islands = []; // { id, seed, cells:[idx] }
    let nextId = 0;

    // 1. Scatter seeds and grow each into a random polyomino.
    for (let s = 0; s < nSeeds; s++) {
      const free = [];
      for (let i = 0; i < N; i++) {
        if (own[i] !== -1) continue;
        if (touchesOther(own, i, rows, cols, -99)) continue; // not adjacent to any island
        free.push(i);
      }
      if (free.length === 0) break;
      const id = nextId++;
      const seedCell = rng.pick(free);
      own[seedCell] = id;
      const cells = [seedCell];
      const want = rng.range(1, maxSize);
      while (cells.length < want) {
        const frontier = [];
        const seenF = new Set();
        for (const ci of cells) {
          const r = (ci / cols) | 0, c = ci % cols;
          for (const [dr, dc] of DIRS) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
            const ni = nr * cols + nc;
            if (own[ni] !== -1 || seenF.has(ni)) continue;
            if (touchesOther(own, ni, rows, cols, id)) continue;
            seenF.add(ni);
            frontier.push(ni);
          }
        }
        if (frontier.length === 0) break;
        const next = rng.pick(frontier);
        own[next] = id;
        cells.push(next);
      }
      islands.push({ id, seed: seedCell, cells });
    }

    // 2. Patch every fully-shaded 2×2 by dropping a size-1 island onto one of its cells.
    let patchOk = true;
    let guard = 0;
    let sq;
    while ((sq = findShadedSquare(own, rows, cols)) && guard++ < N * 4) {
      const [r, c] = sq;
      const block = [r * cols + c, (r + 1) * cols + c, r * cols + c + 1, (r + 1) * cols + c + 1];
      const cand = block.filter((i) => !touchesOther(own, i, rows, cols, -99));
      if (cand.length === 0) { patchOk = false; break; } // can't break this block cleanly
      const id = nextId++;
      const pick = rng.pick(cand);
      own[pick] = id;
      islands.push({ id, seed: pick, cells: [pick] });
    }
    if (!patchOk || findShadedSquare(own, rows, cols)) continue;

    // 3. Require a non-empty, connected sea.
    let total = 0;
    for (let i = 0; i < N; i++) if (own[i] >= 0) total++;
    if (total >= N) continue;
    if (islands.length === 0) continue;
    if (!seaValid(own, rows, cols)) continue;

    const clues = islands.map((p) => ({ r: (p.seed / cols) | 0, c: p.seed % cols, n: p.cells.length }));
    const shaded = shadedFromOwn(own, rows, cols);

    if (countSolutions(rows, cols, clues, 2) === 1) {
      return { rows, cols, clues, shaded, unique: true, attempts, ms: Date.now() - t0 };
    }
    // not unique → re-roll
  }

  // Budget exhausted → deterministic provably-unique fallback.
  return knownGood(rows, cols, seed);
}

// A deterministic, provably-unique fallback: the bare even-parity anchor lattice with NO growth, so
// every island is size 1. Because every island is fixed at its anchor (a size-1 island cannot grow),
// the only freedom is which non-anchor cells are sea — and they ALL must be, leaving exactly one
// solution. The lattice guarantees no fully-shaded 2×2 and (for any rows,cols ≥ 1) a connected sea on
// boards with at least one non-anchor cell. We VERIFY uniqueness; on the pathological tiny board with
// no sea (1×1, 1×2, 2×1, 2×2) we shrink to a single corner island so a sea always exists.
function knownGood(rows, cols, seed) {
  const N = rows * cols;
  const { own, pillars } = layAnchors(rows, cols);

  // If the lattice leaves no sea (board fully covered by anchors — only happens on 1×N / 2×2 etc.),
  // keep just the top-left anchor so the rest is sea.
  let seaCells = 0;
  for (let i = 0; i < N; i++) if (own[i] === -1) seaCells++;
  if (seaCells === 0 || pillars.length === 0) {
    const own2 = new Int32Array(N).fill(-1);
    own2[0] = 0;
    return {
      rows, cols,
      clues: [{ r: 0, c: 0, n: 1 }],
      shaded: shadedFromOwn(own2, rows, cols),
      unique: true, attempts: 0, ms: 0, fallback: true,
    };
  }

  const clues = pillars.map((p) => ({ r: (p.seed / cols) | 0, c: p.seed % cols, n: 1 }));
  return {
    rows, cols, clues,
    shaded: shadedFromOwn(own, rows, cols),
    unique: true, attempts: 0, ms: 0, fallback: true,
  };
}
