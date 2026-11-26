// Börsen-Adapter: Kerzen (REST), Live-Trades, Orderbuch, Open Interest, Funding, Ticker.
// Nur öffentliche Endpunkte, direkt aus dem Browser (CORS). Kein Schlüssel nötig.
import { MIN, HOUR, DAY, tfMinutes, floorTf, sleep } from './util.js';

// ---------------------------------------------------------------- HTTP (mit Begrenzung je Börse)
const LIMITS = { 'www.okx.com': { conc: 3, gap: 120 }, 'api.exchange.coinbase.com': { conc: 3, gap: 140 }, 'api.bybit.com': { conc: 6, gap: 20 } };
const hostState = new Map();
async function slot(host) {
  const L = LIMITS[host] || { conc: 8, gap: 0 };
  let st = hostState.get(host);
  if (!st) { st = { active: 0, queue: [], last: 0 }; hostState.set(host, st); }
  while (st.active >= L.conc) await new Promise(r => st.queue.push(r));
  st.active++;
  const wait = st.last + L.gap - Date.now();
  st.last = Math.max(Date.now(), st.last + L.gap);
  if (wait > 0) await sleep(wait);
  return () => { st.active--; const n = st.queue.shift(); if (n) n(); };
}
async function getJson(url, { timeout = 15000, retries = 1 } = {}) {
  let lastErr;
  const host = new URL(url).host;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const release = await slot(host);
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      const txt = await r.text();
      let j;
      try { j = JSON.parse(txt); } catch { j = null; }
      if (!r.ok) {
        const msg = (j && (j.msg || j.retMsg || j.message)) || `HTTP ${r.status}`;
        const err = new Error(msg);
        err.status = r.status;
        if (r.status === 429 || r.status >= 500) { lastErr = err; await sleep(800 * (attempt + 1)); continue; }
        throw err;
      }
      if (j == null) throw new Error('Ungültige Antwort');
      return j;
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error('Zeitüberschreitung') : e;
      if (e.status && e.status < 500 && e.status !== 429) throw lastErr;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timer);
      release();
    }
  }
  throw lastErr;
}
const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

// ---------------------------------------------------------------- WebSocket mit automatischem Neuverbinden
export class LiveSocket {
  constructor({ url, onOpen, onMessage, onStatus, ping, name = 'ws' }) {
    Object.assign(this, { url, onOpen, onMessage, onStatus, ping, name });
    this.ws = null; this.stopped = true; this.retry = 0; this.pingTimer = 0; this.reTimer = 0; this.lastMsg = 0;
    this._vis = () => { if (document.visibilityState === 'visible' && !this.stopped) this._checkAlive(); };
  }
  start() {
    this.stopped = false;
    document.addEventListener('visibilitychange', this._vis);
    this._connect();
    return this;
  }
  stop() {
    this.stopped = true;
    document.removeEventListener('visibilitychange', this._vis);
    clearInterval(this.pingTimer); clearTimeout(this.reTimer);
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch { /* egal */ } }
    this.ws = null;
    this.onStatus?.('off');
  }
  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }
  _checkAlive() {
    // nach dem Aufwachen (Handy) hängt die Verbindung oft: neu verbinden, wenn lange nichts kam
    if (!this.ws || this.ws.readyState > 1 || Date.now() - this.lastMsg > 30000) this._reconnectNow();
  }
  _reconnectNow() {
    clearTimeout(this.reTimer);
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch { /* egal */ } }
    this.ws = null; this.retry = 0;
    this._connect();
  }
  _connect() {
    if (this.stopped) return;
    this.onStatus?.('connecting');
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this._schedule(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0; this.lastMsg = Date.now();
      this.onStatus?.('live');
      try { this.onOpen?.(this); } catch (e) { console.error(e); }
      clearInterval(this.pingTimer);
      if (this.ping) this.pingTimer = setInterval(() => this.send(this.ping.data), this.ping.ms);
    };
    ws.onmessage = (ev) => {
      this.lastMsg = Date.now();
      let m = ev.data;
      if (typeof m === 'string' && (m[0] === '{' || m[0] === '[')) { try { m = JSON.parse(m); } catch { return; } }
      try { this.onMessage?.(m, this); } catch (e) { console.error(e); }
    };
    ws.onerror = () => { /* onclose folgt */ };
    ws.onclose = () => { clearInterval(this.pingTimer); this.onStatus?.('reconnecting'); this._schedule(); };
  }
  _schedule() {
    if (this.stopped) return;
    const ms = Math.min(30000, 1000 * Math.pow(1.8, this.retry++));
    clearTimeout(this.reTimer);
    this.reTimer = setTimeout(() => this._connect(), ms);
  }
}

