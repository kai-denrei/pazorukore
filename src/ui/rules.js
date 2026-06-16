// src/ui/rules.js — laconic, win-condition-first rules for every game (shipped + roadmap), shown by
// the "i" info modal. House style: imperative, no exposition, no examples. Keyed by game id so the
// picker, the chrome "i" (active game), and the pipeline cards all resolve the same entry.
// Text drafted then adversarially tightened by the pazoru-rules-and-masyu workflow (2026-06-16).

export const RULES = {
  sudoku: {
    title: 'Sudoku',
    lines: [
      'Fill empty cells with digits 1–9.',
      'No repeats in any row.',
      'No repeats in any column.',
      'No repeats in any 3×3 box.',
    ],
    win: 'Every cell filled; no row, column, or box repeats.',
  },
  shikaku: {
    title: 'Shikaku',
    lines: [
      'Partition the grid into rectangles.',
      'One clue per rectangle.',
      'Rectangle area equals its clue.',
      'No overlaps, no gaps.',
    ],
    win: 'Grid fully covered; every clue area matches.',
  },
  bridges: {
    title: 'Bridges',
    lines: [
      'Connect numbered islands with horizontal or vertical bridges.',
      'Run 1 or 2 per pair; never cross.',
      "Match each island's number exactly.",
      'Join all islands into one network.',
    ],
    win: 'All numbers satisfied and every island connected.',
  },
  fillomino: {
    title: 'Fillomino',
    lines: [
      'Divide the grid into regions.',
      'Fill each size-N region with N.',
      "Honor every given number's region size.",
      'Same-size regions never share an edge.',
    ],
    win: 'Whole grid partitioned into valid, edge-separated regions.',
  },
  kenken: {
    title: 'KenKen',
    lines: [
      'Fill the grid 1 to N.',
      'Never repeat a digit per row or column.',
      'Each cage shows a target and operator.',
      'Combine cage cells to its target.',
    ],
    win: 'Every row, column, and cage satisfied.',
  },
  slitherlink: {
    title: 'Slitherlink',
    lines: [
      'Draw one closed loop along grid edges.',
      'Each clue counts its used surrounding edges.',
      'The loop never branches or crosses.',
    ],
    win: "One closed loop; every clue's edge count satisfied.",
  },
  pearl: {
    title: 'Pearl',
    lines: [
      'Draw one closed loop, orthogonal moves only.',
      'Black circle: turn here, straight through both neighbours.',
      'White circle: pass straight, turn at one neighbour.',
    ],
    win: 'One closed loop satisfying every circle.',
  },
  nurikabe: {
    title: 'Nurikabe',
    lines: [
      'Shade non-island cells into one sea.',
      'Each clue: island of exactly that size.',
      'Islands hold one clue, never touch orthogonally.',
      'Keep the sea connected; ban 2×2 shaded blocks.',
    ],
    win: 'Every island correct, sea connected, no 2×2 shaded block.',
  },
  starbattle: {
    title: 'Star Battle',
    lines: [
      'Place stars in the grid.',
      'Each row, column, region: exactly N stars.',
      'Stars never touch, even diagonally.',
    ],
    win: 'Every row, column, and region holds N stars, none adjacent.',
  },
};

export default RULES;
