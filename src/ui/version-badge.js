// src/ui/version-badge.js — the 3-glyph build indicator shown small, top-left, next to the
// project name. Derived from the cache-bust token in <meta name="cb"> using the same byte→cell
// encoding as the cache-busting toolkit (byte mod 64 → row=color band, col=shape variant), so the
// three glyphs are a human-eyeball check that a fresh build actually reached the browser.

const COLORS = ['#00e5d0', '#ff7a1f', '#ffc24a', '#36d6ff', '#b06bff', '#3ad17a', '#ff4d8d', '#e8e6df'];

// 8 shape fragments drawn in a 0..16 viewBox, tinted by the row color.
const SHAPES = [
  (c) => `<circle cx="8" cy="8" r="6" fill="${c}"/>`,
  (c) => `<rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="${c}"/>`,
  (c) => `<path d="M8 1.5 L14.5 14 L1.5 14 Z" fill="${c}"/>`,
  (c) => `<path d="M8 1 L15 8 L8 15 L1 8 Z" fill="${c}"/>`,
  (c) => `<path d="M8 1.5 L14 5 L14 11 L8 14.5 L2 11 L2 5 Z" fill="${c}"/>`,
  (c) => `<path d="M8 1 l1.9 4.4 4.8.4 -3.6 3.1 1.1 4.7 -4.2-2.5 -4.2 2.5 1.1-4.7 -3.6-3.1 4.8-.4 Z" fill="${c}"/>`,
  (c) => `<path d="M6.3 2 h3.4 v3.9 h3.9 v3.4 h-3.9 v3.9 h-3.4 v-3.9 h-3.9 v-3.4 h3.9 Z" fill="${c}"/>`,
  (c) => `<circle cx="8" cy="8" r="6" fill="none" stroke="${c}" stroke-width="3"/>`,
];

function tokenBytes(tok) {
  const b = [];
  for (let i = 0; i + 1 < tok.length; i += 2) b.push(parseInt(tok.slice(i, i + 2), 16) & 0xff);
  return b;
}

function glyphSvg(byte) {
  const cell = byte % 64;
  const color = COLORS[(cell >> 3) & 7];
  const shape = SHAPES[cell & 7];
  return `<svg viewBox="0 0 16 16" role="img">${shape(color)}</svg>`;
}

export function renderVersionGlyphs() {
  const el = document.getElementById('version-glyphs');
  if (!el) return;
  const meta = document.querySelector('meta[name="cb"]');
  const token = (meta && meta.content) || 'dev00000';
  const bytes = tokenBytes(token);
  let html = '';
  for (let i = 0; i < 3; i++) {
    const byte = bytes[i] != null ? bytes[i] : (token.charCodeAt(i) || 0) & 0xff;
    html += glyphSvg(byte);
  }
  html += `<span class="vg-token">${token}</span>`;
  el.innerHTML = html;
  el.title = `build ${token}`;
}