// ---------------------------------------------------------------- Hilfen
function aggregate(bars, tf) {
  const out = [];
  let cur = null;
  for (const b of bars) {
    const t = floorTf(b.t, tf);
    if (!cur || cur.t !== t) {
      cur = { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, bv: b.bv };
      out.push(cur);
    } else {
      if (b.h > cur.h) cur.h = b.h;
      if (b.l < cur.l) cur.l = b.l;
      cur.c = b.c; cur.v += b.v; cur.bv += b.bv;
    }
  }
  return out;
}
function dedupeSort(bars) {
  bars.sort((a, b) => a.t - b.t);
  const out = [];
  for (const b of bars) {
    if (out.length && out[out.length - 1].t === b.t) out[out.length - 1] = b; else out.push(b);
  }
  return out;
}

/**
 * Allgemeiner Abruf: liefert bis zu `count` Kerzen (aufsteigend) mit Start <= endTime.
 * Nicht unterstützte Zeiteinheiten werden aus einer kleineren nativen Zeiteinheit gebaut.
 */
async function fetchBarsGeneric(ad, symbol, tf, { endTime, count = 1000, startTime } = {}) {
  const native = ad.intervals[tf];
  let baseTf = tf, factor = 1;
  if (!native) {
    // größte native Zeiteinheit, die tf teilt
    const m = tfMinutes(tf);
    const cands = Object.keys(ad.intervals).filter(k => ad.intervals[k] && k !== '1M' && k !== '1W' && m % tfMinutes(k) === 0 && tfMinutes(k) < m)
      .sort((a, b) => tfMinutes(b) - tfMinutes(a));
    if (tf === '1M' || tf === '1W') { baseTf = ad.intervals['1D'] ? '1D' : cands[0]; }
    else baseTf = cands[0];
    if (!baseTf) throw new Error('Zeiteinheit nicht verfügbar');
    factor = Math.ceil(tf === '1M' ? 31 * 1440 / tfMinutes(baseTf) : m / tfMinutes(baseTf));
  }
  const want = count * factor + (factor > 1 ? factor : 0);
  let out = [];
  let end = endTime;
  let guard = 0;
  while (out.length < want && guard++ < 200) {
    const limit = Math.min(ad.maxLimit, want - out.length);
    const page = await ad.fetchPage(symbol, baseTf, { endTime: end, limit: Math.max(limit, 2) });
    if (!page.length) break;
    out = page.concat(out.filter(b => b.t > page[page.length - 1].t));
    if (startTime != null && page[0].t <= startTime) break;
    const nextEnd = page[0].t - 1;
    if (end != null && nextEnd >= end) break;
    end = nextEnd;
    if (page.length < Math.min(limit, ad.minFullPage ?? limit)) break; // keine ältere Historie
  }
  out = dedupeSort(out);
  if (baseTf !== tf) out = aggregate(out, tf);
  if (startTime != null) out = out.filter(b => b.t >= floorTf(startTime, tf));
  if (out.length > count && startTime == null) out = out.slice(out.length - count);
  return out;
}

