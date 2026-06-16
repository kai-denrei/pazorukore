// src/ui/app.js — bootstrap. Wires the chrome (version badge, admin toggle, menu/new buttons),
// holds the game/skin registry, and mounts the selected (game × skin) pairing onto the board.
// Modules load lazily so the shell runs and progressively lights up as milestones land (the /loop):
// until a game+skin+board are all present, the board shows a build-status placeholder.

import { renderVersionGlyphs } from './version-badge.js';
import { initPWA } from './pwa.js';
import { TimerDisplay } from './timer-display.js';
import { ActionDisplay } from './action-display.js';
import { ScoreKeeper, SCORE } from './score.js';
import { RULES } from './rules.js';
import { Engine } from '../core/engine.js';
import { EVENTS } from '../core/events.js';
import { negotiate } from '../core/capabilities.js';
import { countUp, countDown } from './clock-format.js';

const GAME_LOADERS = {
  sudoku: () => import('../games/sudoku/index.js'),
  shikaku: () => import('../games/shikaku/index.js'),
  bridges: () => import('../games/bridges/index.js'),
  masyu: () => import('../games/masyu/index.js'),
  fillomino: () => import('../games/fillomino/index.js'),
  kenken: () => import('../games/kenken/index.js'),
  slitherlink: () => import('../games/slitherlink/index.js'),
  nurikabe: () => import('../games/nurikabe/index.js'),
  starbattle: () => import('../games/starbattle/index.js'),
};
const SKIN_LOADERS = {
  futuristic: () => import('../skins/futuristic/skin.js'),
  retro: () => import('../skins/retro/skin.js'),
  pastel: () => import('../skins/pastel/skin.js'),
};
const pickDefault = (mod) => mod.default || Object.values(mod)[0];

// Temporarily-disabled (game × skin) pairings. Bridges' bridge/island renderer is only correct
// under Futuristic right now; Retro (Lixie) and Pastel (split-flap) render broken, so they're
// greyed out in the picker and coerced to a valid skin if reached via URL/game-ID. Drop the
// entry once those two skins' bridge paths are fixed.
const DISABLED_SKINS = { bridges: new Set(['retro', 'pastel']), masyu: new Set(['retro', 'pastel']) };
const skinDisabled = (gameId, skinId) => !!(DISABLED_SKINS[gameId] && DISABLED_SKINS[gameId].has(skinId));
const firstEnabledSkin = (gameId) => Object.keys(SKIN_LOADERS).find((s) => !skinDisabled(gameId, s)) || 'futuristic';

const app = {
  engine: new Engine(),
  game: null, skin: null, board: null, interaction: null, controls: null,
  gameId: document.body.dataset.game || 'sudoku',
  skinId: document.body.dataset.skin || 'futuristic',
  admin: new URLSearchParams(location.search).has('admin'),
};
window.__pazoru = app; // dev handle

async function safeImport(loader) {
  try { return await loader(); } catch (e) { return { __error: e.message }; }
}

async function mountGame(gameId, skinId, params) {
  if (skinDisabled(gameId, skinId)) skinId = firstEnabledSkin(gameId); // never mount a known-broken pairing
  app.gameId = gameId; app.skinId = skinId;
  document.body.dataset.game = gameId;
  document.body.dataset.skin = skinId;

  const [gameMod, skinMod, boardMod, ctrlMod] = await Promise.all([
    safeImport(GAME_LOADERS[gameId]),
    safeImport(SKIN_LOADERS[skinId]),
    safeImport(() => import('./board.js')),
    safeImport(() => import('./controls.js')),
  ]);

  const missing = [];
  const game = gameMod.__error ? null : pickDefault(gameMod); if (!game) missing.push(`game:${gameId}`);
  const skin = skinMod.__error ? null : pickDefault(skinMod); if (!skin) missing.push(`skin:${skinId}`);
  const Board = boardMod.__error ? null : (boardMod.Board || boardMod.default); if (!Board) missing.push('ui/board');

  if (!game || !skin || !Board) { showStatus(missing); return; }

  // Staged-countdown auto-ramp (Shikaku declares game.meta.stages). Apply to a FRESH puzzle only
  // (object/undefined params), never to an explicit shared game-ID string — that carries its own
  // encoded difficulty.
  const stages = game.meta && game.meta.stages;
  if (stages && (params == null || typeof params === 'object')) {
    const n = app.score ? (app.score.gameInRun >= 10 ? 1 : app.score.gameInRun + 1) : 1;
    params = { ...(params || game.defaultParams()), difficulty: stages.curveForGame(n) };
  }

  const neg = negotiate(game, skin);
  if (!neg.ok) { showStatus([`incompatible: ${neg.reasons.join('; ')}`]); return; }

  // tear down a previous mount
  if (app.board && app.board.destroy) app.board.destroy();
  if (app.interaction && app.interaction.destroy) app.interaction.destroy();

  // load the puzzle, theme the board, mount the renderer + interaction + controls
  app.engine = new Engine();
  app.game = game; app.skin = skin;
  try { app.engine.load(game, params || game.defaultParams()); }
  catch (err) { app.engine.load(game, game.defaultParams()); } // bad game-ID → fall back to a fresh puzzle
  // Countdown budget (ms) for staged games, from the difficulty the engine actually loaded
  // (covers both fresh ramps and explicit game-IDs); null → legacy count-up timer.
  const stageSecs = stages ? stages.time[app.engine.params.difficulty] : null;
  app.budgetMs = stageSecs ? stageSecs * 1000 : null;
  app.undoUsed = false; app.scored = false; app.revealed = false;
  app.engine.on(EVENTS.moved, ({ dir }) => {
    if (dir && dir !== 'do') app.undoUsed = true;
    else if (dir === 'do' && app.phase === 'ready') startRound(); // first real move begins timing too
  });
  app.engine.on(EVENTS.solved, onSolved);

  const boardEl = document.getElementById('board');
  skin.applyPalette(boardEl);
  if (skin.background) skin.background(boardEl);

  app.board = new Board(boardEl, app.engine, skin);
  app.board.mount();

  await bindInteraction(game, skin);
  if (!ctrlMod.__error && (ctrlMod.Controls || ctrlMod.default)) {
    const Controls = ctrlMod.Controls || ctrlMod.default;
    app.controls = new Controls(document.getElementById('controls'), app.engine, game, app.interaction);
    app.controls.mount();
  }

  setReady();           // ready-to-start gate: timer armed at 00:00, action display shows START
  updateUpcomingRun();

  // admin tuning panel reflects the active skin's glyph params
  if (app.admin) openAdmin();

  // dev-only: ?demo drives the real interaction path so a static screenshot can prove
  // select→place→events→repaint+transition end to end (no browser automation needed).
  if (new URLSearchParams(location.search).has('demo')) setTimeout(() => runDemo(), 300);
}

