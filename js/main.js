import { App } from './app.js';

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
