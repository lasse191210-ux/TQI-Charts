// TQI Trader: Bybit USDT-Perpetuals (Demo oder Live) direkt aus dem Browser – wie der TQI Bybit Trader in ATAS.
// Sicherheit: API-Schlüssel gibt nur der Nutzer selbst ein, sie bleiben in diesem Browser (localStorage) und gehen
// nur an Bybit. Jede Order, jedes Schließen und jedes Verschieben braucht eine Bestätigung. Nichts handelt automatisch.
// Rechnung: Menge = Risiko / (Stop-Abstand + Gebühren), auf Mengenschritt abgerundet; Hebel = kleinster, bei dem die
// Marge ≤ 90 % des freien Guthabens ist. Gebühren: Maker 0,02 %, Taker 0,055 %.
import { storage, fmtPrice, nf, uid, escapeHtml as esc } from './util.js';
import { ICON } from './icons.js';

const HOST = { demo: 'https://api-demo.bybit.com', live: 'https://api.bybit.com' };
const WSS = { demo: 'wss://stream-demo.bybit.com/v5/private', live: 'wss://stream.bybit.com/v5/private' };
const KEYS = 'tqi-charts:trader-keys';
export const FEE = { maker: 0.0002, taker: 0.00055 };
const MMR = 0.005; // Wartungsmarge (Schätzung für die Liquidation)
const K1000 = new Set(['PEPE', 'BONK', 'FLOKI']);
const LONG = '#787b86', SHORT = '#131722';
const TYPES = [['limit', 'Limit (passiv)', 'Limit', 'Limit-Order, nur Maker (Post-Only) – unter dem Kurs kaufen / über dem Kurs verkaufen'], ['stop', 'Stop (Ausbruch)', 'Stop', 'Stop-Limit: wird beim Erreichen des Preises ausgelöst (Ausbruch)'], ['market', 'Market', 'Market', 'Sofort zum aktuellen Kurs']];

const enc = new TextEncoder();
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const decOf = (step) => { const s = String(step); return s.includes('e-') ? +s.split('e-')[1] : (s.split('.')[1] || '').length; };
const floorStep = (x, step) => Math.floor(x / step + 1e-9) * step;
const roundStep = (x, step) => Math.round(x / step) * step;

export class Trader {
  constructor(app) {
    this.app = app;
    this.keys = storage.get(KEYS, {});
    this.plan = { entry: null, stop: null, target: null };
    this.pos = null; this.orders = []; this.wallet = null;
    this.inst = new Map();
    this.ws = null; this.wsState = 'aus'; this.timeOff = 0;
    this.pick = null;           // 'entry' | 'stop' | 'target': nächster Klick/Tipp in den Chart setzt den Preis
    this.busy = false; this.err = null;
    this._sheetClose = null;
  }

  // ---------------------------------------------------------------- Zustand
  get cfg() { return this.app.state.trader; }
  get env() { return this.cfg.env === 'live' ? 'live' : 'demo'; }
  get key() { const k = this.keys[this.env]; return k && k.key && k.secret ? k : null; }
  get symbol() { const b = this.app.state.base; return (K1000.has(b) ? '1000' + b : b) + 'USDT'; }
  get open() { return this.app.ui.mobile ? !!this._sheetClose : this.app.state.rightOpen && this.app.state.rightPanel === 'trader'; }
  get showLines() { return this.cfg.lines !== false && (this.open || this.cfg.keepLines); }
  save() { this.app._save(); }

  /** Panel öffnen/schließen (PC: rechte Leiste, Handy: Blatt von unten). */
  toggle(force) {
    const a = this.app, st = a.state;
    const want = force ?? !this.open;
    if (a.ui.mobile) {
      if (want && !this._sheetClose) this.openSheet();
      else if (!want && this._sheetClose) this._sheetClose();
    } else {
      st.rightOpen = want; if (want) st.rightPanel = 'trader';
      a._save(); a.ui.renderRight(); document.body.classList.toggle('right-closed', !st.rightOpen);
    }
    if (want) this.start(); else this.redraw();
  }
  openSheet() {
    const box = document.createElement('div');
    box.className = 'trader-sheet';
    const head = document.createElement('div'); head.className = 'tr-head';
    const body = document.createElement('div'); body.className = 'tr-body';
    box.append(head, body);
    this._sheet = { head, body };
    this._sheetClose = this.app.ui.modal('', box, { onClose: () => { this._sheetClose = null; this._sheet = null; this.redraw(); document.getElementById('traderBtn')?.classList.remove('on'); } });
    this.render();
  }

