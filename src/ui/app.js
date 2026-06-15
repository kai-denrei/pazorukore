// src/ui/app.js — bootstrap. Wires the chrome (version badge, admin toggle, menu/new buttons),
// holds the game/skin registry, and mounts the selected (game × skin) pairing onto the board.
// Modules load lazily so the shell runs and progressively lights up as milestones land (the /loop):
// until a game+skin+board are all present, the board shows a build-status placeholder.

import { renderVersionGlyphs } from './version-badge.js';
import { initPWA } from './pwa.js';
import { TimerDisplay } from './timer-display.js';
import { Engine } from '../core/engine.js';
import { EVENTS } from '../core/events.js';
import { negotiate } from '../core/capabilities.js';

const GAME_LOADERS = {
  sudoku: () => import('../games/sudoku/index.js'),
  shikaku: () => import('../games/shikaku/index.js'),
};
const SKIN_LOADERS = {
  futuristic: () => import('../skins/futuristic/skin.js'),
  retro: () => import('../skins/retro/skin.js'),
  pastel: () => import('../skins/pastel/skin.js'),
};
const pickDefault = (mod) => mod.default || Object.values(mod)[0];

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
  app.engine.on(EVENTS.solved, stopTimer);

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

  startTimer();

  // admin tuning panel reflects the active skin's glyph params
  if (app.admin) openAdmin();

  // dev-only: ?demo drives the real interaction path so a static screenshot can prove
  // select→place→events→repaint+transition end to end (no browser automation needed).
  if (new URLSearchParams(location.search).has('demo')) setTimeout(() => runDemo(), 300);
}

