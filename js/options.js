// Options-Level aus Deribit (öffentlich, WebSocket JSON-RPC, kein Schlüssel):
// Call Resistance, Put Support, HVL (Gamma-Flip), Call/Put Wall, Max Pain, erwartete Spanne 1 Tag / 1 Woche,
// GEX 1–10, 0DTE-Level (nächster Verfall) und Major Wall.
// Gleiche Rechnung wie im TQI Terminal: Black-76 mit r = 0, Dealer-Konvention (Dealer long Calls, short Puts),
// GEX je Option = Vorzeichen × Gamma × Open Interest × Kurs² × 0,01.
import { Emitter } from './util.js';

const DAY = 864e5, YEAR = 365 * DAY;
const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
function parseExp(code) { const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(code || ''); return m ? Date.UTC(2000 + +m[3], MON[m[2]], +m[1], 8) : null; }
function parseInst(name) {
  const p = String(name).split('-');
  if (p.length < 4) return null;
  const ts = parseExp(p[1]);
  return ts ? { exp: p[1], expTs: ts, strike: +p[2], cp: p[3] } : null;
}

// ---------------------------------------------------------------- Black-76 (r = 0)
const SQ2PI = Math.sqrt(2 * Math.PI);
const npdf = (x) => Math.exp(-x * x / 2) / SQ2PI;
function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
export function greeks(F, K, T, sig, cp) {
  const sT = sig * Math.sqrt(T), d1 = (Math.log(F / K) + sig * sig * T / 2) / sT;
  return { delta: cp === 'C' ? ncdf(d1) : ncdf(d1) - 1, gamma: npdf(d1) / (F * sT) };
}