function runDemo() {
  const eng = app.engine, inter = app.interaction;
  if (!eng || !inter) return;

  // bridge-draw games: commit ~60% of the solution's bridges (proves island/bridge rendering).
  if (app.game.meta.interaction === 'bridge-draw') {
    const sb = eng.solution && eng.solution.bridges; if (!sb) return;
    const edges = Object.entries(sb), take = Math.ceil(edges.length * 0.6);
    for (let k = 0; k < take; k++) { const [key, count] = edges[k]; const [a, b] = key.split('|'); for (let i = 0; i < count; i++) eng.do({ type: 'bridge', a, b }); }
    return;
  }

  // loop-draw games (Masyu): lay ~60% of the solution loop's edges (proves loop + pearl rendering).
  if (app.game.meta.interaction === 'loop-draw') {
    const sl = eng.solution && eng.solution.loop; if (!sl) return;
    const keys = Object.keys(sl), take = Math.ceil(keys.length * 0.6);
    for (let k = 0; k < take; k++) { const [a, b] = keys[k].split('|'); eng.do({ type: 'loop', a, b }); }
    return;
  }

  // edge-draw games (Slitherlink): lay ~60% of the solution loop's dot-edges.
  if (app.game.meta.interaction === 'edge-draw') {
    const sl = eng.solution && eng.solution.loop; if (!sl) return;
    const keys = Object.keys(sl), take = Math.ceil(keys.length * 0.6);
    for (let k = 0; k < take; k++) { const [a, b] = keys[k].split('|'); eng.do({ type: 'edge', a, b }); }
    return;
  }

  // cell-shade games (Nurikabe): shade ~60% of the solution sea.
  if (app.game.meta.interaction === 'cell-shade') {
    const ss = eng.solution && eng.solution.shaded; if (!ss) return;
    const ids = Object.keys(ss), take = Math.ceil(ids.length * 0.6);
    for (let k = 0; k < take; k++) eng.do({ type: 'shade', id: ids[k] });
    return;
  }

  // star-place games (Star Battle): place ~60% of the solution's stars.
  if (app.game.meta.interaction === 'star-place') {
    const ss = eng.solution && eng.solution.stars; if (!ss) return;
    const ids = Object.keys(ss), take = Math.ceil(ids.length * 0.6);
    for (let k = 0; k < take; k++) eng.do({ type: 'star', id: ids[k] });
    return;
  }

  // region-draw games: commit a few correct regions straight from the solution (proves region
  // membranes + validation rendering without simulating a pointer drag).
  if (app.game.meta.interaction === 'region-draw') {
    const sol = eng.solution && eng.solution.grid ? eng.solution.grid : null;
    if (!sol) return;
    const byRegion = new Map();
    for (const c of sol.cells) { if (c.regionId == null) continue; if (!byRegion.has(c.regionId)) byRegion.set(c.regionId, []); byRegion.get(c.regionId).push(c.id); }
    let done = 0;
    for (const [clueId, cells] of byRegion) { if (done >= 6) break; eng.do({ type: 'region-commit', clueId, cells }); done++; }
    return;
  }

  const sol = eng.solution && eng.solution.grid ? eng.solution.grid : null;
  const empties = eng.current().grid.cells.filter((c) => c.role === 'fillable' && c.value == null);
  const correct = (id) => { if (!sol) return null; const s = sol.cells.find((x) => x.id === id); return s ? s.value : null; };
  let placed = 0;
  for (const c of empties) {
    if (placed >= 7) break;
    const v = correct(c.id) || String(((placed + 2) % 9) + 1);
    inter.select(c.id); inter.place(v); placed++;
  }
  // candidate marks spanning the cell corners (verifies in-bounds rendering: 1=top-left, 5=centre, 9=bottom-right)
  const penCell = empties[15];
  if (penCell) { inter.pencilMode = true; inter.select(penCell.id); ['1', '5', '9'].forEach((d) => inter.pencil(d)); inter.pencilMode = false; }
  // open the number popup centred on another empty cell (proves popup + the amber selection ring)
  const padCell = empties[24] || empties[empties.length - 1];
  if (padCell && app.board && app.board.boxes.get(padCell.id)) {
    inter.select(padCell.id);
    const box = app.board.boxes.get(padCell.id), br = app.board.el.getBoundingClientRect();
    setTimeout(() => inter._openPad(padCell.id, br.left + box.x + box.w / 2, br.top + box.y + box.h / 2), 150);
  }
}