// ---------------------------------------------------------------- Binance
const BINANCE_IV = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h', '1D': '1d', '1W': '1w', '1M': '1M' };
function parseBinanceKlines(arr) {
  return arr.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], bv: +k[9] }));
}
function binanceBase(perp) {
  return {
    intervals: BINANCE_IV,
    maxLimit: perp ? 1500 : 1000,
    hosts: perp ? ['https://fapi.binance.com'] : ['https://api.binance.com', 'https://data-api.binance.vision'],
    async fetchPage(symbol, tf, { endTime, limit }) {
      const path = perp ? '/fapi/v1/klines' : '/api/v3/klines';
      const q = qs({ symbol, interval: this.intervals[tf], limit, endTime });
      let err;
      for (const h of this.hosts) {
        try { return parseBinanceKlines(await getJson(`${h}${path}?${q}`)); } catch (e) { err = e; if (e.status === 400) break; }
      }
      throw err;
    },
    tradeSocket(symbol, onTrade, onStatus, onLiq) {
      const s = symbol.toLowerCase();
      const url = perp
        ? `wss://fstream.binance.com/market/stream?streams=${s}@aggTrade/${s}@forceOrder`
        : `wss://stream.binance.com:9443/ws/${s}@aggTrade`;
      return new LiveSocket({
        url, name: 'trades', onStatus,
        onMessage: (m) => {
          const d = m.data || m;
          if (d.e === 'aggTrade') onTrade({ t: +d.T, p: +d.p, q: +d.q, buy: !d.m });
          else if (d.e === 'forceOrder' && onLiq) {
            const o = d.o;
            // S = SELL → Long-Position liquidiert
            onLiq({ t: +o.T, p: +(o.ap || o.p), q: +(o.z || o.q), side: o.S === 'SELL' ? 'long' : 'short' });
          }
        },
      }).start();
    },
    depthSocket(symbol, onBook, onStatus) {
      return binanceBook(perp, symbol, onBook, onStatus);
    },
    /** Trades rückwärts (neueste zuerst), Seiten zu 1000 aggTrades. Futures: Gewicht 20 je Abfrage → Pause 650 ms. */
    async *tradeHistory(symbol) {
      const path = perp ? '/fapi/v1/aggTrades' : '/api/v3/aggTrades';
      const pace = perp ? 650 : 220;
      const parse = (j) => j.map(x => ({ t: +x.T, p: +x.p, q: +x.q, buy: !x.m, id: +x.a }));
      let host = null, j = null, err;
      for (const h of this.hosts) {
        try { j = await getJson(`${h}${path}?${qs({ symbol, limit: 1000 })}`); host = h; break; } catch (e) { err = e; }
      }
      if (!host) throw err;
      if (!Array.isArray(j) || !j.length) return;
      let minId = +j[0].a;
      yield { trades: parse(j), pace };
      while (minId > 0) {
        const from = Math.max(0, minId - 1000);
        j = await getJson(`${host}${path}?${qs({ symbol, fromId: from, limit: minId - from })}`);
        if (!Array.isArray(j) || !j.length) return;
        minId = +j[0].a;
        yield { trades: parse(j), pace };
      }
    },
    async fetchTicker(symbol) {
      const path = perp ? '/fapi/v1/ticker/24hr' : '/api/v3/ticker/24hr';
      const j = await getJson(`${this.hosts[0]}${path}?symbol=${symbol}`, { retries: 0 });
      return { last: +j.lastPrice, chg: +j.priceChangePercent, vol: +j.quoteVolume };
    },
  };
}

/**
 * Lokales Orderbuch nach Binance-Vorgabe: Diff-Stream puffern, REST-Snapshot (1000 Stufen) holen,
 * dann Ereignisse lückenlos anwenden (Futures: pu = vorheriges u, Spot: U = vorheriges u + 1).
 */