// ---------------------------------------------------------------- Rechnung (wie TQI Terminal: chainAn, chainProf, flipOf, dailyModel)
function chainAn(rows, S0) {
  const m = new Map();
  for (const r of rows) {
    let o = m.get(r.k);
    if (!o) { o = { k: r.k, gc: 0, gp: 0 }; m.set(r.k, o); }
    const g = (r.cp === 'C' ? 1 : -1) * r.gamma * r.oi * S0 * S0 * 0.01;
    if (r.cp === 'C') o.gc += g; else o.gp += g;
  }
  const L = [...m.values()].sort((a, b) => a.k - b.k), nr = L.filter(o => Math.abs(o.k / S0 - 1) <= 0.3);
  let mj = null;
  for (const o of nr) { const a = Math.abs(o.gc) + Math.abs(o.gp); if (a > 0 && (!mj || a > mj.g)) mj = { k: o.k, g: a }; }
  return { L, nr, mj };
}
/** Netto-GEX, wenn der Kurs bei X stünde (jede Option mit ihrer IV), Bereich S0 × (1 ± w). */
function chainProf(rows, S0, t0, w, n) {
  const R = [], tMin = 0.25 / (365 * 24), lim = Math.max(0.35, w * 1.6);
  for (const r of rows) {
    if (!(r.oi > 0) || !(r.iv > 0) || r.expTs <= t0 || Math.abs(r.k / S0 - 1) > lim) continue;
    const T = Math.max((r.expTs - t0) / YEAR, tMin), sg = Math.min(r.iv, 3), sT = sg * Math.sqrt(T);
    R.push([r.k, sT, sg * sg * T / 2, (r.cp === 'C' ? 1 : -1) * r.oi * 0.01]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const X = S0 * (1 - w + 2 * w * i / (n - 1));
    let tot = 0;
    for (const q of R) { const d1 = (Math.log(X / q[0]) + q[2]) / q[1]; if (d1 > -9 && d1 < 9) tot += q[3] * npdf(d1) / q[1] * X; }
    out.push([X, tot]);
  }
  return out;
}
function flipOf(prof, S0) {
  let b = null;
  for (let i = 1; i < prof.length; i++) {
    const a = prof[i - 1], c = prof[i];
    if ((a[1] < 0) !== (c[1] < 0) && a[1] !== c[1]) { const x = a[0] + (c[0] - a[0]) * (-a[1]) / (c[1] - a[1]); if (b == null || Math.abs(x - S0) < Math.abs(b - S0)) b = x; }
  }
  return b;
}
function atmIvOf(rows, S0) {
  let k = null, d = Infinity;
  for (const r of rows) { if (!(r.iv > 0)) continue; const dd = Math.abs(r.k - S0); if (dd < d) { d = dd; k = r.k; } }
  if (k == null) return null;
  const a = rows.filter(r => r.k === k && r.iv > 0);
  return a.reduce((s, r) => s + r.iv, 0) / a.length;
}
function maxPainOf(rows) {
  const ks = [...new Set(rows.filter(r => r.oi > 0).map(r => r.k))].sort((a, b) => a - b);
  let best = null, bv = Infinity;
  for (const X of ks) { let p = 0; for (const r of rows) if (r.oi > 0) p += r.oi * (r.cp === 'C' ? Math.max(X - r.k, 0) : Math.max(r.k - X, 0)); if (p < bv) { bv = p; best = X; } }
  return best;
}
const pick = (L, S0, up) => {
  let b = null;
  for (const o of L) {
    if (Math.abs(o.k / S0 - 1) > 0.3) continue;
    if (up) { if (o.k >= S0 && o.gc > 0 && (!b || o.gc > b.gc)) b = o; }
    else if (o.k <= S0 && o.gp < 0 && (!b || o.gp < b.gp)) b = o;
  }
  return b;
};

/** Alle Level aus der Deribit-Buchübersicht (get_book_summary_by_currency, kind=option). */
export function optionsModel(book, S0, now = Date.now()) {
  const rows = [];
  for (const b of book) {
    const ins = parseInst(b.instrument_name);
    if (!ins || ins.expTs <= now) continue;
    const oi = b.open_interest || 0, iv = (b.mark_iv || 0) / 100, F = b.underlying_price || S0;
    if (!(iv > 0) || !(F > 0)) continue;
    const T = (ins.expTs - now) / YEAR;
    const g = greeks(F, ins.strike, T, iv, ins.cp);
    rows.push({ k: ins.strike, cp: ins.cp, exp: ins.exp, expTs: ins.expTs, oi, iv, gamma: g.gamma, delta: g.delta });
  }
  if (!rows.length || !(S0 > 0)) return null;
  const exps = [...new Set(rows.map(r => r.expTs))].sort((a, b) => a - b);
  const e0 = exps.find(e => e > now);
  const nearest = (days) => exps.reduce((a, e) => Math.abs((e - now) / DAY - days) < Math.abs((a - now) / DAY - days) ? e : a, exps[0]);
  const rowsOf = (e) => rows.filter(r => r.expTs === e);
  const e1 = nearest(1), e7 = nearest(7);
  const iv1 = atmIvOf(rowsOf(e1), S0), iv7 = atmIvOf(rowsOf(e7), S0);
  const sd1 = iv1 ? iv1 * Math.sqrt(1 / 365) : null, sd7 = iv7 ? iv7 * Math.sqrt(7 / 365) : null;

  // Kern-Level (alle Verfälle)
  const A = chainAn(rows, S0);
  const hvl = flipOf(chainProf(rows, S0, now, 0.15, 121), S0);
  const CR = pick(A.L, S0, true), PS = pick(A.L, S0, false);
  // Call Wall / Put Wall = größte positive / negative Netto-GEX je Strike (±30 %)
  let cw = null, pw = null;
  for (const o of A.nr) { const net = o.gc + o.gp; if (net > 0 && (!cw || net > cw.net)) cw = { k: o.k, net }; if (net < 0 && (!pw || net < pw.net)) pw = { k: o.k, net }; }
  // nächster Verfall (0DTE)
  const rows0 = e0 ? rowsOf(e0) : [];
  let cr0 = null, ps0 = null, gw0 = null, hvl0 = null;
  if (rows0.length) {
    const A0 = chainAn(rows0, S0);
    cr0 = pick(A0.L, S0, true)?.k ?? null; ps0 = pick(A0.L, S0, false)?.k ?? null; gw0 = A0.mj ? A0.mj.k : null;
    const iv0 = atmIvOf(rows0, S0), T0 = Math.max(0, e0 - now) / YEAR, em0 = iv0 && T0 ? S0 * iv0 * Math.sqrt(T0) : null;
    const w = Math.min(0.25, Math.max(0.02, em0 ? 4 * em0 / S0 : 0.05));
    hvl0 = flipOf(chainProf(rows0, S0, now, w, 121), S0);
  }
  // GEX 1–10: meiste Gamma (Calls + Puts) in der erwarteten Tagesspanne, ohne Call Resistance / Put Support
  const tot = (o) => Math.abs(o.gc) + Math.abs(o.gp);
  let cand = [];
  for (const f of [1, 1.5, 2, 3]) {
    const lo = sd1 ? S0 * Math.exp(-sd1 * f) : S0 * (1 - 0.03 * f), hi = sd1 ? S0 * Math.exp(sd1 * f) : S0 * (1 + 0.03 * f);
    cand = A.L.filter(o => o.k >= lo && o.k <= hi && o.k !== CR?.k && o.k !== PS?.k && tot(o) > 0);
    if (cand.length >= 10) break;
  }
  const gex = cand.sort((a, b) => tot(b) - tot(a)).slice(0, 10).map((o, i) => ({ n: i + 1, k: o.k, net: o.gc + o.gp }));
  return {
    S0, t: now, cr: CR ? CR.k : null, ps: PS ? PS.k : null, hvl, callWall: cw ? cw.k : null, putWall: pw ? pw.k : null,
    maxPain: rows0.length ? maxPainOf(rows0) : null, frontExp: e0 || null,
    dMax: sd1 ? S0 * Math.exp(sd1) : null, dMin: sd1 ? S0 * Math.exp(-sd1) : null,
    wMax: sd7 ? S0 * Math.exp(sd7) : null, wMin: sd7 ? S0 * Math.exp(-sd7) : null,
    cr0, ps0, hvl0, gw0, major: A.mj ? A.mj.k : null, gex, n: rows.length,
  };
}

// ---------------------------------------------------------------- Deribit JSON-RPC über WebSocket (verbindet bei Bedarf, schließt nach Ruhe)
class DeribitRpc {
  constructor() { this.ws = null; this.id = 1; this.pending = new Map(); this.queue = []; this.idle = 0; }
  _open() {
    if (this.ws && this.ws.readyState <= 1) return;
    const ws = new WebSocket('wss://www.deribit.com/ws/api/v2');
    this.ws = ws;
    ws.onopen = () => { const q = this.queue; this.queue = []; for (const m of q) ws.send(m); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      const p = m && this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id); clearTimeout(p.tm);
      if (m.error) p.rej(new Error(m.error.message || 'Deribit-Fehler')); else p.res(m.result);
    };
    const fail = () => { for (const p of this.pending.values()) { clearTimeout(p.tm); p.rej(new Error('Verbindung zu Deribit getrennt')); } this.pending.clear(); this.ws = null; };
    ws.onclose = fail; ws.onerror = () => {};
  }
  call(method, params) {
    this._open();
    clearTimeout(this.idle);
    this.idle = setTimeout(() => { if (!this.pending.size && this.ws) { try { this.ws.close(); } catch { /* egal */ } this.ws = null; } }, 30000);
    return new Promise((res, rej) => {
      const id = this.id++;
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      const tm = setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('Zeitüberschreitung (Deribit)')); } }, 20000);
      this.pending.set(id, { res, rej, tm });
      if (this.ws.readyState === 1) this.ws.send(msg); else this.queue.push(msg);
    });
  }
}

/** Hält die Level je Währung (BTC, ETH), lädt bei Bedarf neu. */
export class OptionsData extends Emitter {
  constructor() { super(); this.rpc = new DeribitRpc(); this.cache = new Map(); this.busy = new Set(); }
  get(cur, maxAgeMs = 60000) {
    const c = this.cache.get(cur);
    if ((!c || Date.now() - c.at > maxAgeMs) && document.visibilityState === 'visible') this.load(cur);
    return c || null;
  }
  async load(cur) {
    if (this.busy.has(cur)) return;
    this.busy.add(cur);
    try {
      const [book, idx] = await Promise.all([
        this.rpc.call('public/get_book_summary_by_currency', { currency: cur, kind: 'option' }),
        this.rpc.call('public/get_index_price', { index_name: cur.toLowerCase() + '_usd' }),
      ]);
      const m = optionsModel(book || [], idx?.index_price);
      this.cache.set(cur, { at: Date.now(), m, err: m ? null : 'keine Optionsdaten' });
    } catch (e) {
      const old = this.cache.get(cur);
      this.cache.set(cur, { at: Date.now() - 30000, m: old?.m || null, err: e.message || String(e) });
    } finally {
      this.busy.delete(cur);
      this.emit('change', cur);
    }
  }
}
