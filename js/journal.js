// Trading-Journal: abgeschlossene Trades aus dem Bybit-Konto (Demo oder Live) – nur lesen, nie handeln.
// Liste mit PnL, Gebühren, R (wenn mit dem TQI Trader geplant), Notizen und CSV-Export.
// Im Chart: Ein- und Ausstiege (Ausführungen) des aktuellen Coins als Pfeile.
import { storage, fmtPrice, fmtDateTime, nf, escapeHtml as esc, DAY } from './util.js';
import { ICON } from './icons.js';

const NOTES = 'tqi-charts:journal-notes';
const PLANS = 'tqi-charts:journal-plans';
const n2 = nf(2);

export class Journal {
  constructor(app) {
    this.app = app;
    this.trades = [];       // abgeschlossene Trades (alle Coins)
    this.fills = [];        // Ausführungen des aktuellen Coins (Chart)
    this.fillKey = null;
    this.days = 30;
    this.loading = false;
    this.err = null;
    this._t = 0;
    setInterval(() => { if (this.showOnChart && this.app.trader?.key && document.visibilityState === 'visible') this.loadFills(); }, 120000);
  }
  get T() { return this.app.trader; }
  get notes() { return storage.get(NOTES, {}) || {}; }
  setNote(id, patch) { const n = this.notes; n[id] = { ...(n[id] || {}), ...patch }; storage.set(NOTES, n); this.app.sync?.dirty(); }
  get showOnChart() { return this.app.state.trader?.marks !== false; }

  /** Vom TQI Trader beim Senden einer Order: Plan merken (für R = PnL / Risiko). */
  addPlan(p) {
    const list = (storage.get(PLANS, []) || []).filter(x => Date.now() - x.t < 60 * DAY);
    list.push({ ...p, t: Date.now(), env: this.T.env });
    storage.set(PLANS, list.slice(-400));
  }
  planFor(tr) {
    const list = storage.get(PLANS, []) || [];
    let best = null;
    for (const p of list) {
      if (p.env !== tr.env || p.symbol !== tr.symbol || p.side === tr.closeSide) continue;
      if (p.t > tr.t || tr.t - p.t > 14 * DAY) continue;
      if (!best || p.t > best.t) best = p;
    }
    return best;
  }

