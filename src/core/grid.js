// src/core/grid.js — the cell model, roles, and immutable grid backbone (§4).
// A Grid is the structural spine of a game's playState: a row-major array of frozen Cell
// objects. playState is immutable (§3) — mutations produce a NEW grid via withCells(), so the
// engine's undo list is just an append-only array of these snapshots.

// Roles drive render policy (§4): the SKIN decides which roles get a display device.
export const ROLES = Object.freeze({
  given: 'given',       // clue fixed by the puzzle (Sudoku givens; Shikaku area-anchors)
  fillable: 'fillable', // empty cell the player fills (Sudoku blanks)
  clue: 'clue',         // anchor carrying a region-defining number (Shikaku 5,12,9…)
  member: 'member',     // non-clue cell belonging to a drawn region (Shikaku interior)
  blank: 'blank',       // structurally empty / unassigned
});

export const cellId = (row, col) => `r${row}c${col}`;

// Build an immutable grid. init(row,col) -> partial { role, value, regionId, given }.
export function makeGrid(rows, cols, init) {
  const cells = new Array(rows * cols);
  const index = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = init ? init(r, c) || {} : {};
      const cell = Object.freeze({
        id: cellId(r, c),
        row: r,
        col: c,
        role: p.role || ROLES.blank,
        value: p.value != null ? String(p.value) : null, // ALWAYS a string or null (§8.1)
        regionId: p.regionId != null ? p.regionId : null,
        given: !!p.given,
        // Optional display clue carried by a cage's anchor cell (KenKen "6×", "3-", …). Additive,
        // defaults null, does NOT affect gridDiff or other games.
        label: p.label != null ? String(p.label) : null,
      });
      cells[r * cols + c] = cell;
      index.set(cell.id, r * cols + c);
    }
  }
  return Object.freeze({ rows, cols, cells: Object.freeze(cells), index });
}

export const getCell = (grid, id) => grid.cells[grid.index.get(id)];
export const getCellAt = (grid, r, c) =>
  (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) ? null : grid.cells[r * grid.cols + c];

// Pure update: a NEW grid with patches applied; unchanged cells are shared by reference.
// patches: array of { id, ...partial }.
export function withCells(grid, patches) {
  if (!patches || !patches.length) return grid;
  const cells = grid.cells.slice();
  for (const patch of patches) {
    const i = grid.index.get(patch.id);
    if (i == null) continue;
    cells[i] = Object.freeze({ ...cells[i], ...patch, id: cells[i].id });
  }
  return Object.freeze({ rows: grid.rows, cols: grid.cols, cells: Object.freeze(cells), index: grid.index });
}

// Iteration / structural helpers used by game logic.
export const eachCell = (grid, fn) => grid.cells.forEach(fn);
export const rowCells = (grid, r) => grid.cells.slice(r * grid.cols, r * grid.cols + grid.cols);
export const colCells = (grid, c) => {
  const out = [];
  for (let r = 0; r < grid.rows; r++) out.push(grid.cells[r * grid.cols + c]);
  return out;
};
// Box for sub-grid puzzles (Sudoku 3×3): bh×bw box containing (r,c).
export function boxCells(grid, r, c, bh, bw) {
  const r0 = Math.floor(r / bh) * bh, c0 = Math.floor(c / bw) * bw;
  const out = [];
  for (let dr = 0; dr < bh; dr++) for (let dc = 0; dc < bw; dc++) out.push(grid.cells[(r0 + dr) * grid.cols + (c0 + dc)]);
  return out;
}
export const regionCells = (grid, regionId) => grid.cells.filter((c) => c.regionId === regionId);

// Render-diff: ids of cells whose render-relevant fields changed between two grids (§3/§6,
// drives diff-and-patch + cellChanged events). Pencil marks are diffed separately by the board.
export function gridDiff(prev, next) {
  if (prev === next) return [];
  const changed = [];
  const cells = next.cells, pcells = prev.cells;
  for (let i = 0; i < cells.length; i++) {
    const a = pcells[i], b = cells[i];
    if (a === b) continue;
    if (a.value !== b.value || a.regionId !== b.regionId || a.role !== b.role || a.given !== b.given) {
      changed.push(b.id);
    }
  }
  return changed;
}
