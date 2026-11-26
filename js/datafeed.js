// Kerzen-Speicher je (Markt, Coin, Zeiteinheit) + Live-Daten (Trades) für alle Speicher eines Symbols.
import { MARKETS, fetchBars } from './exchanges.js';
import { Emitter, floorTf, tfMs, sleep } from './util.js';

export class BarStore extends Emitter {
  constructor(marketId, base, tf) {
    super();
    this.marketId = marketId; this.base = base; this.tf = tf;
    this.bars = [];
    this.done = false;       // keine ältere Historie mehr
    this._busy = Promise.resolve();
    this.version = 0;        // steigt bei jeder Änderung
    this.lastResync = 0;
  }
  get key() { return `${this.marketId}|${this.base}|${this.tf}`; }
  get last() { return this.bars[this.bars.length - 1]; }

  _queue(fn) {
    const p = this._busy.then(fn, fn);
    this._busy = p.catch(() => {});
    return p;
  }

  /** Neueste Kerzen laden (mindestens count). */
  loadLatest(count = 1000) {
    return this._queue(async () => {
      if (this.bars.length >= count && Date.now() - this.lastResync < 60000) return this.bars;
      const fresh = await fetchBars(this.marketId, this.base, this.tf, { count });
      this._merge(fresh);
      if (fresh.length < count * 0.5) this.done = true;
      this.lastResync = Date.now();
      return this.bars;
    });
  }

  /** Ältere Kerzen nachladen. Gibt Anzahl neuer Kerzen zurück. */
  loadOlder(count = 1000) {
    return this._queue(async () => {
      if (this.done || !this.bars.length) return 0;
      const end = this.bars[0].t - 1;
      const older = await fetchBars(this.marketId, this.base, this.tf, { endTime: end, count });
      const firstBefore = this.bars[0].t;
      const add = older.filter(b => b.t < firstBefore);
      if (!add.length) { this.done = true; return 0; }
      this.bars = add.concat(this.bars);
      if (add.length < count * 0.5) this.done = true;
      this.version++;
      this.emit('change', 'older');
      return add.length;
    });
  }

  /** Sicherstellen, dass die Historie bis mindestens t zurückreicht. */
  async ensureFrom(t, maxBars = 60000) {
    let guard = 0;
    while (this.bars.length && this.bars[0].t > t && !this.done && this.bars.length < maxBars && guard++ < 60) {
      const need = Math.ceil((this.bars[0].t - t) / tfMs(this.tf)) + 2;
      const n = await this.loadOlder(Math.min(Math.max(need, 200), 5000));
      if (!n) break;
    }
    return this.bars;
  }

  /** Letzte Kerzen per REST abgleichen (korrigiert verpasste Trades). */
  resyncTail(n = 3) {
    return this._queue(async () => {
      if (!this.bars.length) return;
      const fresh = await fetchBars(this.marketId, this.base, this.tf, { count: n });
      this._merge(fresh, true);
      this.lastResync = Date.now();
    });
  }

  _merge(fresh, keepLiveDelta = false) {
    if (!fresh.length) return;
    const gap = this.tf === '1M' ? 32 * 864e5 : tfMs(this.tf) * 1.5;
    if (!this.bars.length || fresh[0].t > this.bars[this.bars.length - 1].t + gap) {
      // leer oder Lücke zum alten Stand: komplett ersetzen
      this.bars = fresh.slice(); this.done = false; this.version++; this.emit('change', 'load'); return;
    }
    const first = fresh[0].t;
    // ab first ersetzen
    let i = this.bars.length - 1;
    while (i >= 0 && this.bars[i].t >= first) i--;
    const keep = this.bars.slice(0, i + 1);
    const old = new Map(this.bars.slice(i + 1).map(b => [b.t, b]));
    const merged = fresh.map(b => {
      const o = old.get(b.t);
      if (keepLiveDelta && o && !Number.isFinite(b.bv) && Number.isFinite(o.bv)) return { ...b, bv: Math.min(o.bv, b.v) };
      return b;
    });
    // Live-Kerzen, die neuer sind als der REST-Stand, behalten
    const lastFresh = fresh[fresh.length - 1].t;
    const newer = this.bars.filter(b => b.t > lastFresh);
    this.bars = keep.concat(merged, newer);
    this.version++;
    this.emit('change', 'merge');
  }

