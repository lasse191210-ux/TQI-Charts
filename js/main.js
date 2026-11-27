import { App } from './app.js';
import { APP } from './config.js';

// Installation als App (Chrome/Edge auf PC und Android): Ereignis merken, Knopf zeigen
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installEvt = e; window.tqi?.ui?.renderInstall?.(); });
window.addEventListener('appinstalled', () => { window.__installEvt = null; window.tqi?.ui?.renderInstall?.(); window.tqi?.ui?.toast?.('TQI Charts ist installiert – du findest die App im Startmenü bzw. auf dem Desktop.', 'info', 6000); });

// Mehrere Charts: ?multi=4 baut die Layout-Seite, jede Zelle lädt ?slot=N&embed=1 (eigener Speicher je Zelle)
const q = new URLSearchParams(location.search);
const multi = q.get('multi');
if (multi && window.top === window) {
  import('./multi.js').then(m => m.hostMulti(multi));
} else {
  const slot = Math.max(1, Math.min(4, +q.get('slot') || 1));
  APP.slot = slot;
  APP.embed = q.get('embed') === '1' && window.parent !== window;
  if (slot > 1) APP.key = APP.key + ':s' + slot;
  if (APP.embed) document.body.classList.add('embed');
  const app = new App(document.getElementById('app'));
  window.tqi = app;
  app.init().then(() => { if (APP.embed) import('./multi.js').then(m => m.linkSlot(app, slot)); }).catch((e) => {
    console.error(e);
    const t = document.getElementById('toasts');
    if (t) t.innerHTML = `<div class="toast error">Start fehlgeschlagen: ${String(e.message || e)}</div>`;
  });
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
