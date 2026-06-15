// src/games/bridges/generator.js — random connected bridge-network growth + uniqueness-guaranteed
// island layout (§12, Hashiwokakero). Pure, seeded via makeGenRng so a gameId reproduces the
// puzzle exactly. No DOM.
//
// Pipeline:
//   1. Seed one island. Repeatedly pick an existing island and extend a 1-or-2-bridge in a random
//      orthogonal direction to a clear straight run, landing on a fresh empty cell where we place a
//      NEW island (occasionally connecting to an existing collinear island instead). Track occupied
//      bridge segments + island cells so no bridge crosses another and no run passes an island.
//      Cap each island's degree so no label exceeds 8.
//   2. The placed network IS a valid solution. Each island's label == its total attached bridges.
//      The puzzle is the labels with bridges cleared.
//   3. Run solver.countSolutions(islands, ≤2). If not unique, perturb / regenerate within a budget;
//      fall back to a known-good small layout so we never return a broken puzzle.

import { makeGenRng } from '../../core/rng.js';
import { countSolutions, solveAssignment, buildGraph, assignmentToBridges } from './solver.js';

const DIRS = [
  { dr: -1, dc: 0 }, // up
  { dr: 1, dc: 0 },  // down
  { dr: 0, dc: -1 }, // left
  { dr: 0, dc: 1 },  // right
];

// Difficulty presets → grid size + island-count target band.
export const PRESETS = {
  easy: { size: 7, minIslands: 7, maxIslands: 11 },
  medium: { size: 9, minIslands: 12, maxIslands: 18 },
  hard: { size: 11, minIslands: 18, maxIslands: 26 },
};

export function presetFor(params) {
  const base = PRESETS[params.difficulty] || PRESETS.easy;
  const size = params.size || base.size;
  return { size, minIslands: base.minIslands, maxIslands: base.maxIslands };
}

// Grow ONE candidate network on a rows×cols board with the given rng. Returns
//   { islands:[{ id,r,c,need }], bridges:{edgeKey:count} }  or null if it couldn't grow enough.
function growNetwork(rows, cols, rng, targetIslands) {
  // occupancy maps
  const islandAt = new Map();        // "r,c" -> island index
  const segH = new Set();            // horizontal bridge segments occupying a water cell "r,c"
  const segV = new Set();            // vertical bridge segments occupying a water cell "r,c"
  const islands = [];
  const degree = [];                 // running attached-bridge count per island
  const edges = new Map();           // "i-j" (i<j) -> count

  function addIsland(r, c) {
    const idx = islands.length;
    islands.push({ r, c });
    degree.push(0);
    islandAt.set(`${r},${c}`, idx);
    return idx;
  }

  // Seed near the centre for room to grow in all directions.
  const sr = Math.floor(rows / 2), sc = Math.floor(cols / 2);
  addIsland(sr, sc);

  // From island `i`, in direction d, find the landing options: either a fresh empty cell to place a
  // NEW island, or the nearest existing island — provided the straight run between is all clear
  // (no island, no crossing/parallel bridge segment) and we land in-bounds. Returns
  //   { kind:'new'|'existing', r, c, j?, between:[{r,c}], orient } or null.
  function probe(i, d) {
    const isl = islands[i];
    let r = isl.r + d.dr, c = isl.c + d.dc;
    const between = [];
    const orient = d.dr !== 0 ? 'v' : 'h';
    let last = null;
    while (r >= 0 && c >= 0 && r < rows && c < cols) {
      const key = `${r},${c}`;
      if (islandAt.has(key)) {
        // nearest existing island in this direction
        return { kind: 'existing', r, c, j: islandAt.get(key), between, orient };
      }
      // a bridge segment of EITHER orientation in this cell blocks the run (can't cross/overlap)
      if (segH.has(key) || segV.has(key)) return last; // run blocked; offer the best 'new' so far
      // record this as a possible NEW-island landing (must be ≥2 cells out so there's water between)
      if (between.length >= 1) {
        last = { kind: 'new', r, c, between: between.slice(), orient };
      }
      between.push({ r, c });
      r += d.dr; c += d.dc;
    }
    return last;
  }

  function occupy(between, orient) {
    const set = orient === 'v' ? segV : segH;
    for (const cell of between) set.add(`${cell.r},${cell.c}`);
  }

  function placeBridge(i, j, count, between, orient) {
    const a = Math.min(i, j), b = Math.max(i, j);
    const key = `${a}-${b}`;
    const prev = edges.get(key) || 0;
    const delta = count - prev;
    edges.set(key, count);
    degree[a] += delta; degree[b] += delta;
    if (prev === 0) occupy(between, orient);
  }

  let guard = 0;
  const maxGuard = targetIslands * 40 + 200;
  while (islands.length < targetIslands && guard++ < maxGuard) {
    // pick a random existing island that still has degree headroom (<8) and a free direction.
    const order = rng.shuffle(islands.map((_, i) => i));
    let grew = false;
    for (const i of order) {
      if (degree[i] >= 7) continue; // leave room for at least a single bridge without exceeding 8
      const dirs = rng.shuffle(DIRS.slice());
      for (const d of dirs) {
        const p = probe(i, d);
        if (!p) continue;
        // how many bridges can this edge hold? 1 or 2, bounded by both endpoints' headroom & a coin.
        if (p.kind === 'new') {
          const want = rng.rand() < 0.45 ? 2 : 1;
          const headroom = 8 - degree[i];
          const cnt = Math.min(want, headroom, 2);
          if (cnt < 1) continue;
          const j = addIsland(p.r, p.c);
          placeBridge(i, j, cnt, p.between, p.orient);
          grew = true;
          break;
        } else {
          // connect to an existing collinear island (adds cycles → richer puzzles). Respect both
          // endpoints' headroom and the existing edge count (max 2 total).
          const j = p.j;
          if (j === i) continue;
          const a = Math.min(i, j), b = Math.max(i, j);
          const existing = edges.get(`${a}-${b}`) || 0;
          if (existing >= 2) continue;
          const headroom = Math.min(8 - degree[i], 8 - degree[j]);
          if (headroom < 1) continue;
          // only sometimes add a cross-link, and only +1 at a time
          if (rng.rand() < 0.35) {
            placeBridge(i, j, existing + 1, p.between, p.orient);
            grew = true;
            break;
          }
        }
      }
      if (grew) break;
    }
    if (!grew) break; // stuck — no island could extend
  }

  if (islands.length < 2) return null;

  // Materialise ids + labels.
  const out = islands.map((isl, i) => ({
    id: `r${isl.r}c${isl.c}`,
    r: isl.r,
    c: isl.c,
    need: degree[i],
  }));
  // Any island that ended with need 0 is illegal (Bridges islands are 1..8) → reject.
  for (const isl of out) if (isl.need < 1 || isl.need > 8) return null;

  // bridges keyed by canonical island-id pair.
  const bridges = {};
  for (const [key, count] of edges) {
    if (count <= 0) continue;
    const [a, b] = key.split('-').map(Number);
    const idA = out[a].id, idB = out[b].id;
    const ek = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    bridges[ek] = count;
  }
  return { islands: out, bridges };
}