  // ---------------------------------------------------------------- Laden (signierte GET-Anfragen, nur lesen)
  async load(days = this.days) {
    const T = this.T;
    if (!T.key) { this.err = 'Kein API-Schlüssel im TQI Trader gespeichert'; return; }
    this.loading = true; this.err = null;
    try {
      await T.syncTime();
      const out = [], end = Date.now();
      for (let e = end, k = 0; e > end - days * DAY && k < 60; e -= 7 * DAY, k++) {
        const s = Math.max(end - days * DAY, e - 7 * DAY + 1);
        let cursor = '';
        for (let g = 0; g < 20; g++) {
          const r = await T.req('GET', '/v5/position/closed-pnl', { category: 'linear', startTime: s, endTime: e, limit: 100, ...(cursor ? { cursor } : {}) });
          for (const x of r.list || []) out.push(this._norm(x));
          cursor = r.nextPageCursor;
          if (!cursor || !(r.list || []).length) break;
        }
      }
      const seen = new Set();
      this.trades = out.filter(x => (seen.has(x.id) ? false : seen.add(x.id))).sort((a, b) => b.t - a.t);
      this.loadedAt = Date.now(); this.loadedEnv = T.env; this.days = days;
    } catch (e) { this.err = e.message || String(e); }
    this.loading = false;
  }
  _norm(x) {
    const T = this.T;
    const fees = (+x.openFee || 0) + (+x.closeFee || 0);
    const pnl = +x.closedPnl || 0;
    const entry = +x.avgEntryPrice, exit = +x.avgExitPrice;
    // side = Seite der schließenden Order (Verkauf schließt einen Long)
    let long = x.side === 'Sell';
    const gross = pnl + fees;
    if (Math.abs(exit - entry) / entry > 1e-4 && Math.abs(gross) > 1e-9 && ((exit > entry) === (gross > 0)) !== long) long = !long;
    return { id: x.orderId + '|' + x.updatedTime, env: T.env, symbol: x.symbol, long, closeSide: x.side, qty: +x.closedSize || +x.qty, entry, exit, pnl, fees, lev: +x.leverage || null, t: +x.updatedTime || +x.createdTime, fills: +x.fillCount || 0 };
  }
  /** Ausführungen des aktuellen Coins (letzte 7 Tage) für die Pfeile im Chart. */
  async loadFills() {
    const T = this.T;
    if (!T.key || this._fillBusy) return;
    this._fillBusy = true;
    const sym = T.symbol, key = T.env + '|' + sym;
    try {
      const out = [];
      let cursor = '';
      for (let g = 0; g < 10; g++) {
        const r = await T.req('GET', '/v5/execution/list', { category: 'linear', symbol: sym, limit: 100, ...(cursor ? { cursor } : {}) });
        for (const x of r.list || []) if (!x.execType || x.execType === 'Trade') out.push({ t: +x.execTime, p: +x.execPrice, q: +x.execQty, buy: x.side === 'Buy', close: +x.closedSize > 0, fee: +x.execFee || 0 });
        cursor = r.nextPageCursor;
        if (!cursor || !(r.list || []).length) break;
      }
      if (T.symbol === sym && T.env === key.split('|')[0]) { this.fills = out.sort((a, b) => a.t - b.t); this.fillKey = key; this.app._recompute?.(); }
    } catch (e) { console.warn('Journal Ausführungen', e); }
    this._fillBusy = false;
  }
  /** Nach einer Ausführung (vom Trader): kurz warten, dann neu laden. */
  touch() { clearTimeout(this._t); this._t = setTimeout(() => { this.loadFills(); if (this.trades.length) this.load(this.days); }, 2500); }
  onSymbol() { this.fills = []; this.fillKey = null; if (this.showOnChart && this.T.key) this.loadFills(); }

  /** Pfeile für Ein- und Ausstiege im Chart (aktueller Coin). */
  draw(scene, cut = Infinity) {
    if (!this.showOnChart || !this.fills.length || this.fillKey !== this.T.env + '|' + this.T.symbol) return;
    const bars = this.app.bars;
    if (!bars.length) return;
    const t0 = bars[0].t;
    for (const f of this.fills) {
      if (f.t < t0 || f.t >= cut) continue;
      const col = f.buy ? '#089981' : '#f23645';
      scene.mark({ t: f.t, p: f.p, shape: f.buy ? 'up' : 'down', color: col, size: 6, text: `${f.close ? 'Exit' : f.buy ? 'Kauf' : 'Verkauf'} ${f.q}` });
    }
  }

