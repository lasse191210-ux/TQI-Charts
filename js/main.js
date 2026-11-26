import { App } from './app.js';

// Installation als App (Chrome/Edge auf PC und Android): Ereignis merken, Knopf zeigen
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installEvt = e; window.tqi?.ui?.renderInstall?.(); });
window.addEventListener('appinstalled', () => { window.__installEvt = null; window.tqi?.ui?.renderInstall?.(); window.tqi?.ui?.toast?.('TQI Charts ist installiert – du findest die App im Startmenü bzw. auf dem Desktop.', 'info', 6000); });

const app = new App(document.getElementById('app'));
window.tqi = app;
app.init().catch((e) => {
  console.error(e);
  const t = document.getElementById('toasts');
  if (t) t.innerHTML = `<div class="toast error">Start fehlgeschlagen: ${String(e.message || e)}</div>`;
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