function binanceBook(perp, symbol, onBook, onStatus) {
  const s = symbol.toLowerCase();
  const url = perp ? `wss://fstream.binance.com/public/ws/${s}@depth@100ms` : `wss://stream.binance.com:9443/ws/${s}@depth@100ms`;
  const rest = perp ? `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=1000` : `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=1000`;
  const bids = new Map(), asks = new Map();
  let lastId = -1, prevU = null, ready = false, loading = false, buffer = [], emitT = 0, alive = true;
  const apply = (ev) => {
    for (const [p, q] of ev.b) { if (+q === 0) bids.delete(p); else bids.set(p, +q); }
    for (const [p, q] of ev.a) { if (+q === 0) asks.delete(p); else asks.set(p, +q); }
  };
  const process = (ev) => {
    if (ev.u < lastId) return;
    if (prevU === null) {
      const first = perp ? (ev.U <= lastId && ev.u >= lastId) : (ev.U <= lastId + 1 && ev.u >= lastId + 1);
      if (first) { apply(ev); prevU = ev.u; } else if (ev.U > lastId + 1) resync();
      return;
    }
    if (perp ? ev.pu !== prevU : ev.U !== prevU + 1) { resync(); return; }
    apply(ev); prevU = ev.u;
  };
  const snapshot = async () => {
    if (loading || !alive) return;
    loading = true; ready = false;
    try {
      const j = await getJson(rest, { retries: 1 });
      bids.clear(); asks.clear();
      for (const [p, q] of j.bids) bids.set(p, +q);
      for (const [p, q] of j.asks) asks.set(p, +q);
      lastId = j.lastUpdateId; prevU = null;
      const buf = buffer; buffer = [];
      ready = true;
      for (const ev of buf) process(ev);
      emit();
    } catch (e) { setTimeout(() => { loading = false; snapshot(); }, 3000); return; }
    loading = false;
  };
  const resync = () => { ready = false; prevU = null; buffer = []; snapshot(); };
  const emit = () => {
    const b = [...bids].map(([p, q]) => [+p, q]).sort((x, y) => y[0] - x[0]);
    const a = [...asks].map(([p, q]) => [+p, q]).sort((x, y) => x[0] - y[0]);
    if (b.length && a.length) onBook({ bids: b, asks: a, t: Date.now() });
  };
  const sock = new LiveSocket({
    url, name: 'depth', onStatus,
    onOpen: () => { buffer = []; prevU = null; ready = false; snapshot(); },
    onMessage: (m) => {
      if (!m || m.e !== 'depthUpdate') return;
      if (!ready) { buffer.push(m); if (buffer.length > 3000) buffer.shift(); return; }
      process(m);
      const now = Date.now();
      if (now - emitT > 200) { emitT = now; emit(); }
    },
  }).start();
  return { stop() { alive = false; sock.stop(); } };
}

const binancePerp = {
  ...binanceBase(true),
  async fetchOI(symbol, tf, { startTime, endTime } = {}) {
    const periods = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h', '1D': '1d' };
    let period = periods[tf];
    if (!period) period = tfMinutes(tf) < 5 ? '5m' : '1d';
    const pMs = { '5m': 5 * MIN, '15m': 15 * MIN, '30m': 30 * MIN, '1h': HOUR, '2h': 2 * HOUR, '4h': 4 * HOUR, '6h': 6 * HOUR, '12h': 12 * HOUR, '1d': DAY }[period];
    const minStart = Date.now() - 29.5 * DAY; // Binance liefert nur ~30 Tage
    const from = Math.max(startTime ?? minStart, minStart);
    const to = endTime ?? Date.now();
    const wins = [];
    for (let a = from; a < to && wins.length < 40; a += 500 * pMs) wins.push([a, Math.min(to, a + 500 * pMs - 1)]);
    const pages = await Promise.all(wins.map(([a, b]) => getJson(`https://fapi.binance.com/futures/data/openInterestHist?${qs({ symbol, period, limit: 500, startTime: a, endTime: b })}`).catch(() => [])));
    const out = [];
    for (const j of pages) if (Array.isArray(j)) for (const x of j) out.push({ t: +x.timestamp, v: +x.sumOpenInterest, usd: +x.sumOpenInterestValue });
    return { period, points: dedupePoints(out) };
  },
  async fetchFunding(symbol, { startTime } = {}) {
    const out = [];
    let from = startTime ?? Date.now() - 90 * DAY;
    for (let g = 0; g < 10; g++) {
      const j = await getJson(`https://fapi.binance.com/fapi/v1/fundingRate?${qs({ symbol, limit: 1000, startTime: from })}`);
      if (!Array.isArray(j) || !j.length) break;
      for (const x of j) out.push({ t: +x.fundingTime, v: +x.fundingRate });
      if (j.length < 1000) break;
      from = +j[j.length - 1].fundingTime + 1;
    }
    return dedupePoints(out);
  },
  async fetchPremium(symbol) {
    const j = await getJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { retries: 0 });
    return { mark: +j.markPrice, index: +j.indexPrice, rate: +j.lastFundingRate, next: +j.nextFundingTime };
  },
};
function dedupePoints(arr) {
  arr.sort((a, b) => a.t - b.t);
  const out = [];
  for (const p of arr) { if (out.length && out[out.length - 1].t === p.t) out[out.length - 1] = p; else out.push(p); }
  return out;
}

