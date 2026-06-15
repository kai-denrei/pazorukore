// src/ui/controls.js — the bottom-docked thumb-zone tools (§11.6): prominent always-visible
// undo/redo, plus pencil-mode / erase / hint for digit games. NUMBER ENTRY is no longer a docked
// numpad — it's a popup that opens at the tap point (see numpad-popup.js / digit-entry.js); the
// pencil toggle here flips the interaction into candidate mode so the popup writes pencil marks.

import { EVENTS } from '../core/events.js';

export class Controls {
  constructor(rootEl, engine, game, interaction) {
    this.root = rootEl; this.engine = engine; this.game = game; this.interaction = interaction;
    this._subs = [];
  }

  mount() {
    const isDigit = this.game.meta.interaction === 'digit-entry';
    this.root.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'ctrl-bar';

    const tools = document.createElement('div');
    tools.className = 'ctrl-tools';
    tools.innerHTML = `
      <button class="ctrl-btn" data-act="undo" title="Undo" aria-label="Undo">↶</button>
      <button class="ctrl-btn" data-act="redo" title="Redo" aria-label="Redo">↷</button>
      ${isDigit ? `<button class="ctrl-btn" data-act="pencil" title="Candidate marks" aria-label="Candidate (pencil) mode" aria-pressed="false">✎</button>
      <button class="ctrl-btn" data-act="erase" title="Erase" aria-label="Erase">⌫</button>` : ''}
      <button class="ctrl-btn" data-act="hint" title="Hint" aria-label="Hint">?</button>`;
    bar.appendChild(tools);

    if (isDigit) {
      const hint = document.createElement('div');
      hint.className = 'ctrl-hint';
      hint.textContent = 'tap a cell, tap again for numbers';
      bar.appendChild(hint);
    }

    this.root.appendChild(bar);
    this._wire();
    this._subs.push(this.engine.on(EVENTS.moved, () => this.refresh()));
    this._subs.push(this.engine.on(EVENTS.loaded, () => this.refresh()));
    this.refresh();
  }

  destroy() { this._subs.forEach((off) => off()); this._subs = []; this.root.innerHTML = ''; }

  _wire() {
    this.root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (t) this._tool(t.dataset.act, t);
    });
  }

  _tool(act, el) {
    switch (act) {
      case 'undo': this.engine.undo(); break;
      case 'redo': this.engine.redo(); break;
      case 'erase': this.interaction.clear && this.interaction.clear(); break;
      case 'hint': this.engine.hint(); break;
      case 'pencil':
        this.interaction.pencilMode = !this.interaction.pencilMode;
        el.setAttribute('aria-pressed', String(this.interaction.pencilMode));
        break;
    }
  }

  refresh() {
    const u = this.root.querySelector('[data-act="undo"]'), r = this.root.querySelector('[data-act="redo"]');
    if (u) u.disabled = !this.engine.canUndo();
    if (r) r.disabled = !this.engine.canRedo();
    const p = this.root.querySelector('[data-act="pencil"]');
    if (p && this.interaction) p.setAttribute('aria-pressed', String(!!this.interaction.pencilMode));
  }
}

export default Controls;