  /** Einen Trade einarbeiten. tr = {t, p, q, buy}. */
  applyTrade(tr) {
    const n = this.bars.length;
    if (!n) return false;
    const last = this.bars[n - 1];
    const bt = floorTf(tr.t, this.tf);
    if (bt < last.t) return false;
    if (bt === last.t) {
      if (tr.p > last.h) last.h = tr.p;
      if (tr.p < last.l) last.l = tr.p;
      last.c = tr.p;
      last.v += tr.q;
      if (tr.buy) last.bv = (Number.isFinite(last.bv) ? last.bv : 0) + tr.q;
      else if (!Number.isFinite(last.bv)) last.bv = 0;
    } else {
      this.bars.push({ t: bt, o: tr.p, h: tr.p, l: tr.p, c: tr.p, v: tr.q, bv: tr.buy ? tr.q : 0, live: true });
    }
    this.version++;
    return true;
  }
}

/** Hält alle Speicher und die Live-Verbindung für das aktive Symbol. */
export class DataHub extends Emitter {
  constructor() {
    super();
    this.stores = new Map();
    this.sock = null;
    this.liveKey = null;
    this.status = 'off';
    this._resyncTimer = 0;
  }
  store(marketId, base, tf) {
    const k = `${marketId}|${base}|${tf}`;
    let s = this.stores.get(k);
    if (!s) { s = new BarStore(marketId, base, tf); this.stores.set(k, s); }
    return s;
  }
  storesFor(marketId, base) {
    const p = `${marketId}|${base}|`;
    return [...this.stores.values()].filter(s => s.key.startsWith(p));
  }
  /** Speicher anderer Coins wegwerfen (Speicher sparen). Andere Börsen desselben Coins bleiben (Indikator-Daten). */
  prune(marketId, base) {
    for (const k of [...this.stores.keys()]) if (k.split('|')[1] !== base) this.stores.delete(k);
  }

  startLive(marketId, base, chartTf) {
    const key = `${marketId}|${base}`;
    this.chartTf = chartTf;
    if (this.liveKey === key && this.sock) return;
    this.stopLive();
    this.liveKey = key;
    const m = MARKETS[marketId];
    const inst = m.inst(base);
    this.sock = m.ad.tradeSocket(inst,
      (tr) => this._onTrade(marketId, base, tr),
      (st) => {
        const was = this.status;
        this.status = st; this.emit('status', st);
        if (st === 'live' && was !== 'live') this._resyncAll(marketId, base, true);
      },
      m.liq ? (lq) => this.emit('liq', lq) : null);
    clearInterval(this._resyncTimer);
    let tick = 0;
    this._resyncTimer = setInterval(() => {
      tick++;
      if (document.visibilityState !== 'visible') return;
      const chart = this.store(marketId, base, this.chartTf);
      if (chart.bars.length) chart.resyncTail(3).then(() => this.emit('resync', chart)).catch(() => {});
      if (tick % 4 === 0) this._resyncAll(marketId, base, false);
    }, 20000);
  }
  async _resyncAll(marketId, base, includeChart) {
    for (const s of this.storesFor(marketId, base)) {
      if (!s.bars.length) continue;
      if (!includeChart && s.tf === this.chartTf) continue;
      try { await s.resyncTail(3); this.emit('resync', s); } catch { /* nächster Versuch später */ }
      await sleep(150);
    }
  }
  _onTrade(marketId, base, tr) {
    if (this.liveKey !== `${marketId}|${base}`) return;
    if (!(tr.p > 0) || !(tr.q >= 0)) return;
    // Schutz vor Ausreißern (falsche Ticks): mehr als 20 % vom letzten Kurs weg → ignorieren
    const ref = this.store(marketId, base, this.chartTf).last;
    if (ref && Math.abs(tr.p / ref.c - 1) > 0.2) return;
    for (const s of this.storesFor(marketId, base)) s.applyTrade(tr);
    this.emit('trade', tr);
  }
  stopLive() {
    clearInterval(this._resyncTimer);
    if (this.sock) this.sock.stop();
    this.sock = null; this.liveKey = null;
    this.status = 'off'; this.emit('status', 'off');
  }
}