function runDemo() {
  const eng = app.engine, inter = app.interaction;
  if (!eng || !inter) return;

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
  const path = kind === 'region-draw' ? '../interaction/region-draw.js' : '../interaction/digit-entry.js';
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
  const opt = (arr, sel) => arr.map((x) => `<button class="pick" data-v="${x}"${x === sel ? ' aria-pressed="true"' : ''}>${x}</button>`).join('');
  openSheet('picker', `
    <h2>Game × Skin</h2>
    <p class="muted">A — game</p><div class="pick-row" id="pick-games">${opt(games, app.gameId)}</div>
    <p class="muted">B — skin</p><div class="pick-row" id="pick-skins">${opt(skins, app.skinId)}</div>
    <div class="sheet-links"><button class="link" data-a="pipeline">Pipeline</button><button class="link" data-a="tune">Tune</button><button class="link" data-a="settings">Settings</button><button class="link" data-a="about">About</button></div>`);
  const pk = document.getElementById('picker');
  let g = app.gameId, s = app.skinId;
  pk.querySelectorAll('#pick-games .pick').forEach((b) => b.onclick = () => { g = b.dataset.v; mark('#pick-games', b); });
  pk.querySelectorAll('#pick-skins .pick').forEach((b) => b.onclick = () => { s = b.dataset.v; mark('#pick-skins', b); });
  function mark(sel, b) { pk.querySelectorAll(`${sel} .pick`).forEach((x) => x.removeAttribute('aria-pressed')); b.setAttribute('aria-pressed', 'true'); }
  pk.querySelector('[data-a="pipeline"]').onclick = () => { pk.hidden = true; openPipeline(); };
  pk.querySelector('[data-a="tune"]').onclick = () => { pk.hidden = true; toggleAdmin(); };
  pk.querySelector('[data-a="about"]').onclick = () => { pk.hidden = true; openAbout(); };
  pk.querySelector('[data-a="settings"]').onclick = () => { pk.hidden = true; openSettings(); };
  pk.querySelector('[data-close]').onclick = () => { pk.hidden = true; mountGame(g, s); };
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
  openSheet('settings', `
    <h2>Settings</h2>
    <p class="muted">difficulty — starts a new puzzle</p>
    <div class="pick-row">${diffs.map((d) => `<button class="pick" data-diff="${d}"${params.difficulty === d ? ' aria-pressed="true"' : ''}>${d}</button>`).join('')}</div>
    <p class="muted">game ID — share or enter a puzzle</p>
    <div class="gid-row"><input id="gid-in" class="gid-input" value="${gid}" spellcheck="false" autocapitalize="off"><button class="pick" data-a="gid-copy">copy</button><button class="pick" data-a="gid-load">load</button></div>
    <p class="muted">accessibility</p>
    <div class="pick-row">
      <button class="pick" data-a="rm" aria-pressed="${document.body.classList.contains('force-reduced')}">reduce motion</button>
      <button class="pick" data-a="haptics" aria-pressed="${app.haptics !== false}">haptics</button>
    </div>`);
  const s = document.getElementById('settings');
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

// Pipeline / roadmap: what's shipped + what's next (the §18 horizon), each game briefly explained.
const SHIPPED_GAMES = [
  { n: 'Sudoku', i: 'digit-entry', d: 'Classic 9×9 Latin square — fill so every row, column and 3×3 box holds 1–9 with no repeats.' },
  { n: 'Shikaku', i: 'region-draw', d: 'Divide the grid into rectangles; each rectangle’s area equals the clue number it contains.' },
];
const NEXT_GAMES = [
  { n: 'Bridges', i: 'bridge-draw', d: 'Connect numbered islands with bridges (1 or 2 between a pair, never crossing) so each island has exactly its number of bridges and the whole network is one connected web. (Tatham’s Bridges / Hashiwokakero — in progress, same skins.)' },
  { n: 'Fillomino', i: 'region-paint', d: 'Every cell holds a number; carve the grid into regions where a region of size N is filled entirely with N. The densest glyph showcase.' },
  { n: 'KenKen / Killer', i: 'digit + cages', d: 'A Latin-square base with arithmetic cages — the numbers in each cage must reach a target via +, −, × or ÷.' },
  { n: 'Slitherlink', i: 'edge-draw', d: 'Draw a single closed loop along the grid lines; each clue says how many of its four sides the loop uses. Needs a new edge-draw interaction.' },
  { n: 'Nurikabe', i: 'cell-shade', d: 'Shade cells into one connected “sea” so every clue becomes an island of exactly that many unshaded cells.' },
  { n: 'Star Battle', i: 'star-place', d: 'Place stars so every row, column and region has exactly N, with no two stars touching.' },
  { n: 'Word / alnum', i: 'v2 glyphs', d: '16-segment & dot-matrix skins unlock letters; the capability negotiation already gates which skins can host alphabetic games.' },
];

function openPipeline() {
  const card = (g, cls) => `<div class="pl-card ${cls}"><div class="pl-head"><span class="pl-name">${g.n}</span><span class="pl-tag">${g.i}</span></div><p class="pl-desc">${g.d}</p></div>`;
  openSheet('pipeline', `
    <h2>Pipeline</h2>
    <p class="muted">shipped — playable now, any game × any skin</p>
    <div class="pl-list">${SHIPPED_GAMES.map((g) => card(g, 'done')).join('')}</div>
    <p class="muted">next up — the roadmap</p>
    <div class="pl-list">${NEXT_GAMES.map((g) => card(g, 'next')).join('')}</div>
    <p class="muted pl-foot">3 skins shipped: Futuristic (16-segment) · Retro (Lixie tube) · Pastel (split-flap). Any skin wears any game.</p>`);
}

// ── elapsed-time clock — rendered as a 16-segment red display (starts on load, stops on solve) ──
let _timer = { start: 0, interval: 0, stopped: false, elapsed: 0, disp: null };
function timerDisp() {
  if (!_timer.disp) { const cv = document.getElementById('timer-canvas'); if (cv) _timer.disp = new TimerDisplay(cv); }
  return _timer.disp;
}
function startTimer() {
  clearInterval(_timer.interval);
  _timer.start = performance.now(); _timer.stopped = false; _timer.elapsed = 0;
  renderTimer();
  _timer.interval = setInterval(renderTimer, 1000);
}
function stopTimer() {
  if (_timer.stopped) return;
  _timer.elapsed = performance.now() - _timer.start; _timer.stopped = true;
  clearInterval(_timer.interval);
  renderTimer();
}
function renderTimer() {
  const ms = _timer.stopped ? _timer.elapsed : (performance.now() - _timer.start);
  const s = Math.floor(ms / 1000), m = Math.min(99, Math.floor(s / 60));
  const mmss = `${String(m).padStart(2, '0')}${String(s % 60).padStart(2, '0')}`;
  const d = timerDisp(); if (d) d.render(mmss, _timer.stopped);
}

function init() {
  const q = new URLSearchParams(location.search);
  if (q.get('game')) app.gameId = q.get('game');
  if (q.get('skin')) app.skinId = q.get('skin');
  renderVersionGlyphs();
  initPWA();
  document.getElementById('btn-menu').onclick = openPicker;
  document.getElementById('btn-pipeline').onclick = openPipeline;
  document.getElementById('btn-new').onclick = () => newGameWith({});
  window.addEventListener('resize', () => { if (_timer.disp) renderTimer(); });
  document.getElementById('btn-menu').addEventListener('contextmenu', (e) => e.preventDefault());
  mountGame(app.gameId, app.skinId);
  const sheet = q.get('sheet');
  if (sheet === 'about') setTimeout(openAbout, 400);
  else if (sheet === 'settings') setTimeout(openSettings, 400);
  else if (sheet === 'pipeline') setTimeout(openPipeline, 400);
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
