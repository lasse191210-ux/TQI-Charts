// Oberfläche: Toolbar, Zeichenleiste, Legende, Z-Tabelle, Panels rechts (Watchlist, Trades, Orderbuch),
// Dialoge (Symbol, Indikatoren, Einstellungen), Handy-Leiste.
import { ICON, TOOL_ICON, CHART_TYPES, coinBadge } from './icons.js';
import { TOOLS, COLORS, LINE_TYPES, STYLE_KEYS } from './render/drawings.js';
import { TYPES, REGISTRY, CATEGORIES } from './indicators.js';
import { MARKETS } from './exchanges.js';
import { APP, COINS, COIN_NAME, TEMPLATES, CANDLE_STYLES } from './config.js';
import { ALERT_CONDS } from './alerts.js';
import { TIMEFRAMES, fmtPrice, fmtPct, fmtCompact, fmtTime, fmtDateTime, tzOffsetLabel, escapeHtml as esc, nf, deepClone, mergeDefaults, niceStep, periodStart, cssColor, splitColor, joinColor, mixHex, SESSION_MODES } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const TF_SHORT = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h', '1D': 'D', '1W': 'W', '1M': 'M' };
const TF_LEGEND = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720', '1D': '1D', '1W': '1W', '1M': '1M' };

export class UI {
  constructor(app) {
    this.app = app;
    this.mq = matchMedia('(max-width: 760px)');
    this.tapeDirty = false;
    this.wl = new Map();
    this.domSock = null;
    this.book = null;
  }
  get mobile() { return this.mq.matches; }
  get chartEl() { return $('#chart'); }
  get drawLayer() { return $('#drawLayer'); }

