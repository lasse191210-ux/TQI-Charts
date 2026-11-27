// Mehrere Charts (wie TradingView-Layouts): 2 nebeneinander, 2 übereinander oder 4. Jede Zelle ist ein eigenes
// TQI Charts (Rahmen) mit eigener Zeiteinheit und eigenen Indikatoren. Zelle 1 = dein normaler Chart.
// Fadenkreuz und auf Wunsch Symbol werden zwischen den Zellen gekoppelt (postMessage über diese Seite).
import { ICON } from './icons.js';
import { storage } from './util.js';

export const LAYOUTS = [['2h', '2 nebeneinander', 2, 1], ['2v', '2 übereinander', 1, 2], ['3', '3 (1 groß + 2)', 2, 2], ['4', '4 (2 × 2)', 2, 2]];
const KEY = 'tqi-charts:multi';

export function hostMulti(lay) {
  const L = LAYOUTS.find(x => x[0] === lay) || LAYOUTS[3];
  const cfg = { xhair: true, sym: false, ...(storage.get(KEY, {}) || {}), lay: L[0] };
  storage.set(KEY, cfg);
  const n = L[0] === '3' ? 3 : L[2] * L[3];
  document.title = 'TQI Charts · ' + L[1];
  document.body.className = 'multi-host';
  document.body.innerHTML = `
    <header class="mh-bar">
      <a class="brand" href="./" title="Zurück zu einem Chart">${ICON.candles}<span>TQI <b>Charts</b></span></a>
      <span class="sep"></span>
      ${LAYOUTS.map(([k, l]) => `<button class="tb ${k === L[0] ? 'on' : ''}" data-lay="${k}" title="${l}">${layIcon(k)}</button>`).join('')}
      <span class="sep"></span>
      <label class="chk"><input type="checkbox" data-c="xhair" ${cfg.xhair ? 'checked' : ''}><i></i><span>Fadenkreuz koppeln</span></label>
      <label class="chk"><input type="checkbox" data-c="sym" ${cfg.sym ? 'checked' : ''}><i></i><span>Symbol koppeln</span></label>
      <div class="grow"></div>
      <a class="tb" href="./">${ICON.close}<span>Ein Chart</span></a>
    </header>
    <main class="mh-grid lay-${L[0]}">${Array.from({ length: n }, (_, i) => `<div class="mh-cell" data-slot="${i + 1}"><iframe title="Chart ${i + 1}" src="index.html?slot=${i + 1}&embed=1"></iframe></div>`).join('')}</main>`;
  document.querySelectorAll('[data-lay]').forEach(b => b.onclick = () => { location.search = '?multi=' + b.dataset.lay; });
  document.querySelectorAll('[data-c]').forEach(b => b.onchange = () => { cfg[b.dataset.c] = b.checked; storage.set(KEY, cfg); });
  const frames = () => [...document.querySelectorAll('.mh-cell iframe')];
  // Desktop-Ansicht auch in schmalen Zellen: Rahmen breiter rendern und verkleinern
  const fit = () => {
    for (const f of frames()) {
      const c = f.parentElement, w = c.clientWidth, h = c.clientHeight;
      const s = Math.min(1, w / 900);
      f.style.width = (w / s) + 'px'; f.style.height = (h / s) + 'px';
      f.style.transform = s < 1 ? `scale(${s})` : '';
    }
  };
  new ResizeObserver(fit).observe(document.querySelector('.mh-grid'));
  fit();
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
    const m = e.data;
    if (m.type === 'tqi-xhair' && !cfg.xhair) return;
    if (m.type === 'tqi-sym' && !cfg.sym) return;
    if (m.type !== 'tqi-xhair' && m.type !== 'tqi-sym') return;
    for (const f of frames()) if (f.contentWindow !== e.source) f.contentWindow?.postMessage(m, location.origin);
  });
}

function layIcon(k) {
  const r = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1"/>`;
  const body = k === '2h' ? r(4, 6, 9, 16) + r(15, 6, 9, 16) : k === '2v' ? r(5, 4, 18, 9) + r(5, 15, 18, 9) : k === '3' ? r(4, 6, 10, 16) + r(16, 6, 8, 7) + r(16, 15, 8, 7) : r(4, 5, 9, 8) + r(15, 5, 9, 8) + r(4, 15, 9, 8) + r(15, 15, 9, 8);
  return `<svg viewBox="0 0 28 28" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${body}</svg>`;
}
export { layIcon };

/** In einer Zelle: Fadenkreuz und Symbol an die anderen Zellen melden bzw. übernehmen. */
export function linkSlot(app, slot) {
  if (window.parent === window) return;
  let remote = false, lastSend = 0;
  app.chart.subscribeCrosshairMove((p) => {
    if (remote) return;
    const now = performance.now();
    if (now - lastSend < 30 && p?.time != null) return;
    lastSend = now;
    const t = p && p.time != null && p.point ? p.time * 1000 : null;
    const price = t != null && p.point ? app.series.coordinateToPrice(p.point.y) : null;
    window.parent.postMessage({ type: 'tqi-xhair', slot, t, price, base: app.state.base }, location.origin);
  });
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data) return;
    const m = e.data;
    if (m.type === 'tqi-xhair') {
      remote = true;
      try {
        if (m.t == null || !app.bars.length) app.chart.clearCrosshairPosition();
        else {
          const bars = app.bars;
          let i = bars.length - 1;
          while (i > 0 && bars[i].t > m.t) i--;
          const b = bars[i];
          const price = m.base === app.state.base && Number.isFinite(m.price) ? m.price : b.c;
          app.chart.setCrosshairPosition(price, b.t / 1000, app.series);
        }
      } catch { /* egal */ }
      setTimeout(() => { remote = false; }, 0);
    } else if (m.type === 'tqi-sym' && (m.base !== app.state.base || m.market !== app.state.market)) {
      app._symRemote = true;
      app.setSymbol(m.base, m.market);
    }
  });
}