async function bindInteraction(game, skin) {
  const kind = game.meta.interaction;
  const path = kind === 'region-draw' ? '../interaction/region-draw.js'
    : kind === 'bridge-draw' ? '../interaction/bridge-draw.js'
      : kind === 'loop-draw' ? '../interaction/loop-draw.js'
        : kind === 'edge-draw' ? '../interaction/edge-draw.js'
          : kind === 'cell-shade' ? '../interaction/cell-shade.js'
            : kind === 'star-place' ? '../interaction/star-place.js'
              : '../interaction/digit-entry.js';
  const mod = await safeImport(() => import(/* @vite-ignore */ path));
  if (mod.__error) return;
  const Interaction = mod.default || Object.values(mod)[0];
  app.interaction = new Interaction(app.board, app.engine, game, skin);
  if (app.interaction.attach) app.interaction.attach();
}

// ── status placeholder while milestones are still landing ─────────────────────
function showStatus(missing) {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = `
    <div class="board-status">
      <div class="bs-logo">パ</div>
      <div class="bs-title">PazoruKore</div>
      <div class="bs-line">${app.gameId} × ${app.skinId}</div>
      <div class="bs-missing">building: ${missing.map((m) => `<code>${m}</code>`).join(' · ')}</div>
      <div class="bs-hint">engine ✓ · grid ✓ · events ✓ · display vendored ✓</div>
    </div>`;
}

// ── admin / tuning panel (generic, driven by the skin's glyph params schema) ──
async function openAdmin() {
  const mod = await safeImport(() => import('./admin.js'));
  const panel = document.getElementById('admin');
  if (mod.__error || !(mod.Admin || mod.default)) { panel.hidden = false; panel.innerHTML = '<h3>admin</h3><p class="muted">tuning panel lands with the first skin (M3).</p>'; return; }
  const Admin = mod.Admin || mod.default;
  if (!app._admin) app._admin = new Admin(panel);
  app._admin.show(app.skin, app.board);
}
function toggleAdmin() {
  const panel = document.getElementById('admin');
  app.admin = panel.hidden;
  const ab = document.getElementById('btn-admin'); if (ab) ab.setAttribute('aria-pressed', String(app.admin));
  if (app.admin) openAdmin(); else panel.hidden = true;
}

// ── overlays (picker/settings/about) — minimal sheets for now ─────────────────
function openSheet(id, html) {
  const el = document.getElementById(id);
  el.innerHTML = `<div class="sheet">${html}<div class="admin-actions"><button data-close>close</button></div></div>`;
  el.hidden = false;
  el.querySelector('[data-close]').onclick = () => { el.hidden = true; };
  el.onclick = (e) => { if (e.target === el) el.hidden = true; };
}

function openPicker() {
  const games = Object.keys(GAME_LOADERS), skins = Object.keys(SKIN_LOADERS);
  const gameOpt = (sel) => games.map((x) => `<span class="pick-wrap"><button class="pick" data-v="${x}"${x === sel ? ' aria-pressed="true"' : ''}>${x}</button>${RULES[x] ? `<button class="pick-i" data-i="${x}" title="${x} rules" aria-label="${x} rules">i</button>` : ''}</span>`).join('');
  openSheet('picker', `
    <h2>Game × Skin</h2>
    <p class="muted">A — game</p><div class="pick-row" id="pick-games">${gameOpt(app.gameId)}</div>
    <p class="muted">B — skin</p><div class="pick-row" id="pick-skins"></div>
    <div class="sheet-links"><button class="link" data-a="pipeline">Pipeline</button><button class="link" data-a="tune">Tune</button><button class="link" data-a="settings">Settings</button><button class="link" data-a="about">About</button></div>`);
  const pk = document.getElementById('picker');
  let g = app.gameId, s = app.skinId;
  if (skinDisabled(g, s)) s = firstEnabledSkin(g);
  function mark(sel, b) { pk.querySelectorAll(`${sel} .pick`).forEach((x) => x.removeAttribute('aria-pressed')); b.setAttribute('aria-pressed', 'true'); }
  // (re)build the skin row for the currently-selected game `g`; disabled skins render greyed + inert.
  function renderSkins() {
    const row = pk.querySelector('#pick-skins');
    row.innerHTML = skins.map((x) => {
      const off = skinDisabled(g, x);
      return `<button class="pick${off ? ' is-disabled' : ''}" data-v="${x}"${x === s ? ' aria-pressed="true"' : ''}${off ? ' disabled aria-disabled="true" title="not available for this game yet"' : ''}>${x}</button>`;
    }).join('');
    row.querySelectorAll('.pick').forEach((b) => { if (!b.disabled) b.onclick = () => { s = b.dataset.v; mark('#pick-skins', b); }; });
  }
  pk.querySelectorAll('#pick-games .pick').forEach((b) => b.onclick = () => {
    g = b.dataset.v; mark('#pick-games', b);
    if (skinDisabled(g, s)) s = firstEnabledSkin(g); // selected skin unavailable for the new game → fall back
    renderSkins();
  });
  pk.querySelectorAll('#pick-games .pick-i').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openRules(b.dataset.i); });
  renderSkins();
  pk.querySelector('[data-a="pipeline"]').onclick = () => { pk.hidden = true; openPipeline(); };
  pk.querySelector('[data-a="tune"]').onclick = () => { pk.hidden = true; toggleAdmin(); };
  pk.querySelector('[data-a="about"]').onclick = () => { pk.hidden = true; openAbout(); };
  pk.querySelector('[data-a="settings"]').onclick = () => { pk.hidden = true; openSettings(); };
  pk.querySelector('[data-close]').onclick = () => { pk.hidden = true; mountGame(g, s); };
}