  // ================================================================ Aufbau
  build() {
    const a = this.app;
    $('#brandLogo').innerHTML = logoSvg();
    $('#tfMore').innerHTML = ICON.chev;
    $('#indBtn').innerHTML = `${ICON.fx}<span>Indikatoren</span>`;
    $('#tplBtn').innerHTML = `${ICON.grid}<span>Vorlagen</span>`;
    $('#setBtn').innerHTML = ICON.gear; $('#shotBtn').innerHTML = ICON.camera; $('#fullBtn').innerHTML = ICON.full;
    $('#symBtn').onclick = () => this.openSymbolDialog();
    $('#tfMore').onclick = (e) => this.openTfPop(e.currentTarget);
    $('#typeBtn').onclick = (e) => this.openTypePop(e.currentTarget);
    $('#indBtn').onclick = () => this.openIndicatorDialog();
    $('#tpoBtn').onclick = () => this.app.toggleTpo();
    $('#tplBtn').onclick = (e) => this.openTemplatePop(e.currentTarget);
    $('#themeBtn').onclick = () => a.setTheme(a.state.theme === 'dark' ? 'light' : 'dark');
    $('#setBtn').onclick = () => this.openSettings();
    $('#shotBtn').onclick = () => a.screenshot();
    $('#fullBtn').onclick = () => this.toggleFullscreen();
    $('#installBtn').innerHTML = `${ICON.install}<span>App installieren</span>`;
    $('#installBtn').onclick = () => this.installApp();
    $('#traderBtn').innerHTML = `${ICON.trade}<span>Trader</span>`;
    $('#traderBtn').onclick = () => this.app.trader?.toggle();
    this.renderInstall();
    $('#fsExit').innerHTML = ICON.fullExit;
    $('#fsExit').onclick = () => this.toggleFullscreen(false);
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && this.full && !this.mobile) this.toggleFullscreen(false); });
    this.mq.addEventListener('change', () => { this.renderAll(); setTimeout(() => this.placePaneLegends(), 50); });
    // Legende: Aktionen per Delegation
    $('#legend').addEventListener('click', (e) => this.onLegendClick(e));
    $('#paneLegends').addEventListener('click', (e) => this.onLegendClick(e));
    $('#legend').addEventListener('dblclick', (e) => { const r = e.target.closest('[data-uid]'); if (r) this.openIndicatorSettings(r.dataset.uid); });
    $('#legend').addEventListener('contextmenu', (e) => {
      const r = e.target.closest('[data-uid]');
      if (!r) return;
      e.preventDefault(); e.stopPropagation();
      const a = this.app, uid = r.dataset.uid, ind = a.state.indicators.find(i => i.uid === uid);
      if (!ind) return;
      this.ctxMenu(e.clientX, e.clientY, [
        { label: 'Einstellungen …', icon: 'gear', act: () => this.openIndicatorSettings(uid) },
        { label: ind.visible ? 'Ausblenden' : 'Einblenden', icon: ind.visible ? 'eyeOff' : 'eye', act: () => a.toggleIndicator(uid) },
        'sep',
        { label: 'Entfernen', icon: 'trash', danger: true, act: () => a.removeIndicator(uid) },
      ]);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.pop') && !e.target.closest('[data-pop]')) this.closePop(); });
    setInterval(() => { if (this.tapeDirty) this.renderTape(); }, 400);
    setInterval(() => this.loadWatchlist(), 15000);
  }

  renderAll() {
    this.renderTopbar();
    this.renderTools();
    this.renderLegend();
    this.renderRight();
    this.renderBottom();
    this.renderMobile();
    this.updateHeader();
    document.body.classList.toggle('right-closed', !this.app.state.rightOpen);
  }

  // ================================================================ Toolbar oben
  renderTopbar() {
    const a = this.app, st = a.state, m = a.market;
    $('#symBtn').innerHTML = `${coinBadge(st.base, 20)}<span class="sym-t">${esc(m.ticker(st.base))}</span><span class="sym-x">${m.badge}</span>`;
    $('#tfs').innerHTML = st.favTfs.map(tf => `<button class="tb tf ${tf === st.tf ? 'on' : ''}" data-tf="${tf}">${TF_SHORT[tf]}</button>`).join('') + (st.favTfs.includes(st.tf) ? '' : `<button class="tb tf on" data-tf="${st.tf}">${TF_SHORT[st.tf]}</button>`);
    $$('#tfs [data-tf]').forEach(b => b.onclick = () => a.setTf(b.dataset.tf));
    $('#typeBtn').innerHTML = ICON[st.chartType === 'tpo' ? (st.lastType && st.lastType !== 'tpo' ? st.lastType : 'candles') : st.chartType] || ICON.candles;
    $('#tpoBtn').innerHTML = `${ICON.tpo}<span>TPO</span>`;
    $('#tpoBtn').classList.toggle('on', a.tpoOverlayOn);
    $('#typeBtn').title = 'Charttyp: ' + (CHART_TYPES.find(x => x[0] === st.chartType)?.[1] || '');
    $('#themeBtn').innerHTML = st.theme === 'dark' ? ICON.sun : ICON.moon;
    $('#themeBtn').title = st.theme === 'dark' ? 'Helles Design (wie TradingView-Bild)' : 'Dunkles Design';
  }
  /** „App installieren“ zeigen, wenn der Browser es anbietet (nicht in der installierten App selbst). */
  get isStandalone() { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true; }
  renderInstall() {
    const b = $('#installBtn');
    if (b) b.hidden = this.isStandalone || !window.__installEvt;
  }
  async installApp() {
    const e = window.__installEvt;
    if (e) {
      e.prompt();
      const r = await e.userChoice.catch(() => null);
      if (r?.outcome === 'accepted') window.__installEvt = null;
      this.renderInstall();
      return;
    }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const body = el(`<div class="setdlg"><div class="info-box">${this.isStandalone ? 'Du nutzt TQI Charts bereits als App.' : ios
      ? 'iPhone / iPad: in Safari unten auf „Teilen“ tippen → „Zum Home-Bildschirm“.'
      : 'PC: in Chrome oder Edge oben rechts in der Adressleiste auf das Symbol „App installieren“ klicken (oder Menü ⋮ → „Streamen, speichern und teilen“ → „Seite als App installieren“). Danach startet TQI Charts in einem eigenen Fenster, mit eigenem Symbol im Startmenü und in der Taskleiste.'}</div>
      <div class="dlg-foot"><div class="grow"></div><button class="tb primary" id="inOk">OK</button></div></div>`);
    const close = this.modal('Als App installieren', body);
    $('#inOk', body).onclick = close;
  }
  setStatus(st) {
    const map = { live: ['Live', 'ok'], connecting: ['verbindet …', 'warn'], reconnecting: ['neu verbinden …', 'warn'], off: ['offline', 'off'] };
    const [txt, cls] = map[st] || map.off;
    for (const id of ['#status', '#mstatus']) { const e = $(id); if (e) { e.className = 'status ' + cls; e.querySelector('span').textContent = txt; } }
  }
  setLoading(on, text = '') {
    const l = $('#loading');
    l.classList.toggle('on', on);
    l.querySelector('span').textContent = on ? `Lade ${text} …` : '';
  }
  setHistoryLoading(on) { $('#histLoad').classList.toggle('on', on); }
  toast(msg, kind = 'info', ms = 4000) {
    const t = el(`<div class="toast ${kind}">${esc(msg)}</div>`);
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  }
  /** Vollbild-Chart: nur der Chart (Handy: ohne Kopf und Leiste unten; PC: ohne Seitenleisten) + Browser-Vollbild, wo möglich. */
  toggleFullscreen(on = !this.full) {
    this.full = on;
    document.body.classList.toggle('fullchart', on);
    try {
      if (on && document.fullscreenEnabled && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } catch { /* iPhone: kein Browser-Vollbild, CSS reicht */ }
    $('#fullBtn').innerHTML = on ? ICON.fullExit : ICON.full;
    const mf = $('#mhFull'); if (mf) mf.innerHTML = on ? ICON.fullExit : ICON.full;
    setTimeout(() => { this.placePaneLegends(); this.app.overlay.requestUpdate?.(); }, 60);
  }

  // ================================================================ Zeichenleiste links
  renderTools() {
    const a = this.app, st = a.state;
    const tool = a.drawings?.tool || 'cursor';
    const groups = [['cursor'], ['trend', 'ray', 'hline', 'hray', 'vline'], ['avwap', 'fvp', 'ftpo', 'rect', 'fib', 'measure', 'text'], ['long', 'short'], ['alert']];
    let html = groups.map(g => g.map(t => `<button class="tool ${t === tool ? 'on' : ''}" data-tool="${t}" title="${TOOLS.find(x => x[0] === t)[1]}">${ICON[TOOL_ICON[t]]}</button>`).join('')).join('<div class="tsep"></div>');
    html += '<div class="tsep"></div>';
    html += `<button class="tool ${st.magnet ? 'on' : ''}" data-tt="magnet" title="Magnet (an Kerzen einrasten)">${ICON.magnet}</button>`;
    html += `<button class="tool ${st.drawLock ? 'on' : ''}" data-tt="drawLock" title="Zeichnungen sperren">${st.drawLock ? ICON.lock : ICON.unlock}</button>`;
    html += `<button class="tool ${st.drawHide ? 'on' : ''}" data-tt="drawHide" title="Zeichnungen ausblenden">${st.drawHide ? ICON.eyeOff : ICON.eye}</button>`;
    html += `<button class="tool" data-tt="clear" title="Alle Zeichnungen löschen">${ICON.trash}</button>`;
    const box = $('#tools');
    box.innerHTML = `<div class="tools-in">${html}</div>`;
    $$('[data-tool]', box).forEach(b => b.onclick = () => a.drawings.setTool(b.dataset.tool));
    $$('[data-tt]', box).forEach(b => b.onclick = () => {
      const k = b.dataset.tt;
      if (k === 'clear') { if (a.drawings.items.length && confirm('Alle Zeichnungen für ' + a.state.base + ' löschen?')) a.drawings.clearAll(); return; }
      a.setState({ [k]: !st[k] }, { render: false });
      this.renderTools();
      a.drawings._changed(false);
    });
  }
  onTool(t) {
    this.drawLayer.classList.toggle('on', t !== 'cursor');
    $$('#tools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    if (this.mobile && t !== 'cursor') this.toast(['hline', 'hray', 'vline', 'text', 'long', 'short', 'avwap'].includes(t) ? 'Tippe auf den Chart' : t === 'alert' ? 'Tippe auf den Preis für den Alarm' : 'Tippe Startpunkt, dann Endpunkt', 'info', 1800);
  }
  onDrawingSelect(sel) {
    const bar = $('#selbar');
    if (!sel) { bar.classList.remove('on'); bar.innerHTML = ''; return; }
    const isPos = sel.type === 'long' || sel.type === 'short';
    if (sel.type === 'alert' || sel.type === 'ftpo') { this._selbarSpecial(bar, sel); return; }
    bar.innerHTML = (isPos ? '' : COLORS.map(c => `<button class="sw ${sel.color === c ? 'on' : ''}" data-c="${c}" style="--c:${c}"></button>`).join('') + '<span class="vsep"></span>' +
      [1, 2, 3].map(w => `<button class="wbtn ${sel.width === w ? 'on' : ''}" data-w="${w}"><i style="height:${w}px"></i></button>`).join('')) +
      (sel.type === 'fib' ? `<button class="tb ${sel.ext ? 'on' : ''}" data-ext="1" title="nach rechts verlängern">→</button>` : '') +
      (sel.type === 'avwap' ? `<span class="vsep"></span><button class="tb" data-bands="1" title="Bänder: aus / ±1σ / ±1σ ±2σ / ±1σ ±2σ ±3σ">σ ${['aus', '1', '1 2', '1 2 3'][sel.bands || 0]}</button><button class="tb" data-src="1" title="Quelle">${(sel.src || 'hlc3').toUpperCase()}</button>` : '') +
      `<span class="vsep"></span><button class="tb icon" data-set="1" title="Einstellungen (auch Rechtsklick / Doppelklick)">${ICON.gear}</button><button class="tb icon" data-del="1" title="Löschen">${ICON.trash}</button>`;
    bar.classList.add('on');
    const d = this.app.drawings;
    $('[data-set]', bar).onclick = () => this.openDrawingSettings(sel);
    $$('[data-c]', bar).forEach(b => b.onclick = () => { sel.color = b.dataset.c; d._changed(); });
    $$('[data-w]', bar).forEach(b => b.onclick = () => { sel.width = +b.dataset.w; d._changed(); });
    $('[data-ext]', bar)?.addEventListener('click', () => { sel.ext = !sel.ext; d._changed(); });
    $('[data-bands]', bar)?.addEventListener('click', () => { sel.bands = ((sel.bands || 0) + 1) % 4; d._changed(); });
    $('[data-src]', bar)?.addEventListener('click', () => { const l = ['hlc3', 'ohlc4', 'close']; sel.src = l[(l.indexOf(sel.src || 'hlc3') + 1) % l.length]; d._changed(); });
    $('[data-del]', bar).onclick = () => d.remove(sel);
  }

  /** Auswahlleiste für Alarm-Linien und Fixed Range TPO. */
  _selbarSpecial(bar, sel) {
    const d = this.app.drawings;
    if (sel.type === 'alert') {
      const cond = ALERT_CONDS.find(c => c[0] === (sel.cond || 'cross')) || ALERT_CONDS[0];
      bar.innerHTML = `<span class="sb-t">🔔 ${esc(this.app.fmt(sel.pts[0].p))}</span><button class="tb" data-cond="1" title="Bedingung">${cond[1]}</button>` +
        (sel.fired ? `<button class="tb" data-arm="1" title="Wieder scharf schalten">wieder aktivieren</button>` : '') +
        `<button class="tb" data-note="1" title="Notiz">Notiz</button><button class="tb" data-list="1">alle Alarme</button><span class="vsep"></span><button class="tb icon" data-set="1" title="Einstellungen">${ICON.gear}</button><button class="tb icon" data-del="1" title="Löschen">${ICON.trash}</button>`;
      $('[data-cond]', bar).onclick = () => { const k = ALERT_CONDS.findIndex(c => c[0] === (sel.cond || 'cross')); sel.cond = ALERT_CONDS[(k + 1) % ALERT_CONDS.length][0]; sel.fired = null; d._changed(); };
      $('[data-arm]', bar)?.addEventListener('click', () => { sel.fired = null; d._changed(); });
      $('[data-note]', bar).onclick = () => { const t = prompt('Notiz zum Alarm', sel.note || ''); if (t != null) { sel.note = t.trim(); d._changed(); } };
      $('[data-list]', bar).onclick = () => this.openAlerts();
    } else {
      bar.innerHTML = `<span class="sb-t">TPO</span><button class="tb" data-mode="1" title="Darstellung">${sel.mode === 'blocks' ? 'Blöcke' : 'Buchstaben'}</button>` +
        `<button class="tb" data-block="1" title="Zeit pro Buchstabe">${sel.block || '30m'}</button><button class="tb" data-va="1" title="Value Area">VA ${sel.vaPct || 68} %</button>` +
        `<button class="tb ${sel.clip ? 'on' : ''}" data-clip="1" title="Nur im gezogenen Preisbereich zählen">Preisbereich</button><span class="vsep"></span><button class="tb icon" data-set="1" title="Einstellungen">${ICON.gear}</button><button class="tb icon" data-del="1" title="Löschen">${ICON.trash}</button>`;
      $('[data-mode]', bar).onclick = () => { sel.mode = sel.mode === 'blocks' ? 'letters' : 'blocks'; d._changed(); };
      $('[data-block]', bar).onclick = () => { const l = ['5m', '15m', '30m', '1h']; sel.block = l[(l.indexOf(sel.block || '30m') + 1) % l.length]; d._changed(); this.app.ensureNeeds(); };
      $('[data-va]', bar).onclick = () => { const l = [68, 70, 80]; sel.vaPct = l[(l.indexOf(sel.vaPct || 68) + 1) % l.length]; d._changed(); };
      $('[data-clip]', bar).onclick = () => { sel.clip = !sel.clip; d._changed(); };
    }
    $('[data-del]', bar).onclick = () => d.remove(sel);
    $('[data-set]', bar).onclick = () => this.openDrawingSettings(sel);
    bar.classList.add('on');
  }

  // ================================================================ Rechtsklick-Menüs (wie TradingView / ATAS)
  /** Kontextmenü an der Mausposition. items: { label, icon, act, danger, hint } oder 'sep'. */
  ctxMenu(x, y, items) {
    this.closePop();
    const box = el(`<div class="pop ctxmenu"><div class="menu">${items.map((it, i) => it === 'sep' ? '<div class="msep"></div>'
      : `<div class="mi act ${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon ? ICON[it.icon] || '' : '<i class="noico"></i>'}<span>${esc(it.label)}</span>${it.hint ? `<small class="muted">${esc(it.hint)}</small>` : ''}</div>`).join('')}</div></div>`);
    $('#pop').appendChild(box);
    const w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + 'px';
    box.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 4)) + 'px';
    box.addEventListener('contextmenu', (e) => e.preventDefault());
    box.onclick = (e) => {
      const it = e.target.closest('[data-i]');
      if (!it) return;
      this.closePop();
      items[+it.dataset.i].act?.();
    };
    const off = () => { this.closePop(); window.removeEventListener('wheel', off); window.removeEventListener('resize', off); window.removeEventListener('keydown', esc1); };
    const esc1 = (e) => { if (e.key === 'Escape') off(); };
    window.addEventListener('wheel', off, { once: true, passive: true });
    window.addEventListener('resize', off, { once: true });
    window.addEventListener('keydown', esc1);
  }
  /** Rechtsklick auf eine Zeichnung. */
  openDrawingMenu(it, x, y) {
    const d = this.app.drawings;
    const items = [
      { label: 'Einstellungen …', icon: 'gear', act: () => this.openDrawingSettings(it) },
      { label: 'Klonen', icon: 'copy', act: () => d.clone(it) },
      { label: it.locked ? 'Entsperren' : 'Sperren', icon: it.locked ? 'unlock' : 'lock', act: () => { it.locked = !it.locked; d._changed(); } },
    ];
    if (it.type === 'alert') items.push({ label: 'Alle Alarme …', icon: 'alert', act: () => this.openAlerts() });
    items.push('sep', { label: 'Löschen', icon: 'trash', danger: true, hint: 'Entf', act: () => d.remove(it) });
    this.ctxMenu(x, y, items);
  }
  /** Rechtsklick in den Chart: Chart-Einstellungen, Linie/Alarm am Preis, Trader, Ansicht. */
  openChartMenu(x, y, price) {
    const a = this.app, d = a.drawings, st = a.state;
    const p = price > 0 ? price : null;
    const ps = p ? a.fmt(p) : '';
    const items = [
      { label: 'Chart-Einstellungen (Farben, Kerzen) …', icon: 'candles', act: () => this.openChartSettings() },
      { label: 'Einstellungen (Session, TPO, Zeitzone) …', icon: 'gear', act: () => this.openSettings() },
      { label: 'Indikatoren …', icon: 'fx', hint: '/', act: () => this.openIndicatorDialog() },
      { label: 'Vorlagen …', icon: 'grid', act: () => this.openTemplateSheet() },
    ];
    if (p) {
      items.push('sep',
        { label: `Horizontale Linie bei ${ps}`, icon: 'hline', act: () => d.addAt('hline', p) },
        { label: `Alarm bei ${ps}`, icon: 'alert', act: () => d.addAt('alert', p) });
      if (a.trader?.open) {
        const T = a.trader;
        items.push(
          { label: `Trader: Entry ${ps}`, icon: 'trade', act: () => T.dragLine('entry', p, true) },
          { label: `Trader: Stop ${ps}`, icon: 'trade', act: () => T.dragLine('stop', p, true) },
          { label: `Trader: Ziel ${ps}`, icon: 'trade', act: () => T.dragLine('target', p, true) });
      }
      items.push({ label: `Preis kopieren (${ps})`, icon: 'copy', act: () => { navigator.clipboard?.writeText(String(+p.toFixed(a.priceDec))).then(() => this.toast('Preis kopiert', 'info', 1500)).catch(() => {}); } });
    }
    items.push('sep',
      { label: 'Ansicht zurücksetzen', icon: 'reset', act: () => { a.chart.priceScale('right').setAutoScale(true); a.chart.timeScale().scrollToRealTime(); } },
      { label: st.drawHide ? 'Zeichnungen einblenden' : 'Zeichnungen ausblenden', icon: st.drawHide ? 'eye' : 'eyeOff', act: () => { a.setState({ drawHide: !st.drawHide }, { render: false }); this.renderTools(); d._changed(false); } });
    if (d.items.length) items.push({ label: `Alle Zeichnungen löschen (${d.items.length}) …`, icon: 'trash', danger: true, act: () => { if (confirm(`Alle ${d.items.length} Zeichnungen auf ${st.base} löschen?`)) d.clearAll(); } });
    this.ctxMenu(x, y, items);
  }

  /** Einstellungen einer Zeichnung wie in TradingView: außen (Rand) und innen (Hintergrund) je Farbe mit Deckkraft,
   *  Text, Koordinaten; unten „Vorlage“: als Standard für neue Zeichnungen speichern, eigene Vorlagen, Werkseinstellung. */
  openDrawingSettings(it) {
    const a = this.app, d = a.drawings, ty = it.type, st = a.state;
    const NAME = Object.fromEntries(TOOLS);
    const isLine = LINE_TYPES.has(ty), isPos = ty === 'long' || ty === 'short';
    const one = ['hline', 'hray', 'vline', 'text', 'avwap', 'alert'].includes(ty);
    const keys = STYLE_KEYS[ty] || [];
    const FACTORY = {
      color: ty === 'hline' || ty === 'hray' ? '#7c3aed' : ty === 'alert' || ty === 'ftpo' ? '#131722' : ty === 'text' ? (a.theme.dark ? '#e8e6e1' : '#131722') : '#2962ff',
      width: ty === 'alert' || ty === 'ftpo' ? 1 : 2, dash: 'solid', ext: false, extL: false, axis: true, bgOn: ty !== 'text', bg: null,
      fs: 13, bdOn: false, bd: '#787b86', src: 'hlc3', bands: 1, cond: 'cross', mode: ty === 'ftpo' ? 'letters' : 'volume', block: '30m', vaPct: 68, clip: false, rows: 0, wf: 0.4,
    };
    const hexOf = (c) => splitColor(c || '#2962ff').hex;
    const read = () => ({
      color: it.color || FACTORY.color, width: it.width || 1, dash: it.dash || 'solid', label: it.label || '',
      bgOn: ty === 'text' ? !!it.bgOn : it.bgOn !== false, bg: it.bg || (ty === 'text' ? (a.theme.dark ? '#2a2e39' : '#f0f3fa') : joinColor(hexOf(it.color), it.fillA ?? 0.14)),
      ext: !!it.ext, extL: !!it.extL, axis: it.axis !== false, text: it.text || '', fs: it.fs || 13, bdOn: !!it.bdOn, bd: it.bd || '#787b86', locked: !!it.locked,
      src: it.src || 'hlc3', bands: it.bands ?? 1, cond: it.cond || 'cross', note: it.note || '',
      mode: it.mode || FACTORY.mode, block: it.block || '30m', vaPct: it.vaPct || 68, clip: !!it.clip, rows: it.rows || 0, wf: it.wf || 0.4,
      p0: +(+it.pts[0].p).toFixed(a.priceDec), p1: +(+it.pts[1].p).toFixed(a.priceDec), stop: it.stop != null ? +(+it.stop).toFixed(a.priceDec) : 0, target: it.target != null ? +(+it.target).toFixed(a.priceDec) : 0,
    });
    let cur = read();
    const step = Math.pow(10, -a.priceDec);
    const schema = [];
    // außen: Linie bzw. Rand
    if (!isPos && ty !== 'measure') {
      schema.push({ sec: ty === 'rect' ? 'Außen (Rand)' : ty === 'text' ? 'Text' : 'Linie' });
      schema.push({ k: 'color', label: ty === 'rect' ? 'Farbe Rand' : 'Farbe', t: 'color' });
      if (isLine || ['avwap', 'alert'].includes(ty)) schema.push({ k: 'width', label: ty === 'rect' ? 'Randbreite' : 'Linienbreite', t: 'width' });
      if (isLine) schema.push({ k: 'dash', label: 'Linienart', t: 'select', opts: [['solid', 'durchgezogen'], ['dashed', 'gestrichelt'], ['dotted', 'gepunktet']] });
    }
    if (ty === 'text') schema.push({ k: 'text', label: 'Text', t: 'text' }, { k: 'fs', label: 'Schriftgröße', t: 'int', min: 8, max: 48 });
    // innen: Hintergrund
    if (ty === 'rect' || ty === 'text') {
      schema.push({ sec: ty === 'rect' ? 'Innen (Hintergrund)' : 'Hintergrund und Rahmen' });
      schema.push({ k: 'bgOn', label: 'Hintergrund', t: 'bool', color: 'bg' });
      if (ty === 'text') schema.push({ k: 'bdOn', label: 'Rahmen', t: 'bool', color: 'bd' });
    }
    if (ty === 'trend' || ty === 'fib' || ty === 'ray' || ty === 'hline' || ty === 'hray' || isLine) schema.push({ sec: 'Weitere' });
    if (ty === 'trend' || ty === 'fib') schema.push({ k: 'ext', label: 'nach rechts verlängern', t: 'bool' });
    if (ty === 'trend' || ty === 'ray') schema.push({ k: 'extL', label: 'nach links verlängern', t: 'bool' });
    if (ty === 'hline' || ty === 'hray') schema.push({ k: 'axis', label: 'Preis auf der Skala zeigen', t: 'bool' });
    if (isLine) schema.push({ k: 'label', label: 'Beschriftung', t: 'text' });
    if (ty === 'avwap') schema.push({ sec: 'Anchored VWAP' }, { k: 'src', label: 'Quelle', t: 'select', opts: [['hlc3', 'HLC3'], ['ohlc4', 'OHLC4'], ['close', 'Close']] }, { k: 'bands', label: 'Bänder', t: 'select', opts: [[0, 'aus'], [1, '±1σ'], [2, '±1σ ±2σ'], [3, '±1σ ±2σ ±3σ']] });
    if (ty === 'alert') schema.push({ sec: 'Alarm' }, { k: 'cond', label: 'Bedingung', t: 'select', opts: ALERT_CONDS.map(c => [c[0], c[1]]) }, { k: 'note', label: 'Notiz', t: 'text' });
    if (ty === 'ftpo') schema.push({ sec: 'TPO' }, { k: 'mode', label: 'Darstellung', t: 'select', opts: [['letters', 'Buchstaben'], ['blocks', 'Blöcke']] }, { k: 'block', label: 'Zeit pro Buchstabe', t: 'select', opts: [['5m', '5 Min.'], ['15m', '15 Min.'], ['30m', '30 Min.'], ['1h', '1 Std.']] }, { k: 'vaPct', label: 'Value Area %', t: 'select', opts: [[68, '68 %'], [70, '70 %'], [80, '80 %']] }, { k: 'clip', label: 'Nur im gezogenen Preisbereich zählen', t: 'bool' });
    if (ty === 'fvp') schema.push({ sec: 'Volume Profile' }, { k: 'mode', label: 'Anzeige', t: 'select', opts: [['volume', 'Volumen'], ['bidask', 'Kauf / Verkauf'], ['delta', 'Delta']] }, { k: 'rows', label: 'Zeilenhöhe (0 = automatisch)', t: 'num', min: 0, max: 1e6, step }, { k: 'wf', label: 'Breite des Profils', t: 'num', min: 0.1, max: 1, step: 0.05 });
    if (ty !== 'measure') {
      schema.push({ sec: 'Koordinaten' });
      if (isPos) schema.push({ k: 'p0', label: 'Entry', t: 'num', step, min: 0 }, { k: 'stop', label: 'Stop', t: 'num', step, min: 0 }, { k: 'target', label: 'Ziel', t: 'num', step, min: 0 });
      else if (ty !== 'vline') schema.push({ k: 'p0', label: one ? 'Preis' : 'Preis 1', t: 'num', step, min: 0 });
      if (!one && !isPos) schema.push({ k: 'p1', label: 'Preis 2', t: 'num', step, min: 0 });
    }
    schema.push({ sec: 'Sonstiges' }, { k: 'locked', label: 'Sperren (nicht verschiebbar)', t: 'bool' });
    const body = el(`<div class="setdlg"><div class="form" id="dsForm">${formHtml(schema, cur)}</div>
      <div class="dlg-foot">${keys.length ? `<div class="dd-wrap"><button class="tb" id="dsTpl">Vorlage ${ICON.chev}</button></div>` : ''}<button class="tb icon danger" id="dsDel" title="Löschen">${ICON.trash}</button><button class="tb icon" id="dsClone" title="Klonen">${ICON.copy}</button><div class="grow"></div><button class="tb primary" id="dsOk">Ok</button></div></div>`);
    const close = this.modal(NAME[ty] || 'Zeichnung', body);
    const has = (k) => schema.some(f => f.k === k || f.color === k);
    const apply = () => {
      for (const k of ['color', 'width', 'dash', 'ext', 'extL', 'axis', 'fs', 'locked', 'src', 'cond', 'mode', 'block', 'clip', 'rows', 'wf', 'bgOn', 'bg', 'bdOn', 'bd']) if (has(k)) it[k] = cur[k];
      if (has('bands')) it.bands = +cur.bands;
      if (has('vaPct')) it.vaPct = +cur.vaPct;
      if (has('label')) it.label = String(cur.label || '').trim();
      if (has('note')) it.note = String(cur.note || '').trim();
      if (has('text') && String(cur.text).trim()) it.text = String(cur.text).trim();
      if (has('p0') && cur.p0 > 0) { it.pts[0].p = cur.p0; if (one || isPos) it.pts[1].p = cur.p0; }
      if (has('p1') && cur.p1 > 0) it.pts[1].p = cur.p1;
      if (has('stop') && cur.stop > 0) it.stop = cur.stop;
      if (has('target') && cur.target > 0) it.target = cur.target;
      if (ty === 'alert') it.fired = null;
      delete it.fillA;
      d._changed();
      if (ty === 'ftpo') a.ensureNeeds();
    };
    const rerender = () => { $('#dsForm', body).innerHTML = formHtml(schema, cur); this.bindForm($('#dsForm', body), cur, (imm) => { if (imm) apply(); }); };
    this.bindForm($('#dsForm', body), cur, (imm) => { if (imm) apply(); });
    // Stil übernehmen (Vorlage / Standard / Werkseinstellung)
    const useStyle = (props) => { for (const k of keys) if (props[k] !== undefined) it[k] = deepClone(props[k]); if (keys.includes('bg') && props.bg === null) delete it.bg; delete it.fillA; d._changed(); cur = read(); rerender(); };
    const styleNow = () => { apply(); const o = {}; for (const k of keys) if (it[k] !== undefined) o[k] = deepClone(it[k]); return o; };
    $('#dsTpl', body)?.addEventListener('click', (e) => {
      e.stopPropagation();
      const list = (st.drawTpls?.[ty] || []);
      const def = st.drawDefaults?.[ty];
      const menu = el(`<div class="dd-menu up">
        <button data-v="def">Als Standard für neue „${esc(NAME[ty] || ty)}“ speichern</button>
        <button data-v="save">Als Vorlage speichern …</button>
        ${list.length ? '<div class="dd-sep"></div>' + list.map((t, i) => `<div class="dd-row"><button data-v="use" data-i="${i}">${esc(t.name)}</button><button class="dd-x" data-v="del" data-i="${i}" title="Vorlage löschen">✕</button></div>`).join('') : ''}
        <div class="dd-sep"></div>
        ${def ? '<button data-v="apply">Standard anwenden</button>' : ''}
        <button data-v="factory">Werkseinstellung${def ? ' (eigenen Standard löschen)' : ''}</button></div>`);
      const wrap = $('.dd-wrap', body);
      $('.dd-menu', wrap)?.remove();
      wrap.appendChild(menu);
      const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', off, true); } };
      setTimeout(() => document.addEventListener('pointerdown', off, true));
      menu.onclick = (ev) => {
        const b = ev.target.closest('[data-v]');
        if (!b) return;
        const v = b.dataset.v, i = +b.dataset.i;
        if (v === 'def') { (st.drawDefaults ||= {})[ty] = styleNow(); a._save(); this.toast(`Neue „${NAME[ty]}“ sehen jetzt immer so aus`, 'info', 2500); }
        if (v === 'save') { const n = prompt('Name der Vorlage', NAME[ty] || 'Vorlage'); if (n && n.trim()) { (st.drawTpls ||= {})[ty] = [...list.filter(t => t.name !== n.trim()), { name: n.trim(), props: styleNow() }]; a._save(); this.toast('Vorlage gespeichert: ' + n.trim(), 'info', 2000); } }
        if (v === 'use' && list[i]) useStyle(list[i].props);
        if (v === 'del' && list[i]) { st.drawTpls[ty] = list.filter((_, j) => j !== i); a._save(); }
        if (v === 'apply' && def) useStyle(def);
        if (v === 'factory') { if (st.drawDefaults) delete st.drawDefaults[ty]; a._save(); useStyle(FACTORY); }
        menu.remove();
      };
    });
    $('#dsDel', body).onclick = () => { close(); d.remove(it); };
    $('#dsClone', body).onclick = () => { close(); d.clone(it); };
    $('#dsOk', body).onclick = () => { apply(); close(); };
  }

  /** Liste aller Alarme (aktueller Coin). */
  openAlerts() {
    const a = this.app, al = a.alerts;
    const list = al.list().sort((x, y) => y.pts[0].p - x.pts[0].p);
    const perm = al.permission;
    const body = el(`<div class="setdlg"><div class="alert-list">${list.length ? list.map(it => `<div class="al-row ${it.fired ? 'fired' : ''}" data-id="${it.id}"><b>${esc(a.fmt(it.pts[0].p))}</b><span>${esc((ALERT_CONDS.find(c => c[0] === (it.cond || 'cross')) || ALERT_CONDS[0])[1])}${it.note ? ' · ' + esc(it.note) : ''}</span><span class="muted">${it.fired ? 'ausgelöst ' + esc(fmtDateTime(it.fired, a.tz)) : 'aktiv'}</span>${it.fired ? '<button class="tb" data-arm>aktivieren</button>' : ''}<button class="tb icon" data-del title="Löschen">${ICON.trash}</button></div>`).join('') : '<div class="muted pad">Noch keine Alarme. Werkzeug „Alarm“ (Glocke) wählen und auf den Preis tippen.</div>'}</div>
      <div class="info-box">Alarme werden geprüft, solange die Seite offen ist (Handy: im Vordergrund). Ton und Vibration bei Auslösung${perm === 'granted' ? ', System-Benachrichtigung ist erlaubt.' : perm === 'denied' ? '. System-Benachrichtigungen sind im Browser blockiert.' : '.'}</div>
      <div class="dlg-foot">${perm === 'default' ? '<button class="tb" id="alPerm">Benachrichtigungen erlauben</button>' : ''}<button class="tb" id="alNew">${ICON.alert}<span>Alarm beim aktuellen Kurs</span></button><div class="grow"></div><button class="tb primary" id="alOk">Fertig</button></div></div>`);
    const close = this.modal('Alarme · ' + a.market.ticker(a.state.base), body);
    $$('.al-row', body).forEach(row => {
      const it = list.find(x => x.id === row.dataset.id);
      $('[data-del]', row).onclick = () => { a.drawings.remove(it); close(); this.openAlerts(); };
      $('[data-arm]', row)?.addEventListener('click', () => { it.fired = null; a.drawings._changed(); close(); this.openAlerts(); });
    });
    $('#alPerm', body)?.addEventListener('click', () => { al.askPermission(); setTimeout(() => { close(); this.openAlerts(); }, 1500); });
    $('#alNew', body).onclick = () => {
      const last = a.bars[a.bars.length - 1];
      if (!last) return;
      const v = prompt('Alarm bei Preis', String(Math.round(last.c * 100) / 100).replace('.', ','));
      if (v == null) return;
      const p = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
      if (!(p > 0)) { this.toast('Ungültiger Preis', 'error'); return; }
      const it = a.drawings._create('alert', { t: last.t, p });
      it.cond = p > last.c ? 'up' : 'down';
      a.drawings._finish(it);
      close(); this.openAlerts();
    };
    $('#alOk', body).onclick = close;
  }

  /** TPO-Chart: Leiste für das ausgewählte Profil (zusammenfügen / teilen wie MMT). */
  renderTpoBar() {
    const a = this.app;
    let bar = $('#tpoBar');
    if (!bar) { bar = el('<div id="tpoBar" class="tpo-bar"></div>'); $('#chartwrap').appendChild(bar); }
    const s = a.isTpo && a.tpoSel != null ? (a.tpoSessions || []).find(x => x.start === a.tpoSel) : null;
    if (!s) { bar.classList.remove('on'); bar.innerHTML = ''; return; }
    const ed = a.tpoEdits();
    const merged = ed.merges.some(m => m[0] === s.start);
    bar.innerHTML = `<span class="sb-t">${esc(a.tpoLabel(s))}</span>
      <button class="tb" data-m="-1" title="Mit dem Profil links zusammenfügen">${ICON.merge}<span>◀ zusammen</span></button>
      <button class="tb" data-m="1" title="Mit dem Profil rechts zusammenfügen">${ICON.merge}<span>zusammen ▶</span></button>
      <button class="tb" data-split title="An der angetippten Stelle teilen">${ICON.split}<span>hier teilen</span></button>
      ${merged ? '<button class="tb" data-unmerge>trennen</button>' : ''}
      ${ed.merges.length || ed.splits.length ? '<button class="tb" data-reset title="Alle Änderungen an den Profilen zurücksetzen">alle zurück</button>' : ''}
      <button class="tb icon" data-x title="Schließen">${ICON.close}</button>`;
    $$('[data-m]', bar).forEach(b => b.onclick = () => a.mergeTpo(+b.dataset.m));
    $('[data-split]', bar).onclick = () => a.splitTpo();
    $('[data-unmerge]', bar)?.addEventListener('click', () => a.unmergeTpo());
    $('[data-reset]', bar)?.addEventListener('click', () => a.resetTpoEdits());
    $('[data-x]', bar).onclick = () => { a.tpoSel = null; this.renderTpoBar(); a.recompute(true); };
    bar.classList.add('on');
  }

  // ================================================================ Legende
  renderLegend() {
    const a = this.app, st = a.state, m = a.market;
    const main = st.indicators.filter(x => TYPES[x.type].pane !== 'own');
    const name = `${COIN_NAME[st.base] || st.base} / ${m.quote === 'USD' ? 'US-Dollar' : 'TetherUS'}${m.type === 'Perp' ? ' Perp' : ''}`;
    $('#legend').innerHTML = `
      <div class="lg-row lg-main">
        <span class="lg-sym" title="${esc(m.label)}">${esc(name)} · ${TF_LEGEND[st.tf]} · ${m.badge}</span>
        <span class="lg-ohlc" id="lgOhlc"></span>
      </div>
      <div class="lg-inds ${st.legendOpen ? '' : 'closed'}">
        ${a.isTpo ? `<div class="lg-row lg-ind" data-tpo="1"><span class="lg-title">TPO ${st.tpo.block} · Zeile ${a.fmt(a.tpoRowSize())} · VA ${st.tpo.vaPct} %</span><span class="lg-vals" id="tpoVals"></span><span class="lg-acts"><button data-act="tposet" title="TPO-Einstellungen">${ICON.gear}</button></span></div>` : ''}
        ${main.map(x => this.legendRow(x)).join('')}
      </div>
      ${main.length ? `<button class="lg-toggle" data-act="lgtoggle" title="Indikatoren ein-/ausklappen">${st.legendOpen ? ICON.chevUp : ICON.chev}<span>${main.length}</span></button>` : ''}`;
    this.renderPaneLegends();
    this.updateLegend();
  }
  legendRow(x) {
    const T = TYPES[x.type];
    return `<div class="lg-row lg-ind ${x.visible ? '' : 'off'}" data-uid="${x.uid}">
      <span class="lg-title">${esc(T.title(x.s, this.app.titleCtx()))}</span>
      <span class="lg-vals" data-vals></span>
      <span class="lg-acts">
        <button data-act="eye" title="${x.visible ? 'Ausblenden' : 'Einblenden'}">${x.visible ? ICON.eye : ICON.eyeOff}</button>
        <button data-act="set" title="Einstellungen">${ICON.gear}</button>
        <button data-act="del" title="Entfernen">${ICON.close}</button>
      </span></div>`;
  }
  onLegendClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) {
      // Handy: Tippen auf eine Zeile zeigt Augen-/Einstellungs-Knopf (wie TradingView-App)
      const row = e.target.closest('.lg-ind, .plg');
      if (row && this.mobile) { const was = row.classList.contains('open'); $$('.lg-ind.open, .plg.open').forEach(r => r.classList.remove('open')); row.classList.toggle('open', !was); }
      return;
    }
    const a = this.app;
    if (b.dataset.act === 'lgtoggle') { a.state.legendOpen = !a.state.legendOpen; a._save(); this.renderLegend(); return; }
    if (b.dataset.act === 'tposet') { this.openTpoSettings(); return; }
    const uid = b.closest('[data-uid]')?.dataset.uid;
    if (!uid) return;
    if (b.dataset.act === 'eye') a.toggleIndicator(uid);
    if (b.dataset.act === 'set') this.openIndicatorSettings(uid);
    if (b.dataset.act === 'del') a.removeIndicator(uid);
  }
  updateLegend() {
    const a = this.app;
    const bars = a.bars;
    if (!bars.length) { $('#lgOhlc') && ($('#lgOhlc').innerHTML = ''); return; }
    const i = a.crossIdx ?? bars.length - 1;
    $('#legend')?.classList.toggle('xhair', a.crossIdx != null);
    const b = bars[i], p = bars[i - 1];
    const ch = p ? b.c - p.c : b.c - b.o, chp = p ? ch / p.c * 100 : 0;
    const cls = b.c >= b.o ? 'up' : 'dn';
    const o = $('#lgOhlc');
    if (o) o.innerHTML = `<span>O<b class="${cls}">${a.fmt(b.o)}</b></span><span>H<b class="${cls}">${a.fmt(b.h)}</b></span><span>L<b class="${cls}">${a.fmt(b.l)}</b></span><span>C<b class="${cls}">${a.fmt(b.c)}</b></span><b class="${ch >= 0 ? 'up' : 'dn'} chg">${ch >= 0 ? '+' : '−'}${a.fmt(Math.abs(ch))} (${fmtPct(chp)})</b>`;
    const tv = $('#tpoVals');
    if (tv && a.tpoSessions?.length) {
      const s = a.tpoSessions.find(x => i >= x.first && i < x.first + x.n) || a.tpoSessions[a.tpoSessions.length - 1];
      tv.innerHTML = s && s.poc != null ? `<span class="muted">POC</span><b style="color:#e91e63">${a.fmt(s.poc)}</b><span class="muted">VA</span><b style="color:#7c3aed">${a.fmt(s.val)} – ${a.fmt(s.vah)}</b><span class="muted">IB</span><b style="color:#2962ff">${a.fmt(s.ibLo)} – ${a.fmt(s.ibHi)}</b>` : '';
    }
    for (const row of $$('#legend .lg-ind[data-uid]')) {
      const ind = a.state.indicators.find(x => x.uid === row.dataset.uid);
      const T = ind && TYPES[ind.type];
      const d = ind && a.data.get(ind.uid);
      const box = row.querySelector('[data-vals]');
      if (!T || !d || !T.values || !ind.visible) { box.innerHTML = d?.note ? `<i>${esc(d.note)}</i>` : ''; continue; }
      const vals = T.values(ind.s, d, i).filter(v => Number.isFinite(v.v));
      box.innerHTML = vals.map(v => `<b style="color:${v.color}">${a.fmt(v.v)}</b>`).join('');
    }
    this.updatePaneValues(i);
  }

  // Panels unter dem Chart: Legenden an den Panel-Rand setzen
  renderPaneLegends() {
    const a = this.app;
    const box = $('#paneLegends');
    const list = a.state.indicators.filter(x => TYPES[x.type].pane === 'own');
    box.innerHTML = list.map(x => `<div class="plg ${x.visible ? '' : 'off'}" data-uid="${x.uid}">
      <span class="lg-title">${esc(TYPES[x.type].title(x.s, this.app.titleCtx()))}</span><span class="lg-vals" data-vals></span>
      <span class="lg-acts"><button data-act="eye">${x.visible ? ICON.eye : ICON.eyeOff}</button><button data-act="set">${ICON.gear}</button><button data-act="del">${ICON.close}</button></span></div>`).join('');
    this.placePaneLegends();
  }
  placePaneLegends() {
    const a = this.app;
    if (!a.chart) return;
    const wrapR = $('#chartwrap').getBoundingClientRect();
    for (const node of $$('#paneLegends .plg')) {
      const p = a.panes.get(node.dataset.uid);
      const first = p && Object.values(p.series)[0];
      const pane = first?.getPane?.();
      const pe = pane?.getHTMLElement?.();
      if (!pe) { node.style.display = 'none'; continue; }
      const r = pe.getBoundingClientRect();
      node.style.display = '';
      node.style.top = (r.top - wrapR.top + 4) + 'px';
      node.style.left = (r.left - wrapR.left + 8) + 'px';
    }
    this.placeZTable();
  }
  placeZTable() {
    const z = $('#ztable');
    if (!z || !this.app.chart) return;
    try {
      const w = this.app.chart.priceScale('right').width() + 10;
      if (this._zR !== w) { this._zR = w; z.style.right = w + 'px'; }
      // Handy: unten rechts im Hauptchart (über den Panels), sonst oben rechts
      const top = this.mobile ? Math.max(8, this.app.chart.panes()[0].getHeight() - z.offsetHeight - 10) + 'px' : '8px';
      if (z.style.top !== top) z.style.top = top;
    } catch { /* egal */ }
  }
  checkPaneLayout() {
    const a = this.app;
    if (!a.chart) return;
    const sig = a.chart.panes().map(p => p.getHeight()).join(',');
    if (sig !== this._paneSig) { this._paneSig = sig; this.placePaneLegends(); }
  }
  updatePaneValues(i) {
    const a = this.app;
    for (const node of $$('#paneLegends .plg')) {
      const ind = a.state.indicators.find(x => x.uid === node.dataset.uid);
      const d = ind && a.data.get(ind.uid);
      const box = node.querySelector('[data-vals]');
      if (!d) { box.innerHTML = ''; continue; }
      if (d.note) { box.innerHTML = `<i>${esc(d.note)}</i>`; continue; }
      const T = TYPES[ind.type];
      box.innerHTML = T.plots.map(pl => {
        const v = d.plots?.[pl.key];
        if (!v) return '';
        let x = v.values[i];
        if (!Number.isFinite(x)) { for (let k = i; k >= Math.max(0, i - 3); k--) if (Number.isFinite(v.values[k])) { x = v.values[k]; break; } }
        if (!Number.isFinite(x)) return '';
        const col = v.colors ? v.colors[i] : v.color;
        return `<b style="color:${col || 'inherit'}">${a.paneFmt(ind.type, x)}</b>`;
      }).join('');
    }
  }

  // ================================================================ Z-Tabelle (RVWAP)
  updateZTable() {
    const a = this.app;
    const z = $('#ztable');
    const ind = a.state.indicators.find(x => x.type === 'rvwap' && x.visible && x.s.table);
    const d = ind && a.data.get(ind.uid);
    if (!d || !d.wins?.length) { z.classList.remove('on'); return; }
    z.classList.add('on');
    z.innerHTML = `<table><tbody>${d.wins.slice().sort((p, q) => q.days - p.days).map(w => {
      const v = w.z;
      const cls = !Number.isFinite(v) ? '' : v >= 2 ? 'zp2' : v > 0 ? 'zp' : v <= -2 ? 'zn2' : 'zn';
      return `<tr><td>${w.label}</td><td class="${cls}">${Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + nf(1).format(Math.abs(v)) : '–'}</td></tr>`;
    }).join('')}</tbody></table>`;
    z.title = 'Z-Score: Abstand des Kurses zum Rolling VWAP in Standardabweichungen';
    this.placeZTable();
  }

  // ================================================================ Kopf (Preis), Titel
  updateHeader() {
    const a = this.app, st = a.state, m = a.market;
    const last = a.bars[a.bars.length - 1];
    let chg = NaN, chgAbs = NaN;
    const d = a.hub.stores.get(`${st.market}|${st.base}|1D`);
    if (last && d && d.bars.length) {
      const today = periodStart(Date.now(), 'day');
      const bar = d.bars[d.bars.length - 1];
      const open = bar.t === today ? bar.o : bar.c;
      chgAbs = last.c - open; chg = chgAbs / open * 100;
    }
    const px = last ? a.fmt(last.c) : '–';
    document.title = last ? `${m.ticker(st.base)} ${px} · TQI Charts` : 'TQI Charts';
    const mh = $('#mhead');
    const key = `${st.market}|${st.base}`;
    if (mh && mh.dataset.key === key && $('.mh-px', mh)) {
      $('.mh-px b', mh).textContent = px;
      const sp = $('.mh-px span', mh);
      sp.className = chg >= 0 ? 'up' : 'dn';
      sp.textContent = Number.isFinite(chg) ? `${chgAbs >= 0 ? '+' : '−'}${a.fmt(Math.abs(chgAbs))} (${fmtPct(chg)})` : '';
    } else if (mh) {
      mh.dataset.key = key;
      const nm = `${COIN_NAME[st.base] || st.base} / ${m.quote === 'USD' ? 'Dollar' : 'TetherUS'}${m.type === 'Perp' ? ' Perp' : ''}`;
      mh.innerHTML = `<div class="mh-title">
          <button class="mh-sym" id="mhSym">${coinBadge(st.base, 24)}<b>${esc(nm)}</b><span class="status" id="mstatus"><i></i><span></span></span></button>
          <div class="mh-px"><b>${px}</b><span class="${chg >= 0 ? 'up' : 'dn'}">${Number.isFinite(chg) ? `${chgAbs >= 0 ? '+' : '−'}${a.fmt(Math.abs(chgAbs))} (${fmtPct(chg)})` : ''}</span></div>
        </div>
        <button class="mh-full" id="mhFull" title="Vollbild-Chart">${this.full ? ICON.fullExit : ICON.full}</button>`;
      $('#mhSym').onclick = () => this.openSymbolDialog();
      $('#mhFull').onclick = () => this.toggleFullscreen();
      this.setStatus(a.hub.status);
    }
    const wr = $(`.wl-row[data-base="${st.base}"] .wl-px`);
    if (wr && last) wr.textContent = px;
  }

  // ================================================================ Unten
  renderBottom() {
    const a = this.app, st = a.state;
    const ranges = [['1D', '1T'], ['5D', '5T'], ['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['1Y', '1J'], ['ALL', 'Alles']];
    $('#bottombar').innerHTML = `
      <div class="ranges">${ranges.map(([k, l]) => `<button class="tb sm" data-range="${k}">${l}</button>`).join('')}</div>
      <div class="grow"></div>
      <button class="tb sm clock" id="clock" title="Zeitzone wechseln"></button>
      <span class="sep"></span>
      <button class="tb sm ${st.pct ? 'on' : ''}" data-scale="pct" title="Prozent-Skala">%</button>
      <button class="tb sm ${st.log ? 'on' : ''}" data-scale="log" title="Log-Skala">log</button>
      <button class="tb sm" data-scale="auto" title="Automatisch skalieren">auto</button>`;
    $$('[data-range]').forEach(b => b.onclick = () => a.setRange(b.dataset.range));
    $('#clock').onclick = () => { a.setState({ tz: st.tz === 'utc' ? 'local' : 'utc' }, { render: false }); a.refreshTimeFormat(); this.tickClock(); };
    $$('[data-scale]').forEach(b => b.onclick = () => {
      const k = b.dataset.scale;
      if (k === 'auto') { a.chart.priceScale('right').setAutoScale(true); a.chart.timeScale().scrollToRealTime(); return; }
      if (k === 'pct') a.setState({ pct: !st.pct, log: false }, { render: false });
      if (k === 'log') a.setState({ log: !st.log, pct: false }, { render: false });
      a.applyScaleMode(); this.renderBottom();
    });
    this.tickClock();
  }
  tickClock() {
    const c = $('#clock');
    if (!c) return;
    const tz = this.app.tz;
    c.textContent = `${fmtTime(Date.now(), tz, true)} (${tz === 'UTC' ? 'UTC' : tzOffsetLabel(tz)})`;
  }

  // ================================================================ Rechts: Watchlist / Trades / Orderbuch
  renderRight() {
    const a = this.app, st = a.state;
    const tabs = [['watch', 'Watchlist', ICON.list], ['tape', 'Trades', ICON.tape], ['dom', 'Orderbuch', ICON.dom], ['trader', 'TQI Trader', ICON.trade]];
    $('#widgets').innerHTML = tabs.map(([k, l, ic]) => `<button class="wbtn2 ${st.rightOpen && st.rightPanel === k ? 'on' : ''}" data-panel="${k}" title="${l}">${ic}</button>`).join('');
    $$('#widgets [data-panel]').forEach(b => b.onclick = () => {
      const k = b.dataset.panel;
      if (st.rightOpen && st.rightPanel === k) a.setState({ rightOpen: false }, { render: false });
      else a.setState({ rightOpen: true, rightPanel: k }, { render: false });
      this.renderRight();
      document.body.classList.toggle('right-closed', !a.state.rightOpen);
      if (k === 'trader' && a.state.rightOpen) a.trader.start();
      a.trader.redraw();
    });
    const p = st.rightPanel;
    const head = $('#rhead'), body = $('#rbody');
    $('#traderBtn')?.classList.toggle('on', !!a.trader?.open);
    if (p === 'watch') {
      head.innerHTML = `<b>Watchlist</b><span class="muted">${a.market.label}</span><div class="grow"></div><button class="tb icon" id="wlAdd" title="Symbol hinzufügen">${ICON.plus}</button>`;
      body.innerHTML = `<div class="wl-head"><span>Symbol</span><span>Letzter</span><span>Änd. %</span></div>` + st.watchlist.map(b => `
        <div class="wl-row ${b === st.base ? 'on' : ''}" data-base="${b}">
          <span class="wl-sym">${coinBadge(b, 18)}<b>${esc(a.market.ticker(b))}</b></span>
          <span class="wl-px">${this.wl.get(b)?.last != null ? a.fmt(this.wl.get(b).last, undefined) : '…'}</span>
          <span class="wl-ch ${(this.wl.get(b)?.chg ?? 0) >= 0 ? 'up' : 'dn'}">${this.wl.get(b) ? fmtPct(this.wl.get(b).chg) : ''}</span>
          <button class="wl-x" data-rm="${b}" title="Entfernen">${ICON.close}</button>
        </div>`).join('');
      $('#wlAdd').onclick = () => this.openSymbolDialog(true);
      $$('.wl-row', body).forEach(r => r.onclick = (e) => {
        if (e.target.closest('[data-rm]')) { a.setState({ watchlist: st.watchlist.filter(x => x !== r.dataset.base) }, { render: false }); this.renderRight(); return; }
        a.setSymbol(r.dataset.base);
      });
      this.loadWatchlist();
    } else if (p === 'tape') {
      head.innerHTML = `<b>Trades</b><span class="muted">${a.market.label}</span><div class="grow"></div><label class="mini">ab <input id="tapeMin" type="number" min="0" step="1000" value="${st.tapeMin || 0}"> $</label>`;
      body.innerHTML = `<div class="tp-head"><span>Zeit</span><span>Preis</span><span>Größe $</span></div><div id="tapeList" class="tape"></div>`;
      $('#tapeMin').onchange = (e) => { a.setState({ tapeMin: Math.max(0, +e.target.value || 0) }, { render: false }); this.renderTape(); };
      this.renderTape();
    } else if (p === 'trader') {
      a.trader.renderInto(head, body);
    } else if (p === 'dom') {
      head.innerHTML = `<b>Orderbuch</b><span class="muted">${a.market.label}</span><div class="grow"></div><label class="mini">Schritt <select id="domStep">${[0, 0.01, 0.1, 1, 5, 10, 25, 50, 100].map(v => `<option value="${v}" ${+st.domStep === v ? 'selected' : ''}>${v === 0 ? 'auto' : nf(v < 1 ? 2 : 0).format(v)}</option>`).join('')}</select></label>`;
      body.innerHTML = `<div id="domBox" class="dom"><div class="muted pad">${a.market.dom ? 'verbinde …' : 'Für diese Börse gibt es kein öffentliches Orderbuch.'}</div></div>`;
      $('#domStep').onchange = (e) => { a.setState({ domStep: +e.target.value }, { render: false }); this.renderDom(); };
    }
    this.reconnectDom();
  }

  async loadWatchlist() {
    const a = this.app, st = a.state;
    if (!(st.rightOpen && st.rightPanel === 'watch') && !this._mWatch) return;
    if (document.visibilityState !== 'visible') return;
    const m = a.market;
    if (!m.ad.fetchTicker) return;
    await Promise.allSettled(st.watchlist.map(async (b) => {
      try { const t = await m.ad.fetchTicker(m.inst(b)); this.wl.set(b, t); } catch { /* nicht auf dieser Börse */ }
    }));
    for (const r of $$('.wl-row')) {
      const t = this.wl.get(r.dataset.base);
      if (!t) { r.querySelector('.wl-px').textContent = '–'; continue; }
      const px = r.querySelector('.wl-px'), ch = r.querySelector('.wl-ch');
      const old = px.dataset.v ? +px.dataset.v : null;
      px.textContent = fmtPrice(t.last); px.dataset.v = t.last;
      if (old != null && old !== t.last) { px.classList.remove('flash-up', 'flash-dn'); void px.offsetWidth; px.classList.add(t.last > old ? 'flash-up' : 'flash-dn'); }
      ch.textContent = fmtPct(t.chg); ch.className = 'wl-ch ' + (t.chg >= 0 ? 'up' : 'dn');
    }
  }

  renderTape() {
    this.tapeDirty = false;
    const box = $('#tapeList') || $('#mTape');
    if (!box) return;
    const a = this.app;
    const min = a.state.tapeMin || 0;
    const big = a.bigUsd();
    const rows = [];
    for (let k = a.tape.length - 1; k >= 0 && rows.length < 120; k--) {
      const x = a.tape[k];
      if (x.usd < min) continue;
      if (x.liq) rows.push(`<div class="tp-row liq ${x.liq === 'long' ? 'dn' : 'up'}"><span>${fmtTime(x.t, a.tz, true)}</span><span>${a.fmt(x.p)}</span><span>⚡ ${x.liq === 'long' ? 'Long' : 'Short'} ${fmtCompact(x.usd, 1)}</span></div>`);
      else rows.push(`<div class="tp-row ${x.buy ? 'up' : 'dn'} ${x.usd >= big ? 'big' : x.usd >= big / 4 ? 'mid' : ''}"><span>${fmtTime(x.t, a.tz, true)}</span><span>${a.fmt(x.p)}</span><span>${fmtCompact(x.usd, 1)}</span></div>`);
    }
    box.innerHTML = rows.join('') || '<div class="muted pad">Warte auf Trades …</div>';
  }

  reconnectDom() {
    const a = this.app, st = a.state;
    const want = st.rightOpen && st.rightPanel === 'dom' && a.market.dom && (!this.mobile || this._mDom);
    const key = `${st.market}|${st.base}`;
    if (!want) { if (this.domSock) { this.domSock.stop(); this.domSock = null; this.domKey = null; } return; }
    if (this.domSock && this.domKey === key) return;
    if (this.domSock) this.domSock.stop();
    this.book = null;
    this.domKey = key;
    this.domSock = a.market.ad.depthSocket(a.market.inst(st.base), (b) => { this.book = b; this._domDirty = true; if (!this._domRaf) this._domRaf = requestAnimationFrame(() => { this._domRaf = 0; this.renderDom(); }); }, () => {});
  }
  renderDom() {
    const box = $('#domBox') || $('#mDom');
    if (!box || !this.book) return;
    const a = this.app;
    const { bids, asks } = this.book;
    if (!bids.length || !asks.length) return;
    const mid = (bids[0][0] + asks[0][0]) / 2;
    let step = +a.state.domStep || niceStep(mid * 0.0015 / 16);
    const group = (arr, side) => {
      const m = new Map();
      for (const [p, q] of arr) {
        const k = side === 'b' ? Math.floor(p / step) * step : Math.ceil(p / step) * step;
        m.set(k, (m.get(k) || 0) + q);
      }
      return [...m].sort((x, y) => side === 'b' ? y[0] - x[0] : x[0] - y[0]).slice(0, 16);
    };
    const gb = group(bids, 'b'), ga = group(asks, 'a');
    const max = Math.max(...gb.map(x => x[1]), ...ga.map(x => x[1]), 1e-9);
    const dec = Math.max(0, -Math.floor(Math.log10(step)));
    const row = (p, q, side) => `<div class="dm-row ${side}"><i style="width:${(q / max * 100).toFixed(1)}%"></i><span>${fmtPrice(p, Math.min(dec, a.priceDec))}</span><span>${fmtCompact(q * p, 1)}</span><span>${nf(q >= 100 ? 0 : 3).format(q)}</span></div>`;
    const spread = asks[0][0] - bids[0][0];
    box.innerHTML = `<div class="dm-head"><span>Preis</span><span>$</span><span>Menge</span></div>` +
      ga.slice().reverse().map(([p, q]) => row(p, q, 'ask')).join('') +
      `<div class="dm-mid"><b>${a.fmt(mid)}</b><span>Spread ${a.fmt(spread)}</span></div>` +
      gb.map(([p, q]) => row(p, q, 'bid')).join('');
  }

  // ================================================================ Handy
  renderMobile() {
    const a = this.app, st = a.state;
    $('#mbar').innerHTML = `
      <button class="mb-pill" id="mbSym">${coinBadge(st.base, 26)}<b>${esc(a.market.ticker(st.base).replace('.P', ''))}</b><span>${TF_SHORT[st.tf]}</span></button>
      <div class="mb-group">
        <button class="mb-btn mb-tpo ${a.tpoOverlayOn ? 'on' : ''}" id="mbTpo" title="TPO / Market Profile">TPO</button>
        <button class="mb-btn ${$('#tools').classList.contains('mopen') ? 'on' : ''}" id="mbDraw" title="Zeichnen">${ICON.pencil}</button>
        <button class="mb-btn" id="mbInd" title="Indikatoren">${ICON.fx}</button>
        <button class="mb-btn" id="mbMore" title="Mehr">${ICON.more}</button>
      </div>`;
    $('#mbSym').onclick = () => this.openMobileSymTf();
    $('#mbDraw').onclick = () => { $('#tools').classList.toggle('mopen'); this.renderMobile(); };
    $('#mbTpo').onclick = () => this.app.toggleTpo();
    $('#mbInd').onclick = () => this.openIndicatorDialog();
    $('#mbMore').onclick = () => this.openMoreSheet();
  }
  openMobileSymTf() {
    const a = this.app, st = a.state;
    const body = el(`<div class="sheet-list">
      <button class="row-btn" data-sym>${ICON.search}<span>Symbol suchen</span><b>${esc(a.market.ticker(st.base))}</b></button>
      <div class="sec-t">Zeiteinheit</div>
      <div class="tf-grid">${TIMEFRAMES.map(t => `<button class="chip ${t.id === st.tf ? 'on' : ''}" data-tf="${t.id}">${TF_SHORT[t.id]}</button>`).join('')}</div>
      <div class="sec-t">Charttyp</div>
      <div class="tf-grid">${CHART_TYPES.map(([k, l]) => `<button class="chip ${k === st.chartType ? 'on' : ''}" data-type="${k}">${ICON[k]}<span>${l}</span></button>`).join('')}</div>
    </div>`);
    const close = this.modal('Symbol & Zeiteinheit', body);
    $('[data-sym]', body).onclick = () => { close(); this.openSymbolDialog(); };
    $$('[data-tf]', body).forEach(b => b.onclick = () => { close(); a.setTf(b.dataset.tf); });
    $$('[data-type]', body).forEach(b => b.onclick = () => { close(); a.setChartType(b.dataset.type); });
  }
  openMoreSheet() {
    const a = this.app, st = a.state;
    const body = el(`<div class="sheet-list">
      <div class="seg" id="mSeg"><button data-k="watch" class="on">Watchlist</button><button data-k="tape">Trades</button><button data-k="dom">Orderbuch</button></div>
      <div id="mPanel" class="mpanel"></div>
      <div class="sec-t">Mehr</div>
      <button class="row-btn" data-k="tpl">${ICON.grid}<span>Vorlagen</span></button>
      <button class="row-btn" data-k="alerts">${ICON.alert}<span>Alarme</span><b>${a.alerts.list().filter(x => !x.fired).length || ''}</b></button>
      <button class="row-btn" data-k="trader">${ICON.trade}<span>TQI Trader</span></button>
      <button class="row-btn" data-k="chartset">${ICON.candles}<span>Chart-Einstellungen (Farben, Kerzen)</span></button>
      ${this.isStandalone ? '' : `<button class="row-btn" data-k="install">${ICON.install}<span>Als App installieren</span></button>`}
      <button class="row-btn" data-k="theme">${st.theme === 'dark' ? ICON.sun : ICON.moon}<span>${st.theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}</span></button>
      <button class="row-btn" data-k="shot">${ICON.camera}<span>Screenshot speichern</span></button>
      <button class="row-btn" data-k="set">${ICON.gear}<span>Einstellungen</span></button>
    </div>`);
    const close = this.modal('Mehr', body, { onClose: () => { this._mWatch = false; this._mDom = false; this.reconnectDom(); } });
    const show = (k) => {
      $$('#mSeg button', body).forEach(b => b.classList.toggle('on', b.dataset.k === k));
      const p = $('#mPanel', body);
      this._mWatch = k === 'watch'; this._mDom = k === 'dom';
      if (k === 'watch') {
        p.innerHTML = st.watchlist.map(b => `<div class="wl-row ${b === st.base ? 'on' : ''}" data-base="${b}"><span class="wl-sym">${coinBadge(b, 20)}<b>${esc(a.market.ticker(b))}</b></span><span class="wl-px">${this.wl.get(b) ? fmtPrice(this.wl.get(b).last) : '…'}</span><span class="wl-ch ${(this.wl.get(b)?.chg ?? 0) >= 0 ? 'up' : 'dn'}">${this.wl.get(b) ? fmtPct(this.wl.get(b).chg) : ''}</span></div>`).join('');
        $$('.wl-row', p).forEach(r => r.onclick = () => { close(); a.setSymbol(r.dataset.base); });
        this.loadWatchlist();
      } else if (k === 'tape') {
        p.innerHTML = `<div class="tp-head"><span>Zeit</span><span>Preis</span><span>Größe $</span></div><div id="mTape" class="tape"></div>`;
        this.renderTape();
      } else {
        p.innerHTML = `<div id="mDom" class="dom"><div class="muted pad">${a.market.dom ? 'verbinde …' : 'Für diese Börse gibt es kein öffentliches Orderbuch.'}</div></div>`;
        const prev = { open: st.rightOpen, panel: st.rightPanel };
        st.rightOpen = true; st.rightPanel = 'dom';
        this.reconnectDom();
        st.rightOpen = prev.open; st.rightPanel = prev.panel;
        this.renderDom();
      }
    };
    $$('#mSeg button', body).forEach(b => b.onclick = () => show(b.dataset.k));
    show('watch');
    $$('[data-k].row-btn', body).forEach(b => b.onclick = () => {
      const k = b.dataset.k;
      close();
      if (k === 'tpl') this.openTemplateSheet();
      if (k === 'alerts') this.openAlerts();
      if (k === 'trader') a.trader?.toggle(true);
      if (k === 'chartset') this.openChartSettings();
      if (k === 'install') this.installApp();
      if (k === 'theme') a.setTheme(st.theme === 'dark' ? 'light' : 'dark');
      if (k === 'shot') a.screenshot();
      if (k === 'set') this.openSettings();
    });
  }

  // ================================================================ Popover
  pop(anchor, content) {
    this.closePop();
    if (this.mobile) return this.modal('', content);
    const r = anchor.getBoundingClientRect();
    const p = el('<div class="pop"></div>');
    p.appendChild(content);
    $('#pop').appendChild(p);
    p.style.top = (r.bottom + 4) + 'px';
    p.style.left = Math.min(r.left, window.innerWidth - p.offsetWidth - 8) + 'px';
    return () => this.closePop();
  }
  closePop() { $('#pop').innerHTML = ''; }
  openTfPop(anchor) {
    const a = this.app, st = a.state;
    const box = el(`<div class="menu">${TIMEFRAMES.map(t => `<div class="mi ${t.id === st.tf ? 'on' : ''}" data-tf="${t.id}"><span>${t.label}</span><button class="star ${st.favTfs.includes(t.id) ? 'on' : ''}" data-fav="${t.id}" title="Favorit">${st.favTfs.includes(t.id) ? ICON.starFill : ICON.star}</button></div>`).join('')}</div>`);
    box.onclick = (e) => {
      const f = e.target.closest('[data-fav]');
      if (f) {
        e.stopPropagation();
        const id = f.dataset.fav;
        const fav = st.favTfs.includes(id) ? st.favTfs.filter(x => x !== id) : [...st.favTfs, id].sort((x, y) => TIMEFRAMES.findIndex(t => t.id === x) - TIMEFRAMES.findIndex(t => t.id === y));
        a.setState({ favTfs: fav }, { render: false }); this.renderTopbar(); this.openTfPop(anchor); return;
      }
      const it = e.target.closest('[data-tf]');
      if (it) { this.closePop(); a.setTf(it.dataset.tf); }
    };
    this.pop(anchor, box);
  }
  openTypePop(anchor) {
    const a = this.app;
    const box = el(`<div class="menu">${CHART_TYPES.map(([k, l]) => `<div class="mi ${k === a.state.chartType ? 'on' : ''}" data-type="${k}">${ICON[k]}<span>${l}</span></div>`).join('')}</div>`);
    box.onclick = (e) => { const it = e.target.closest('[data-type]'); if (it) { this.closePop(); a.setChartType(it.dataset.type); } };
    this.pop(anchor, box);
  }
  openTemplatePop(anchor) {
    const box = this.templateList(() => this.closePop());
    this.pop(anchor, box);
  }
  openTemplateSheet() { let close; const box = this.templateList(() => close?.()); close = this.modal('Vorlagen', box); }
  templateList(done) {
    const a = this.app, st = a.state;
    const user = st.userTpls || [];
    const cur = st.template;
    const isUser = user.some(t => t.id === cur);
    const box = el(`<div class="menu wide">
      ${Object.entries(TEMPLATES).map(([k, t]) => `<div class="mi tpl ${cur === k ? 'on' : ''}" data-tpl="${k}"><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></div>`).join('')}
      ${user.length ? '<div class="msep">Meine Vorlagen</div>' + user.map(t => `<div class="mi tpl ${cur === t.id ? 'on' : ''}" data-tpl="${t.id}"><b>${esc(t.name)}</b><small>${t.list.length} Indikatoren${t.chart === 'tpo' ? ' · TPO-Chart' : ''}</small><button class="tb icon del" data-deltpl="${t.id}" title="Vorlage löschen">${ICON.trash}</button></div>`).join('') : ''}
      <div class="msep">Einstellungen bleiben beim Wechseln erhalten</div>
      <div class="mi act" data-act="save">${ICON.plus}<span>Aktuellen Chart als neue Vorlage speichern …</span></div>
      <div class="mi act" data-act="copy">${ICON.copy}<span>Diese Indikatoren in eine andere Vorlage kopieren …</span></div>
      <div class="mi act" data-act="share">${ICON.share}<span>Vorlage teilen / aufs Handy übertragen …</span></div>
      <div class="mi act" data-act="import">${ICON.download}<span>Vorlage importieren (Code einfügen) …</span></div>
      ${isUser ? `<div class="mi act" data-act="over">${ICON.copy}<span>„${esc(a.templateName())}“ mit aktuellem Stand überschreiben</span></div>` : ''}
      ${cur ? `<div class="mi act" data-act="reset">${ICON.reset}<span>„${esc(a.templateName())}“ auf ${isUser ? 'gespeicherten Stand' : 'Werkseinstellung'} zurücksetzen</span></div>` : ''}
    </div>`);
    box.onclick = (e) => {
      const del = e.target.closest('[data-deltpl]');
      if (del) { e.stopPropagation(); if (confirm('Vorlage löschen?')) { a.deleteUserTemplate(del.dataset.deltpl); done(); this.toast('Vorlage gelöscht', 'info', 1800); } return; }
      const act = e.target.closest('[data-act]');
      if (act) {
        done();
        if (act.dataset.act === 'save') { const n = prompt('Name der Vorlage', 'Meine Vorlage'); if (n != null) { a.saveUserTemplate(n.trim() || 'Meine Vorlage'); this.toast('Vorlage gespeichert: ' + (n.trim() || 'Meine Vorlage'), 'info', 2200); } }
        if (act.dataset.act === 'over') { a.saveUserTemplate(null, cur); this.toast('Vorlage aktualisiert', 'info', 1800); }
        if (act.dataset.act === 'copy') this.openCopyTemplate();
        if (act.dataset.act === 'share') this.openShareTemplate();
        if (act.dataset.act === 'import') {
          const code = prompt('Vorlagen-Code oder Link einfügen');
          if (code) { try { this.openImport(a.parseTemplate(code)); } catch (err) { this.toast(err.message, 'error'); } }
        }
        if (act.dataset.act === 'reset') { if (confirm('Vorlage zurücksetzen? Deine Änderungen in dieser Vorlage gehen verloren.')) { a.resetTemplate(); this.toast('Vorlage zurückgesetzt', 'info', 1800); } }
        return;
      }
      const it = e.target.closest('[data-tpl]');
      if (it) { done(); a.applyTemplate(it.dataset.tpl); this.toast('Vorlage: ' + a.templateName(it.dataset.tpl), 'info', 2000); }
    };
    return box;
  }

  /** Chart-Einstellungen wie in ATAS: Kerzenfarben (Körper, Rand, Docht), Hintergrund, Gitter, Fadenkreuz, Schrift, Preislinie. */
  openChartSettings() {
    const a = this.app, st = a.state;
    const cur = { ...st.chartCol, countdown: st.countdown !== false, symLabel: st.symLabel !== false };
    const schema = [
      { sec: 'Kerzen' },
      { k: 'up', label: 'Körper steigend', t: 'color', auto: true },
      { k: 'down', label: 'Körper fallend', t: 'color', auto: true },
      { k: 'borderVis', label: 'Kerzenrand zeichnen', t: 'bool' },
      { k: 'borderUp', label: 'Rand steigend', t: 'color', auto: true },
      { k: 'borderDown', label: 'Rand fallend', t: 'color', auto: true },
      { k: 'wickUp', label: 'Docht steigend', t: 'color', auto: true },
      { k: 'wickDown', label: 'Docht fallend', t: 'color', auto: true },
      { sec: 'Hintergrund und Gitter' },
      { k: 'bg', label: 'Hintergrund', t: 'color', auto: true },
      { k: 'gridV', label: 'Senkrechte Gitterlinien', t: 'bool' },
      { k: 'gridH', label: 'Waagerechte Gitterlinien', t: 'bool' },
      { k: 'grid', label: 'Farbe Gitter', t: 'color', auto: true },
      { k: 'border', label: 'Farbe Skalenrand', t: 'color', auto: true },
      { sec: 'Fadenkreuz, Schrift, Preis' },
      { k: 'crosshair', label: 'Farbe Fadenkreuz', t: 'color', auto: true },
      { k: 'crossStyle', label: 'Fadenkreuz-Linie', t: 'select', opts: [['large', 'lang gestrichelt'], ['dashed', 'gestrichelt'], ['dotted', 'gepunktet'], ['solid', 'durchgezogen']] },
      { k: 'text', label: 'Schriftfarbe (Skalen)', t: 'color', auto: true },
      { k: 'priceLine', label: 'Linie am letzten Preis', t: 'bool' },
      { k: 'countdown', label: 'Countdown bis Kerzenschluss', t: 'bool' },
      { k: 'symLabel', label: 'Symbolname am Preis', t: 'bool' },
    ];
    const PRESETS = {
      tv: { up: '#26a69a', down: '#ef5350', borderUp: '#26a69a', borderDown: '#ef5350', wickUp: '#26a69a', wickDown: '#ef5350' },
      sw: { up: '#ffffff', down: '#131722', borderUp: '#131722', borderDown: '#131722', wickUp: '#131722', wickDown: '#131722' },
      atas: { up: '#00c78c', down: '#ff4d4d', borderUp: '#00c78c', borderDown: '#ff4d4d', wickUp: '#9aa0a6', wickDown: '#9aa0a6' },
      hollow: { up: '#00000000', down: '#131722', borderUp: '#131722', borderDown: '#131722', wickUp: '#131722', wickDown: '#131722' },
    };
    const body = el(`<div class="setdlg"><div class="tv-presets"><span>Vorlagen:</span><button class="tb" data-pre="tv">Grün / Rot</button><button class="tb" data-pre="atas">ATAS</button><button class="tb" data-pre="sw">Schwarz / Weiß</button><button class="tb" data-pre="hollow">Hohl</button></div>
      <div class="form" id="csForm">${formHtml(schema, cur)}</div>
      <div class="dlg-foot"><button class="tb" id="csReset">Alles automatisch (Design)</button><div class="grow"></div><button class="tb primary" id="csOk">Fertig</button></div></div>`);
    const close = this.modal('Chart-Einstellungen', body);
    const apply = () => {
      // „auto“ abgewählt: mit der Farbe weitermachen, die gerade zu sehen ist
      const th = a.theme;
      for (const f of schema) if (f.t === 'color' && cur[f.k] === '#888888') {
        const v = ['up', 'down', 'borderUp', 'borderDown', 'wickUp', 'wickDown'].includes(f.k) ? th.candles[f.k] : th[f.k];
        if (typeof v === 'string' && v.startsWith('#')) cur[f.k] = v;
      }
      const { countdown, symLabel, ...col } = cur;
      st.chartCol = { ...st.chartCol, ...col };
      st.countdown = countdown; st.symLabel = symLabel;
      a._save();
      a.applyTheme();
      this.renderAll();
    };
    const rerender = () => { $('#csForm', body).innerHTML = formHtml(schema, cur); this.bindForm($('#csForm', body), cur, (imm) => { if (imm) apply(); }, rerender); };
    this.bindForm($('#csForm', body), cur, (imm) => { if (imm) apply(); }, rerender);
    $$('[data-pre]', body).forEach(b => b.onclick = () => { Object.assign(cur, PRESETS[b.dataset.pre]); apply(); rerender(); });
    $('#csReset', body).onclick = () => { for (const f of schema) if (f.t === 'color') cur[f.k] = 'auto'; apply(); rerender(); };
    $('#csOk', body).onclick = close;
  }

  /** Indikatoren der aktuellen Vorlage in eine andere kopieren (z. B. versehentlich in die falsche gebaut). */
  openCopyTemplate() {
    const a = this.app, st = a.state;
    const all = [...Object.entries(TEMPLATES).map(([k, t]) => [k, t.name]), ...(st.userTpls || []).map(t => [t.id, t.name])].filter(([k]) => k !== st.template);
    const body = el(`<div class="setdlg"><div class="info-box">Kopiert alle ${st.indicators.length} Indikatoren mit ihren Einstellungen aus „${esc(a.templateName())}“. Der bisherige Inhalt der Ziel-Vorlage wird ersetzt.</div>
      <div class="menu wide">${all.map(([k, n]) => `<div class="mi tpl" data-to="${k}"><b>${esc(n)}</b></div>`).join('')}</div></div>`);
    const close = this.modal('Kopieren nach …', body);
    body.onclick = (e) => {
      const it = e.target.closest('[data-to]');
      if (!it) return;
      close();
      a.copyTemplateTo(it.dataset.to);
      a.applyTemplate(it.dataset.to);
      this.toast(`Kopiert nach „${a.templateName(it.dataset.to)}“`, 'info', 2500);
    };
  }
  /** Vorlage als Code/Link teilen – auf dem Handy in der App unter Vorlagen → importieren einfügen. */
  openShareTemplate() {
    const a = this.app;
    const code = a.exportTemplate(), link = a.shareLink();
    const body = el(`<div class="setdlg">
      <div class="info-box"><b>So kommt die Vorlage aufs Handy:</b><br>1. „Code kopieren“ und dir selbst schicken (z. B. WhatsApp, Discord).<br>2. Auf dem Handy den Code kopieren, TQI Charts öffnen → Vorlagen → „Vorlage importieren“ → einfügen.<br>Der Link öffnet die Vorlage im Browser (die Home-Bildschirm-App auf dem iPhone hat einen eigenen Speicher, dort den Code nehmen).</div>
      <textarea class="codebox" readonly rows="4">${esc(code)}</textarea>
      <div class="dlg-foot stack"><button class="tb" id="shCode">${ICON.copy}<span>Code kopieren</span></button><button class="tb" id="shLink">Link kopieren</button>${navigator.share ? '<button class="tb" id="shShare">Teilen …</button>' : ''}<div class="grow"></div><button class="tb primary" id="shOk">Fertig</button></div></div>`);
    const close = this.modal('Vorlage teilen: ' + a.templateName(), body);
    const copy = async (txt, what) => {
      try { await navigator.clipboard.writeText(txt); this.toast(what + ' kopiert', 'info', 1800); }
      catch { const ta = $('.codebox', body); ta.value = txt; ta.select(); document.execCommand?.('copy'); this.toast(what + ' markiert – kopieren mit Strg+C', 'info', 2500); }
    };
    $('#shCode', body).onclick = () => copy(code, 'Code');
    $('#shLink', body).onclick = () => copy(link, 'Link');
    $('#shShare', body)?.addEventListener('click', () => navigator.share({ title: 'TQI Charts Vorlage', text: code }).catch(() => {}));
    $('#shOk', body).onclick = close;
  }
  /** Importierte Vorlage: als Standard übernehmen oder als neue Vorlage speichern. */
  openImport(imp) {
    const a = this.app;
    const body = el(`<div class="setdlg"><div class="info-box">„${esc(imp.name)}“ mit ${imp.list.length} Indikatoren: ${esc(imp.list.map(x => TYPES[x.type].name).join(', '))}.</div>
      <div class="dlg-foot stack"><button class="tb primary" id="imStd">Als „Standard“ übernehmen</button><button class="tb" id="imNew">Als neue Vorlage</button><div class="grow"></div><button class="tb" id="imNo">Abbrechen</button></div></div>`);
    const close = this.modal('Vorlage importieren', body);
    $('#imStd', body).onclick = () => { close(); a.applyImported(imp, 'bild'); this.toast('Standard-Vorlage übernommen', 'info', 2200); };
    $('#imNew', body).onclick = () => { close(); a.applyImported(imp, 'new'); this.toast('Neue Vorlage gespeichert', 'info', 2200); };
    $('#imNo', body).onclick = close;
  }

  // ================================================================ Dialoge
  modal(title, content, { onClose, wide = false } = {}) {
    const root = $('#modal');
    const m = el(`<div class="mback"><div class="mdlg ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="dlg-head">${title ? `<b>${esc(title)}</b>` : ''}<div class="grow"></div><button class="tb icon" data-close title="Schließen">${ICON.close}</button></div>
      <div class="mbody"></div></div></div>`);
    $('.mbody', m).appendChild(content);
    root.appendChild(m);
    const close = () => { if (!m.isConnected) return; m.remove(); onClose?.(); };
    m.addEventListener('pointerdown', (e) => { if (e.target === m) close(); });
    $('[data-close]', m).onclick = close;
    m._close = close;
    requestAnimationFrame(() => m.classList.add('on'));
    return close;
  }
  closeTopModal() { const ms = $$('#modal .mback'); const m = ms[ms.length - 1]; if (m) { m._close(); return true; } return false; }

  openSymbolDialog(addToWatch = false, prefill = '') {
    const a = this.app, st = a.state;
    let mk = addToWatch ? st.market : 'all';
    const body = el(`<div class="symdlg">
      <div class="search">${ICON.search}<input id="symQ" placeholder="Symbol oder Name (z. B. BTC, Solana)" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(prefill)}"></div>
      <div class="chips" id="symMk">${[['all', 'Alle Börsen'], ...Object.values(MARKETS).map(m => [m.id, m.label])].map(([k, l]) => `<button class="chip ${k === mk ? 'on' : ''}" data-mk="${k}">${l}</button>`).join('')}</div>
      <div class="symlist" id="symList"></div></div>`);
    const close = this.modal(addToWatch ? 'Zur Watchlist hinzufügen' : 'Symbol suchen', body, { wide: true });
    const q = $('#symQ', body);
    const render = () => {
      const term = q.value.trim().toUpperCase();
      let coins = COINS.filter(([b, n]) => !term || b.includes(term) || n.toUpperCase().includes(term));
      if (term && /^[A-Z0-9]{2,12}$/.test(term) && !COINS.some(([b]) => b === term)) coins = [[term, 'eigenes Symbol'], ...coins];
      const mks = mk === 'all' ? Object.values(MARKETS) : [MARKETS[mk]];
      const rows = [];
      for (const [b, n] of coins.slice(0, 60)) for (const m of mks) rows.push({ b, n, m });
      $('#symList', body).innerHTML = rows.slice(0, 240).map(r => `<div class="sym-row ${r.b === st.base && r.m.id === st.market ? 'on' : ''}" data-b="${r.b}" data-m="${r.m.id}">
        ${coinBadge(r.b, 24)}<b>${esc(r.m.ticker(r.b))}</b><span class="nm">${esc(r.n)}</span><span class="grow"></span><span class="mk">${esc(r.m.desc)}</span><span class="ex">${r.m.badge}</span></div>`).join('') || '<div class="muted pad">Nichts gefunden</div>';
    };
    q.oninput = render;
    $('#symMk', body).onclick = (e) => { const c = e.target.closest('[data-mk]'); if (!c) return; mk = c.dataset.mk; $$('#symMk .chip', body).forEach(x => x.classList.toggle('on', x === c)); render(); };
    $('#symList', body).onclick = (e) => {
      const r = e.target.closest('[data-b]');
      if (!r) return;
      close();
      if (addToWatch) { if (!st.watchlist.includes(r.dataset.b)) a.setState({ watchlist: [...st.watchlist, r.dataset.b] }, { render: false }); this.renderRight(); }
      else a.setSymbol(r.dataset.b, r.dataset.m);
    };
    q.onkeydown = (e) => { if (e.key === 'Enter') { const f = $('#symList .sym-row', body); f?.click(); } };
    render();
    setTimeout(() => { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 30);
  }

  openIndicatorDialog() {
    const a = this.app;
    let cat = 'tqi';
    const body = el(`<div class="inddlg">
      <div class="search">${ICON.search}<input id="indQ" placeholder="Indikator suchen" autocomplete="off"></div>
      <div class="ind-cols"><nav class="ind-cats" id="indCats"></nav><div class="ind-list" id="indList"></div></div></div>`);
    const close = this.modal('Indikatoren', body, { wide: true });
    const render = () => {
      const q = $('#indQ', body).value.trim().toLowerCase();
      $('#indCats', body).innerHTML = [...CATEGORIES, ['active', `Aktiv (${a.state.indicators.length})`]].map(([k, l]) => `<button class="${k === cat && !q ? 'on' : ''}" data-cat="${k}">${l}</button>`).join('');
      let list;
      if (q) list = REGISTRY.filter(t => (t.name + ' ' + t.desc).toLowerCase().includes(q)).map(t => ({ T: t }));
      else if (cat === 'active') list = a.state.indicators.map(x => ({ T: TYPES[x.type], ind: x }));
      else list = REGISTRY.filter(t => t.cat === cat).map(t => ({ T: t }));
      $('#indList', body).innerHTML = list.map(({ T, ind }) => {
        const active = ind || a.state.indicators.find(x => x.type === T.type);
        return `<div class="ind-row" data-type="${T.type}" ${ind ? `data-uid="${ind.uid}"` : ''}>
          <div class="ind-tx"><b>${esc(ind ? T.title(ind.s) : T.name)}</b><small>${esc(T.desc)}</small></div>
          ${active ? `<span class="tag">${ind && !ind.visible ? 'ausgeblendet' : 'aktiv'}</span>` : ''}
          ${ind ? `<button class="tb icon" data-set="${ind.uid}" title="Einstellungen">${ICON.gear}</button><button class="tb icon" data-del="${ind.uid}" title="Entfernen">${ICON.trash}</button>` : `<button class="tb add" data-add="${T.type}">${active && !T.multi ? 'Einstellungen' : '+ Hinzufügen'}</button>`}
        </div>`;
      }).join('') || '<div class="muted pad">Keine Indikatoren</div>';
    };
    $('#indQ', body).oninput = render;
    $('#indCats', body).onclick = (e) => { const b = e.target.closest('[data-cat]'); if (b) { cat = b.dataset.cat; $('#indQ', body).value = ''; render(); } };
    $('#indList', body).onclick = (e) => {
      const add = e.target.closest('[data-add]'), set = e.target.closest('[data-set]'), del = e.target.closest('[data-del]');
      if (set) { this.openIndicatorSettings(set.dataset.set); return; }
      if (del) { a.removeIndicator(del.dataset.del); render(); return; }
      const row = e.target.closest('[data-type]');
      const type = add?.dataset.add || (row && !row.dataset.uid ? row.dataset.type : null);
      if (!type) return;
      const T = TYPES[type];
      const ex = a.state.indicators.find(x => x.type === type);
      if (ex && !T.multi) { this.openIndicatorSettings(ex.uid); return; }
      a.addIndicator(type);
      this.toast(T.name + ' hinzugefügt', 'info', 1600);
      if (this.mobile) close(); else render();
    };
    render();
    if (!this.mobile) setTimeout(() => $('#indQ', body).focus(), 30);
  }

  /** Einstellungen wie TradingView: Reiter Eingaben / Stil / Sichtbarkeit, Standardwerte-Menü, Abbrechen / Ok. */
  openIndicatorSettings(uid) {
    const a = this.app;
    const ind = a.state.indicators.find(x => x.uid === uid);
    if (!ind) return;
    const T = TYPES[ind.type];
    const orig = deepClone(ind.s), origVis = deepClone(ind.vis || null);
    let cur = deepClone(ind.s);
    const vis = Object.assign({ min: true, hour: true, day: true, week: true }, ind.vis || {});
    const tabs = splitSchema(T.schema);
    const order = [['inputs', 'Eingaben'], ['style', 'Stil'], ['vis', 'Sichtbarkeit']].filter(([k]) => k === 'vis' || tabs[k].length);
    let tab = order[0][0];
    const body = el(`<div class="setdlg tvdlg">
      <div class="tv-tabs">${order.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="form" id="frm"></div>
      <div class="dlg-foot"><div class="dd-wrap"><button class="tb" id="fDef">Standardwerte ${ICON.chev}</button></div><div class="grow"></div><button class="tb" id="fCancel">Abbrechen</button><button class="tb primary" id="fOk">Ok</button></div></div>`);
    const close = this.modal(T.name, body);
    const render = () => {
      $$('.tv-tabs button', body).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
      if (tab === 'vis') {
        $('#frm', body).innerHTML = `<div class="f-sec">Anzeigen auf Zeiteinheiten</div>` + [['min', 'Minuten', '1 – 30 Min.'], ['hour', 'Stunden', '1 – 12 Std.'], ['day', 'Tage', '1 T'], ['week', 'Wochen und Monate', '1 W, 1 M']]
          .map(([k, l, r]) => `<div class="f-row f-chk"><label class="chk"><input type="checkbox" data-vis="${k}" ${vis[k] ? 'checked' : ''}><i></i><span>${l}</span></label><span class="f-ctl muted">${r}</span></div>`).join('');
      } else $('#frm', body).innerHTML = groupsHtml(tabs[tab], cur);
    };
    render();
    const apply = () => {
      ind.vis = Object.values(vis).every(Boolean) ? undefined : { ...vis };
      a.updateIndicator(uid, deepClone(cur));
      this.renderLegend();
    };
    let tmr;
    const later = () => { clearTimeout(tmr); tmr = setTimeout(apply, 200); };
    $('.tv-tabs', body).onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; render(); } };
    $('#frm', body).addEventListener('change', (e) => { const v = e.target.dataset.vis; if (v) { vis[v] = e.target.checked; apply(); } });
    this.bindForm($('#frm', body), cur, (immediate) => immediate ? (clearTimeout(tmr), apply()) : later(), render);
    $('#fDef', body).onclick = (e) => {
      e.stopPropagation();
      const mine = a.state.myDefaults?.[ind.type];
      const menu = el(`<div class="dd-menu">
        <button data-d="factory">Auf Werkseinstellungen zurücksetzen</button>
        ${mine ? '<button data-d="mine">Meine Standardwerte laden</button>' : ''}
        <button data-d="save">Als meine Standardwerte speichern</button>
        ${mine ? '<button data-d="forget">Meine Standardwerte löschen</button>' : ''}</div>`);
      const wrap = $('.dd-wrap', body);
      $('.dd-menu', wrap)?.remove();
      wrap.appendChild(menu);
      const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', off, true); } };
      setTimeout(() => document.addEventListener('pointerdown', off, true));
      menu.onclick = (ev) => {
        const d = ev.target.closest('[data-d]')?.dataset.d;
        if (!d) return;
        if (d === 'factory') { cur = deepClone(T.defaults); }
        if (d === 'mine') { cur = mergeDefaults(T.defaults, mine); }
        if (d === 'save') { (a.state.myDefaults ||= {})[ind.type] = deepClone(cur); a._save(); this.toast('Als Standard für neue „' + T.name + '“ gespeichert', 'info', 2500); }
        if (d === 'forget') { delete a.state.myDefaults[ind.type]; a._save(); }
        menu.remove();
        this.bindForm($('#frm', body), cur, (immediate) => immediate ? (clearTimeout(tmr), apply()) : later(), render);
        render(); apply();
      };
    };
    $('#fCancel', body).onclick = () => { ind.vis = origVis || undefined; a.updateIndicator(uid, orig); this.renderLegend(); close(); };
    $('#fOk', body).onclick = () => { clearTimeout(tmr); apply(); close(); };
  }

  /**
   * Formular-Ereignisse: Eingaben, Farbwähler (Palette + Deckkraft), Linienbreite.
   * onChange(immediate) wird nach jeder Änderung gerufen. Bindet sich je Container nur einmal (Daten über Getter).
   */
  bindForm(box, cur, onChange, rerender) {
    box._fs = { cur, onChange, rerender };
    if (box._bound) return;
    box._bound = true;
    const st = () => box._fs;
    box.addEventListener('input', (e) => { if (e.target.dataset.k && e.target.dataset.t !== 'bool') { readField(e.target, st().cur); st().onChange(false); } });
    box.addEventListener('change', (e) => {
      if (!e.target.dataset.k) return;
      readField(e.target, st().cur);
      if (e.target.dataset.auto != null) st().rerender?.();
      // abhängige Felder aus- bzw. einschalten (z. B. Min. Volumen nur ohne Auto-Filter)
      $$('[data-offk]', box).forEach(x => { const off = String(st().cur[x.dataset.offk]) === x.dataset.offv; x.disabled = off; x.closest('.f-row')?.classList.toggle('off', off); });
      st().onChange(true);
    });
    box.addEventListener('click', (e) => {
      const sw = e.target.closest('.cswatch');
      if (sw) {
        e.preventDefault();
        const k = sw.dataset.sw;
        this.openColorPicker(sw, st().cur[k], (c) => { st().cur[k] = c; sw.style.setProperty('--c', cssColor(c)); sw.classList.remove('auto'); st().onChange(true); });
        return;
      }
      const wb = e.target.closest('.wpick [data-w]');
      if (wb) {
        e.preventDefault();
        const k = wb.parentElement.dataset.wk;
        st().cur[k] = +wb.dataset.w;
        $$('[data-w]', wb.parentElement).forEach(x => x.classList.toggle('on', x === wb));
        st().onChange(true);
      }
    });
  }

  /** Farbwähler wie TradingView: Palette, zuletzt benutzt, eigene Farbe (+), Deckkraft. */
  openColorPicker(anchor, value, onPick) {
    $('.cpick')?.remove();
    const a = this.app;
    let { hex, a: op } = splitColor(value === 'auto' ? '#787b86' : value);
    const recent = (a.state.recentColors || []).slice(0, 10);
    const pop = el(`<div class="cpick" role="dialog" aria-label="Farbe">
      <div class="cp-grid">${TV_PALETTE.map(row => row.map(c => `<button data-c="${c}" style="--c:${c}" class="${c === hex ? 'on' : ''}" title="${c}"></button>`).join('')).join('')}</div>
      ${recent.length ? `<div class="cp-recent">${recent.map(c => `<button data-c="${c}" style="--c:${c}"></button>`).join('')}</div>` : ''}
      <div class="cp-row"><label class="cp-add" title="Eigene Farbe">+<input type="color" value="${hex}"></label><span class="cp-cur" style="--c:${cssColor(joinColor(hex, op))}"></span></div>
      <div class="cp-op"><span>Deckkraft</span><input type="range" min="0" max="100" step="1" value="${Math.round(op * 100)}"><b>${Math.round(op * 100)} %</b></div>
    </div>`);
    document.body.appendChild(pop);
    // Lage: am Feld (PC) bzw. unten mittig (Handy)
    if (!this.mobile) {
      const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
      let x = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w)), y = r.bottom + 6;
      if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6);
      pop.style.left = x + 'px'; pop.style.top = y + 'px';
    } else pop.classList.add('sheet');
    const emit = (remember) => {
      const c = joinColor(hex, op);
      $('.cp-cur', pop).style.setProperty('--c', cssColor(c));
      $$('.cp-grid [data-c]', pop).forEach(b => b.classList.toggle('on', b.dataset.c === hex));
      onPick(c);
      if (remember) { a.state.recentColors = [hex, ...(a.state.recentColors || []).filter(x => x !== hex)].slice(0, 10); a._save(); }
    };
    pop.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { hex = b.dataset.c; emit(true); } });
    $('.cp-add input', pop).addEventListener('input', (e) => { hex = e.target.value; emit(false); });
    $('.cp-add input', pop).addEventListener('change', (e) => { hex = e.target.value; emit(true); });
    $('.cp-op input', pop).addEventListener('input', (e) => { op = +e.target.value / 100; $('.cp-op b', pop).textContent = e.target.value + ' %'; emit(false); });
    const off = (ev) => { if (!pop.contains(ev.target) && ev.target !== anchor) { pop.remove(); document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', esc2, true); } };
    const esc2 = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); pop.remove(); document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', esc2, true); } };
    setTimeout(() => { document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', esc2, true); });
  }

  openTpoSettings() {
    const a = this.app;
    const schema = [
      { sec: 'Profil' },
      { k: 'block', label: 'Zeit pro Buchstabe', t: 'select', opts: [['5m', '5 Minuten'], ['15m', '15 Minuten'], ['30m', '30 Minuten (klassisch)'], ['1h', '60 Minuten']] },
      { k: 'rowSize', label: 'Zeilengröße in Preis (0 = automatisch)', t: 'num', min: 0, max: 100000, step: 0.01 },
      { k: 'vaPct', label: 'Value Area (%)', t: 'int', min: 50, max: 95 },
      { k: 'ibMin', label: 'Initial Balance (Minuten)', t: 'int', min: 5, max: 480 },
      { sec: 'Darstellung' },
      { k: 'display', label: 'TPOs als', t: 'select', opts: [['auto', 'automatisch (Buchstaben beim Reinzoomen)'], ['letters', 'Buchstaben'], ['blocks', 'Blöcke']] },
      { k: 'colors', label: 'Farben', t: 'select', opts: [['gradient', 'Verlauf über den Tag'], ['mono', 'einfarbig']] },
      { k: 'poc', label: 'POC', t: 'bool' },
      { k: 'va', label: 'Value Area (VAH / VAL)', t: 'bool' },
      { k: 'vaFill', label: 'Value Area hinterlegen', t: 'bool' },
      { k: 'extendVa', label: 'VA-Linien bis Tagesende', t: 'bool' },
      { k: 'ib', label: 'Initial Balance (blauer Balken)', t: 'bool' },
      { k: 'openClose', label: 'Open / Close markieren', t: 'bool' },
      { k: 'singles', label: 'Single Prints hervorheben', t: 'bool' },
      { k: 'nakedPoc', label: 'Naked POCs nach rechts verlängern', t: 'bool' },
      { k: 'vp', label: 'Volumenprofil rechts', t: 'bool' },
      { k: 'vpWidth', label: 'Breite Volumenprofil (Anteil)', t: 'num', min: 0.1, max: 0.8, step: 0.05 },
    ];
    const cur = { ...a.state.tpo };
    const body = el(`<div class="setdlg"><div class="form">${formHtml(schema, cur)}</div>
      <div class="dlg-foot"><button class="tb" id="tReset">Standard</button><div class="grow"></div><button class="tb primary" id="tOk">Fertig</button></div></div>`);
    const close = this.modal('TPO (Market Profile)', body);
    this.bindForm($('.form', body), cur, () => a.setTpo({ ...cur }));
    $('#tOk', body).onclick = close;
    $('#tReset', body).onclick = () => { close(); a.setTpo({ block: '30m', rowSize: 0, display: 'auto', colors: 'gradient', vaPct: 68, ibMin: 60, poc: true, va: true, vaFill: true, ib: true, openClose: true, singles: true, vp: true, vpWidth: 0.3, nakedPoc: true, extendVa: false }); };
  }

  openSettings() {
    const a = this.app, st = a.state;
    const schema = [
      { sec: 'Session (TPO, Key Levels, Naked Levels)' },
      { k: 'sx.mode', label: 'Session', t: 'select', opts: SESSION_MODES },
      { k: 'sx.start', label: 'Eigene Session: Beginn (HH:MM)', t: 'text' },
      { k: 'sx.end', label: 'Eigene Session: Ende (HH:MM)', t: 'text' },
      { k: 'sx.tz', label: 'Eigene Session: Zeitzone', t: 'select', opts: [['Europe/Berlin', 'Berlin'], ['UTC', 'UTC'], ['America/New_York', 'New York'], ['America/Chicago', 'Chicago'], ['Europe/London', 'London'], ['Asia/Tokyo', 'Tokio']] },
      { k: 'sessionOffsetMin', label: 'Nur bei 00:00 UTC: Tagesbeginn verschieben (Minuten)', t: 'int', min: -720, max: 720 },
      { sec: 'Market Profile' },
      { k: 'tpoRow', label: 'TPO-Zeilengröße in Preis (0 = automatisch)', t: 'num', min: 0, max: 100000, step: 0.01 },
      { k: 'vaStep', label: 'Value Area: Zeilen pro Schritt', t: 'select', opts: [[2, '2 Zeilen (ATAS / CBOT-Methode)'], [1, '1 Zeile']] },
      { sec: 'Darstellung' },
      { k: 'theme', label: 'Design', t: 'select', opts: [['dark', 'Dunkel'], ['light', 'Hell (wie TradingView-Bild)']] },
      { k: 'candles', label: 'Kerzenfarben', t: 'select', opts: [['auto', 'automatisch (Dunkel: Grün/Rot, Hell: Schwarz/Weiß)'], ...Object.entries(CANDLE_STYLES).map(([k, v]) => [k, v.name])] },
      { k: 'tz', label: 'Zeitzone', t: 'select', opts: [['local', 'Lokal (' + tzOffsetLabel(Intl.DateTimeFormat().resolvedOptions().timeZone) + ')'], ['utc', 'UTC']] },
      { sec: 'Level-Beschriftung' },
      { k: 'd.labelSize', label: 'Schriftgröße', t: 'int', min: 8, max: 18 },
      { k: 'd.labelOffset', label: 'Abstand rechts (Kerzen)', t: 'int', min: 0, max: 100 },
      { k: 'd.labelNoOverlap', label: 'Beschriftungen nicht überlappen', t: 'bool' },
      { k: 'd.labelBg', label: 'Beschriftung mit Hintergrund', t: 'bool' },
    ];
    const sx = st.session || {};
    const flat = { theme: st.theme, candles: st.candles, tz: st.tz, sessionOffsetMin: st.sessionOffsetMin, tpoRow: st.tpoRow, vaStep: st.vaStep === 1 ? 1 : 2, 'sx.mode': sx.mode || 'utc', 'sx.start': sx.start || '02:00', 'sx.end': sx.end || '22:00', 'sx.tz': sx.tz || 'Europe/Berlin' };
    for (const [k, v] of Object.entries(st.display)) flat['d.' + k] = v;
    const body = el(`<div class="setdlg"><div class="form">${formHtml(schema, flat)}</div>
      <div class="info-box">
        <b>${APP.name} ${APP.version}</b><br>
        Daten: öffentliche Schnittstellen von Binance, Bybit, OKX, Coinbase und Bitstamp, direkt im Browser. Einstellungen, Zeichnungen und Watchlist werden nur in diesem Browser gespeichert.<br>
        Charts: TradingView Lightweight Charts™ Copyright (c) 2026 TradingView, Inc. <a href="https://www.tradingview.com/" target="_blank" rel="noopener">tradingview.com</a> (Apache-2.0).<br>
        Aktuelle TPO-Zeile: ${a.fmt(a.rowSize())} · Session: ${esc(a.sess.label())} · Kerzen geladen: ${nf(0).format(a.bars.length)}<br>
        Tipp: Wie ATAS mit deiner Session = „eigene Zeiten“ 02:00–22:00 Berlin. CME-Futures liegen um die Futures-Prämie über Krypto-Spot/Perp.
      </div>
      <div class="dlg-foot"><button class="tb danger" id="sReset">Alles zurücksetzen</button><button class="tb" id="sChart">${ICON.candles}<span>Chart-Farben &amp; Kerzen …</span></button><div class="grow"></div><button class="tb primary" id="sOk">Fertig</button></div></div>`);
    const close = this.modal('Einstellungen', body);
    $('#sChart', body).onclick = () => { close(); this.openChartSettings(); };
    this.bindForm($('.form', body), flat, (immediate) => {
      if (!immediate) return;
      const disp = {};
      for (const [k, v] of Object.entries(flat)) if (k.startsWith('d.')) disp[k.slice(2)] = v;
      const themeChanged = flat.theme !== st.theme || flat.candles !== st.candles;
      const okHm = (v, d) => /^\d{1,2}:\d{2}$/.test(String(v).trim()) ? String(v).trim().padStart(5, '0') : d;
      const nsx = { mode: flat['sx.mode'], start: okHm(flat['sx.start'], sx.start || '02:00'), end: okHm(flat['sx.end'], sx.end || '22:00'), tz: flat['sx.tz'] };
      const sessChanged = flat.sessionOffsetMin !== st.sessionOffsetMin || flat.tpoRow !== st.tpoRow || +flat.vaStep !== (st.vaStep === 1 ? 1 : 2) || JSON.stringify(nsx) !== JSON.stringify(st.session || {});
      Object.assign(st, { theme: flat.theme, candles: flat.candles, tz: flat.tz, sessionOffsetMin: flat.sessionOffsetMin, tpoRow: flat.tpoRow, vaStep: +flat.vaStep === 1 ? 1 : 2, session: nsx, display: mergeDefaults(st.display, disp) });
      a._save();
      if (themeChanged) a.applyTheme();
      a.refreshTimeFormat();
      this.renderAll();
      if (sessChanged) { a.ensureNeeds(); if (a.isTpo) a.applySpacing(); }
      a.recompute(true);
    });
    $('#sOk', body).onclick = close;
    $('#sReset', body).onclick = () => {
      if (!confirm('Alle Einstellungen, Indikatoren und die Watchlist zurücksetzen? Zeichnungen bleiben erhalten.')) return;
      localStorage.removeItem(APP.key);
      location.reload();
    };
  }

  // ================================================================ Tastatur
  onKey(e) {
    if (e.key === 'Escape') { if (this.closeTopModal()) { e.preventDefault(); return; } this.closePop(); return; }
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ($('#modal .mback')) return;
    if (e.key === '/') { e.preventDefault(); this.openIndicatorDialog(); return; }
    if (/^[a-zA-Z]$/.test(e.key) && !['Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); this.openSymbolDialog(false, e.key.toUpperCase()); return; }
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); this.openTfQuick(e.key); }
  }
  openTfQuick(first) {
    const body = el(`<div class="tfq"><input id="tfqI" value="${first}" autocomplete="off"><small>Zahl = Minuten, h = Stunden, D/W/M · Enter</small></div>`);
    const close = this.modal('Zeiteinheit', body);
    const i = $('#tfqI', body);
    setTimeout(() => { i.focus(); i.setSelectionRange(1, 1); }, 20);
    i.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      const v = i.value.trim();
      let tf = null;
      const m = /^(\d+)\s*([mhdwMHDW]?)$/.exec(v);
      if (m) {
        const n = +m[1], u = m[2];
        if (!u || u === 'm') tf = TIMEFRAMES.find(t => t.min === n)?.id;
        else if (u.toLowerCase() === 'h') tf = TIMEFRAMES.find(t => t.min === n * 60)?.id;
        else if (u.toLowerCase() === 'd' && n === 1) tf = '1D';
        else if (u.toLowerCase() === 'w' && n === 1) tf = '1W';
        else if (u === 'M' && n === 1) tf = '1M';
      }
      close();
      if (tf) this.app.setTf(tf); else this.toast('Zeiteinheit nicht verfügbar: ' + v, 'error');
    };
  }
}

