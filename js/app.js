// TQI Charts – Hauptsteuerung: Chart, Daten, Indikatoren, Live-Updates.
import { createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries, CrosshairMode, LineStyle, PriceScaleMode } from './vendor/lightweight-charts.esm.js';
import { APP, TEMPLATES, DEFAULT_STATE, THEMES, CANDLE_STYLES } from './config.js';
import { MARKETS, fetchBars } from './exchanges.js';
import { DataHub } from './datafeed.js';
import { TYPES } from './indicators.js';
import { OverlayPrimitive, Scene } from './render/overlay.js';
import { Drawings } from './render/drawings.js';
import { TpoPaneView, buildTpoSessions } from './render/tpo.js';
import { BigTrades } from './bigtrades.js';
import { OptionsData } from './options.js';
import { Alerts } from './alerts.js';
import { buildDayProfiles, autoRowSize, firstTouch } from './calc/profile.js';
import { heikinAshi } from './calc/std.js';
import * as U from './util.js';
import { UI } from './ui.js';

const TPO_BLOCKS = ['5m', '15m', '30m', '1h'];
const INITIAL_BARS = { '1m': 1500, '3m': 1500, '5m': 1500, '15m': 1500, '30m': 1500, '1h': 1500, '2h': 1200, '4h': 1200, '6h': 1000, '12h': 1000, '1D': 1000, '1W': 400, '1M': 150 };

export class App {
  constructor(root) {
    this.root = root;
    const saved = U.storage.get(APP.key, null);
    this.state = U.mergeDefaults(DEFAULT_STATE, saved || {});
    if (saved && Array.isArray(saved.indicators)) this.state.indicators = saved.indicators.filter(x => TYPES[x.type]).map(x => ({ ...x, s: U.mergeDefaults(TYPES[x.type].defaults, x.s) }));
    if (!Array.isArray(this.state.indicators)) this.state.indicators = this.templateIndicators(this.state.template || 'bild');
    if (!MARKETS[this.state.market]) this.state.market = DEFAULT_STATE.market;
    this.migrate(saved);
    // Handy: Legende anfangs eingeklappt (übersichtlich wie die TradingView-App)
    if (!saved && matchMedia('(max-width: 760px)').matches) this.state.legendOpen = false;
    this.hub = new DataHub();
    this.bars = [];
    this.view = [];             // angezeigte Kerzen (z. B. Heikin Ashi)
    this.data = new Map();      // uid → Ergebnis der Rechnung
    this.panes = new Map();     // uid → { series: {key: api}, ind }
    this.ext = { oi: null, funding: null };
    this.liqList = [];
    this.tape = [];
    this.fine = new Map();      // HVB 1m-Daten je Eimer
    this.fineQueue = [];
    this.loadSeq = 0;
    this.priceDec = 2;
    this.crossIdx = null;
    this._save = this._debounce(() => this.saveState(), 300);
    this._recompute = U.frameThrottle(() => this.recompute(), matchMedia('(max-width: 760px)').matches ? 500 : 250);
    this._live = U.frameThrottle(() => this.liveUpdate(), 60);
    // Countdown bis Kerzenschluss am Preislabel
    setInterval(() => { if (document.visibilityState === 'visible') this.overlay?.requestUpdate?.(); }, 1000);
    this.opt = new OptionsData();
    this.opt.on('change', () => this._recompute());
    this.bt = new BigTrades();
    this.bt.on('change', () => this._recompute());
    setInterval(() => this.bt.save(), 30000);
    window.addEventListener('pagehide', () => this.bt.save());
    this.alerts = new Alerts(this);
    this.tpoSel = null;
    // Daten anderer Börsen (Indikator-Einstellung „Daten von“): alle 30 s abgleichen
    setInterval(() => this.refreshFeeds(), 30000);
  }

  /** Alte gespeicherte Stände anpassen (neue Farben, Session, Vorlagen). */
  migrate(saved) {
    const st = this.state;
    if (!saved) { st.colorsV = 2; return; }
    if ((saved.colorsV || 0) < 2) {
      // zweifarbig (Schwarz/Grau, POC pink): Farben der Indikatoren auf die neuen Standardwerte setzen
      for (const ind of st.indicators || []) {
        const T = TYPES[ind.type];
        if (!T) continue;
        for (const f of T.schema || []) {
          for (const k of [f.t === 'color' ? f.k : null, typeof f.color === 'string' ? f.color : null]) if (k && k in T.defaults) ind.s[k] = T.defaults[k];
        }
        if (ind.type === 'keylevels') ind.s.lines = 'full';
        if (ind.type === 'rvwap' && !ind.s.feed) ind.s.feed = 'bitstamp-spot';
      }
      if (st.template === 'bild') {
        const tpo = st.indicators?.find(x => x.type === 'tpo');
        if (tpo) tpo.visible = false;
        if (!st.indicators?.some(x => x.type === 'sfp')) st.indicators?.push({ uid: U.uid(), type: 'sfp', visible: true, s: U.deepClone(TYPES.sfp.defaults) });
      }
      st.tpo = { ...st.tpo, colors: 'mono' };
      st.colorsV = 2;
    }
  }