// "how to play" — laconic rules for a game, opened by the picker/pipeline "i" and the chrome "i".
function openRules(key) {
  const r = RULES[key];
  if (!r) return;
  openSheet('rules', `
    <div class="rules-sheet">
      <div class="rules-title"><h2>${r.title}</h2><span class="rules-tag">how to play</span></div>
      <ul class="rules-list">${r.lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      <p class="rules-win"><b>Win</b>${r.win}</p>
    </div>`);
}

function openAbout() {
  openSheet('about', `
    <h2>PazoruKore</h2>
    <p class="muted">パズル + コア — a small, skinnable engine for grid-deduction puzzles.</p>
    <p>Inspired by <a href="https://www.chiark.greenend.org.uk/~sgtatham/puzzles/" target="_blank" rel="noopener">Simon Tatham's Portable Puzzle Collection</a>. We took architectural inspiration only and wrote original code, MIT licensed.</p>
    <p class="muted">Display renderers adapted from dexipurei-galore. Build <code id="about-build"></code>.</p>`);
  const b = document.querySelector('meta[name="cb"]'), el = document.getElementById('about-build');
  if (el && b) el.textContent = b.content;
}

function openSettings() {
  const params = app.game ? app.game.defaultParams() : {};
  const diffs = ['easy', 'medium', 'hard'];
  const gid = (app.engine && app.game) ? app.engine.gameId() : '';
  const stages = app.game && app.game.meta && app.game.meta.stages;
  const diffSection = stages
    ? `<p class="muted">stage — auto-ramps across the 10-game run</p>
       <div class="stage-curve">
         <span>1–3 <b>easy</b> ${stages.time.easy}s</span>
         <span>4–7 <b>medium</b> ${stages.time.medium}s</span>
         <span>8–10 <b>hard</b> ${stages.time.hard}s</span>
       </div>`
    : `<p class="muted">difficulty — starts a new puzzle</p>
       <div class="pick-row">${diffs.map((d) => `<button class="pick" data-diff="${d}"${params.difficulty === d ? ' aria-pressed="true"' : ''}>${d}</button>`).join('')}</div>`;
  openSheet('settings', `
    <h2>Settings</h2>
    ${diffSection}
    <p class="muted">solver — every puzzle is generated with a guaranteed unique solution</p>
    <div class="pick-row">
      <button class="pick" data-a="solve">Reveal solution</button>
      <button class="pick" data-a="hint">Hint (one step)</button>
    </div>
    <p class="muted">game ID — share or enter a puzzle</p>
    <div class="gid-row"><input id="gid-in" class="gid-input" value="${gid}" spellcheck="false" autocapitalize="off"><button class="pick" data-a="gid-copy">copy</button><button class="pick" data-a="gid-load">load</button></div>
    <p class="muted">accessibility</p>
    <div class="pick-row">
      <button class="pick" data-a="rm" aria-pressed="${document.body.classList.contains('force-reduced')}">reduce motion</button>
      <button class="pick" data-a="haptics" aria-pressed="${app.haptics !== false}">haptics</button>
    </div>
    <p class="muted">session</p>
    <div class="pick-row">
      <button class="pick" data-a="hiscores">High scores</button>
    </div>`);
  const s = document.getElementById('settings');
  s.querySelector('[data-a="hiscores"]').onclick = () => { s.hidden = true; openHighScores(); };
  s.querySelector('[data-a="solve"]').onclick = () => { s.hidden = true; revealSolution(); };
  s.querySelector('[data-a="hint"]').onclick = () => { s.hidden = true; if (app.engine && app.engine.hint) app.engine.hint(); };
  s.querySelectorAll('[data-diff]').forEach((b) => b.onclick = () => { s.hidden = true; newGameWith({ difficulty: b.dataset.diff }); });
  s.querySelector('[data-a="gid-copy"]').onclick = () => { const v = document.getElementById('gid-in').value; if (navigator.clipboard) navigator.clipboard.writeText(v); };
  s.querySelector('[data-a="gid-load"]').onclick = () => { const v = document.getElementById('gid-in').value.trim(); if (v) { s.hidden = true; mountGame(app.gameId, app.skinId, v); } };
  s.querySelector('[data-a="rm"]').onclick = (e) => { document.body.classList.toggle('force-reduced'); e.target.setAttribute('aria-pressed', String(document.body.classList.contains('force-reduced'))); };
  s.querySelector('[data-a="haptics"]').onclick = (e) => { app.haptics = app.haptics === false; e.target.setAttribute('aria-pressed', String(app.haptics !== false)); };
}

function newGameWith(extra) {
  if (!app.game) return;
  mountGame(app.gameId, app.skinId, { ...app.game.defaultParams(), ...extra, seed: undefined });
}

