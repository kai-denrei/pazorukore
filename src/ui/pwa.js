// src/ui/pwa.js — registers the service worker, shows a CONSENT-GATED update toast (never
// skipWaiting() behind the user's back), and surfaces an install affordance: the Chrome/Android
// beforeinstallprompt, or a manual Add-to-Home-Screen hint on iOS Safari (which has no such event).

export function initPWA() {
  registerSW();
  wireInstall();
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(reg.waiting || sw);
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloading) { reloading = true; location.reload(); }
    });
  } catch (_) { /* SW is progressive enhancement — ignore failures */ }
}

function showUpdate(worker) {
  const el = document.getElementById('sw-toast');
  if (!el || !worker) return;
  el.innerHTML = 'New version available <button type="button" data-act="refresh">Refresh</button><button type="button" class="x" data-act="dismiss" aria-label="dismiss">✕</button>';
  el.hidden = false;
  el.querySelector('[data-act="refresh"]').onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
  el.querySelector('[data-act="dismiss"]').onclick = () => { el.hidden = true; };
}

function dismissed() { try { return localStorage.getItem('pk.install.dismissed') === '1'; } catch (_) { return false; } }
function markDismissed() { try { localStorage.setItem('pk.install.dismissed', '1'); } catch (_) {} }

function wireInstall() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone || dismissed()) return;

  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    const el = document.getElementById('install-hint');
    if (!el) return;
    el.innerHTML = '<span class="logo">パ</span> Install PazoruKore <button type="button" data-act="install">Install</button><button type="button" class="x" data-act="dismiss" aria-label="dismiss">✕</button>';
    el.hidden = false;
    el.querySelector('[data-act="install"]').onclick = async () => { el.hidden = true; deferred.prompt(); await deferred.userChoice; deferred = null; };
    el.querySelector('[data-act="dismiss"]').onclick = () => { el.hidden = true; markDismissed(); };
  });
  window.addEventListener('appinstalled', () => { const el = document.getElementById('install-hint'); if (el) el.hidden = true; });

  // iOS Safari: no beforeinstallprompt — show a one-time manual hint.
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) && !window.MSStream;
  const isSafari = /^((?!chrome|crios|fxios|android).)*safari/i.test(ua);
  if (isIOS && isSafari) {
    const el = document.getElementById('install-hint');
    if (!el) return;
    el.innerHTML = '<span class="logo">パ</span> Add to Home Screen — tap Share then “Add to Home Screen”<button type="button" class="x" data-act="dismiss" aria-label="dismiss">✕</button>';
    el.hidden = false;
    el.querySelector('[data-act="dismiss"]').onclick = () => { el.hidden = true; markDismissed(); };
  }
}
