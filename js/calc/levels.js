// Institutionelle Level, SFP (Swing Failure Pattern), Volumen-Kerzen.
import { DAY, periodStart, periodPrev, lowerBound } from '../util.js';

/**
 * Level aus Tageskerzen (UTC-Tage). now = aktuelle Zeit.
 * Rückgabe: Liste {key, label, price, from}
 */
export function institutionalLevels(daily, now, opts = {}) {
  const out = [];
  if (!daily.length) return out;
  const o = Object.assign({ w52: true, pwHL: true, pmHL: true, pdHL: false, do: true, wo: true, mo: true, qo: false, yo: true, sma200: true, sma50: false }, opts);
  const today = periodStart(now, 'day');
  const idxToday = lowerBound(daily, today);
  const openAt = (t) => { const i = lowerBound(daily, t); return i < daily.length ? daily[i].o : NaN; };
  const hlRange = (a, b) => {
    let h = -Infinity, l = Infinity;
    for (let i = lowerBound(daily, a); i < daily.length && daily[i].t < b; i++) { if (daily[i].h > h) h = daily[i].h; if (daily[i].l < l) l = daily[i].l; }
    return Number.isFinite(h) ? { h, l } : null;
  };
  const week = periodStart(now, 'week'), month = periodStart(now, 'month'), quarter = periodStart(now, 'quarter'), year = periodStart(now, 'year');
  if (o.w52) {
    const r = hlRange(today - 364 * DAY, today + DAY);
    if (r) { out.push({ key: '52wH', label: '52w high', price: r.h, from: today }); out.push({ key: '52wL', label: '52w low', price: r.l, from: today }); }
  }
  if (o.pwHL) {
    const r = hlRange(periodPrev(week, 'week'), week);
    if (r) { out.push({ key: 'pwH', label: 'pw high', price: r.h, from: week }); out.push({ key: 'pwL', label: 'pw low', price: r.l, from: week }); }
  }
  if (o.pmHL) {
    const r = hlRange(periodPrev(month, 'month'), month);
    if (r) { out.push({ key: 'pmH', label: 'pm high', price: r.h, from: month }); out.push({ key: 'pmL', label: 'pm low', price: r.l, from: month }); }
  }
  if (o.pdHL) {
    const r = hlRange(today - DAY, today);
    if (r) { out.push({ key: 'pdH', label: 'pd high', price: r.h, from: today }); out.push({ key: 'pdL', label: 'pd low', price: r.l, from: today }); }
  }
  if (o.do && idxToday < daily.length && daily[idxToday].t === today) out.push({ key: 'do', label: 'do', price: daily[idxToday].o, from: today });
  if (o.wo) { const p = openAt(week); if (Number.isFinite(p)) out.push({ key: 'wo', label: 'wo', price: p, from: week }); }
  if (o.mo) { const p = openAt(month); if (Number.isFinite(p)) out.push({ key: 'mo', label: 'mo', price: p, from: month }); }
  if (o.qo) { const p = openAt(quarter); if (Number.isFinite(p)) out.push({ key: 'qo', label: 'qo', price: p, from: quarter }); }
  if (o.yo) { const p = openAt(year); if (Number.isFinite(p) && daily[0].t <= year) out.push({ key: 'yo', label: 'yo', price: p, from: year }); }
  const closes = daily.map(b => b.c);
  const smaLast = (n) => closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : NaN;
  if (o.sma200) { const v = smaLast(200); if (Number.isFinite(v)) out.push({ key: 'sma200', label: '200D SMA', price: v, from: today, sma: true }); }
  if (o.sma50) { const v = smaLast(50); if (Number.isFinite(v)) out.push({ key: 'sma50', label: '50D SMA', price: v, from: today, sma: true }); }
  return out;
}

/**
 * Swing Failure Pattern. Swing-Hoch/Tief mit `strength` Kerzen links und rechts.
 * Bearish: Hoch über offenem Swing-Hoch, Schluss mind. minDist darunter. Bullish umgekehrt.
 * Ein Swing gilt nach dem ersten Überschreiten als verbraucht.
 */
export function sfp(bars, { strength = 5, minDist = 0, maxSwings = 5, includeLive = false } = {}) {
  const out = [];
  const highs = [], lows = [];
  const n = bars.length;
  const end = includeLive ? n : n - 1;
  for (let i = 0; i < end; i++) {
    const k = i - strength;
    if (k >= strength) {
      let ph = true, pl = true;
      for (let j = k - strength; j <= k + strength; j++) {
        if (j === k) continue;
        if (bars[j].h >= bars[k].h) ph = false;
        if (bars[j].l <= bars[k].l) pl = false;
        if (!ph && !pl) break;
      }
      if (ph) { highs.push({ k, p: bars[k].h }); if (highs.length > maxSwings) highs.shift(); }
      if (pl) { lows.push({ k, p: bars[k].l }); if (lows.length > maxSwings) lows.shift(); }
    }
    const b = bars[i];
    for (let s = highs.length - 1; s >= 0; s--) {
      const sw = highs[s];
      if (sw.k + strength >= i) continue;
      if (b.h > sw.p) {
        if (b.c < sw.p - minDist) out.push({ i, t: b.t, type: 'bear', price: sw.p, swingT: bars[sw.k].t, ext: b.h });
        highs.splice(s, 1);
      }
    }
    for (let s = lows.length - 1; s >= 0; s--) {
      const sw = lows[s];
      if (sw.k + strength >= i) continue;
      if (b.l < sw.p) {
        if (b.c > sw.p + minDist) out.push({ i, t: b.t, type: 'bull', price: sw.p, swingT: bars[sw.k].t, ext: b.l });
        lows.splice(s, 1);
      }
    }
  }
  return out;
}

/** Kerzen mit auffällig hohem Volumen (Vergleich mit den letzten lookback Kerzen, ohne die aktuelle). */
export function volumeCandles(bars, { lookback = 200, sd = 3, sdExtreme = 5 } = {}) {
  const out = [];
  let s = 0, s2 = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i >= lookback) {
      const mean = s / lookback, dev = Math.sqrt(Math.max(0, s2 / lookback - mean * mean));
      if (dev > 0) {
        const z = (bars[i].v - mean) / dev;
        if (z >= sdExtreme) out.push({ i, t: bars[i].t, z, level: 2 });
        else if (z >= sd) out.push({ i, t: bars[i].t, z, level: 1 });
      }
    }
    const v = bars[i].v;
    s += v; s2 += v * v;
    if (i >= lookback) { const o = bars[i - lookback].v; s -= o; s2 -= o * o; }
  }
  return out;
}
