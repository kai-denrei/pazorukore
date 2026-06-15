// src/games/sudoku/generator.js — Sudoku puzzle generation (§12.1).
// 1. Build a complete valid solution by randomized backtracking (seeded rng → reproducible).
// 2. Dig holes in a randomized order, KEEPING the puzzle uniquely solvable at every step,
//    until we hit the difficulty's target clue count (or run out of safe removals).
// 3. Grade the result by the hardest human technique the solver needed.
// All randomness flows through makeGenRng (§12.3) so a gameId reproduces the exact board.

import { makeGeometry, countSolutions, gradeBoard, TECHNIQUES } from './solver.js';

// Difficulty presets: target #clues to leave, and the technique tier we are willing to require.
// minTier/maxTier index into solver TECHNIQUES (0 singles, 1 pairs, 2 locked). 'guess' (3) is
// never an acceptable grade — a unique puzzle that needs guessing fails the grade and is skipped.
export const DIFFICULTIES = Object.freeze({
  easy:   { clues: 40, minTier: 0, maxTier: 0 },   // singles only
  medium: { clues: 32, minTier: 1, maxTier: 1 },   // up to naked pairs
  hard:   { clues: 28, minTier: 2, maxTier: 2 },   // up to locked candidates
});

// Build a full valid solution board (Int8Array, 1..N) via randomized backtracking.
function buildSolution(geom, rng) {
  const N = geom.N;
  const board = new Int8Array(N * N);
  const order = [];
  for (let d = 1; d <= N; d++) order.push(d);

  const recurse = (pos) => {
    if (pos === N * N) return true;
    // candidates for this cell
    let used = 0;
    const peers = geom.peers[pos];
    for (let p = 0; p < peers.length; p++) { const v = board[peers[p]]; if (v) used |= (1 << (v - 1)); }
    const avail = order.filter((d) => !(used & (1 << (d - 1))));
    rng.shuffle(avail);
    for (const d of avail) {
      board[pos] = d;
      if (recurse(pos + 1)) return true;
      board[pos] = 0;
    }
    return false;
  };
  recurse(0);
  return board;
}

// Dig holes from a full solution, preserving uniqueness, aiming at targetClues.
function digHoles(geom, solution, targetClues, rng) {
  const N = geom.N;
  const puzzle = Int8Array.from(solution);
  const cellOrder = [];
  for (let i = 0; i < N * N; i++) cellOrder.push(i);
  rng.shuffle(cellOrder);

  let clues = N * N;
  for (const i of cellOrder) {
    if (clues <= targetClues) break;
    const saved = puzzle[i];
    if (saved === 0) continue;
    puzzle[i] = 0;
    // removal is safe iff the puzzle still has exactly one solution
    if (countSolutions(geom, puzzle, 2) !== 1) {
      puzzle[i] = saved;                 // revert — removal broke uniqueness
    } else {
      clues--;
    }
  }
  return { puzzle, clues };
}

// Generate one puzzle for the given params. Returns { solution, puzzle, geom, clues, tier }.
// `tier` is the graded difficulty index (see solver.TECHNIQUES). We retry generation a bounded
// number of times to land a puzzle whose grade falls in the requested band; if we can't, we
// return the closest attempt (uniqueness is always guaranteed regardless).
export function generate(params, rng) {
  const N = params.size;
  const geom = makeGeometry(N, params.box, N / params.box);
  const preset = DIFFICULTIES[params.difficulty] || DIFFICULTIES.easy;

  const MAX_ATTEMPTS = 24;
  let fallback = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const solution = buildSolution(geom, rng);
    const { puzzle, clues } = digHoles(geom, solution, preset.clues, rng);
    const grade = gradeBoard(geom, puzzle);
    const tier = grade.hardest;

    const result = { solution, puzzle, geom, clues, tier };
    if (!fallback) fallback = result;

    // accept if the hardest required technique is within the band and logic alone solves it
    if (grade.solved && tier >= preset.minTier && tier <= preset.maxTier) {
      return result;
    }
    // keep the attempt that is solvable-by-logic and closest-from-below as a better fallback
    if (grade.solved && tier <= preset.maxTier && (!fallback.grade || tier > (fallback.tier ?? -1))) {
      fallback = result;
    }
  }
  return fallback;
}

export { TECHNIQUES };