// ================================================================ Formulare
const TV_BASE = ['#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63'];
const TV_PALETTE = [
  ['#ffffff', '#d1d4dc', '#b2b5be', '#9598a1', '#787b86', '#5d606b', '#434651', '#2a2e39', '#131722', '#000000'],
  TV_BASE,
  TV_BASE.map(c => mixHex(c, '#ffffff', 0.18)),
  TV_BASE.map(c => mixHex(c, '#ffffff', 0.36)),
  TV_BASE.map(c => mixHex(c, '#ffffff', 0.58)),
  TV_BASE.map(c => mixHex(c, '#ffffff', 0.8)),
  TV_BASE.map(c => mixHex(c, '#000000', 0.72)),
  TV_BASE.map(c => mixHex(c, '#000000', 0.5)),
];
const STYLE_SEC = /Darstellung|Farbe|Stil|Linien|TPOs|Hintergrund|Beschriftung|Anzeige/i;
/** Schema in Reiter aufteilen: Abschnitte mit tab: 'style' (oder Stil-Namen) → Stil; Farben aus Eingaben → Stil/Farben. */
function splitSchema(schema) {
  const tabs = { inputs: [], style: [] };
  let g = null, gt = 'inputs';
  const colors = { sec: 'Farben', fields: [] };
  for (const f of schema) {
    if (f.sec) { gt = f.tab || (STYLE_SEC.test(f.sec) ? 'style' : 'inputs'); g = { sec: f.sec, fields: [] }; tabs[gt].push(g); continue; }
    if (!g) { g = { sec: null, fields: [] }; gt = 'inputs'; tabs.inputs.push(g); }
    if (gt === 'inputs' && (f.t === 'color' || f.t === 'width')) colors.fields.push(f); else g.fields.push(f);
  }
  if (colors.fields.length) tabs.style.push(colors);
  for (const k of Object.keys(tabs)) tabs[k] = tabs[k].filter(x => x.fields.length);
  return tabs;
}
function groupsHtml(groups, s) {
  return groups.map(g => (g.sec ? `<div class="f-sec">${esc(g.sec)}</div>` : '') + g.fields.map(f => fieldHtml(f, s)).join('')).join('');
}
function formHtml(schema, s) {
  const out = [];
  for (const f of schema) out.push(f.sec ? `<div class="f-sec">${esc(f.sec)}</div>` : fieldHtml(f, s));
  return out.join('');
}
function swatchHtml(k, v) {
  const auto = v === 'auto';
  return `<button type="button" class="cswatch ${auto ? 'auto' : ''}" data-sw="${k}" style="--c:${auto ? 'transparent' : cssColor(v)}" title="Farbe wählen"></button>`;
}
function widthHtml(k, v) {
  return `<span class="wpick" data-wk="${k}">${[1, 2, 3, 4].map(w => `<button type="button" class="${+v === w ? 'on' : ''}" data-w="${w}" title="${w} px"><i style="height:${w}px"></i></button>`).join('')}</span>`;
}
function fieldHtml(f, s) {
  const v = s[f.k];
  const id = 'f_' + f.k.replace(/\W/g, '_');
  if (f.t === 'bool') {
    const extra = (f.color ? swatchHtml(f.color, s[f.color]) : '') + (f.width ? widthHtml(f.width, s[f.width]) : '');
    return `<div class="f-row f-chk"><label class="chk"><input type="checkbox" data-k="${f.k}" data-t="bool" ${v ? 'checked' : ''}><i></i><span>${esc(f.label)}</span></label>${extra ? `<span class="f-ctl">${extra}</span>` : ''}</div>`;
  }
  let input;
  switch (f.t) {
    case 'int': case 'num': input = `<input id="${id}" type="number" inputmode="decimal" data-k="${f.k}" data-t="${f.t}" value="${v}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} step="${f.step || 1}">`; break;
    case 'select': input = `<select id="${id}" data-k="${f.k}" data-t="select">${(typeof f.opts === 'function' ? f.opts() : f.opts).map(([k, l]) => `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`; break;
    case 'date': input = `<input id="${id}" type="date" data-k="${f.k}" data-t="date" value="${esc(v)}">`; break;
    case 'text': input = `<input id="${id}" type="text" data-k="${f.k}" data-t="text" value="${esc(v ?? '')}" maxlength="40">`; break;
    case 'width': input = widthHtml(f.k, v); break;
    case 'color': {
      const auto = v === 'auto';
      input = (f.auto ? `<label class="mini"><input type="checkbox" data-k="${f.k}" data-t="auto" data-auto ${auto ? 'checked' : ''}> auto</label>` : '') + swatchHtml(f.k, v);
      break;
    }
    default: input = esc(String(v));
  }
  if (f.offIf) {
    const off = String(s[f.offIf[0]]) === String(f.offIf[1]);
    input = input.replace(/<(input|select)\b/, `<$1 data-offk="${f.offIf[0]}" data-offv="${f.offIf[1]}" ${off ? 'disabled' : ''}`);
    return `<div class="f-row ${off ? 'off' : ''}"><label for="${id}">${esc(f.label)}</label><span class="f-ctl">${input}</span></div>`;
  }
  return `<div class="f-row"><label for="${id}">${esc(f.label)}</label><span class="f-ctl">${input}</span></div>`;
}
function readField(t, s) {
  const k = t.dataset.k;
  if (!k) return;
  const ty = t.dataset.t;
  if (ty === 'bool') s[k] = t.checked;
  else if (ty === 'int') { const v = parseInt(t.value, 10); if (Number.isFinite(v)) s[k] = clampNum(v, t); }
  else if (ty === 'num') { const v = parseFloat(String(t.value).replace(',', '.')); if (Number.isFinite(v)) s[k] = clampNum(v, t); }
  else if (ty === 'select') { const cur = s[k]; s[k] = typeof cur === 'number' ? +t.value : t.value; }
  else if (ty === 'date') s[k] = t.value;
  else if (ty === 'text') s[k] = t.value;
  else if (ty === 'color') s[k] = t.value;
  else if (ty === 'auto') s[k] = t.checked ? 'auto' : '#888888';
}
function clampNum(v, t) {
  const mn = t.min !== '' ? parseFloat(t.min) : -Infinity, mx = t.max !== '' ? parseFloat(t.max) : Infinity;
  return Math.min(mx, Math.max(mn, v));
}
function toHex(c) {
  if (!c) return '#888888';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join('');
  return '#888888';
}
function logoSvg() {
  return `<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="7" fill="currentColor" opacity=".12"/><path d="M9 21V13M9 11V8M16 24V15M16 13v-2M23 19v-9M23 8V6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="7.2" y="13" width="3.6" height="6" rx="1" fill="#e91e63"/><rect x="14.2" y="11" width="3.6" height="8" rx="1" fill="currentColor"/><rect x="21.2" y="10" width="3.6" height="6" rx="1" fill="#7c3aed"/></svg>`;
}
