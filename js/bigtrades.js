// Big Trades wie ATAS: große Marktorders als Blasen. Eine Marktorder = alle Trades mit gleicher Zeit und Seite
// (Binance aggTrades einer Order über mehrere Preise haben denselben Zeitstempel).
// Live aus dem Trade-Stream ab Start (boundary), ältere per REST rückwärts, im Browser gespeichert (48 Std.).
import { MARKETS } from './exchanges.js';
import { Emitter, sleep, storage } from './util.js';

const KEEP_HOURS = 48;
const keyOf = (t, buy) => t * 2 + (buy ? 1 : 0);

export class BigTrades extends Emitter {
  constructor() {
    super();
    this.key = null;
    this.list = [];
    this.keys = new Set();
  }
  get active() { return !!this.key; }
  get storeKey() { return 'tqi-charts:big:' + this.key; }

  /** keepUsd = ab dieser Größe merken (der Anzeige-Filter liegt meist darüber). */
  start(marketId, base, keepUsd) {
    const key = `${marketId}|${base}`;
    if (this.key === key) { this.keepUsd = Math.min(this.keepUsd, keepUsd); return; }
    this.save();
    Object.assign(this, { key, marketId, base, keepUsd });
    this.list = []; this.keys = new Set(); this.pending = null; this.edge = new Map(); this.sorted = true;
    this.boundary = Date.now(); this.histFrom = this.boundary; this.target = this.boundary;
    this.iter = null; this.loading = false; this.done = false; this.limited = false; this.error = null;
    const saved = storage.get(this.storeKey, null);
    if (saved && Array.isArray(saved.l)) for (const [t, p, q, b] of saved.l) if (t < this.boundary) this._push({ t, p, q, buy: !!b, usd: p * q });
    this.emit('change');
  }
  stop() { this.save(); this.key = null; this.list = []; this.keys = new Set(); this.iter = null; this.pending = null; }
  save() {
    if (!this.key) return;
    const cut = Date.now() - KEEP_HOURS * 3600e3;
    const l = this._sorted().filter(x => x.t >= cut).slice(-8000).map(x => [x.t, +x.p.toPrecision(8), +x.q.toPrecision(6), x.buy ? 1 : 0]);
    storage.set(this.storeKey, { v: 1, l });
  }
  _push(o) {
    const k = keyOf(o.t, o.buy);
    if (this.keys.has(k)) return false;
    this.keys.add(k);
    const last = this.list[this.list.length - 1];
    if (last && last.t > o.t) this.sorted = false;
    this.list.push(o);
    return true;
  }
  _sorted() {
    if (!this.sorted) { this.list.sort((a, b) => a.t - b.t); this.sorted = true; }
    return this.list;
  }

  /** Live-Trade (einzelner aggTrade). Gleiche Zeit + Seite wie der vorige → gleiche Marktorder. */
  onTrade(tr) {
    if (!this.key || tr.t < this.boundary) return;
    const pd = this.pending;
    if (pd && pd.t === tr.t && pd.buy === tr.buy) { pd.q += tr.q; pd.usd += tr.p * tr.q; pd.p = pd.usd / pd.q; return; }
    if (pd && pd.usd >= this.keepUsd && this._push({ t: pd.t, p: pd.p, q: pd.q, buy: pd.buy, usd: pd.usd })) this.emit('change');
    this.pending = { t: tr.t, buy: tr.buy, q: tr.q, usd: tr.p * tr.q, p: tr.p };
    if (this.pending.usd >= this.keepUsd) this.emit('change');
  }

  /** Alle Orders ab minUsd (inkl. der gerade laufenden). */
  orders(minUsd) {
    const out = this._sorted().filter(x => x.usd >= minUsd);
    const pd = this.pending;
    if (pd && pd.usd >= minUsd) out.push({ ...pd });
    return out;
  }

  /** Historie bis Zeitpunkt t laden (max. maxHours vor Start). */
  want(t, maxHours = 4) {
    if (!this.key) return;
    const tt = Math.max(t, this.boundary - maxHours * 3600e3);
    if (tt < this.target) this.target = tt;
    this._pump();
  }

  async _pump() {
    if (this.loading || this.done || !this.key || this.histFrom <= this.target) return;
    const m = MARKETS[this.marketId];
    if (!m.ad.tradeHistory) { this.done = true; this.limited = true; this.emit('change'); return; }
    const key = this.key;
    this.loading = true; this.error = null;
    try {
      if (!this.iter) this.iter = m.ad.tradeHistory(m.inst(this.base));
      while (this.key === key && this.histFrom > this.target) {
        if (document.visibilityState !== 'visible') { await sleep(1000); continue; }
        const r = await this.iter.next();
        if (this.key !== key) return;
        if (r.done) { this.done = true; break; }
        const page = r.value;
        const local = new Map();
        let minT = Infinity;
        for (const tr of page.trades) {
          if (!(tr.t < this.boundary) || !(tr.p > 0) || !(tr.q > 0)) continue;
          const k = keyOf(tr.t, tr.buy);
          let o = local.get(k);
          if (!o) { o = { t: tr.t, buy: tr.buy, q: 0, usd: 0 }; local.set(k, o); }
          o.q += tr.q; o.usd += tr.p * tr.q;
          if (tr.t < minT) minT = tr.t;
        }
        // Orders an der Seitengrenze können auf zwei Seiten verteilt sein → zusammenführen
        for (const [k, o] of this.edge) { const x = local.get(k); if (x) { x.q += o.q; x.usd += o.usd; } else this._hist(o); }
        this.edge = new Map();
        for (const [k, o] of local) { if (o.t === minT) this.edge.set(k, o); else this._hist(o); }
        if (minT < this.histFrom) this.histFrom = minT;
        if (page.limited) { this.limited = true; this.done = true; }
        this.emit('change');
        if (page.limited) break;
        if (page.pace) await sleep(page.pace);
      }
    } catch (e) {
      if (this.key === key) { this.error = e.message || String(e); console.warn('Big Trades Historie', e); }
    } finally {
      if (this.key === key) {
        if (this.done) { for (const o of this.edge.values()) this._hist(o); this.edge = new Map(); }
        this.loading = false; this.emit('change');
      }
    }
  }
  _hist(o) { if (o.usd >= this.keepUsd && o.q > 0) this._push({ t: o.t, p: o.usd / o.q, q: o.q, buy: o.buy, usd: o.usd }); }

  info() {
    if (!this.key) return '';
    const mins = Math.round((this.boundary - this.histFrom) / 60000);
    const span = mins >= 90 ? `${(mins / 60).toFixed(1).replace('.', ',')} Std.` : `${mins} Min.`;
    if (this.error) return `Historie: Fehler · live`;
    if (this.limited) return `Historie ${span} (Börse liefert nur letzte Trades) · live`;
    if (this.loading) return `lädt Historie … ${span}`;
    return `Historie ${span} · live`;
  }
}