  // ---------------------------------------------------------------- Start
  async init() {
    this.ui = new UI(this);
    this.ui.build();
    this.createChart();
    this.drawings = new Drawings(this);
    this.applyTheme();
    this.hub.on('trade', (tr) => this.onTrade(tr));
    this.hub.on('liq', (lq) => this.onLiq(lq));
    this.hub.on('status', (st) => this.ui.setStatus(st));
    this.hub.on('resync', (store) => { if (store === this.chartStore) this.fullRender(); else this._recompute(); });
    this.ui.renderAll();
    await this.loadSymbol();
    setInterval(() => this.refreshExt(false), 60000);
    setInterval(() => { this.ui.tickClock(); this.ui.checkPaneLayout(); }, 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.onWake(); });
  }

  templateIndicators(key) {
    const t = TEMPLATES[key] || TEMPLATES.bild;
    const mine = this.state?.myDefaults || {};
    return t.list.map(x => ({ uid: U.uid(), type: x.type, visible: x.visible !== false, s: Object.assign(U.deepClone(TYPES[x.type].defaults), mine[x.type] ? U.mergeDefaults(TYPES[x.type].defaults, mine[x.type]) : {}, x.s || {}) }));
  }

  get market() { return MARKETS[this.state.market]; }
  get tf() { return this.state.tf; }
  get theme() {
    const base = THEMES[this.state.theme] || THEMES.dark;
    const style = this.state.candles === 'auto' ? (base.dark ? 'tv' : 'sw') : this.state.candles;
    const cs = CANDLE_STYLES[style] || CANDLE_STYLES.tv;
    const candles = cs.up ? cs : (base.dark ? cs.dark : cs.light);
    return { ...base, candles };
  }
  get display() { return this.state.display; }
  get isTpo() { return this.state.chartType === 'tpo'; }
  get tpoBlockMs() { return U.tfMs(this.state.tpo.block); }
  get tz() { return this.state.tz === 'utc' ? 'UTC' : U.localTz(); }
  get offset() { return (this.state.sessionOffsetMin || 0) * U.MIN; }
  /** Sessions für TPO / Key Levels (00:00 UTC, CME oder eigene Zeiten). */
  get sess() {
    const c = this.state.session || {};
    const key = JSON.stringify([c.mode, c.start, c.end, c.tz, this.state.sessionOffsetMin]);
    if (this._sessKey !== key) { this._sessKey = key; this._sess = new U.Sessions({ mode: c.mode, start: c.start, end: c.end, tz: c.tz, offset: this.offset }); }
    return this._sess;
  }
  get vaStep() { return this.state.vaStep === 1 ? 1 : 2; }
  /** Für Indikator-Titel: welche Börsen-Daten verfügbar sind. */
  titleCtx() { const b = this.state.base; return { marketId: this.state.market, feedOk: (m) => !this._feedFailed?.has(`${m}|${b}`) }; }
  fmt(p, dec) { return U.fmtPrice(p, dec ?? this.priceDec); }

  saveState() { U.storage.set(APP.key, this.state); }
  setState(patch, { reload = false, render = true } = {}) {
    Object.assign(this.state, patch);
    this._save();
    if (reload) this.loadSymbol();
    else if (render) { this.ui.renderAll(); this._recompute(); }
  }

  // ---------------------------------------------------------------- Chart
  createChart() {
    const el = this.ui.chartEl;
    const th = this.theme;
    this.chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: 'solid', color: th.bg }, textColor: th.text, fontSize: 11,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, "Helvetica Neue", sans-serif',
        attributionLogo: false,
        panes: { separatorColor: th.border, separatorHoverColor: 'rgba(120,123,134,0.25)', enableResize: true },
      },
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: th.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: th.border, timeVisible: true, secondsVisible: false, rightOffset: 12, barSpacing: 7, minBarSpacing: 0.4,
        tickMarkFormatter: (t, type) => this.tickLabel(t * 1000, type),
      },
      localization: { locale: 'de-DE', timeFormatter: (t) => this.crossTime(t * 1000) },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
      kineticScroll: { touch: true, mouse: false },
    });
    this.overlay = new OverlayPrimitive(this);
    this.makeMainSeries();
    this.chart.subscribeCrosshairMove((p) => {
      const idx = p && p.logical != null && p.point ? Math.round(p.logical) : null;
      this.crossIdx = idx != null && idx >= 0 && idx < this.bars.length ? idx : null;
      this.ui.updateLegend();
    });
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => this.onRange(r));
    // TPO-Chart: Profil antippen → auswählen (zusammenfügen / teilen)
    this.chart.subscribeClick((p) => {
      if (!this.isTpo || !p || p.logical == null || !p.point) return;
      if (this.drawings && (this.drawings.tool !== 'cursor' || this.drawings.sel)) return;
      this.selectTpo(Math.round(p.logical));
    });
    new ResizeObserver(() => this.ui.placePaneLegends()).observe(el);
  }

  crossTime(t) {
    const tf = this.state.tf;
    const o = { timeZone: this.tz, weekday: 'short', day: '2-digit', month: 'short', year: '2-digit', hourCycle: 'h23' };
    if (!['1D', '1W', '1M'].includes(tf)) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return new Intl.DateTimeFormat('de-DE', o).format(t);
  }
  refreshTimeFormat() {
    this.chart.applyOptions({
      localization: { timeFormatter: (t) => this.crossTime(t * 1000) },
      timeScale: { tickMarkFormatter: (t, type) => this.tickLabel(t * 1000, type) },
    });
  }

  tickLabel(t, type) {
    const tz = this.tz;
    const p = new Intl.DateTimeFormat('de-DE', { timeZone: tz, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t);
    const g = (k) => p.find(x => x.type === k)?.value || '';
    switch (type) {
      case 0: return g('year');
      case 1: return g('month').replace('.', '');
      case 2: return g('day').replace('.', '');
      default: return `${g('hour')}:${g('minute')}`;
    }
  }

  makeMainSeries() {
    if (this.series) {
      this.series.detachPrimitive(this.overlay);
      if (this.drawings) this.series.detachPrimitive(this.drawings.prim);
      this.chart.removeSeries(this.series);
    }
    const c = this.theme.candles;
    const fmt = { type: 'custom', formatter: (p) => U.fmtPrice(p, this.priceDec), minMove: Math.pow(10, -this.priceDec) };
    const type = this.state.chartType;
    if (type === 'tpo') {
      this.tpoView = new TpoPaneView(this);
      this.series = this.chart.addCustomSeries(this.tpoView, { priceFormat: fmt, priceLineVisible: true, lastValueVisible: false, priceLineColor: '#e91e63' });
    } else if (type === 'bars') this.series = this.chart.addSeries(BarSeries, { upColor: c.borderUp === '#131722' ? '#131722' : c.up, downColor: c.down, thinBars: false, priceFormat: fmt });
    else if (type === 'line') this.series = this.chart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 2, priceFormat: fmt });
    else if (type === 'area') this.series = this.chart.addSeries(AreaSeries, { lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.28)', bottomColor: 'rgba(41,98,255,0.02)', lineWidth: 2, priceFormat: fmt });
    else {
      const hollow = type === 'hollow';
      this.series = this.chart.addSeries(CandlestickSeries, {
        upColor: hollow ? 'rgba(0,0,0,0)' : c.up, downColor: c.down,
        wickUpColor: c.wickUp, wickDownColor: c.wickDown, borderUpColor: c.borderUp, borderDownColor: c.borderDown,
        borderVisible: true, priceFormat: fmt,
      });
    }
    // Preislinie gepunktet; weiße Kerzen auf weißem Grund → Linie in Randfarbe
    const sameAsBg = (c.up || '').toLowerCase() === (this.theme.bg || '').toLowerCase();
    this.series.applyOptions({ lastValueVisible: false, priceLineStyle: LineStyle.Dotted, ...(type !== 'tpo' && sameAsBg ? { priceLineColor: c.borderUp } : {}) });
    this.series.attachPrimitive(this.overlay);
    if (this.drawings) this.series.attachPrimitive(this.drawings.prim);
    this.chart.panes()[0]?.setStretchFactor(5);
    if (this.view.length) this.series.setData(this.seriesData(this.view));
  }

  applyTheme() {
    const th = this.theme;
    document.documentElement.dataset.theme = this.state.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', th.dark ? '#141413' : '#ffffff');
    this.chart.applyOptions({
      layout: { background: { type: 'solid', color: th.bg }, textColor: th.text, panes: { separatorColor: th.border } },
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      rightPriceScale: { borderColor: th.border },
      timeScale: { borderColor: th.border },
      crosshair: {
        vertLine: { color: th.crosshair, labelBackgroundColor: th.dark ? '#363a45' : '#131722' },
        horzLine: { color: th.crosshair, labelBackgroundColor: th.dark ? '#363a45' : '#131722' },
      },
    });
    this.makeMainSeries();
    this.applyScaleMode();
    for (const uid of [...this.panes.keys()]) this.removePane(uid);
    this.fullRender();
  }

  applyScaleMode() {
    const mode = this.state.log ? PriceScaleMode.Logarithmic : this.state.pct ? PriceScaleMode.Percentage : PriceScaleMode.Normal;
    this.chart.priceScale('right').applyOptions({ mode, autoScale: true });
  }

  seriesData(view) {
    const t = this.state.chartType;
    if (t === 'tpo') return view.map(b => ({ time: b.t / 1000, o: b.o, h: b.h, l: b.l, c: b.c }));
    if (t === 'line' || t === 'area') return view.map(b => ({ time: b.t / 1000, value: b.c }));
    return view.map(b => ({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c }));
  }
  makeView() { return this.state.chartType === 'ha' ? heikinAshi(this.bars) : this.bars; }

  // ---------------------------------------------------------------- Symbol laden
  async loadSymbol() {
    const seq = ++this.loadSeq;
    const { market: mk, base, tf } = this.state;
    this.ui.setLoading(true, `${this.market.ticker(base)} · ${this.market.label}`);
    this.hub.stopLive();
    this.hub.prune(mk, base);
    this.ext = { oi: null, funding: null };
    this.liqList = []; this.tape = []; this.fine.clear(); this.fineQueue = [];
    this.data.clear();
    this.alerts?.reset();
    this.tpoSel = null;
    for (const uid of [...this.panes.keys()]) this.removePane(uid);
    if (this.chartStoreOff) this.chartStoreOff();
    const st = this.hub.store(mk, base, tf);
    this.chartStore = st;
    try {
      await st.loadLatest(INITIAL_BARS[tf] || 1500);
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.ui.setLoading(false);
      const good = this.lastGood;
      this.ui.toast(`${this.market.ticker(base)} auf ${this.market.label} nicht verfügbar (${e.message || e}).${good ? ' Zurück zu ' + MARKETS[good.market].ticker(good.base) + '.' : ''}`, 'error', 7000);
      if (good && (good.market !== mk || good.base !== base || good.tf !== tf)) {
        Object.assign(this.state, good); this._save(); this.ui.renderAll();
        return this.loadSymbol();
      }
      this.bars = []; this.view = []; this.series.setData([]);
      this.overlay.setScene(new Scene());
      return;
    }
    this.lastGood = { market: mk, base, tf };
    if (seq !== this.loadSeq) return;
    this.chartStoreOff = st.on('change', () => { if (st === this.chartStore) this.fullRender(); });
    this.bars = st.bars;
    this.priceDec = U.priceDecimals(this.bars[this.bars.length - 1]?.c || 1);
    this.makeMainSeries();
    this.fullRender();
    if (!this.isTpo) this.chart.timeScale().scrollToRealTime();
    this.applySpacing();
    this.syncBigTrades();
    this.ui.setLoading(false);
    this.drawings.load();
    this.hub.startLive(mk, base, tf);
    this.ui.renderAll();
    await this.ensureNeeds();
    if (seq !== this.loadSeq) return;
    this.recompute();
    this.refreshExt(true);
    this.ui.loadWatchlist();
    this.ui.reconnectDom();
  }

  /** Alles neu zeichnen (nach Laden / Historie / Abgleich). */
  fullRender() {
    if (!this.chartStore) return;
    const r = this.chart.timeScale().getVisibleLogicalRange();
    const prevFirst = this._firstT;
    this.bars = this.chartStore.bars;
    this.view = this.makeView();
    this.series.setData(this.seriesData(this.view));
    this._seriesLen = this.view.length;
    this._firstT = this.bars[0]?.t;
    this._forceNext = true;
    // beim Nachladen älterer Kerzen die Ansicht stabil halten
    if (r && prevFirst != null && this._firstT < prevFirst) {
      const added = U.lowerBound(this.bars, prevFirst);
      if (added > 0) this.chart.timeScale().setVisibleLogicalRange({ from: r.from + added, to: r.to + added });
    }
    this.recompute();
  }

  onRange(r) {
    if (r && this.bt.active && this.bars.length) {
      const i = Math.max(0, Math.min(this.bars.length - 1, Math.floor(r.from)));
      this.bt.want(this.bars[i].t, this.btHours());
    }
    if (!r || !this.chartStore || this._loadingOlder) return;
    if (r.from < 30 && !this.chartStore.done && this.bars.length) {
      this._loadingOlder = true;
      this.ui.setHistoryLoading(true);
      this.chartStore.loadOlder(1000).then(async () => { await this.ensureNeeds(); }).catch(e => this.ui.toast('Ältere Daten: ' + e.message, 'error'))
        .finally(() => { this._loadingOlder = false; this.ui.setHistoryLoading(false); });
    }
  }

  /** Daten nachladen, die die Indikatoren brauchen (höhere Zeiteinheiten usw.). */
  async ensureNeeds() {
    const ctx = this.makeCtx();
    const req = new Map();
    const add = (tf, from, count, market) => {
      const key = (market && market !== this.state.market ? market : '') + '|' + tf;
      const r = req.get(key) || { tf, market: market || null, from: Infinity, count: 0 };
      if (from != null) r.from = Math.min(r.from, from);
      if (count) r.count = Math.max(r.count, count);
      req.set(key, r);
    };
    add('1D', null, 400);
    for (const it of this.drawings?.items || []) if (it.type === 'ftpo') add(it.block || '30m', Math.min(it.pts[0].t, it.pts[1].t) - U.DAY, 0);
    for (const ind of this.state.indicators) {
      const T = TYPES[ind.type];
      if (!T || !T.needs) continue;
      try { for (const n of T.needs(ind.s, ctx)) add(n.tf, n.from ?? null, n.count ?? 0, n.market && MARKETS[n.market] ? n.market : null); } catch (e) { console.error(e); }
    }
    const { market: mk, base } = this.state;
    const seq = this.loadSeq;
    const jobs = [];
    for (const r of req.values()) {
      const tf = r.tf;
      const st = this.hub.store(r.market || mk, base, tf);
      jobs.push((async () => {
        try {
          if (!st.bars.length) {
            const byFrom = Number.isFinite(r.from) ? Math.ceil((Date.now() - r.from) / U.tfMs(tf)) + 3 : 0;
            await st.loadLatest(Math.min(Math.max(r.count, byFrom, 50), 40000));
          }
          if (Number.isFinite(r.from)) await st.ensureFrom(r.from);
        } catch (e) {
          console.warn('Daten', r.market || mk, tf, e);
          if (r.market && !st.bars.length) {
            // Coin auf dieser Börse nicht vorhanden → Indikator rechnet mit den Chart-Daten
            (this._feedFailed ||= new Set()).add(`${r.market}|${base}`);
            this.ui.toast(`${MARKETS[r.market].label}: ${base} nicht verfügbar – Rolling VWAP rechnet mit den Chart-Daten`, 'info', 4000);
            this.ui.renderLegend();
          }
        }
      })());
    }
    await Promise.all(jobs);
    if (seq !== this.loadSeq) return;
    this._recompute();
  }

  // ---------------------------------------------------------------- Rechnen und zeichnen
  makeCtx() {
    const { market: mk, base, tf } = this.state;
    const app = this;
    const profCache = new Map();
    const sess = this.sess;
    const store = (t) => { const s = app.hub.stores.get(`${mk}|${base}|${t}`); return s && s.bars.length ? s : null; };
    return {
      bars: this.bars, tf, tfMs: U.tfMs(tf), now: Date.now(), offset: this.offset, isTpo: this.isTpo,
      market: this.market, marketId: mk, base, theme: this.theme, display: this.display,
      sess, vaStep: this.vaStep,
      store,
      /** Kerzen einer anderen Börse (gleicher Coin), z. B. für den Rolling VWAP „wie TradingView“. */
      feedOk: (m) => !this._feedFailed?.has(`${m}|${base}`),
      storeOf: (m, t) => { if (!m || m === mk) return store(t); const s = app.hub.stores.get(`${m}|${base}|${t}`); return s && s.bars.length ? s : null; },
      rowSize: () => this.rowSize(),
      profiles: (rs) => {
        const r = rs > 0 ? rs : this.rowSize();
        if (profCache.has(r)) return profCache.get(r);
        const m30 = store('30m');
        const p = m30 ? buildDayProfiles(m30.bars, { rowSize: r, sess, now: Date.now() }) : null;
        profCache.set(r, p);
        return p;
      },
      /** Beginn der aktuellen (bzw. letzten) Session. */
      sessStart: (t) => { const x = sess.last(t); return x ? x[0] : U.periodStart(t, 'day', this.offset); },
      idx: (t) => { if (!this.bars.length || t < this.bars[0].t) return null; return U.floorIndex(this.bars, t); },
      fine: (t0, t1, live) => this.fineBars(t0, t1, live),
      ext: (k) => this.ext[k],
      bigTrades: (min) => this.bt.active ? this.bt.orders(min > 0 ? min : this.autoBigUsd()) : [],
      autoBig: () => this.autoBigUsd(),
      btInfo: () => this.bt.info(),
      options: (cur, maxAge) => this.opt.get(cur, maxAge),
      liqs: () => this.liqList,
    };
  }

  tpoRowSize() { return this.state.tpo.rowSize > 0 ? this.state.tpo.rowSize : this.rowSize(); }

  /** TPO-Profile je Session berechnen, Achsen-Labels und Naked POCs ergänzen. */
  updateTpo(scene, ctx) {
    const o = this.state.tpo;
    const ed = this.tpoEdits();
    const sessions = buildTpoSessions(this.bars, { rowSize: this.tpoRowSize(), sess: this.sess, blockMs: this.tpoBlockMs, vaPct: o.vaPct, ibMin: o.ibMin, step: this.vaStep, merges: ed.merges, splits: ed.splits });
    this.tpoSessions = sessions;
    this.tpoView.setSessions(sessions, o);
    const cur = sessions[sessions.length - 1];
    const th = this.theme;
    if (cur) {
      if (o.poc && cur.poc != null) scene.axisLabel(cur.poc, null, '#e91e63', '#fff');
      if (o.va && cur.vah != null) { scene.axisLabel(cur.vah, null, th.dark ? '#d1d4dc' : '#131722', th.dark ? '#131722' : '#fff'); scene.axisLabel(cur.val, null, th.dark ? '#d1d4dc' : '#131722', th.dark ? '#131722' : '#fff'); }
    }
    if (o.nakedPoc) {
      const done = sessions.slice(Math.max(0, sessions.length - 41), -1);
      for (const s of done) {
        if (s.poc == null || s.n < 4) continue;
        if (firstTouch(this.bars, s.end, s.poc, s.poc) != null) continue;
        scene.level({ p: s.poc, from: s.start, color: 'rgba(233,30,99,0.85)', dash: 'dashed', label: 'nPOC ' + U.fmtDayLabel(s.day0 ?? s.start), lc: '#e91e63' });
      }
    }
  }

  rowSize() {
    if (this.state.tpoRow > 0) return this.state.tpoRow;
    const d = this.hub.stores.get(`${this.state.market}|${this.state.base}|1D`);
    return d && d.bars.length ? autoRowSize(d.bars) : U.niceStep((this.bars[this.bars.length - 1]?.c || 100) * 0.0005);
  }
  autoBigUsd() {
    const b = this.state.base;
    return b === 'BTC' ? 200000 : b === 'ETH' ? 100000 : ['SOL', 'BNB', 'XRP'].includes(b) ? 50000 : 20000;
  }

  recompute(force = false) {
    if (!this.bars.length) return;
    this._forcePanes = force || this._forceNext;
    this._forceNext = false;
    const ctx = this.makeCtx();
    const scene = new Scene();
    for (const ind of this.state.indicators) {
      const T = TYPES[ind.type];
      if (!T) continue;
      let d = null;
      const on = ind.visible && this.visOnTf(ind);
      if (on) { try { d = T.compute(ind.s, ctx); } catch (e) { console.error(ind.type, e); } }
      this.data.set(ind.uid, d);
      if (T.pane === 'own') { try { this.updatePane(on ? ind : { ...ind, visible: false }, T, d); } catch (e) { console.error(ind.type, e); const p = this.panes.get(ind.uid); if (p) p.lens = {}; } continue; }
      if (!on || !d || !T.draw) continue;
      try { T.draw(ind.s, d, scene, ctx); } catch (e) { console.error(ind.type, e); }
    }
    if (this.isTpo && this.tpoView) this.updateTpo(scene, ctx);
    // überzählige Panels entfernen
    for (const uid of [...this.panes.keys()]) if (!this.state.indicators.some(x => x.uid === uid)) this.removePane(uid);
    this.overlay.setScene(scene);
    this.ui.updateLegend();
    this.ui.updateZTable();
    this.ui.updateHeader();
    if (this._paneLayoutDirty) { this._paneLayoutDirty = false; this.ui.placePaneLegends(); }
  }

  // ---------------------------------------------------------------- Panels (eigene Fenster unter dem Chart)
  updatePane(ind, T, d) {
    let p = this.panes.get(ind.uid);
    if (!p) {
      const paneIndex = this.chart.panes().length;
      const series = {};
      for (const pl of T.plots) {
        const def = pl.kind === 'hist' ? HistogramSeries : LineSeries;
        const opts = {
          priceFormat: { type: 'custom', formatter: (v) => this.paneFmt(ind.type, v), minMove: 1e-9 },
          lastValueVisible: true, priceLineVisible: false,
          ...(pl.kind === 'line' ? { lineWidth: pl.width || 1, crosshairMarkerRadius: 3 } : {}),
        };
        series[pl.key] = this.chart.addSeries(def, opts, paneIndex);
      }
      const first = Object.values(series)[0];
      const pane = first.getPane();
      pane.setStretchFactor(1);
      this.chart.panes()[0].setStretchFactor(5);
      if (T.hlines) for (const h of T.hlines(ind.s)) first.createPriceLine({ price: h, color: this.theme.dark ? '#555' : '#bbb', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
      p = { series, ind, lens: {} };
      this.panes.set(ind.uid, p);
      this._paneLayoutDirty = true;
    }
    p.ind = ind;
    const plots = d?.plots || {};
    const n = this.bars.length, firstT = this.bars[0]?.t;
    const pt = (v, i) => {
      const val = v.values[i], time = this.bars[i].t / 1000;
      if (!Number.isFinite(val)) return { time };
      return v.colors ? { time, value: val, color: U.cssColor(v.colors[i]) } : { time, value: val };
    };
    for (const pl of T.plots) {
      const s = p.series[pl.key];
      const v = plots[pl.key];
      const vis = !!ind.visible && !!v;
      if (p.vis?.[pl.key] !== vis) { s.applyOptions({ visible: vis }); (p.vis ||= {})[pl.key] = vis; }
      if (!v) { if (p.lens[pl.key]) { s.setData([]); p.lens[pl.key] = 0; } continue; }
      if (v.color && p.col?.[pl.key] !== v.color) { s.applyOptions({ color: U.cssColor(v.color) }); (p.col ||= {})[pl.key] = v.color; }
      const prevN = p.lens[pl.key] || 0;
      if (!this._forcePanes && p.firstT === firstT && prevN && n >= prevN && n - prevN <= 2) {
        // nur das Ende hat sich geändert (Live)
        for (let i = Math.max(0, prevN - 1); i < n; i++) s.update(pt(v, i));
      } else {
        const data = new Array(n);
        for (let i = 0; i < n; i++) data[i] = pt(v, i);
        s.setData(data);
      }
      p.lens[pl.key] = n;
    }
    p.firstT = firstT;
  }
  paneFmt(type, v) {
    if (!Number.isFinite(v)) return '';
    if (type === 'funding') return U.nf(4).format(v) + ' %';
    if (type === 'rsi') return U.nf(2).format(v);
    if (type === 'macd' || type === 'atr') return U.fmtPrice(v, Math.min(6, this.priceDec + 1));
    return U.fmtCompact(v, 2);
  }
  removePane(uid) {
    const p = this.panes.get(uid);
    if (!p) return;
    for (const s of Object.values(p.series)) { try { this.chart.removeSeries(s); } catch { /* schon weg */ } }
    this.panes.delete(uid);
    this._paneLayoutDirty = true;
  }

  // ---------------------------------------------------------------- Live
  onTrade(tr) {
    if (this.bt.active) this.bt.onTrade(tr);
    this.alerts.check(tr.p);
    // Tape und große Trades (gleicher Zeitstempel + Seite = eine Marktorder)
    const usd = tr.p * tr.q;
    const last = this.tape[this.tape.length - 1];
    if (last && last.t === tr.t && last.buy === tr.buy) {
      last.usd += usd; last.q += tr.q; last.p = (last.p * (last.q - tr.q) + tr.p * tr.q) / last.q;
    } else {
      this.tape.push({ t: tr.t, p: tr.p, q: tr.q, usd, buy: tr.buy });
      if (this.tape.length > 600) this.tape.splice(0, 200);
    }
    this.ui.tapeDirty = true;
    this._live();
  }
  onLiq(lq) {
    this.liqList.push({ ...lq, usd: lq.p * lq.q });
    if (this.liqList.length > 3000) this.liqList.splice(0, 500);
    this.tape.push({ t: lq.t, p: lq.p, q: lq.q, usd: lq.p * lq.q, liq: lq.side });
    this.ui.tapeDirty = true;
  }

  liveUpdate() {
    if (!this.chartStore || this.chartStore.bars !== this.bars) { if (this.chartStore) this.fullRender(); return; }
    const n = this.bars.length;
    if (!n) return;
    const from = Math.max(0, Math.min(this._seriesLen ?? n, n) - 1);
    this.view = this.state.chartType === 'ha' ? heikinAshi(this.bars) : this.bars;
    for (const x of this.seriesData(this.view.slice(from))) this.series.update(x);
    this._seriesLen = n;
    this._recompute();
    this.ui.updateHeader();
    this.ui.renderTape();
  }

  onWake() {
    // nach Handy-Sperre: Lücke schließen
    if (!this.chartStore) return;
    const last = this.chartStore.last;
    if (last && Date.now() - last.t > 3 * U.tfMs(this.tf === '1M' ? '1W' : this.tf)) this.loadSymbol();
    else this.chartStore.resyncTail(5).then(() => this.fullRender()).catch(() => {});
  }

  // ---------------------------------------------------------------- Zusatzdaten (OI, Funding, 1m für HVB)
  async refreshExt(force) {
    const need = (t) => this.state.indicators.some(x => x.type === t);
    const m = this.market, inst = m.inst(this.state.base), tf = this.tf, seq = this.loadSeq;
    const from = this.bars[0]?.t;
    if (need('oi') && m.oi && m.ad.fetchOI && (force || !this.ext.oi || Date.now() - this.ext.oi.at > 110000)) {
      try {
        const r = await m.ad.fetchOI(inst, tf, { startTime: from });
        if (seq === this.loadSeq) { this.ext.oi = { ...r, at: Date.now() }; this._recompute(); }
      } catch (e) { console.warn('OI', e); }
    }
    if (need('funding') && m.funding && m.ad.fetchFunding) {
      try {
        if (force || !this.ext.funding || Date.now() - this.ext.funding.at > 30 * 60000) {
          const pts = await m.ad.fetchFunding(inst, { startTime: from });
          if (seq === this.loadSeq) this.ext.funding = { points: pts, at: Date.now(), live: this.ext.funding?.live };
        }
        const live = await m.ad.fetchPremium(inst).catch(() => null);
        if (seq === this.loadSeq && this.ext.funding) { this.ext.funding.live = live; this._recompute(); }
      } catch (e) { console.warn('Funding', e); }
    }
  }

  fineBars(t0, t1, live) {
    const st = this.hub.stores.get(`${this.state.market}|${this.state.base}|1m`);
    if (st && st.bars.length && st.bars[0].t <= t0) {
      const i = U.lowerBound(st.bars, t0);
      return st.bars.slice(i, U.lowerBound(st.bars, t1));
    }
    const c = this.fine.get(t0);
    if (c && c !== 'pending') return c;
    if (!c) { this.fine.set(t0, 'pending'); this.fineQueue.push([t0, t1]); this._pumpFine(); }
    return null;
  }
  async _pumpFine() {
    if (this._finePumping) return;
    this._finePumping = true;
    const seq = this.loadSeq;
    try {
      while (this.fineQueue.length && seq === this.loadSeq) {
        const batch = this.fineQueue.splice(-2);
        await Promise.all(batch.map(async ([t0, t1]) => {
          try {
            const n = Math.max(1, Math.round((t1 - t0) / U.MIN));
            const bars = await fetchBars(this.state.market, this.state.base, '1m', { endTime: t1 - 1, count: n });
            this.fine.set(t0, bars.filter(b => b.t >= t0 && b.t < t1));
          } catch { this.fine.delete(t0); }
        }));
        this._recompute();
        await U.sleep(120);
      }
    } finally { this._finePumping = false; }
  }

  /** Speicher anderer Börsen (für „Daten von“) per REST auffrischen. */
  refreshFeeds() {
    if (document.visibilityState !== 'visible') return;
    const { market: mk, base } = this.state;
    const list = [...this.hub.stores.values()].filter(s => s.base === base && s.marketId !== mk && s.bars.length);
    if (!list.length) return;
    (async () => {
      for (const s of list) { try { await s.resyncTail(3); } catch { /* später */ } await U.sleep(200); }
      this._recompute();
    })();
  }

  // ---------------------------------------------------------------- TPO-Chart: Profile zusammenfügen / teilen (wie MMT)
  tpoEdits() {
    const k = `${this.state.market}|${this.state.base}`;
    const e = this.state.tpoEdits?.[k];
    return e ? { merges: e.merges || [], splits: e.splits || [] } : { merges: [], splits: [] };
  }
  setTpoEdits(e) {
    const k = `${this.state.market}|${this.state.base}`;
    this.state.tpoEdits = { ...(this.state.tpoEdits || {}), [k]: { merges: e.merges, splits: e.splits } };
    if (!e.merges.length && !e.splits.length) delete this.state.tpoEdits[k];
    this._save();
    this.recompute(true);
    this.ui.renderTpoBar();
  }
  tpoLabel(s) {
    const day = (t) => { const x = this.sess.of(t) || this.sess.last(t); return U.fmtDayLabel(x ? x[2] : t); };
    const sx = this.sess.of(s.start);
    const t = (x) => U.fmtTime(x, this.tz);
    if (s.merged) return `${day(s.start)}–${day(s.end - 1)}`;
    if (sx && (s.start !== sx[0] || s.end !== sx[1])) return `${day(s.start)} ${t(s.start)}–${t(s.end)}`;
    return day(s.start);
  }
  tpoSessionAt(i) { return (this.tpoSessions || []).find(s => i >= s.first && i < s.first + s.n) || null; }
  selectTpo(i) {
    const s = i == null ? null : this.tpoSessionAt(i);
    this.tpoSel = s && this.tpoSel !== s.start ? s.start : null;
    this.tpoClickT = s ? this.bars[Math.max(0, Math.min(this.bars.length - 1, i))].t : null;
    this.ui.renderTpoBar();
    this.recompute(true);
  }
  mergeTpo(dir) {
    const list = this.tpoSessions || [];
    const k = list.findIndex(s => s.start === this.tpoSel);
    const nb = list[k + dir];
    if (k < 0 || !nb) { this.ui.toast('Kein ' + (dir < 0 ? 'vorheriges' : 'nächstes') + ' Profil', 'info', 1800); return; }
    const a = list[k];
    let lo = Math.min(a.start, nb.start), hi = Math.max(a.end, nb.end);
    const e = this.tpoEdits();
    const keep = [];
    for (const m of e.merges) { if (m[1] > lo && m[0] < hi) { lo = Math.min(lo, m[0]); hi = Math.max(hi, m[1]); } else keep.push(m); }
    keep.push([lo, hi]);
    this.tpoSel = lo;
    this.setTpoEdits({ merges: keep, splits: e.splits });
  }
  unmergeTpo() {
    const e = this.tpoEdits();
    const merges = e.merges.filter(m => m[0] !== this.tpoSel);
    if (merges.length === e.merges.length) { this.ui.toast('Dieses Profil ist nicht zusammengefügt', 'info', 1800); return; }
    this.setTpoEdits({ merges, splits: e.splits });
  }
  splitTpo() {
    const t = this.tpoClickT;
    const s = (this.tpoSessions || []).find(x => x.start === this.tpoSel);
    if (t == null || !s || t <= s.start) { this.ui.toast('Tippe zuerst auf die Stelle im Profil, an der geteilt werden soll', 'info', 2500); return; }
    const q = Math.floor(t / this.tpoBlockMs) * this.tpoBlockMs;
    const e = this.tpoEdits();
    const merges = [];
    for (const m of e.merges) { if (q > m[0] && q < m[1]) { merges.push([m[0], q], [q, m[1]]); } else merges.push(m); }
    const sx = this.sess.of(q);
    const inDay = sx && q > sx[0];
    const splits = inDay && !e.splits.includes(q) ? [...e.splits, q] : e.splits;
    this.tpoSel = q;
    this.setTpoEdits({ merges: merges.filter(m => m[1] > m[0]), splits });
  }
  resetTpoEdits() { this.tpoSel = null; this.setTpoEdits({ merges: [], splits: [] }); }

  // ---------------------------------------------------------------- Indikatoren verwalten
  addIndicator(type, opts = {}) {
    const T = TYPES[type];
    if (!T) return;
    const ex = this.state.indicators.find(x => x.type === type);
    if (ex && !T.multi) { ex.visible = true; this.afterIndicatorChange(); return ex; }
    const mine = this.state.myDefaults?.[type];
    const ind = { uid: U.uid(), type, visible: true, s: Object.assign(U.deepClone(T.defaults), mine ? U.mergeDefaults(T.defaults, mine) : {}, opts) };
    this.state.indicators.push(ind);
    this.afterIndicatorChange(true);
    return ind;
  }
  removeIndicator(uid) {
    this.state.indicators = this.state.indicators.filter(x => x.uid !== uid);
    this.removePane(uid);
    this.data.delete(uid);
    this.afterIndicatorChange();
  }
  /** Sichtbarkeit je Zeiteinheit (Reiter „Sichtbarkeit“ wie bei TradingView). */
  visOnTf(ind) {
    const v = ind.vis;
    if (!v) return true;
    const tf = this.state.tf;
    const cls = /m$/.test(tf) ? 'min' : /h$/.test(tf) ? 'hour' : tf === '1D' ? 'day' : 'week';
    return v[cls] !== false;
  }
  toggleIndicator(uid) {
    const x = this.state.indicators.find(i => i.uid === uid);
    if (x) { x.visible = !x.visible; this.afterIndicatorChange(); }
  }
  updateIndicator(uid, s) {
    const x = this.state.indicators.find(i => i.uid === uid);
    if (!x) return;
    x.s = s;
    if (TYPES[x.type].pane === 'own') this.removePane(uid);
    this.afterIndicatorChange(true);
  }
  /** Vorlage wechseln. Der Stand der bisherigen Vorlage wird gemerkt und beim Zurückwechseln wiederhergestellt. */
  applyTemplate(key) {
    const st = this.state;
    st.tplState ||= {};
    const prev = st.template;
    if (prev) st.tplState[prev] = U.deepClone(st.indicators);
    for (const uid of [...this.panes.keys()]) this.removePane(uid);
    st.template = key;
    const user = (st.userTpls || []).find(t => t.id === key);
    const saved = st.tplState[key];
    const fix = (list) => list.filter(x => TYPES[x.type]).map(x => ({ ...x, uid: x.uid || U.uid(), s: U.mergeDefaults(TYPES[x.type].defaults, x.s) }));
    if (saved) st.indicators = fix(U.deepClone(saved));
    else if (user) st.indicators = fix(U.deepClone(user.list)).map(x => ({ ...x, uid: U.uid() }));
    else st.indicators = this.templateIndicators(key);
    this.afterIndicatorChange(true);
    const chartOf = (k) => (st.userTpls || []).find(t => t.id === k)?.chart || TEMPLATES[k]?.chart || null;
    if (chartOf(key) === 'tpo' && !this.isTpo) this.setChartType('tpo');
    else if (chartOf(prev) === 'tpo' && chartOf(key) !== 'tpo' && this.isTpo) this.toggleTpo();
  }
  /** Aktuelle Indikatoren als eigene Vorlage sichern (oder eine eigene Vorlage überschreiben). */
  saveUserTemplate(name, id = null) {
    const st = this.state;
    st.userTpls ||= [];
    const list = U.deepClone(st.indicators);
    let t = id && st.userTpls.find(x => x.id === id);
    if (t) { t.list = list; t.name = name || t.name; t.chart = this.isTpo ? 'tpo' : null; }
    else { t = { id: 'u' + U.uid(), name: name || 'Meine Vorlage', list, chart: this.isTpo ? 'tpo' : null }; st.userTpls.push(t); }
    st.tplState ||= {};
    delete st.tplState[t.id];
    st.template = t.id;
    this._save();
    this.ui.renderAll();
    return t;
  }
  deleteUserTemplate(id) {
    const st = this.state;
    st.userTpls = (st.userTpls || []).filter(t => t.id !== id);
    if (st.tplState) delete st.tplState[id];
    if (st.template === id) st.template = null;
    this._save();
  }
  /** Aktuelle Vorlage auf den Ursprung zurücksetzen (eigene Vorlage: gespeicherter Stand, sonst Werkseinstellung). */
  resetTemplate() {
    const st = this.state;
    const key = st.template || 'bild';
    if (st.tplState) delete st.tplState[key];
    st.template = null;
    this.applyTemplate(key);
    if (st.tplState) delete st.tplState[key];
  }
  templateName(key = this.state.template) {
    return (this.state.userTpls || []).find(t => t.id === key)?.name || TEMPLATES[key]?.name || 'Eigene Einstellungen';
  }
  afterIndicatorChange(needData = false) {
    this._save();
    this.syncBigTrades();
    this.ui.renderTopbar();
    this.ui.renderMobile();
    this.ui.renderLegend();
    this.recompute();
    if (needData) { this.ensureNeeds().then(() => this.refreshExt(true)); }
  }

  // ---------------------------------------------------------------- Symbol / Zeiteinheit
  setSymbol(base, market) {
    const patch = { base };
    if (market) patch.market = market;
    this.setState(patch, { reload: true });
  }
  setTf(tf) {
    if (tf === this.state.tf) return;
    const patch = { tf };
    if (this.isTpo) {
      if (TPO_BLOCKS.includes(tf)) patch.tpo = { ...this.state.tpo, block: tf };
      else { patch.chartType = 'candles'; this.ui.toast('TPO gibt es mit 5, 15, 30 oder 60 Min. pro Buchstabe – zurück zu Kerzen', 'info', 3000); }
    }
    this.setState(patch, { reload: true });
  }
  setChartType(t) {
    const wasTpo = this.isTpo;
    if (t === 'tpo' && !wasTpo) { this.state.lastType = this.state.chartType; this.state.lastTf = this.state.tf; }
    this.state.chartType = t;
    this._save();
    // TPO nutzt immer die eingestellte TPO-Periode (Standard 30 Min. wie ATAS)
    if (t === 'tpo' && this.state.tf !== this.state.tpo.block) { this.state.tf = this.state.tpo.block; this._save(); this.ui.renderAll(); this.loadSymbol(); return; }
    this.view = this.makeView(); this.makeMainSeries(); this.applySpacing(); this.ui.renderAll();
    if (t === 'tpo' || wasTpo) this.recompute(true);
  }
  /** Big Trades: Historie/Live nur, wenn der Indikator da ist; anderes Symbol → neu. */
  syncBigTrades() {
    const ind = this.state.indicators.find(x => x.type === 'bigtrades' && x.visible);
    const key = `${this.state.market}|${this.state.base}`;
    if (ind && this.bars.length) {
      this.bt.start(this.state.market, this.state.base, this.autoBigUsd() / 4);
      const r = this.chart.timeScale().getVisibleLogicalRange();
      const i = r ? Math.max(0, Math.min(this.bars.length - 1, Math.floor(r.from))) : Math.max(0, this.bars.length - 100);
      this.bt.want(this.bars[i].t, this.btHours());
    } else if (this.bt.active && this.bt.key !== key) this.bt.stop();
  }
  btHours() { const ind = this.state.indicators.find(x => x.type === 'bigtrades'); return ind ? ind.s.hours : 0; }
  /** TPO-Knopf: TPO im Kerzenchart ein/aus. Im eigenen TPO-Chart: zurück zum vorherigen Charttyp und zur vorherigen Zeiteinheit. */
  toggleTpo() {
    if (!this.isTpo) {
      const ind = this.state.indicators.find(x => x.type === 'tpo');
      if (ind) this.toggleIndicator(ind.uid); else this.addIndicator('tpo');
      return;
    }
    const tf = this.state.lastTf;
    this.state.lastTf = null;
    const back = this.state.lastType && this.state.lastType !== 'tpo' ? this.state.lastType : 'candles';
    if (tf && tf !== this.state.tf) { this.state.chartType = back; this.state.tf = tf; this._save(); this.ui.renderAll(); this.loadSymbol(); }
    else this.setChartType(back);
  }
  get tpoOverlayOn() { return this.isTpo || this.state.indicators.some(x => x.type === 'tpo' && x.visible); }
  setTpo(patch) {
    const block = patch.block && patch.block !== this.state.tpo.block ? patch.block : null;
    this.state.tpo = { ...this.state.tpo, ...patch };
    this._save();
    if (block) { this.state.tf = block; this._save(); this.loadSymbol(); return; }
    this.recompute(true);
    this.ui.renderLegend();
  }
  /** Kerzenabstand: TPO braucht breite Spalten für die Buchstaben, rechts Platz bis Tagesende. */
  applySpacing() {
    const ts = this.chart.timeScale();
    if (this.isTpo) {
      const perDay = Math.round(U.DAY / this.tpoBlockMs);
      const last = this.bars[this.bars.length - 1];
      const sx = last ? this.sess.last(last.t) : null;
      const s0 = sx ? sx[0] : (last ? U.periodStart(last.t, 'day', this.offset) : 0);
      const done = last ? Math.floor((last.t - s0) / this.tpoBlockMs) + 1 : 0;
      ts.applyOptions({ barSpacing: this.ui.mobile ? 7 : 10, rightOffset: Math.max(6, Math.min(perDay + 2, perDay - done + 3)), minBarSpacing: 0.5 });
      // Ansicht: aktuelle Session ganz (Desktop zusätzlich die vorherige)
      if (last) {
        const start = U.lowerBound(this.bars, s0);
        requestAnimationFrame(() => ts.setVisibleLogicalRange({ from: start - (this.ui.mobile ? 1.5 : perDay + 1), to: start + perDay + 1.5 }));
      }
    } else ts.applyOptions({ barSpacing: 7, rightOffset: 12 });
  }
  setTheme(theme) { this.state.theme = theme; this._save(); this.applyTheme(); this.ui.renderAll(); }

  /** Zeitraum-Knöpfe unten (wie TradingView: Zeitraum + passende Zeiteinheit). */
  async setRange(key) {
    const map = { '1D': ['1m', U.DAY], '5D': ['5m', 5 * U.DAY], '1M': ['30m', 30 * U.DAY], '3M': ['1h', 91 * U.DAY], '6M': ['2h', 182 * U.DAY], '1Y': ['1D', 365 * U.DAY], 'ALL': ['1W', 0] };
    const [tf, span] = map[key];
    if (tf !== this.state.tf) { this.state.tf = tf; this._save(); await this.loadSymbol(); }
    const now = Date.now();
    if (span) {
      await this.chartStore.ensureFrom(now - span);
      this.fullRender();
      const from = U.lowerBound(this.bars, now - span);
      this.chart.timeScale().setVisibleLogicalRange({ from, to: this.bars.length + 5 });
    } else this.chart.timeScale().fitContent();
  }

  screenshot() {
    const c = this.chart.takeScreenshot(true, false);
    const out = document.createElement('canvas');
    out.width = c.width; out.height = c.height + 44;
    const g = out.getContext('2d');
    g.fillStyle = this.theme.bg; g.fillRect(0, 0, out.width, out.height);
    g.drawImage(c, 0, 44);
    g.fillStyle = this.theme.text; g.font = '600 18px -apple-system, Segoe UI, Roboto, sans-serif';
    const last = this.bars[this.bars.length - 1];
    g.fillText(`${this.market.ticker(this.state.base)} · ${this.tf} · ${this.market.label}   ${last ? this.fmt(last.c) : ''}`, 14, 28);
    g.font = '13px -apple-system, Segoe UI, Roboto, sans-serif';
    g.textAlign = 'right';
    g.fillText(`TQI Charts · ${U.fmtDateTime(Date.now(), this.tz)}`, out.width - 14, 28);
    out.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `TQI_${this.state.base}_${this.tf}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  }

  _debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
}
