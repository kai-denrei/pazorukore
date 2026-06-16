// src/skins/_region-tint.js — shared Fillomino region tint (skin-agnostic).
//
// Fillomino has NO assigned regionId: a "region" is a maximal 4-connected group of cells sharing
// the SAME non-null value, discovered by flood fill. We colour-code each region by its VALUE (a
// Shikaku-style hue-per-size: every 2-region reads one colour, every 3-region another, …) and update
// live as the board fills. This rides ALL THREE skins, so it lives here and is painted by board.js;
// each skin only supplies a `tint` palette (value → colour) the board hands in.
//
// Cheap by design — it runs on the grid layer every grid-pulse frame (and on each cell change). The
// flood fill is a single O(cells) pass over the measured boxes; no allocation per frame beyond the
// visited array and the component list.

import { getCellAt } from '../core/grid.js';

// Default value → colour map (mirrors region-neon.js's VAL_COLORS hue-per-size). A skin's `tint`
// palette can override any/all of these; values past 9 fall back to a neutral tint.
export const VAL_COLORS = Object.freeze({
  2: '#1bf0c8', 3: '#ff5db0', 4: '#ffb000', 5: '#5cff7a',
  6: '#3aa0ff', 7: '#c77dff', 8: '#ff7a3a', 9: '#7dffe8',
});

export function makeRegionTint() {
  // Flood-fill the grid into maximal 4-connected same-value components. Returns an array of
  // { val, ids: [cellId, …] }. Empty (value == null) cells are skipped.
  function components(grid) {
    const { rows, cols, cells } = grid;
    const visited = new Uint8Array(rows * cols);
    const out = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (visited[idx]) continue;
        const cell = cells[idx];
        const val = cell.value;
        if (val == null) { visited[idx] = 1; continue; }
        // BFS over the same-value 4-connected blob.
        const ids = [];
        const stack = [[r, c]];
        visited[idx] = 1;
        while (stack.length) {
          const [cr, cc] = stack.pop();
          ids.push(`r${cr}c${cc}`);
          const nbrs = [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]];
          for (const [nr, nc] of nbrs) {
            const n = getCellAt(grid, nr, nc);
            if (!n) continue;
            const ni = nr * cols + nc;
            if (visited[ni]) continue;
            if (n.value !== val) continue;
            visited[ni] = 1;
            stack.push([nr, nc]);
          }
        }
        out.push({ val, ids });
      }
    }
    return out;
  }

  return {
    id: 'region-tint',

    // paint(ctx, geom, palette) — palette is a value → colour map (a skin's `tint`); falls back to
    // VAL_COLORS. Fills each region member's cell box at a low alpha plus a slightly stronger inner
    // edge so adjacent regions read as distinct even when their hues are close.
    paint(ctx, geom, palette) {
      if (!geom.boxes.size) return;
      const colorFor = (v) => (palette && palette[v]) || VAL_COLORS[v] || '#9fb6c8';
      const fillAlpha = (palette && palette.alpha) || 0.14;
      const edgeAlpha = (palette && palette.edgeAlpha) || 0.34;

      const comps = components(geom.grid);
      for (const comp of comps) {
        const col = colorFor(comp.val);
        // low-alpha wash over every member cell box.
        ctx.save();
        ctx.fillStyle = col;
        ctx.globalAlpha = fillAlpha;
        for (const id of comp.ids) {
          const b = geom.boxes.get(id);
          if (b) ctx.fillRect(b.x, b.y, b.w, b.h);
        }
        ctx.restore();

        // a slightly stronger inner edge per member so the region's outline reads. We only stroke
        // the sides that face OUT of the region (a neighbour cell not in this component) — that
        // traces the region's silhouette without drawing internal seams.
        const members = new Set(comp.ids);
        const first = geom.boxes.get(comp.ids[0]);
        const lw = first ? Math.max(1, Math.min(first.w, first.h) * 0.06) : 1.5;
        ctx.save();
        ctx.strokeStyle = col;
        ctx.globalAlpha = edgeAlpha;
        ctx.lineWidth = lw;
        ctx.lineCap = 'square';
        const inset = lw / 2;
        for (const id of comp.ids) {
          const b = geom.boxes.get(id);
          if (!b) continue;
          const m = id.match(/^r(\d+)c(\d+)$/);
          if (!m) continue;
          const r = +m[1], c = +m[2];
          const x0 = b.x + inset, y0 = b.y + inset, x1 = b.x + b.w - inset, y1 = b.y + b.h - inset;
          ctx.beginPath();
          if (!members.has(`r${r - 1}c${c}`)) { ctx.moveTo(b.x, y0); ctx.lineTo(b.x + b.w, y0); }     // top
          if (!members.has(`r${r + 1}c${c}`)) { ctx.moveTo(b.x, y1); ctx.lineTo(b.x + b.w, y1); }     // bottom
          if (!members.has(`r${r}c${c - 1}`)) { ctx.moveTo(x0, b.y); ctx.lineTo(x0, b.y + b.h); }     // left
          if (!members.has(`r${r}c${c + 1}`)) { ctx.moveTo(x1, b.y); ctx.lineTo(x1, b.y + b.h); }     // right
          ctx.stroke();
        }
        ctx.restore();
      }
    },
  };
}

export default makeRegionTint;