// ---------------------------------------------------------------- Bybit (v5)
const BYBIT_IV = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720', '1D': 'D', '1W': 'W', '1M': 'M' };
function bybitBase(category) {
  return {
    intervals: BYBIT_IV,
    maxLimit: 1000,
    async fetchPage(symbol, tf, { endTime, limit }) {
      const j = await getJson(`https://api.bybit.com/v5/market/kline?${qs({ category, symbol, interval: this.intervals[tf], limit, end: endTime })}`);
      if (j.retCode !== 0) { const e = new Error(j.retMsg || 'Bybit-Fehler'); e.status = 400; throw e; }
      const list = j.result?.list || [];
      return list.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], bv: NaN })).reverse();
    },
    tradeSocket(symbol, onTrade, onStatus) {
      return new LiveSocket({
        url: `wss://stream.bybit.com/v5/public/${category}`, name: 'trades', onStatus,
        ping: { ms: 20000, data: { op: 'ping' } },
        onOpen: (s) => s.send({ op: 'subscribe', args: [`publicTrade.${symbol}`] }),
        onMessage: (m) => {
          if (!m.topic || !m.topic.startsWith('publicTrade') || !Array.isArray(m.data)) return;
          for (const x of m.data) onTrade({ t: +x.T, p: +x.p, q: +x.v, buy: x.S === 'Buy' });
        },
      }).start();
    },
    depthSocket(symbol, onBook, onStatus) {
      const book = { b: new Map(), a: new Map() };
      return new LiveSocket({
        url: `wss://stream.bybit.com/v5/public/${category}`, name: 'depth', onStatus,
        ping: { ms: 20000, data: { op: 'ping' } },
        onOpen: (s) => { book.b.clear(); book.a.clear(); s.send({ op: 'subscribe', args: [`orderbook.200.${symbol}`] }); },
        onMessage: (m) => {
          if (!m.topic || !m.topic.startsWith('orderbook') || !m.data) return;
          if (m.type === 'snapshot') { book.b.clear(); book.a.clear(); }
          for (const [p, q] of m.data.b || []) { if (+q === 0) book.b.delete(p); else book.b.set(p, +q); }
          for (const [p, q] of m.data.a || []) { if (+q === 0) book.a.delete(p); else book.a.set(p, +q); }
          const now = Date.now();
          if (m.type !== 'snapshot' && now - (book.t || 0) < 200) return;
          book.t = now;
          const bids = [...book.b].map(([p, q]) => [+p, q]).sort((x, y) => y[0] - x[0]);
          const asks = [...book.a].map(([p, q]) => [+p, q]).sort((x, y) => x[0] - y[0]);
          onBook({ bids, asks, t: now });
        },
      }).start();
    },
    /** Bybit liefert öffentlich nur die letzten Trades (Perp 1000, Spot 60). */
    async *tradeHistory(symbol) {
      const j = await getJson(`https://api.bybit.com/v5/market/recent-trade?${qs({ category, symbol, limit: category === 'spot' ? 60 : 1000 })}`);
      const list = j.result?.list || [];
      yield { trades: list.map(x => ({ t: +x.time, p: +x.price, q: +x.size, buy: x.side === 'Buy' })), pace: 0, limited: true };
    },
    async fetchTicker(symbol) {
      const j = await getJson(`https://api.bybit.com/v5/market/tickers?category=${category}&symbol=${symbol}`, { retries: 0 });
      const x = j.result?.list?.[0];
      if (!x) throw new Error('kein Ticker');
      return { last: +x.lastPrice, chg: +x.price24hPcnt * 100, vol: +x.turnover24h };
    },
  };
}
const bybitPerp = {
  ...bybitBase('linear'),
  async fetchOI(symbol, tf, { startTime } = {}) {
    const ivs = { '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h', '4h': '4h', '1D': '1d' };
    let iv = ivs[tf];
    if (!iv) { const m = tfMinutes(tf); iv = m < 15 ? '5min' : m < 30 ? '15min' : m < 60 ? '30min' : m < 240 ? '1h' : m < 1440 ? '4h' : '1d'; }
    const out = [];
    let cursor = '';
    for (let g = 0; g < 25; g++) {
      const j = await getJson(`https://api.bybit.com/v5/market/open-interest?${qs({ category: 'linear', symbol, intervalTime: iv, limit: 200, cursor: cursor || undefined })}`);
      const list = j.result?.list || [];
      for (const x of list) out.push({ t: +x.timestamp, v: +x.openInterest });
      cursor = j.result?.nextPageCursor;
      if (!cursor || !list.length) break;
      if (startTime && +list[list.length - 1].timestamp <= startTime) break;
    }
    return { period: iv, points: dedupePoints(out) };
  },
  async fetchFunding(symbol, { startTime } = {}) {
    const out = [];
    let end;
    for (let g = 0; g < 10; g++) {
      const j = await getJson(`https://api.bybit.com/v5/market/funding/history?${qs({ category: 'linear', symbol, limit: 200, endTime: end })}`);
      const list = j.result?.list || [];
      for (const x of list) out.push({ t: +x.fundingRateTimestamp, v: +x.fundingRate });
      if (list.length < 200) break;
      const oldest = +list[list.length - 1].fundingRateTimestamp;
      if (startTime && oldest <= startTime) break;
      end = oldest - 1;
    }
    return dedupePoints(out);
  },
  async fetchPremium(symbol) {
    const j = await getJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`, { retries: 0 });
    const x = j.result?.list?.[0] || {};
    return { mark: +x.markPrice, index: +x.indexPrice, rate: +x.fundingRate, next: +x.nextFundingTime };
  },
};

// ---------------------------------------------------------------- OKX (v5)
const OKX_IV = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6Hutc', '12h': '12Hutc', '1D': '1Dutc', '1W': '1Wutc', '1M': '1Mutc' };
const okxCtVal = new Map();
async function okxContractValue(instId) {
  if (!instId.endsWith('-SWAP')) return 1;
  if (okxCtVal.has(instId)) return okxCtVal.get(instId);
  try {
    const j = await getJson(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${instId}`, { retries: 0 });
    const v = +j.data?.[0]?.ctVal || 1;
    okxCtVal.set(instId, v);
    return v;
  } catch { return 1; }
}
const okxPerp = {
  intervals: OKX_IV,
  maxLimit: 100,
  minFullPage: 90,
  async fetchPage(instId, tf, { endTime, limit }) {
    // jüngste Kerzen über /candles (bis 300), ältere über /history-candles (bis 100)
    const bar = this.intervals[tf];
    const after = endTime != null ? endTime + 1 : undefined; // "after" = älter als ts
    const path = endTime == null ? 'candles' : 'history-candles';
    const j = await getJson(`https://www.okx.com/api/v5/market/${path}?${qs({ instId, bar, limit: Math.min(limit, path === 'candles' ? 300 : 100), after })}`);
    if (j.code !== '0') { const e = new Error(j.msg || 'OKX-Fehler'); e.status = 400; throw e; }
    const swap = instId.endsWith('-SWAP');
    return (j.data || []).map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: swap ? +k[6] : +k[5], bv: NaN })).reverse();
  },
  tradeSocket(instId, onTrade, onStatus) {
    let ct = 1;
    okxContractValue(instId).then(v => { ct = v; });
    return new LiveSocket({
      url: 'wss://ws.okx.com:8443/ws/v5/public', name: 'trades', onStatus,
      ping: { ms: 25000, data: 'ping' },
      onOpen: (s) => s.send({ op: 'subscribe', args: [{ channel: 'trades', instId }] }),
      onMessage: (m) => {
        if (!m || !m.arg || m.arg.channel !== 'trades' || !Array.isArray(m.data)) return;
        for (const x of m.data) onTrade({ t: +x.ts, p: +x.px, q: +x.sz * ct, buy: x.side === 'buy' });
      },
    }).start();
  },
  depthSocket(instId, onBook, onStatus) {
    let ct = 1;
    okxContractValue(instId).then(v => { ct = v; });
    const book = { b: new Map(), a: new Map(), t: 0 };
    return new LiveSocket({
      url: 'wss://ws.okx.com:8443/ws/v5/public', name: 'depth', onStatus,
      ping: { ms: 25000, data: 'ping' },
      onOpen: (s) => { book.b.clear(); book.a.clear(); s.send({ op: 'subscribe', args: [{ channel: 'books', instId }] }); },
      onMessage: (m) => {
        if (!m || !m.arg || m.arg.channel !== 'books' || !m.data?.[0]) return;
        const d = m.data[0];
        if (m.action === 'snapshot') { book.b.clear(); book.a.clear(); }
        for (const x of d.bids || []) { if (+x[1] === 0) book.b.delete(x[0]); else book.b.set(x[0], +x[1]); }
        for (const x of d.asks || []) { if (+x[1] === 0) book.a.delete(x[0]); else book.a.set(x[0], +x[1]); }
        const now = Date.now();
        if (m.action !== 'snapshot' && now - book.t < 200) return;
        book.t = now;
        onBook({
          bids: [...book.b].map(([p, q]) => [+p, q * ct]).sort((x, y) => y[0] - x[0]),
          asks: [...book.a].map(([p, q]) => [+p, q * ct]).sort((x, y) => x[0] - y[0]), t: now,
        });
      },
    }).start();
  },
  /** Trades rückwärts, Seiten zu 100 (Paging über tradeId). */
  async *tradeHistory(instId) {
    const ct = await okxContractValue(instId);
    let after;
    for (let g = 0; g < 5000; g++) {
      const j = await getJson(`https://www.okx.com/api/v5/market/history-trades?${qs({ instId, limit: 100, type: 1, after })}`);
      const list = j.data || [];
      if (!list.length) return;
      yield { trades: list.map(x => ({ t: +x.ts, p: +x.px, q: +x.sz * ct, buy: x.side === 'buy' })), pace: 60 };
      after = list[list.length - 1].tradeId;
    }
  },
  async fetchTicker(instId) {
    const j = await getJson(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, { retries: 0 });
    const x = j.data?.[0];
    if (!x) throw new Error('kein Ticker');
    return { last: +x.last, chg: (+x.last / +x.open24h - 1) * 100, vol: +x.volCcy24h * +x.last };
  },
  async fetchFunding(instId, { startTime } = {}) {
    const out = [];
    let after;
    for (let g = 0; g < 4; g++) {
      const j = await getJson(`https://www.okx.com/api/v5/public/funding-rate-history?${qs({ instId, limit: 100, after })}`);
      const list = j.data || [];
      for (const x of list) out.push({ t: +x.fundingTime, v: +x.realizedRate || +x.fundingRate });
      if (list.length < 100) break;
      const oldest = +list[list.length - 1].fundingTime;
      if (startTime && oldest <= startTime) break;
      after = oldest;
    }
    return dedupePoints(out);
  },
  async fetchPremium(instId) {
    const j = await getJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`, { retries: 0 });
    const x = j.data?.[0] || {};
    return { rate: +x.fundingRate, next: +x.nextFundingTime || +x.fundingTime };
  },
};

// ---------------------------------------------------------------- Coinbase Exchange
const CB_IV = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1D': 86400 };
const coinbaseSpot = {
  intervals: CB_IV,
  maxLimit: 300,
  minFullPage: 250,
  async fetchPage(product, tf, { endTime, limit }) {
    const g = this.intervals[tf];
    const end = endTime != null ? endTime + 1 : Date.now();
    const start = end - (limit) * g * 1000;
    const j = await getJson(`https://api.exchange.coinbase.com/products/${product}/candles?${qs({ granularity: g, start: new Date(start).toISOString(), end: new Date(end).toISOString() })}`);
    if (!Array.isArray(j)) { const e = new Error(j?.message || 'Coinbase-Fehler'); e.status = 400; throw e; }
    return j.map(k => ({ t: k[0] * 1000, l: +k[1], h: +k[2], o: +k[3], c: +k[4], v: +k[5], bv: NaN })).reverse();
  },
  tradeSocket(product, onTrade, onStatus) {
    return new LiveSocket({
      url: 'wss://ws-feed.exchange.coinbase.com', name: 'trades', onStatus,
      onOpen: (s) => s.send({ type: 'subscribe', product_ids: [product], channels: ['matches'] }),
      onMessage: (m) => {
        if (m.type !== 'match' && m.type !== 'last_match') return;
        // side = Seite der Maker-Order → Aggressor ist die Gegenseite
        onTrade({ t: Date.parse(m.time), p: +m.price, q: +m.size, buy: m.side === 'sell' });
      },
    }).start();
  },
  /** Trades rückwärts, Seiten zu 1000 (after = trade_id → ältere). side = Maker-Seite. */
  async *tradeHistory(product) {
    let after;
    for (let g = 0; g < 3000; g++) {
      const j = await getJson(`https://api.exchange.coinbase.com/products/${product}/trades?${qs({ limit: 1000, after })}`);
      if (!Array.isArray(j) || !j.length) return;
      yield { trades: j.map(x => ({ t: Date.parse(x.time), p: +x.price, q: +x.size, buy: x.side === 'sell' })), pace: 120 };
      after = j[j.length - 1].trade_id;
    }
  },
  async fetchTicker(product) {
    const j = await getJson(`https://api.exchange.coinbase.com/products/${product}/stats`, { retries: 0 });
    return { last: +j.last, chg: (+j.last / +j.open - 1) * 100, vol: +j.volume * +j.last };
  },
};