// Reveal the full solution (the engine's own solver result). A player aid + a solvability check for
// when a puzzle "feels impossible" — it proves the puzzle IS solvable. Does NOT score (app.revealed).
function revealSolution() {
  if (!app.engine || !app.engine.solution || app.phase === 'solved') return;
  app.revealed = true;
  solveFromSolution();
}

// Pipeline / roadmap: what's shipped + what's next (the §18 horizon), each game briefly explained.
const SHIPPED_GAMES = [
  { n: 'Sudoku', k: 'sudoku', i: 'digit-entry', d: 'Classic 9×9 Latin square — fill so every row, column and 3×3 box holds 1–9 with no repeats.' },
  { n: 'Shikaku', k: 'shikaku', i: 'region-draw', d: 'Divide the grid into rectangles; each rectangle’s area equals the clue number it contains.' },
  { n: 'Bridges', k: 'bridges', i: 'bridge-draw', d: 'Connect numbered islands with bridges (1 or 2 between a pair, never crossing) so each island has exactly its number of bridges and the whole network is one connected web. (Tatham’s Bridges / Hashiwokakero.)' },
  { n: 'Pearl', k: 'masyu', i: 'loop-draw', d: 'Draw one closed loop through the centres of adjacent squares: every black circle must be a corner (and not touch another corner), every white circle a straight that meets at least one corner. Drag between squares to lay or lift loop segments. (Tatham’s Pearl / Masyu.)' },
  { n: 'Fillomino', k: 'fillomino', i: 'digit-entry', d: 'Every cell holds a number; carve the grid into regions where a region of size N is filled entirely with N — no two equal-size regions touching. Rides every skin (digit glyphs).' },
  { n: 'KenKen', k: 'kenken', i: 'digit + cages', d: 'A Latin-square base with arithmetic cages — the numbers in each cage must combine to its target via +, −, × or ÷. Rides every skin.' },
  { n: 'Slitherlink', k: 'slitherlink', i: 'edge-draw', d: 'Draw a single closed loop along the grid lines; each clue says how many of its four sides the loop uses. Tap or drag along the dot lattice to lay/lift edges.' },
  { n: 'Nurikabe', k: 'nurikabe', i: 'cell-shade', d: 'Shade cells into one connected “sea” so every clue becomes an island of exactly that many unshaded cells. Tap or drag to shade.' },
  { n: 'Star Battle', k: 'starbattle', i: 'star-place', d: 'Grid split into regions; place one star per row, column and region, with no two stars touching (even diagonally). Tap a cell to place or remove a star.' },
];
const NEXT_GAMES = [
  { n: 'Word / alnum', i: 'v2 glyphs', d: '16-segment & dot-matrix skins unlock letters; the capability negotiation already gates which skins can host alphabetic games.' },
];
// Feature / polish backlog (not games) — surfaced in the Pipeline "to do" section.
// Feature / polish backlog — all shipped (run recap, session high-scores, START/NEW action display,
// ready-to-start gate, Sudoku finalize FX, Fillomino region tinting). Empty → the "to do" section is
// hidden. Future v1.x ideas land here.
const TODO_FEATURES = [];

function openPipeline() {
  const card = (g, cls) => `<div class="pl-card ${cls}"><div class="pl-head"><span class="pl-name">${g.n}</span>${g.k && RULES[g.k] ? `<button class="pick-i pl-i" data-i="${g.k}" title="${g.n} rules" aria-label="${g.n} rules">i</button>` : ''}<span class="pl-tag">${g.i}</span></div><p class="pl-desc">${g.d}</p></div>`;
  openSheet('pipeline', `
    <h2>Pipeline</h2>
    <p class="muted">shipped — playable now, any game × any skin</p>
    <div class="pl-list">${SHIPPED_GAMES.map((g) => card(g, 'done')).join('')}</div>
    <p class="muted">next up — the roadmap</p>
    <div class="pl-list">${NEXT_GAMES.map((g) => card(g, 'next')).join('')}</div>
    ${TODO_FEATURES.length ? `<p class="muted">to do — features &amp; polish</p>
    <div class="pl-list">${TODO_FEATURES.map((g) => card(g, 'todo')).join('')}</div>` : ''}
    <p class="muted pl-foot">3 skins shipped: Futuristic (16-segment) · Retro (Lixie tube) · Pastel (split-flap). Any skin wears any game.</p>`);
  const pl = document.getElementById('pipeline');
  pl.querySelectorAll('.pl-i').forEach((b) => b.onclick = () => openRules(b.dataset.i));
}

// ── elapsed-time clock (16-seg red) — ARMED at 00:00 on load (ready-to-start gate), runs on START ──
let _timer = { start: 0, interval: 0, running: false, solved: false, elapsed: 0, disp: null, actDisp: null, budgetMs: null };
function timerDisp() {
  if (!_timer.disp) { const cv = document.getElementById('timer-canvas'); if (cv) _timer.disp = new TimerDisplay(cv); }
  return _timer.disp;
}
// READY: show 00:00 (or the full budget) in red, clock NOT running — the player presses START.
function armTimer() {
  clearInterval(_timer.interval); _timer.interval = 0;
  _timer.running = false; _timer.solved = false; _timer.elapsed = 0; _timer.start = 0;
  _timer.budgetMs = app.budgetMs || null;
  renderTimer();
}
function startTimer() {
  clearInterval(_timer.interval);
  _timer.start = performance.now(); _timer.running = true; _timer.solved = false; _timer.elapsed = 0;
  _timer.budgetMs = app.budgetMs || null;
  renderTimer();
  _timer.interval = setInterval(renderTimer, 1000);
}
function stopTimer() {
  if (_timer.solved) return;
  _timer.elapsed = _timer.running ? (performance.now() - _timer.start) : 0;
  _timer.running = false; _timer.solved = true;
  clearInterval(_timer.interval); _timer.interval = 0;
  renderTimer();
}
function renderTimer() {
  const ms = _timer.running ? (performance.now() - _timer.start) : _timer.elapsed;
  const d = timerDisp(); if (!d) return;
  if (_timer.budgetMs != null) {
    const { mmss, over } = countDown(_timer.budgetMs - ms);
    d.render(mmss, _timer.solved, over);
  } else {
    d.render(countUp(ms), _timer.solved, false);
  }
}