  // ---------------------------------------------------------------- Bybit REST
  async pub(path, params) {
    const q = new URLSearchParams(params).toString();
    const r = await fetch(`${HOST[this.env]}${path}?${q}`);
    const j = await r.json();
    if (j.retCode !== 0) throw new Error(`${j.retMsg} (${j.retCode})`);
    return j.result;
  }
  async req(method, path, params = {}) {
    const k = this.key;
    if (!k) throw new Error(`Kein API-Schlüssel für ${this.env === 'live' ? 'Live' : 'Demo'} gespeichert`);
    const ts = String(Date.now() + this.timeOff), rw = '10000';
    let url = HOST[this.env] + path, body, payload;
    if (method === 'GET') { const q = new URLSearchParams(params).toString(); if (q) url += '?' + q; payload = q; }
    else { body = JSON.stringify(params); payload = body; }
    const sign = await hmacHex(k.secret, ts + k.key + rw + payload);
    let r;
    try {
      r = await fetch(url, { method, body, headers: { 'X-BAPI-API-KEY': k.key, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': rw, 'X-BAPI-SIGN': sign, ...(body ? { 'Content-Type': 'application/json' } : {}) } });
    } catch (e) { throw new Error('Bybit nicht erreichbar (Netzwerk oder Browser blockiert): ' + (e.message || e)); }
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch { /* leer */ }
    if (!j) throw new Error(`Bybit antwortet mit HTTP ${r.status}${r.status === 401 ? ' – API-Schlüssel oder Secret falsch, abgelaufen oder für ' + (this.env === 'live' ? 'Live' : 'Demo') + ' nicht gültig' : ''}`);
    if (j.retCode !== 0) { const e = new Error(`${j.retMsg} (Code ${j.retCode})`); e.code = j.retCode; throw e; }
    return j.result;
  }
  async syncTime() {
    try { const t0 = Date.now(); const r = await this.pub('/v5/market/time', {}); const t1 = Date.now(); this.timeOff = Math.round(+r.timeNano / 1e6 - (t0 + t1) / 2); } catch { /* egal */ }
  }
  async instrument() {
    const sym = this.symbol;
    if (this.inst.has(sym)) return this.inst.get(sym);
    const r = await this.pub('/v5/market/instruments-info', { category: 'linear', symbol: sym });
    const x = r.list?.[0];
    if (!x) throw new Error(`${sym} gibt es auf Bybit nicht als USDT-Perp`);
    const info = { tick: +x.priceFilter.tickSize, step: +x.lotSizeFilter.qtyStep, minQty: +x.lotSizeFilter.minOrderQty, maxLev: +x.leverageFilter.maxLeverage, minNotional: +(x.lotSizeFilter.minNotionalValue || 0) };
    this.inst.set(sym, info);
    return info;
  }

  // ---------------------------------------------------------------- Start, Aktualisieren, privater WebSocket
  async start() {
    this.render();
    if (!this.key) return;
    try { await this.syncTime(); await this.instrument(); await this.refresh(); this.connectWs(); }
    catch (e) { this.err = e.message; this.render(); }
  }
  async refresh() {
    if (!this.key) return;
    const sym = this.symbol;
    try {
      const [w, p, o] = await Promise.all([
        this.req('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }),
        this.req('GET', '/v5/position/list', { category: 'linear', symbol: sym }),
        this.req('GET', '/v5/order/realtime', { category: 'linear', symbol: sym }),
      ]);
      this.setWallet(w.list?.[0]);
      this.setPos((p.list || []).find(x => +x.size > 0) || null);
      this.orders = (o.list || []).map(normOrder);
      this.err = null;
    } catch (e) { this.err = e.message; }
    this.render(); this.redraw();
  }
  setWallet(x) {
    if (!x) return;
    this.wallet = { equity: +x.totalEquity, avail: +x.totalAvailableBalance, upnl: +x.totalPerpUPL || 0 };
  }
  setPos(x) {
    this.pos = x && +x.size > 0 ? { side: x.side, size: +x.size, avg: +x.avgPrice, sl: +x.stopLoss || null, tp: +x.takeProfit || null, liq: +x.liqPrice || null, upnl: +x.unrealisedPnl || 0, lev: +x.leverage || null } : null;
  }
  connectWs() {
    if (!this.key || this.ws) return;
    const env = this.env, k = this.key;
    const ws = new WebSocket(WSS[env]);
    this.ws = ws; this.wsState = 'verbindet';
    let ping;
    ws.onopen = async () => {
      const exp = Date.now() + this.timeOff + 10000;
      ws.send(JSON.stringify({ op: 'auth', args: [k.key, exp, await hmacHex(k.secret, 'GET/realtime' + exp)] }));
      ping = setInterval(() => { try { ws.send('{"op":"ping"}'); } catch { /* zu */ } }, 20000);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.op === 'auth') {
        if (m.success) { this.wsState = 'live'; ws.send(JSON.stringify({ op: 'subscribe', args: ['position', 'order', 'wallet'] })); }
        else { this.wsState = 'Anmeldung fehlgeschlagen'; this.err = 'WebSocket-Anmeldung: ' + (m.ret_msg || 'abgelehnt'); }
        this.render(); return;
      }
      const sym = this.symbol;
      if (m.topic === 'position') { for (const x of m.data || []) if (x.symbol === sym) this.setPos(x); this.render(); this.redraw(); }
      else if (m.topic === 'order') {
        for (const x of m.data || []) {
          if (x.symbol !== sym) continue;
          const o = normOrder(x);
          this.orders = this.orders.filter(y => y.id !== o.id);
          if (['New', 'PartiallyFilled', 'Untriggered'].includes(x.orderStatus)) this.orders.push(o);
          if (x.orderStatus === 'Filled' && x.orderType !== 'Market' && !x.reduceOnly) this.app.ui.toast(`Order ausgeführt: ${x.side === 'Buy' ? 'Kauf' : 'Verkauf'} ${x.qty} @ ${x.avgPrice || x.price}`, 'info', 5000);
        }
        this.render(); this.redraw();
      } else if (m.topic === 'wallet') { this.setWallet(m.data?.[0]); this.render(); }
    };
    ws.onclose = () => {
      clearInterval(ping);
      if (this.ws !== ws) return;
      this.ws = null; this.wsState = 'getrennt'; this.render();
      if (this.key && env === this.env) setTimeout(() => { if (!this.ws && this.key) this.connectWs(); }, 5000);
    };
    ws.onerror = () => {};
  }
  stopWs() { const w = this.ws; this.ws = null; this.wsState = 'aus'; try { w?.close(); } catch { /* egal */ } }
  /** Coin gewechselt: Position/Orders des neuen Symbols laden. */
  onSymbol() { this.pos = null; this.orders = []; this.plan = { entry: null, stop: null, target: null }; if (this.key && this.open) { this.instrument().then(() => this.refresh()).catch(e => { this.err = e.message; this.render(); }); } else this.render(); }

  // ---------------------------------------------------------------- Rechnung
  /** Entry für die Rechnung: bei Market der aktuelle Kurs. */
  entryPx() {
    if (this.cfg.type === 'market') return this.app.bars[this.app.bars.length - 1]?.c || null;
    return this.plan.entry;
  }
  calc() {
    const c = this.cfg, I = this.inst.get(this.symbol);
    const p = { ...this.plan, entry: this.entryPx() };
    if (!(p.entry > 0) || !(p.stop > 0) || p.entry === p.stop) return null;
    const long = p.stop < p.entry;
    const fIn = c.type === 'limit' ? FEE.maker : FEE.taker, fOut = FEE.taker;
    const per = Math.abs(p.entry - p.stop) + (c.fees !== false ? p.entry * fIn + p.stop * fOut : 0);
    const step = I?.step || 0.001;
    const qty = floorStep(c.risk / per, step);
    const notional = qty * p.entry;
    const avail = this.wallet?.avail;
    let lev = c.lev > 0 ? c.lev : (avail > 0 ? Math.max(1, Math.ceil(notional / (0.9 * avail))) : 1);
    if (I?.maxLev) lev = Math.min(lev, I.maxLev);
    const margin = notional / lev;
    const feesUsd = qty * (p.entry * fIn + p.stop * fOut);
    const rr = p.target > 0 ? Math.abs(p.target - p.entry) / Math.abs(p.entry - p.stop) : null;
    const liq = long ? p.entry * (1 - 1 / lev + MMR) : p.entry * (1 + 1 / lev - MMR);
    const last = this.app.bars[this.app.bars.length - 1]?.c;
    const warn = [];
    if (I && qty < I.minQty) warn.push(`Menge unter Mindestmenge ${I.minQty} – Risiko erhöhen oder Stop enger`);
    if (avail > 0 && margin > 0.9 * avail) warn.push('Marge über 90 % des freien Guthabens');
    if (long ? liq >= p.stop : liq <= p.stop) warn.push(`Liquidation (≈ ${this.fmt(liq)}) liegt vor dem Stop – Hebel senken`);
    if (p.target > 0 && (long ? p.target <= p.entry : p.target >= p.entry)) warn.push('Ziel liegt auf der falschen Seite');
    if (last && c.type === 'limit' && (long ? p.entry >= last : p.entry <= last)) warn.push('Limit (passiv) muss ' + (long ? 'unter' : 'über') + ' dem Kurs liegen – sonst Stop (Ausbruch) wählen');
    if (last && c.type === 'stop' && (long ? p.entry <= last : p.entry >= last)) warn.push('Stop (Ausbruch) muss ' + (long ? 'über' : 'unter') + ' dem Kurs liegen – sonst Limit wählen');
    if (!this.wallet) warn.push('Guthaben unbekannt (Schlüssel prüfen)');
    return { long, qty, notional, lev, margin, feesUsd, rr, liq, warn, risk: qty * per };
  }
  fmt(p) { return fmtPrice(p, this.app.priceDec); }
  px(p) { const I = this.inst.get(this.symbol); const t = I?.tick || 0.1; return roundStep(p, t).toFixed(decOf(t)); }
  qtyStr(q) { const I = this.inst.get(this.symbol); return q.toFixed(decOf(I?.step || 0.001)); }

  // ---------------------------------------------------------------- Aktionen (immer mit Bestätigung)
  confirm(title, rows, okText, danger) {
    return new Promise((res) => {
      const live = this.env === 'live';
      const box = document.createElement('div');
      box.className = 'setdlg';
      box.innerHTML = `<div class="tr-confirm ${live ? 'live' : ''}"><div class="tr-env">${live ? 'LIVE – echtes Geld' : 'DEMO-Konto'} · ${esc(this.symbol)}</div>
        <table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(String(v))}</b></td></tr>`).join('')}</table></div>
        <div class="dlg-foot"><button class="tb" data-no>Abbrechen</button><div class="grow"></div><button class="tb ${danger ? 'danger' : 'primary'}" data-ok>${esc(okText)}</button></div>`;
      let done = false;
      const close = this.app.ui.modal(title, box, { onClose: () => { if (!done) res(false); } });
      box.querySelector('[data-no]').onclick = () => { done = true; close(); res(false); };
      box.querySelector('[data-ok]').onclick = () => { done = true; close(); res(true); };
    });
  }
  async run(label, fn) {
    if (this.busy) return;
    this.busy = true; this.render();
    try { await fn(); this.err = null; }
    catch (e) {
      let msg = e.message || String(e);
      if (e.code === 10001 && /position idx|positionIdx/i.test(msg)) msg = 'Bitte in Bybit den One-Way-Modus einstellen (nicht Hedge-Modus). ' + msg;
      this.err = label + ': ' + msg;
      this.app.ui.toast(this.err, 'error', 8000);
    } finally { this.busy = false; this.render(); setTimeout(() => this.refresh(), 600); }
  }
  async placeOrder() {
    const I = await this.instrument().catch(e => { this.app.ui.toast(e.message, 'error'); return null; });
    if (!I) return;
    const c = this.calc(), p = { ...this.plan, entry: this.entryPx() }, cfg = this.cfg;
    if (!c) { this.app.ui.toast(cfg.type === 'market' ? 'Stop setzen' : 'Entry und Stop setzen', 'error'); return; }
    if (c.qty < I.minQty) { this.app.ui.toast(c.warn[0], 'error', 5000); return; }
    const side = c.long ? 'Buy' : 'Sell';
    const params = { category: 'linear', symbol: this.symbol, side, qty: this.qtyStr(c.qty), positionIdx: 0, orderLinkId: 'tqi-' + uid() + uid(), tpslMode: 'Full', stopLoss: this.px(p.stop), slTriggerBy: 'LastPrice' };
    if (p.target > 0) Object.assign(params, { takeProfit: this.px(p.target), tpTriggerBy: 'LastPrice' });
    if (cfg.type === 'limit') Object.assign(params, { orderType: 'Limit', price: this.px(p.entry), timeInForce: 'PostOnly' });
    else if (cfg.type === 'stop') {
      const slip = (cfg.slip ?? 0.05) / 100;
      Object.assign(params, { orderType: 'Limit', triggerPrice: this.px(p.entry), triggerDirection: c.long ? 1 : 2, triggerBy: 'LastPrice', price: this.px(c.long ? p.entry * (1 + slip) : p.entry * (1 - slip)), timeInForce: 'GTC' });
    } else Object.assign(params, { orderType: 'Market' });
    const rows = [
      ['Richtung', c.long ? 'Long (Kauf)' : 'Short (Verkauf)'],
      ['Art', TYPES.find(t => t[0] === cfg.type)[1]],
      ['Menge', `${params.qty} ${this.app.state.base} (≈ ${nf(0).format(c.notional)} $)`],
      ['Entry', cfg.type === 'market' ? `Markt (≈ ${this.fmt(p.entry)})` : params.triggerPrice || params.price],
      ['Stop', params.stopLoss],
      ['Ziel', params.takeProfit || '–'],
      ['Risiko inkl. Gebühren', nf(2).format(c.risk) + ' $'],
      ['R:R', c.rr ? nf(2).format(c.rr) : '–'],
      ['Hebel / Marge', `${c.lev}x / ${nf(2).format(c.margin)} $`],
      ['Liquidation ≈', this.fmt(c.liq)],
    ];
    if (c.warn.length) rows.push(['Hinweis', c.warn.join(' · ')]);
    if (!(await this.confirm('Order prüfen', rows, (c.long ? 'Long' : 'Short') + ' senden', false))) return;
    await this.run('Order', async () => {
      if (!this.pos || this.pos.lev !== c.lev) {
        try { await this.req('POST', '/v5/position/set-leverage', { category: 'linear', symbol: this.symbol, buyLeverage: String(c.lev), sellLeverage: String(c.lev) }); }
        catch (e) { if (e.code !== 110043) throw e; }
      }
      const r = await this.req('POST', '/v5/order/create', params);
      this.app.ui.toast(`Order gesendet (${this.env === 'live' ? 'Live' : 'Demo'}): ${c.long ? 'Long' : 'Short'} ${params.qty} · ID ${String(r.orderId || '').slice(0, 8)}`, 'info', 5000);
    });
  }
  async closePosition() {
    const P = this.pos;
    if (!P) return;
    if (!(await this.confirm('Position schließen', [['Position', `${P.side === 'Buy' ? 'Long' : 'Short'} ${P.size}`], ['Art', 'Market, nur reduzieren'], ['Unrealisiert', nf(2).format(P.upnl) + ' $']], 'Jetzt schließen', true))) return;
    await this.run('Schließen', () => this.req('POST', '/v5/order/create', { category: 'linear', symbol: this.symbol, side: P.side === 'Buy' ? 'Sell' : 'Buy', orderType: 'Market', qty: String(P.size), reduceOnly: true, positionIdx: 0 }));
  }
  async breakEven() {
    const P = this.pos;
    if (!P) return;
    const long = P.side === 'Buy';
    const be = P.avg * (long ? 1 + FEE.maker + FEE.taker : 1 - FEE.maker - FEE.taker);
    if (!(await this.confirm('Stop auf Break-even', [['Position', `${long ? 'Long' : 'Short'} ${P.size} @ ${this.fmt(P.avg)}`], ['Neuer Stop (inkl. Gebühren)', this.px(be)], ['Bisher', P.sl ? this.fmt(P.sl) : '–']], 'Stop setzen'))) return;
    await this.run('Break-even', () => this.req('POST', '/v5/position/trading-stop', { category: 'linear', symbol: this.symbol, positionIdx: 0, tpslMode: 'Full', stopLoss: this.px(be), slTriggerBy: 'LastPrice' }));
  }
  async moveStop(kind, price) {
    const P = this.pos;
    if (!P) return;
    const name = kind === 'sl' ? 'Stop' : 'Ziel';
    if (!(await this.confirm(name + ' verschieben', [['Position', `${P.side === 'Buy' ? 'Long' : 'Short'} ${P.size}`], ['Neu', this.px(price)], ['Bisher', (kind === 'sl' ? P.sl : P.tp) ? this.fmt(kind === 'sl' ? P.sl : P.tp) : '–']], name + ' setzen'))) { this.redraw(); return; }
    await this.run(name, () => this.req('POST', '/v5/position/trading-stop', { category: 'linear', symbol: this.symbol, positionIdx: 0, tpslMode: 'Full', ...(kind === 'sl' ? { stopLoss: this.px(price), slTriggerBy: 'LastPrice' } : { takeProfit: this.px(price), tpTriggerBy: 'LastPrice' }) }));
  }
  async cancelAll() {
    if (!this.orders.length) return;
    if (!(await this.confirm('Alle Orders löschen', [['Offene Orders', String(this.orders.length)]], 'Alle löschen', true))) return;
    await this.run('Löschen', () => this.req('POST', '/v5/order/cancel-all', { category: 'linear', symbol: this.symbol }));
  }
  async cancelOne(id) {
    const o = this.orders.find(x => x.id === id);
    if (!o) return;
    if (!(await this.confirm('Order löschen', [['Order', `${o.side === 'Buy' ? 'Kauf' : 'Verkauf'} ${o.qty} @ ${o.trigger || o.price}`]], 'Löschen', true))) return;
    await this.run('Löschen', () => this.req('POST', '/v5/order/cancel', { category: 'linear', symbol: this.symbol, orderId: id }));
  }

  // ---------------------------------------------------------------- Chart: Linien (ziehbar), Klicks
  /** Linien für den Chart: Planung (Entry/Stop/Ziel) und echte Position/Orders. */
  lines() {
    const out = [];
    if (!this.showLines) return out;
    const p = this.plan, c = this.calc(), mkt = this.cfg.type === 'market', E = this.entryPx();
    const col = c ? (c.long ? LONG : SHORT) : LONG;
    const dark = this.app.theme.dark;
    const ink = (x) => (dark && x === SHORT ? '#d1d4dc' : x);
    if (E > 0 && (!mkt || p.stop > 0)) out.push({ id: 'entry', p: E, color: ink(col), width: 2, dash: null, drag: !mkt, label: `${c ? (c.long ? 'LONG' : 'SHORT') : 'ENTRY'}${mkt ? ' MARKT' : ''} ${this.fmt(E)}${c ? ` · ${this.qtyStr(c.qty)} · ${c.lev}x` : ''}` });
    if (p.stop > 0) out.push({ id: 'stop', p: p.stop, color: ink(col), width: 1, dash: 'dashed', drag: true, label: `STOP ${this.fmt(p.stop)}${c ? ` · −${nf(0).format(c.risk)} $` : ''}` });
    if (p.target > 0) out.push({ id: 'target', p: p.target, color: ink(col), width: 1, dash: 'dotted', drag: true, label: `ZIEL ${this.fmt(p.target)}${c?.rr ? ` · ${nf(2).format(c.rr)} R` : ''}` });
    const P = this.pos;
    if (P) {
      const pc = ink(P.side === 'Buy' ? LONG : SHORT);
      out.push({ id: 'pos', p: P.avg, color: pc, width: 2, dash: null, drag: false, label: `${P.side === 'Buy' ? 'Long' : 'Short'} ${P.size} @ ${this.fmt(P.avg)} · ${P.upnl >= 0 ? '+' : ''}${nf(2).format(P.upnl)} $`, box: true });
      if (P.sl) out.push({ id: 'sl', p: P.sl, color: pc, width: 1, dash: 'dashed', drag: true, label: `SL ${this.fmt(P.sl)}` });
      if (P.tp) out.push({ id: 'tp', p: P.tp, color: pc, width: 1, dash: 'dotted', drag: true, label: `TP ${this.fmt(P.tp)}` });
      if (P.liq) out.push({ id: 'liq', p: P.liq, color: '#e91e63', width: 1, dash: 'sparse', drag: false, label: `Liq ${this.fmt(P.liq)}` });
    }
    for (const o of this.orders) {
      const p0 = o.trigger || o.price;
      if (!(p0 > 0)) continue;
      out.push({ id: 'ord:' + o.id, p: p0, color: ink(o.side === 'Buy' ? LONG : SHORT), width: 1, dash: 'dashed', drag: false, label: `${o.reduce ? 'TP/SL' : o.trigger ? 'Stop' : 'Limit'} ${o.side === 'Buy' ? 'Kauf' : 'Verkauf'} ${o.qty} @ ${this.fmt(p0)}` });
    }
    return out;
  }
  /** Linie wurde gezogen: Planung sofort, echte Position nach Bestätigung. */
  dragLine(id, price, done) {
    const I = this.inst.get(this.symbol);
    const p = I ? +roundStep(price, I.tick).toFixed(decOf(I.tick)) : +price.toFixed(Math.max(0, this.app.priceDec ?? 2));
    if (id === 'entry' || id === 'stop' || id === 'target') { this.plan[id] = p; this.render(true); return; }
    if (!done) { this._dragPreview = { id, p }; return; }
    this._dragPreview = null;
    if (id === 'sl' || id === 'tp') this.moveStop(id, p);
  }
  /** Klick in den Chart: Strg = Entry, Umschalt = Stop, Alt = Ziel; oder nach „antippen“ im Panel. */
  chartClick(price, mods) {
    const kind = this.pick || (mods.ctrl ? 'entry' : mods.shift ? 'stop' : mods.alt ? 'target' : null);
    if (!kind || (kind === 'entry' && this.cfg.type === 'market')) return false;
    this.pick = null;
    this.dragLine(kind, price, true);
    if (this.app.ui.mobile && !this._sheetClose) setTimeout(() => this.toggle(true), 150);
    this.redraw();
    return true;
  }
  redraw() { this.app.drawings?._changed(false); }

  // ---------------------------------------------------------------- Schlüssel
  saveKey(env, key, secret) {
    this.keys[env] = { key: key.trim(), secret: secret.trim() };
    storage.set(KEYS, this.keys);
    this.stopWs(); this.start();
  }
  deleteKey(env) {
    delete this.keys[env];
    storage.set(KEYS, this.keys);
    if (env === this.env) { this.stopWs(); this.pos = null; this.orders = []; this.wallet = null; }
    this.render(); this.redraw();
  }
  async setEnv(env) {
    if (env === this.env) return;
    if (env === 'live') {
      const ok = await this.confirm('Live-Handel einschalten', [['Konto', 'Bybit Live – echtes Geld'], ['Jede Order', 'wird vorher bestätigt']], 'Live einschalten', true);
      if (!ok) return;
    }
    this.cfg.env = env; this.save();
    this.stopWs(); this.pos = null; this.orders = []; this.wallet = null; this.inst.clear();
    this.start(); this.redraw();
  }

  // ---------------------------------------------------------------- Panel
  /** In die rechte Leiste (PC) zeichnen. */
  renderInto(head, body) { this._dock = { head, body }; this.render(); }
  render(force = false) {
    document.getElementById('traderBtn')?.classList.toggle('on', !!this.open);
    const t = this._sheet || (this.app.state.rightOpen && this.app.state.rightPanel === 'trader' && this._dock);
    if (!t) return;
    const { head, body } = t;
    // Während der Eingabe nicht neu zeichnen (Fokus bliebe sonst nicht im Feld) – nach dem Verlassen nachholen
    const ae = document.activeElement;
    if (!force && ae && body.contains(ae) && ae.tagName === 'INPUT') {
      if (!this._pendingBlur) { this._pendingBlur = true; ae.addEventListener('blur', () => { this._pendingBlur = false; setTimeout(() => this.render(), 0); }, { once: true }); }
      return;
    }
    const live = this.env === 'live', c = this.cfg, k = this.key, I = this.inst.get(this.symbol);
    const stat = !k ? 'kein Schlüssel' : this.wsState === 'live' ? 'verbunden' : this.wsState;
    head.innerHTML = `<b>TQI Trader</b><span class="status ${this.wsState === 'live' ? 'ok' : k ? 'warn' : 'off'}" title="${esc(stat)}"><i></i></span><div class="grow"></div><button class="tb icon tr-x" data-x title="Trader schließen">${ICON.close}</button>`;
    head.querySelector('[data-x]').onclick = () => this.toggle(false);
    const envRow = `<div class="tr-sec tr-envrow"><div class="seg tr-envseg"><button data-env="demo" class="${!live ? 'on' : ''}">Demo</button><button data-env="live" class="${live ? 'on live' : ''}">Live</button></div><span class="status ${this.wsState === 'live' ? 'ok' : k ? 'warn' : 'off'}"><i></i><span>${esc(stat)}</span></span></div>`;
    const bindEnv = () => body.querySelectorAll('[data-env]').forEach(b => b.onclick = () => this.setEnv(b.dataset.env));
    if (!k) { body.innerHTML = envRow + this.keyForm(); this.bindKeyForm(body); bindEnv(); return; }
    const W = this.wallet, P = this.pos, calc = this.calc();
    const val = (x) => (x > 0 ? String(x) : '');
    body.innerHTML = `${envRow}
      ${live ? '<div class="tr-live">LIVE – echtes Geld</div>' : ''}
      ${this.err ? `<div class="tr-err">${esc(this.err)}</div>` : ''}
      <div class="tr-sec"><div class="tr-row"><span>Verfügbar</span><b>${W ? nf(2).format(W.avail) + ' $' : '…'}</b></div><div class="tr-row"><span>Equity</span><b>${W ? nf(2).format(W.equity) + ' $' : '…'}</b></div></div>
      <div class="tr-sec"><div class="tr-t">Position ${esc(this.symbol)}</div>
        ${P ? `<div class="tr-pos ${P.side === 'Buy' ? 'long' : 'short'}"><b>${P.side === 'Buy' ? 'Long' : 'Short'} ${P.size}</b> @ ${this.fmt(P.avg)} · <b>${P.upnl >= 0 ? '+' : ''}${nf(2).format(P.upnl)} $</b><br><span class="muted">SL ${P.sl ? this.fmt(P.sl) : '–'} · TP ${P.tp ? this.fmt(P.tp) : '–'} · Liq ${P.liq ? this.fmt(P.liq) : '–'} · ${P.lev || '–'}x</span></div>
          <div class="tr-btns"><button class="tb" data-act="be">Break-even</button><button class="tb danger" data-act="close">Schließen</button></div>` : '<div class="muted">keine Position</div>'}
        ${this.orders.length ? `<div class="tr-orders">${this.orders.map(o => `<div class="tr-ord"><span>${o.reduce ? 'TP/SL' : o.trigger ? 'Stop' : 'Limit'} ${o.side === 'Buy' ? 'Kauf' : 'Verkauf'} ${o.qty} @ ${this.fmt(o.trigger || o.price)}</span><button class="tb icon" data-cancel="${esc(o.id)}" title="Order löschen">✕</button></div>`).join('')}</div><div class="tr-btns"><button class="tb" data-act="cancelAll">Alle Orders löschen</button></div>` : ''}
      </div>
      <div class="tr-sec"><div class="tr-t">Neue Order</div>
        <div class="seg tr-type">${TYPES.map(([v, , l, tip]) => `<button data-type="${v}" class="${c.type === v ? 'on' : ''}" title="${esc(tip)}">${l}</button>`).join('')}</div>
        ${[['entry', 'Entry', 'Strg+Klick'], ['stop', 'Stop', 'Umschalt+Klick'], ['target', 'Ziel', 'Alt+Klick']].map(([key, l, hint]) => `
          <label class="tr-in"><span>${l}</span><input type="number" inputmode="decimal" step="${I?.tick || 0.1}" data-plan="${key}" value="${key === 'entry' && c.type === 'market' ? '' : val(this.plan[key])}" ${key === 'entry' && c.type === 'market' ? 'placeholder="Markt (aktueller Kurs)" disabled' : ''}><button class="tb sm ${this.pick === key ? 'on' : ''}" data-pick="${key}" title="${hint} im Chart" ${key === 'entry' && c.type === 'market' ? 'disabled' : ''}>${this.app.ui.mobile ? 'antippen' : hint}</button></label>`).join('')}
        <label class="tr-in"><span>Risiko $</span><input type="number" inputmode="decimal" min="1" step="1" data-cfg="risk" value="${c.risk}"><span class="muted">${c.fees !== false ? 'inkl. Gebühren' : 'ohne Gebühren'}</span></label>
        <label class="tr-in"><span>Hebel</span><input type="number" inputmode="numeric" min="0" max="${I?.maxLev || 100}" step="1" data-cfg="lev" value="${c.lev || 0}"><span class="muted">0 = automatisch</span></label>
        ${calc ? `<div class="tr-calc ${calc.long ? 'long' : 'short'}"><b>${calc.long ? 'Long' : 'Short'}</b> · Menge <b>${this.qtyStr(calc.qty)}</b> (${nf(0).format(calc.notional)} $) · Hebel <b>${calc.lev}x</b> · Marge ${nf(2).format(calc.margin)} $<br>Gebühren ${nf(2).format(calc.feesUsd)} $ · R:R ${calc.rr ? nf(2).format(calc.rr) : '–'} · Liq ≈ ${this.fmt(calc.liq)}</div>
          ${calc.warn.map(w => `<div class="tr-warn">${esc(w)}</div>`).join('')}` : `<div class="muted">${this.app.ui.mobile
            ? (c.type === 'market' ? 'Stop eintippen oder „antippen“ und dann auf den Preis im Chart tippen – Entry ist der aktuelle Kurs.' : 'Entry und Stop eintippen oder „antippen“ und dann auf den Preis im Chart tippen. Linien danach im Chart verschieben.')
            : (c.type === 'market' ? 'Stop setzen (Umschalt+Klick in den Chart oder eintippen) – Entry ist der aktuelle Kurs.' : 'Entry und Stop setzen (Strg+Klick / Umschalt+Klick in den Chart oder eintippen), Linien im Chart ziehen.')} Long oder Short ergibt sich aus dem Stop.</div>`}
        <div class="tr-btns"><button class="tb" data-act="clear">Leeren</button><label class="mini"><input type="checkbox" data-cfg="keepLines" ${c.keepLines ? 'checked' : ''}> Linien auch bei geschlossenem Panel</label></div>
        <button class="tb primary tr-send ${calc ? (calc.long ? 'long' : 'short') : ''}" data-act="send" ${calc && !this.busy ? '' : 'disabled'}>${this.busy ? 'sendet …' : calc ? `${calc.long ? 'Long' : 'Short'} prüfen und senden …` : 'Order prüfen …'}</button>
      </div>
      <div class="tr-sec tr-foot"><button class="tb sm" data-act="key">Schlüssel ${live ? 'Live' : 'Demo'} ändern</button><button class="tb sm" data-act="refresh">Aktualisieren</button></div>`;
    bindEnv();
    body.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { c.type = b.dataset.type; this.save(); this.render(true); this.redraw(); });
    body.querySelectorAll('[data-plan]').forEach(inp => inp.onchange = () => { const v = parseFloat(String(inp.value).replace(',', '.')); this.plan[inp.dataset.plan] = v > 0 ? v : null; this.render(true); this.redraw(); });
    body.querySelectorAll('[data-cfg]').forEach(inp => inp.onchange = () => {
      const k2 = inp.dataset.cfg;
      if (inp.type === 'checkbox') c[k2] = inp.checked; else { const v = parseFloat(String(inp.value).replace(',', '.')); c[k2] = Number.isFinite(v) && v >= 0 ? v : c[k2]; }
      this.save(); this.render(true); this.redraw();
    });
    body.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
      this.pick = this.pick === b.dataset.pick ? null : b.dataset.pick;
      if (this.app.ui.mobile && this.pick && this._sheetClose) { this._sheetClose(); this.app.ui.toast('Tippe auf den Preis im Chart', 'info', 2000); }
      this.render(true);
    });
    body.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => this.cancelOne(b.dataset.cancel));
    body.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const act = b.dataset.act;
      if (act === 'send') this.placeOrder();
      if (act === 'close') this.closePosition();
      if (act === 'be') this.breakEven();
      if (act === 'cancelAll') this.cancelAll();
      if (act === 'refresh') this.refresh();
      if (act === 'clear') { this.plan = { entry: null, stop: null, target: null }; this.render(true); this.redraw(); }
      if (act === 'key') { body.innerHTML = envRow + this.keyForm(true); this.bindKeyForm(body); bindEnv(); }
    });
  }
  keyForm(edit) {
    const env = this.env, live = env === 'live';
    return `<div class="tr-sec"><div class="tr-t">Bybit API-Schlüssel (${live ? 'Live' : 'Demo'})</div>
      <div class="tr-note">Schlüssel bei Bybit ${live ? '' : 'im Demo-Trading '}unter API-Verwaltung anlegen: nur <b>Verträge – Orders und Positionen</b>, <b>keine</b> Auszahlung und kein Transfer. Schlüssel und Secret bleiben nur in diesem Browser gespeichert und gehen nur an Bybit.</div>
      <label class="tr-in col"><span>API-Key</span><input type="text" autocomplete="off" spellcheck="false" data-k="key"></label>
      <label class="tr-in col"><span>Secret</span><input type="password" autocomplete="off" spellcheck="false" data-k="secret"></label>
      <div class="tr-btns"><button class="tb primary" data-save>Speichern</button>${edit ? `<button class="tb" data-back>Zurück</button><button class="tb danger" data-del>Schlüssel löschen</button>` : ''}</div></div>`;
  }
  bindKeyForm(body) {
    const env = this.env;
    body.querySelector('[data-save]').onclick = () => {
      const key = body.querySelector('[data-k="key"]').value, secret = body.querySelector('[data-k="secret"]').value;
      if (key.trim().length < 8 || secret.trim().length < 8) { this.app.ui.toast('API-Key und Secret eintragen', 'error'); return; }
      this.saveKey(env, key, secret);
    };
    body.querySelector('[data-back]')?.addEventListener('click', () => this.render());
    body.querySelector('[data-del]')?.addEventListener('click', async () => { if (await this.confirm('Schlüssel löschen', [['Konto', env === 'live' ? 'Live' : 'Demo'], ['Gespeichert', 'nur in diesem Browser']], 'Löschen', true)) this.deleteKey(env); });
  }
}

function normOrder(x) {
  return { id: x.orderId, side: x.side, qty: +x.qty, price: +x.price || 0, trigger: +x.triggerPrice || 0, type: x.orderType, reduce: !!x.reduceOnly || /TakeProfit|StopLoss|PartialStopLoss|PartialTakeProfit/.test(x.stopOrderType || '') };
}
