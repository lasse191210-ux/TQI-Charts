// Market Profile (TPO) und Volumenprofil je Session-Tag, Value Areas, Composites,
// Naked POC / UFA, Single Prints, Tails. Grundlage: 30-Minuten-Kerzen (eine Kerze = eine TPO-Periode).
import { periodStart, DAY, niceStep, lowerBound } from '../util.js';

/**
 * Value Area um den POC. step = Zeilen, die pro Schritt verglichen und hinzugefügt werden
 * (2 = ATAS-/CBOT-Methode, 1 = einfach). Gibt Indizes zurück.
 */
export function valueArea(vals, pct = 68, step = 2) {
  const n = vals.length;
  if (!n) return null;
  let total = 0, best = -1;
  for (let i = 0; i < n; i++) { total += vals[i]; if (best < 0 || vals[i] > vals[best]) best = i; }
  if (!(total > 0)) return null;
  // bei Gleichstand: POC am nächsten zur Mitte
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) if (vals[i] === vals[best] && Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  const target = total * pct / 100;
  let lo = best, hi = best, acc = vals[best];
  while (acc < target && (lo > 0 || hi < n - 1)) {
    let up = 0, dn = 0, nu = 0, nd = 0;
    for (let k = 1; k <= step; k++) {
      if (hi + k < n) { up += vals[hi + k]; nu++; }
      if (lo - k >= 0) { dn += vals[lo - k]; nd++; }
    }
    if (!nu) { lo -= nd; acc += dn; continue; }
    if (!nd) { hi += nu; acc += up; continue; }
    if (up >= dn) { hi += nu; acc += up; } else { lo -= nd; acc += dn; }
  }
  return { poc: best, lo: Math.max(0, lo), hi: Math.min(n - 1, hi), total };
}

/** Zeilengröße automatisch: Median-Tagesspanne / 100, auf 1-2-2,5-5 gerundet. */
export function autoRowSize(dailyBars) {
  const rs = dailyBars.slice(-21, -1).map(b => b.h - b.l).filter(x => x > 0).sort((a, b) => a - b);
  if (!rs.length) {
    const p = dailyBars.length ? dailyBars[dailyBars.length - 1].c : 100;
    return niceStep(p * 0.0005);
  }
  const med = rs[Math.floor(rs.length / 2)];
  return niceStep(med / 100);
}

/**
 * Tagesprofile aus 30m-Kerzen. rowSize in Preis-Einheiten, Raster global (Zeile = floor(Preis/rowSize)).
 * Jede Kerze = eine TPO-Periode; Volumen wird gleichmäßig auf die berührten Zeilen verteilt.
 */
export function buildDayProfiles(bars, { rowSize, offset = 0, now = Date.now(), sess = null }) {
  const days = [];
  let d = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    let ds, de, day;
    if (sess) { const x = sess.of(b.t); if (!x) continue; [ds, de, day] = x; }
    else { ds = periodStart(b.t, 'day', offset); de = ds + DAY; day = ds; }
    if (!d || d.start !== ds) {
      if (d) finishDay(d);
      d = { start: ds, end: de, day, first: i, last: i, o: b.o, h: b.h, l: b.l, c: b.c, v: 0, periods: [], partialStart: !days.length && bars[0].t > ds };
      days.push(d);
    }
    d.last = i;
    if (b.h > d.h) d.h = b.h;
    if (b.l < d.l) d.l = b.l;
    d.c = b.c; d.v += b.v;
    d.periods.push(b);
  }
  if (d) finishDay(d);
  for (const x of days) x.complete = x.end <= now && !x.partialStart;
  return days;

  function finishDay(day) {
    const lo = Math.floor(day.l / rowSize), hi = Math.floor(day.h / rowSize);
    const n = hi - lo + 1;
    const tpo = new Int32Array(n), vol = new Float64Array(n);
    for (const b of day.periods) {
      const a = Math.floor(b.l / rowSize) - lo, z = Math.floor(b.h / rowSize) - lo;
      const per = b.v / (z - a + 1);
      for (let k = a; k <= z; k++) { tpo[k] += 1; vol[k] += per; }
    }
    day.rowLo = lo; day.rowHi = hi; day.tpo = tpo; day.vol = vol; day.rowSize = rowSize;
    day.nPeriods = day.periods.length;
    delete day.periods;
  }
}