// ── START / NEW action display (16-seg green) + round lifecycle ───────────────
// phase: 'ready' (press START or make the first move to begin timing) → 'playing' → 'solved'
// (press NEW for the next puzzle). The label ghosts (dim) while playing, lit green when actionable.
function actionDisp() {
  if (!_timer.actDisp) { const cv = document.getElementById('action-canvas'); if (cv) _timer.actDisp = new ActionDisplay(cv); }
  return _timer.actDisp;
}
// START before a round → NEXT for the next game within a 10-game run → NEW once the run is complete.
function actionLabel() {
  if (app.phase === 'ready') return 'START';
  const solved = app.score ? app.score.gameInRun : 0;
  // at 'solved' renderAction runs AFTER record() so gameInRun already counts this solve; while
  // 'playing' it's pre-solve, so look ahead one to preview the right label.
  const done = app.phase === 'solved' ? solved : solved + 1;
  return done >= SCORE.runLen ? 'NEW' : 'NEXT';
}
function renderAction() {
  const d = actionDisp(); if (!d) return;
  const active = app.phase === 'ready' || app.phase === 'solved';
  const label = actionLabel();
  const btn = document.getElementById('btn-action');
  if (btn) { btn.dataset.phase = app.phase || 'ready'; btn.setAttribute('aria-label', active ? label : 'in play'); }
  d.render(label, active);
}
function setReady() {            // a fresh puzzle is loaded but not yet timed
  app.phase = 'ready';
  armTimer();
  renderAction();
}
function startRound() {          // begin timing the current puzzle (explicit START, or first move)
  if (app.phase !== 'ready') return;
  app.phase = 'playing';
  startTimer();
  renderAction();
}
function onActionPress() {
  if (app.phase === 'ready') startRound();
  else if (app.phase === 'solved') newGameWith({});   // advance → mountGame → setReady()
}

// ── scoring + combo callouts (timer-linked) ───────────────────────────────────
function onSolved() {
  stopTimer();
  app.phase = 'solved';
  if (app.scored || !app.score || app.revealed) { renderAction(); return; } // a revealed solution doesn't score
  app.scored = true;
  const secs = _timer.elapsed / 1000;
  const opts = _timer.budgetMs != null ? { budget: _timer.budgetMs / 1000 } : undefined;
  const r = app.score.record(secs, app.undoUsed, opts);
  updateScoreHUD(r);
  renderAction();   // after record() so the label reflects this solve (NEXT mid-run, NEW when complete)
  if (r.callout) showStreak(r.callout, r.tier);
  if (r.runComplete) setTimeout(() => showRecap(r), 1600);    // let the board celebration play, then recap
  else if (r.overlay) showPerfectOverlay(r);
}

function updateScoreHUD(r) {
  const num = document.getElementById('score-num');
  if (num) {
    num.textContent = r.runTotal.toLocaleString();
    num.classList.toggle('perfect', !!r.perfect);
    num.classList.remove('bump'); void num.offsetWidth; num.classList.add('bump');
  }
  const lbl = document.getElementById('score-lbl');
  if (lbl) {
    lbl.textContent = r.perfect
      ? `+${r.points} ·×${r.mult.toFixed(1)}`
      : (r.overBy > 0 ? `+${r.points} · OVER −${Math.ceil(r.overBy)}s` : `+${r.points}`);
  }
  const prog = document.getElementById('run-prog');
  if (prog) prog.innerHTML = `${Math.min(r.gameInRun, 10)}<span class="run-sep">/</span>10`;
  const best = document.getElementById('run-best');
  if (best) best.textContent = `★ ${(app.score.best.runScore || 0).toLocaleString()}`;
}

// reflect the game-of-run that's about to be played + the persisted best (called on each new game).
function updateUpcomingRun() {
  if (!app.score) return;
  const fresh = app.score.gameInRun >= 10;
  const n = fresh ? 1 : app.score.gameInRun + 1;
  const prog = document.getElementById('run-prog');
  if (prog) prog.innerHTML = `${n}<span class="run-sep">/</span>10`;
  const num = document.getElementById('score-num');
  if (num) { num.textContent = (fresh ? 0 : app.score.runTotal).toLocaleString(); num.classList.remove('perfect'); }
  const lbl = document.getElementById('score-lbl'); if (lbl) lbl.textContent = 'SCORE';
  const best = document.getElementById('run-best');
  if (best) best.textContent = `★ ${(app.score.best.runScore || 0).toLocaleString()}`;
}

