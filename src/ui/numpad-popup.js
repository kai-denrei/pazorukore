// src/ui/numpad-popup.js — a number popup that opens at the tap point with the "5" under the finger
// (a 3×3 grid centred on the tap). Slightly transparent, amber/orange digits, per-digit remaining
// counts. Backdrop tap, Escape, or a hardware digit key closes it. Triggered on the SECOND tap of a
// selected editable cell (see digit-entry.js).

export class NumpadPopup {
  constructor() { this.backdrop = null; this.pad = null; this._key = null; }

  isOpen() { return !!this.backdrop; }

  // show(x, y, opts): opts = { size, counts:Map<string,number>, pencil:boolean, onPick(d), onClose() }
  show(x, y, opts = {}) {
    this.hide();
    const { size = 9, counts = null, pencil = false, onPick, onClose } = opts;
    this.onClose = onClose;

    const backdrop = document.createElement('div');
    backdrop.className = 'numpop-backdrop';
    const pad = document.createElement('div');
    pad.className = 'numpop' + (pencil ? ' is-pencil' : '');
    if (pencil) { const tag = document.createElement('div'); tag.className = 'numpop-tag'; tag.textContent = 'candidate'; pad.appendChild(tag); }
    const grid = document.createElement('div');
    grid.className = 'numpop-grid';
    for (let d = 1; d <= size; d++) {                 // digits 1..board-size (Sudoku 9, Fillomino 7, …)
      const b = document.createElement('button');
      b.className = 'numpop-key'; b.type = 'button'; b.dataset.d = d;
      const left = counts ? Math.max(0, size - (counts.get(String(d)) || 0)) : null;
      b.innerHTML = `<span class="np-d">${d}</span>${left != null ? `<span class="np-rem">${left || ''}</span>` : ''}`;
      if (left === 0) b.classList.add('np-done');
      grid.appendChild(b);
    }
    pad.appendChild(grid);
    backdrop.appendChild(pad);
    document.body.appendChild(backdrop);
    this.backdrop = backdrop; this.pad = pad;

    // centre the 3×3 (its middle key = "5") under the tap, clamped to the viewport.
    const place = () => {
      const r = pad.getBoundingClientRect(), m = 10;
      let left = x - r.width / 2, top = y - r.height / 2;
      left = Math.max(m, Math.min(left, window.innerWidth - r.width - m));
      top = Math.max(m, Math.min(top, window.innerHeight - r.height - m));
      pad.style.left = `${left}px`; pad.style.top = `${top}px`;
      pad.classList.add('in');
    };
    requestAnimationFrame(place);

    grid.addEventListener('click', (e) => {
      const k = e.target.closest('.numpop-key'); if (!k) return;
      if (onPick) onPick(parseInt(k.dataset.d, 10));
      this.hide();
    });
    backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) this.hide(); });
    this._key = (e) => {
      if (e.key === 'Escape') this.hide();
      else if (/^[1-9]$/.test(e.key)) { if (onPick) onPick(parseInt(e.key, 10)); this.hide(); }
    };
    window.addEventListener('keydown', this._key);
  }

  hide() {
    if (this._key) { window.removeEventListener('keydown', this._key); this._key = null; }
    if (this.backdrop) {
      this.backdrop.remove();
      this.backdrop = null; this.pad = null;
      const cb = this.onClose; this.onClose = null;
      if (cb) cb();
    }
  }
}

export default NumpadPopup;