// ---------------------------------------------------------------- Märkte
const K1000 = new Set(['PEPE', 'BONK', 'FLOKI']);
export const MARKETS = {
  'binance-perp': {
    id: 'binance-perp', exchange: 'Binance', type: 'Perp', label: 'Binance Perp', badge: 'BINANCE',
    ad: binancePerp, delta: true, oi: true, funding: true, liq: true, dom: true,
    inst: (b) => (K1000.has(b) ? '1000' + b : b) + 'USDT',
    ticker: (b) => (K1000.has(b) ? '1000' + b : b) + 'USDT.P',
    quote: 'USDT', desc: 'USDⓈ-M Perpetual',
  },
  'binance-spot': {
    id: 'binance-spot', exchange: 'Binance', type: 'Spot', label: 'Binance Spot', badge: 'BINANCE',
    ad: binanceBase(false), delta: true, oi: false, funding: false, liq: false, dom: true,
    inst: (b) => b + 'USDT', ticker: (b) => b + 'USDT', quote: 'USDT', desc: 'Spot',
  },
  'bybit-perp': {
    id: 'bybit-perp', exchange: 'Bybit', type: 'Perp', label: 'Bybit Perp', badge: 'BYBIT',
    ad: bybitPerp, delta: false, oi: true, funding: true, liq: false, dom: true,
    inst: (b) => (K1000.has(b) ? '1000' + b : b) + 'USDT', ticker: (b) => (K1000.has(b) ? '1000' + b : b) + 'USDT.P', quote: 'USDT', desc: 'USDT Perpetual',
  },
  'bybit-spot': {
    id: 'bybit-spot', exchange: 'Bybit', type: 'Spot', label: 'Bybit Spot', badge: 'BYBIT',
    ad: bybitBase('spot'), delta: false, oi: false, funding: false, liq: false, dom: true,
    inst: (b) => b + 'USDT', ticker: (b) => b + 'USDT', quote: 'USDT', desc: 'Spot',
  },
  'okx-perp': {
    id: 'okx-perp', exchange: 'OKX', type: 'Perp', label: 'OKX Perp', badge: 'OKX',
    ad: okxPerp, delta: false, oi: false, funding: true, liq: false, dom: true,
    inst: (b) => b + '-USDT-SWAP', ticker: (b) => b + 'USDT.P', quote: 'USDT', desc: 'USDT Swap',
  },
  'coinbase-spot': {
    id: 'coinbase-spot', exchange: 'Coinbase', type: 'Spot', label: 'Coinbase Spot', badge: 'COINBASE',
    ad: coinbaseSpot, delta: false, oi: false, funding: false, liq: false, dom: false,
    inst: (b) => b + '-USD', ticker: (b) => b + 'USD', quote: 'USD', desc: 'Spot',
  },
};

/** Kerzen laden (aufsteigend). */
export function fetchBars(marketId, base, tf, opts) {
  const m = MARKETS[marketId];
  return fetchBarsGeneric(m.ad, m.inst(base), tf, opts);
}

export const _test = { aggregate, dedupeSort, parseBinanceKlines, fetchBarsGeneric, okxPerp, coinbaseSpot, bybitPerp, binancePerp };