  // ---------------------------------------------------------------- Auswertung
  stats(list) {
    const n = list.length;
    if (!n) return null;
    const wins = list.filter(x => x.pnl > 0), losses = list.filter(x => x.pnl < 0);
    const sum = list.reduce((s, x) => s + x.pnl, 0), fees = list.reduce((s, x) => s + x.fees, 0);
    const gw = wins.reduce((s, x) => s + x.pnl, 0), gl = -losses.reduce((s, x) => s + x.pnl, 0);
    const rs = list.map(x => this.rOf(x)).filter(Number.isFinite);
    return { n, win: wins.length / n, sum, fees, pf: gl > 0 ? gw / gl : null, best: Math.max(...list.map(x => x.pnl)), worst: Math.min(...list.map(x => x.pnl)), avgR: rs.length ? rs.reduce((s, x) => s + x, 0) / rs.length : null, rN: rs.length };
  }
  rOf(tr) {
    const note = this.notes[tr.id];
    const risk = note?.risk > 0 ? +note.risk : this.planFor(tr)?.risk;
    return risk > 0 ? tr.pnl / risk : NaN;
  }
  csv(list) {
    const c = (x) => (typeof x === 'number' ? String(Math.round(x * 1e6) / 1e6).replace('.', ',') : `"${String(x ?? '').replace(/"/g, '""')}"`);
    const head = ['Datum', 'Konto', 'Symbol', 'Richtung', 'Menge', 'Entry', 'Exit', 'PnL netto ($)', 'Gebühren ($)', 'R', 'Risiko ($)', 'Setup', 'Notiz'];
    const rows = list.map(x => {
      const nt = this.notes[x.id] || {}, r = this.rOf(x), plan = this.planFor(x);
      return [fmtDateTime(x.t, this.app.tz), x.env === 'live' ? 'Live' : 'Demo', x.symbol, x.long ? 'Long' : 'Short', x.qty, x.entry, x.exit, x.pnl, x.fees, Number.isFinite(r) ? r : '', nt.risk > 0 ? +nt.risk : plan?.risk ?? '', nt.setup || '', nt.note || ''].map(c).join(';');
    });
    return '﻿' + head.map(c).join(';') + '\n' + rows.join('\n');
  }