/** Mehrere Tage zu einem Profil zusammenfassen. */
export function mergeProfiles(days) {
  if (!days.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const d of days) { if (d.rowLo < lo) lo = d.rowLo; if (d.rowHi > hi) hi = d.rowHi; }
  const n = hi - lo + 1;
  const tpo = new Float64Array(n), vol = new Float64Array(n);
  for (const d of days) {
    const off = d.rowLo - lo;
    for (let k = 0; k < d.tpo.length; k++) { tpo[off + k] += d.tpo[k]; vol[off + k] += d.vol[k]; }
  }
  return { rowLo: lo, rowHi: hi, tpo, vol, rowSize: days[0].rowSize, start: days[0].start, end: days[days.length - 1].end, h: Math.max(...days.map(d => d.h)), l: Math.min(...days.map(d => d.l)) };
}

/** VAH / VAL / POC eines Profils als Preise. basis: 'vol' | 'tpo'. */
export function profileLevels(p, { basis = 'vol', pct = 68, step = 2 } = {}) {
  const arr = basis === 'tpo' ? p.tpo : p.vol;
  const va = valueArea(arr, pct, step);
  if (!va) return null;
  const rs = p.rowSize;
  return {
    poc: (p.rowLo + va.poc + 0.5) * rs,
    vah: (p.rowLo + va.hi + 1) * rs,
    val: (p.rowLo + va.lo) * rs,
  };
}

/** Läufe aus Zeilen mit genau einer TPO: Tails an den Extremen, sonst Single Prints. */
export function findSingles(day, { minSingle = 3, minTail = 3 } = {}) {
  const res = { singles: [], buyTail: null, sellTail: null };
  const n = day.tpo.length;
  let k = 0;
  while (k < n) {
    if (day.tpo[k] !== 1) { k++; continue; }
    let e = k;
    while (e + 1 < n && day.tpo[e + 1] === 1) e++;
    const len = e - k + 1;
    const zone = { bottom: (day.rowLo + k) * day.rowSize, top: (day.rowLo + e + 1) * day.rowSize, rows: len };
    if (k === 0 && e === n - 1) { /* ganzer Tag nur eine Periode */ }
    else if (k === 0) { if (len >= minTail) res.buyTail = zone; }
    else if (e === n - 1) { if (len >= minTail) res.sellTail = zone; }
    else if (len >= minSingle) res.singles.push(zone);
    k = e + 1;
  }
  return res;
}

/** Unfinished Auction (TPO-Modus): mindestens minTpos Perioden am Extrem. */
export function findUfa(day, { minTpos = 2 } = {}) {
  const n = day.tpo.length;
  return {
    high: day.tpo[n - 1] >= minTpos ? day.h : null,
    low: day.tpo[0] >= minTpos ? day.l : null,
  };
}

/**
 * Erste Berührung eines Levels (oder einer Zone) nach Zeitpunkt from.
 * bars: Kerzen aufsteigend (30m + aktuelle). mode 'touch' (Zone wird berührt) oder 'fill' (ganz durchgehandelt).
 */
export function firstTouch(bars, from, lo, hi, { tol = 0, mode = 'touch' } = {}) {
  let i = lowerBound(bars, from);
  if (mode === 'fill' && hi > lo) {
    let reachedTop = false, reachedBottom = false;
    for (; i < bars.length; i++) {
      const b = bars[i];
      if (b.h >= hi - tol) reachedTop = true;
      if (b.l <= lo + tol) reachedBottom = true;
      if (reachedTop && reachedBottom) return b.t;
    }
    return null;
  }
  for (; i < bars.length; i++) {
    const b = bars[i];
    if (b.l <= hi + tol && b.h >= lo - tol) return b.t;
  }
  return null;
}