function showStreak(callout, tier) {
  const el = document.getElementById('streak-flash'); if (!el) return;
  el.className = 'streak-flash tier-' + Math.min(tier, 10);
  el.textContent = callout.label;
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(app._streakT);
  app._streakT = setTimeout(() => { el.hidden = true; el.classList.remove('show'); }, 3000);
  if (navigator.vibrate && app.haptics !== false) { try { navigator.vibrate(tier >= 3 ? [18, 28, 40] : 14); } catch (_) {} }
}

function showPerfectOverlay(r) {
  const el = document.getElementById('perfect-overlay'); if (!el) return;
  const title = document.getElementById('po-title'), sub = document.getElementById('po-sub');
  if (title) title.textContent = '完璧!';
  if (sub) sub.textContent = r.flawless ? `PĀFEKUTO RUN · 10/10 · +${r.runBonus.toLocaleString()}` : `${r.streak} PERFECT IN A ROW`;
  el.hidden = false;
  clearTimeout(app._overlayT);
  app._overlayT = setTimeout(() => { el.hidden = true; }, 2800);
  el.onclick = () => { el.hidden = true; };
}

// Session high-scores markup, reused by the recap section and the standalone sheet. Built on the
// existing .recap-table / .muted styling so it renders consistently with the rest of the sheets.
// `best` is the persisted ScoreKeeper.best; `highlight` (a run total) marks the freshly-set best run
// with a NEW badge (only the first matching row, so duplicate totals don't all light up).
function highScoresHTML(best, highlight) {
  const fastest = (best && best.fastestRound != null) ? best.fastestRound : null;
  const runs = (best && best.topRuns) ? best.topRuns : [];
  let marked = false;
  const runsList = runs.length
    ? `<table class="recap-table"><tbody>${runs.map((v, i) => {
        const isNew = !marked && highlight != null && v === highlight;
        if (isNew) marked = true;
        return `<tr class="${isNew ? 'rc-perfect' : ''}"><td class="rc-n">#${i + 1}</td><td class="rc-res">${isNew ? 'new best' : ''}</td><td class="rc-pts">${v.toLocaleString()}</td></tr>`;
      }).join('')}</tbody></table>`
    : `<p class="muted">no completed runs yet</p>`;
  return `
    <div class="recap-total"><span>FASTEST ROUND</span><span class="rc-total-val">${fastest != null ? Math.round(fastest) + 's' : '—'}</span></div>
    <p class="muted">top runs</p>
    ${runsList}`;
}

// Standalone high-scores sheet (Settings → High scores) — works outside a run, reads app.score.best.
// Reuses the hidden #recap overlay container; openSheet rewrites its innerHTML each time.
function openHighScores() {
  const best = (app.score && app.score.best) ? app.score.best : { fastestRound: null, topRuns: [] };
  openSheet('recap', `
    <h2>High scores</h2>
    <p class="muted">this session · persisted</p>
    ${highScoresHTML(best, null)}
    <div class="sheet-links"><button class="link" data-a="settings">Settings</button></div>`);
  const el = document.getElementById('recap');
  const back = el.querySelector('[data-a="settings"]');
  if (back) back.onclick = () => { el.hidden = true; openSettings(); };
}

// End-of-run recap dashboard: a per-round table (R# · time · result) + the run total, after a 10/10 run.
function showRecap(r) {
  const sum = r.summary; if (!sum) return;
  const rows = (sum.rounds || []).map((rd) => {
    const time = rd.overBy > 0 ? `+${Math.ceil(rd.overBy)}s` : `${Math.round(rd.t)}s`;
    const res = rd.label || (rd.overBy > 0 ? 'OVER' : 'clear');
    return `<tr class="${rd.perfect ? 'rc-perfect' : ''}"><td class="rc-n">R${rd.n}</td><td class="rc-t">${time}</td><td class="rc-res">${res}</td><td class="rc-pts">+${rd.points.toLocaleString()}</td></tr>`;
  }).join('');
  const isBest = sum.total > 0 && sum.total >= (sum.best || 0);
  // high-scores reads ScoreKeeper.best (already updated by record()); highlight this run if it's a new top-3 entry.
  const hsBest = (app.score && app.score.best) ? app.score.best : { fastestRound: sum.fastestRound, topRuns: sum.topRuns };
  openSheet('recap', `
    <div class="recap-sheet">
      <h2 class="recap-title ${sum.flawless ? 'is-flawless' : ''}">${sum.flawless ? '完璧 FLAWLESS' : 'RUN RECAP'}</h2>
      <p class="muted">10 games · ${sum.perfects}/10 perfect${sum.bonus ? ` · run bonus +${sum.bonus.toLocaleString()}` : ''}</p>
      <table class="recap-table"><tbody>${rows}</tbody></table>
      <div class="recap-total"><span>TOTAL</span><span class="rc-total-val${isBest ? ' rc-best' : ''}">${sum.total.toLocaleString()}</span></div>
      <p class="muted recap-best">${isBest ? '★ NEW BEST RUN' : `★ best ${(sum.best || 0).toLocaleString()}`}</p>
      <p class="muted hs-head">high scores</p>
      ${highScoresHTML(hsBest, sum.total)}
      <button class="recap-new" type="button" data-recap-new>NEW RUN ▸</button>
    </div>`);
  const el = document.getElementById('recap');
  const nb = el.querySelector('[data-recap-new]');
  if (nb) nb.onclick = () => { el.hidden = true; newGameWith({}); };
}

function init() {
  const q = new URLSearchParams(location.search);
  if (q.get('game')) app.gameId = q.get('game');
  if (q.get('skin')) app.skinId = q.get('skin');
  app.score = new ScoreKeeper();
  renderVersionGlyphs();
  initPWA();
  document.getElementById('btn-menu').onclick = openPicker;
  document.getElementById('btn-pipeline').onclick = openPipeline;
  const rb = document.getElementById('btn-rules'); if (rb) rb.onclick = () => openRules(app.gameId);
  document.getElementById('btn-action').onclick = onActionPress;
  window.addEventListener('resize', () => { if (_timer.disp) renderTimer(); if (_timer.actDisp && app.phase) renderAction(); });
  document.getElementById('btn-menu').addEventListener('contextmenu', (e) => e.preventDefault());
  mountGame(app.gameId, app.skinId);
  if (q.has('recap')) setTimeout(() => {   // dev: simulate a 10-game run and show the recap dashboard
    const times = [7, 9, 22, 6, 11, 8, 30, 5, 13, 19], undos = [false, false, false, true, false, false, false, false, false, false];
    let r; for (let i = 0; i < 10; i++) r = app.score.record(times[i], undos[i], {});
    showRecap(r);
  }, 400);
  const sheet = q.get('sheet');
  if (sheet === 'about') setTimeout(openAbout, 400);
  else if (sheet === 'settings') setTimeout(openSettings, 400);
  else if (sheet === 'pipeline') setTimeout(openPipeline, 400);
  else if (sheet === 'rules') setTimeout(() => openRules(app.gameId), 400);
  else if (sheet === 'picker') setTimeout(openPicker, 400);
  if (q.has('pad')) setTimeout(() => {
    const c = app.engine.current().grid.cells.find((x) => x.role === 'fillable' && x.value == null);
    if (c && app.interaction && app.interaction._openPad) { app.interaction.select(c.id); app.interaction._openPad(c.id, window.innerWidth / 2, window.innerHeight / 2); }
  }, 500);
  if (q.has('cand')) setTimeout(() => {
    const c = app.engine.current().grid.cells.find((x) => x.role === 'fillable' && x.value == null);
    if (c && app.interaction) { app.interaction.pencilMode = true; app.interaction.select(c.id); for (let d = 1; d <= 9; d++) app.interaction.pencil(d); app.interaction.pencilMode = false; }
  }, 450);
  if (q.has('win')) {
    const tryWin = () => { if (app.interaction && app.engine && app.engine.solution) solveFromSolution(); else setTimeout(tryWin, 80); };
    setTimeout(tryWin, 300);
  }
  if (q.has('celeb')) {  // dev: solve, then FREEZE the celebration at a fixed progress for a deterministic shot
    const pr = Math.max(0, Math.min(1, parseFloat(q.get('celeb')) || 0.5));
    const tryC = () => {
      if (!(app.interaction && app.board && app.engine && app.engine.solution)) return setTimeout(tryC, 80);
      solveFromSolution();
      cancelAnimationFrame(app.board._raf); app.board._raf = 0; app.board.anims.clear();
      for (const c of app.engine.current().grid.cells) app.board.paintCell(c.id, { event: 'solved', progress: pr, elapsed: pr * 1750, payload: {} });
    };
    setTimeout(tryC, 300);
  }
}

// dev: drive the puzzle to its solution so the solved celebration fires (for screenshots / smoke tests).
function solveFromSolution() {
  const eng = app.engine, g = app.game;
  if (g.meta.interaction === 'bridge-draw') {
    const sb = eng.solution && eng.solution.bridges; if (!sb) return;
    for (const [key, count] of Object.entries(sb)) { const [a, b] = key.split('|'); for (let i = 0; i < count; i++) eng.do({ type: 'bridge', a, b }); }
    return;
  }
  if (g.meta.interaction === 'loop-draw') {
    const sl = eng.solution && eng.solution.loop; if (!sl) return;
    for (const key of Object.keys(sl)) { const [a, b] = key.split('|'); eng.do({ type: 'loop', a, b }); }
    return;
  }
  if (g.meta.interaction === 'edge-draw') {
    const sl = eng.solution && eng.solution.loop; if (!sl) return;
    for (const key of Object.keys(sl)) { const [a, b] = key.split('|'); eng.do({ type: 'edge', a, b }); }
    return;
  }
  if (g.meta.interaction === 'cell-shade') {
    const ss = eng.solution && eng.solution.shaded; if (!ss) return;
    for (const id of Object.keys(ss)) eng.do({ type: 'shade', id });
    return;
  }
  if (g.meta.interaction === 'star-place') {
    const ss = eng.solution && eng.solution.stars; if (!ss) return;
    for (const id of Object.keys(ss)) eng.do({ type: 'star', id });
    return;
  }
  const sol = eng.solution && eng.solution.grid ? eng.solution.grid : null;
  if (!sol) return;
  if (g.meta.interaction === 'digit-entry') {
    for (const c of eng.current().grid.cells) {
      if (c.role !== 'fillable' || c.value != null) continue;
      const s = sol.cells.find((x) => x.id === c.id);
      if (s) { app.interaction.select(c.id); app.interaction.place(s.value); }
    }
  } else {
    const byRegion = new Map();
    for (const c of sol.cells) { if (c.regionId == null) continue; if (!byRegion.has(c.regionId)) byRegion.set(c.regionId, []); byRegion.get(c.regionId).push(c.id); }
    for (const [clueId, cells] of byRegion) eng.do({ type: 'region-commit', clueId, cells });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