  // ---------------------------------------------------------------- Fenster
  async open() {
    const a = this.app, ui = a.ui;
    const body = document.createElement('div');
    body.className = 'setdlg journal';
    let filter = 'all';
    const render = () => {
      const T = this.T;
      const list = this.trades.filter(x => filter === 'all' || x.symbol === T.symbol);
      const s = this.stats(list), notes = this.notes;
      const money = (x) => `<span class="${x > 0 ? 'up' : x < 0 ? 'dn' : ''}">${x > 0 ? '+' : ''}${n2.format(x)} $</span>`;
      body.innerHTML = `
        <div class="jr-bar">
          <span class="jr-env ${T.env}">${T.env === 'live' ? 'Live-Konto' : 'Demo-Konto'}</span>
          <select data-j="days">${[7, 30, 90, 180].map(d => `<option value="${d}" ${d === this.days ? 'selected' : ''}>letzte ${d} Tage</option>`).join('')}</select>
          <select data-j="filter"><option value="all" ${filter === 'all' ? 'selected' : ''}>alle Coins</option><option value="sym" ${filter === 'sym' ? 'selected' : ''}>nur ${esc(T.symbol)}</option></select>
          <label class="chk"><input type="checkbox" data-j="marks" ${this.showOnChart ? 'checked' : ''}><i></i><span>Ein-/Ausstiege im Chart</span></label>
          <div class="grow"></div>
          <button class="tb" data-j="reload">${ICON.reset || ''}<span>Aktualisieren</span></button>
          <button class="tb" data-j="csv">CSV</button>
        </div>
        ${!T.key ? `<div class="info-box">Für das Journal im TQI Trader den Bybit-API-Schlüssel (${T.env === 'live' ? 'Live' : 'Demo'}) eintragen. Das Journal liest nur (abgeschlossene Trades und Ausführungen), es handelt nie.</div>` : ''}
        ${this.err ? `<div class="info-box err">${esc(this.err)}</div>` : ''}
        ${this.loading ? '<div class="muted pad">lädt …</div>' : ''}
        ${s ? `<div class="jr-stats">
          <div><small>Trades</small><b>${s.n}</b></div>
          <div><small>Gewinnrate</small><b>${Math.round(s.win * 100)} %</b></div>
          <div><small>Summe netto</small><b>${money(s.sum)}</b></div>
          <div><small>Gebühren</small><b>${n2.format(s.fees)} $</b></div>
          <div><small>Profit-Faktor</small><b>${s.pf != null ? n2.format(s.pf) : '–'}</b></div>
          <div><small>Ø R${s.rN ? ` (${s.rN})` : ''}</small><b>${s.avgR != null ? n2.format(s.avgR) : '–'}</b></div>
        </div>` : (!this.loading && T.key && !this.err ? '<div class="muted pad">Keine abgeschlossenen Trades im Zeitraum.</div>' : '')}
        <div class="jr-list">${list.map(x => {
          const nt = notes[x.id] || {}, r = this.rOf(x);
          return `<div class="jr-row" data-id="${esc(x.id)}">
            <div class="jr-main"><span class="jr-dir ${x.long ? 'l' : 's'}">${x.long ? 'Long' : 'Short'}</span><b>${esc(x.symbol)}</b><span class="muted">${esc(fmtDateTime(x.t, a.tz))}</span><span class="grow"></span>${money(x.pnl)}${Number.isFinite(r) ? `<span class="jr-r ${r >= 0 ? 'up' : 'dn'}">${r >= 0 ? '+' : ''}${n2.format(r)} R</span>` : ''}</div>
            <div class="jr-sub muted">${x.qty} @ ${fmtPrice(x.entry)} → ${fmtPrice(x.exit)} · Gebühren ${n2.format(x.fees)} $${x.lev ? ' · ' + x.lev + 'x' : ''}</div>
            <div class="jr-note"><input data-n="setup" placeholder="Setup (z. B. Absorption pdVAL)" value="${esc(nt.setup || '')}"><input data-n="note" placeholder="Notiz" value="${esc(nt.note || '')}"><input data-n="risk" type="number" inputmode="decimal" placeholder="Risiko $" title="Risiko in $ für R (sonst aus dem Trader-Plan)" value="${nt.risk || ''}"><button class="tb sm" data-chart="1" title="Im Chart zeigen">Chart</button></div>
          </div>`;
        }).join('')}</div>`;
    };
    render();
    const close = ui.modal('Journal · Bybit ' + (this.T.env === 'live' ? 'Live' : 'Demo'), body, { wide: true });
    body.addEventListener('change', async (e) => {
      const j = e.target.dataset.j, n = e.target.dataset.n;
      if (j === 'days') { this.loading = true; render(); await this.load(+e.target.value); render(); }
      if (j === 'filter') { filter = e.target.value; render(); }
      if (j === 'marks') { a.state.trader = { ...a.state.trader, marks: e.target.checked }; a._save(); if (e.target.checked) this.loadFills(); a.recompute(); }
      if (n) {
        const id = e.target.closest('[data-id]')?.dataset.id;
        if (id) { this.setNote(id, { [n]: n === 'risk' ? (+e.target.value || null) : e.target.value.trim() }); if (n === 'risk') render(); }
      }
    });
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-j],[data-chart]');
      if (!b) return;
      if (b.dataset.j === 'reload') { this.loading = true; render(); await this.load(this.days); this.loadFills(); render(); }
      if (b.dataset.j === 'csv') {
        const blob = new Blob([this.csv(this.trades.filter(x => filter === 'all' || x.symbol === this.T.symbol))], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob), l = document.createElement('a');
        l.href = url; l.download = `tqi-journal-${this.T.env}-${new Date().toISOString().slice(0, 10)}.csv`; l.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      if (b.dataset.chart) {
        const tr = this.trades.find(x => x.id === b.closest('[data-id]').dataset.id);
        if (!tr) return;
        close();
        const base = tr.symbol.replace(/USDT$/, '').replace(/^1000/, '');
        const go = () => { const bars = a.bars; const i = bars.findIndex(x => x.t >= tr.t); if (i >= 0) a.chart.timeScale().setVisibleLogicalRange({ from: i - 60, to: i + 20 }); };
        if (base !== a.state.base) { a.setSymbol(base); setTimeout(go, 2500); } else go();
      }
    });
    if (this.T.key && (!this.trades.length || this.loadedEnv !== this.T.env || Date.now() - (this.loadedAt || 0) > 60000)) { this.loading = true; render(); await this.load(this.days); render(); this.loadFills(); }
    return close;
  }
}