// Generate a uniquely-solvable Bridges layout. Returns
//   { rows, cols, islands:[{id,r,c,need}], bridges:{edgeKey:count}, unique, attempts, ms }
// `bridges` is the generator's own solution network (verified unique → equals the solver's).
export function generate(params) {
  const { size, minIslands, maxIslands } = presetFor(params);
  const rows = size, cols = size;
  const seed = (params.seed >>> 0) || 1;

  const budget = {
    maxAttempts: params.maxAttempts || 200,
    maxMs: params.maxMs || 300,
  };
  const t0 = Date.now();
  let attempts = 0;
  let fallback = null;

  while (attempts < budget.maxAttempts && (Date.now() - t0) < budget.maxMs) {
    attempts++;
    const rng = makeGenRng((seed ^ (attempts * 0x9e3779b1)) >>> 0);
    const target = rng.range(minIslands, maxIslands);
    const net = growNetwork(rows, cols, rng, target);
    if (!net || net.islands.length < 2) continue;

    // Keep the first viable network as a fallback solution even if not yet proven unique.
    if (!fallback) fallback = { rows, cols, ...net };

    const count = countSolutions(net.islands, 2);
    if (count === 1) {
      return { rows, cols, islands: net.islands, bridges: net.bridges, unique: true, attempts, ms: Date.now() - t0 };
    }
    // not unique → just regenerate (a fresh attempt seed produces a different network)
  }

  // Budget exhausted. Hand back a guaranteed-unique known-good layout so we never return broken.
  return knownGood(rows, cols, seed);
}

// A deterministic, provably-unique fallback: a simple line of islands along the top row connected
// by single bridges. End islands need 1, interior islands need 2; the ONLY way to satisfy a
// degree-1 endpoint is its single neighbour bridge, which forces the whole chain — uniquely
// solvable and trivially connected. Always fits any board with cols ≥ 3.
function knownGood(rows, cols, seed) {
  const n = Math.max(3, Math.min(cols, 5));      // 3..5 islands on the top row
  const islands = [];
  const positions = [];
  // place at columns 0,2,4,... (one water cell between each so bridges have somewhere to run)
  let c = 0;
  for (let i = 0; i < n && c < cols; i++) { positions.push(c); c += 2; }
  const k = positions.length;
  for (let i = 0; i < k; i++) {
    const col = positions[i];
    const need = (i === 0 || i === k - 1) ? 1 : 2;
    islands.push({ id: `r0c${col}`, r: 0, c: col, need });
  }
  // bridges: single between consecutive islands.
  const bridges = {};
  for (let i = 0; i + 1 < k; i++) {
    const idA = islands[i].id, idB = islands[i + 1].id;
    const ek = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    bridges[ek] = 1;
  }
  return { rows, cols, islands, bridges, unique: true, attempts: 0, ms: 0, fallback: true };
}

// Re-derive a bridges object directly from islands via the solver (used as a cross-check / when a
// layout is loaded from a desc string and we need its solution).
export function solutionBridges(islands) {
  return solveAssignment(islands);
}

export { buildGraph, assignmentToBridges };
