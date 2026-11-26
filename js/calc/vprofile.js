// Volumenprofile aus Kerzen: das Volumen jeder Kerze wird gleichmäßig über ihre Spanne (Low bis High)
// verteilt, Kauf/Verkauf aus dem Taker-Kaufvolumen (bv) der Kerze. Raster global: Zeile = floor(Preis / rs).
import { valueArea } from './profile.js';
import { niceStep, periodStart, periodNext, lowerBound } from '../util.js';

const EPS = 1e-9;

/** Profil über bars[i0..i1] (inklusive). rs = Zeilengröße (Preis). */
export function volumeProfile(bars, i0, i1, rs, { vaPct = 70, step = 1 } = {}) {
  if (!(rs > 0) || i1 < i0 || i0 < 0 || i1 >= bars.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (let i = i0; i <= i1; i++) { const b = bars[i]; if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const r0 = Math.floor(lo / rs + EPS), r1 = Math.floor(hi / rs + EPS);
  const n = r1 - r0 + 1;
  if (n < 1 || n > 20000) return null;
  const vol = new Float64Array(n), buy = new Float64Array(n);
  let hasBuy = true, total = 0, tb = 0;
  for (let i = i0; i <= i1; i++) {
    const b = bars[i];
    const v = b.v;
    if (!(v > 0)) continue;
    let bf = 0.5;
    if (Number.isFinite(b.bv)) bf = Math.min(1, Math.max(0, b.bv / v)); else hasBuy = false;
    total += v; tb += v * bf;
    const a = Math.floor(b.l / rs + EPS) - r0, z = Math.floor(b.h / rs + EPS) - r0;
    if (a === z || !(b.h > b.l)) { vol[a] += v; buy[a] += v * bf; continue; }
    const span = b.h - b.l;
    for (let k = a; k <= z; k++) {
      const top = Math.min(b.h, (k + r0 + 1) * rs), bot = Math.max(b.l, (k + r0) * rs);
      const f = top > bot ? (top - bot) / span : 0;
      if (f > 0) { vol[k] += v * f; buy[k] += v * f * bf; }
    }
  }
  if (!(total > 0)) return null;
  const va = valueArea(vol, vaPct, step);
  let maxV = 0;
  for (let k = 0; k < n; k++) if (vol[k] > maxV) maxV = vol[k];
  return {
    r0, rs, n, vol, buy: hasBuy ? buy : null, maxV, total,
    delta: hasBuy ? 2 * tb - total : NaN,
    pocRow: va.poc, vaLo: va.lo, vaHi: va.hi,
    poc: (r0 + va.poc + 0.5) * rs, vah: (r0 + va.hi + 1) * rs, val: (r0 + va.lo) * rs,
    lo, hi, t0: bars[i0].t, t1: bars[i1].t,
  };
}

/** Zeitspanne [t0, t1) als Profil (Kerzen, deren Start im Bereich liegt). */
export function rangeProfile(bars, t0, t1, rs, opts) {
  if (!bars.length) return null;
  const i0 = lowerBound(bars, t0);
  let i1 = lowerBound(bars, t1) - 1;
  if (i1 >= bars.length) i1 = bars.length - 1;
  return i0 <= i1 ? volumeProfile(bars, i0, i1, rs, opts) : null;
}

/** Profile je Periode (Tag/Woche/Monat) – die letzten count Perioden bis jetzt. */
export function sessionProfiles(bars, { period = 'day', offset = 0, count = 10, rs, vaPct = 70, step = 1, now = Date.now() }) {
  if (!bars.length || !(rs > 0)) return [];
  let start = periodStart(now, period, offset);
  const starts = [start];
  for (let k = 1; k < count; k++) {
    // Periode davor: Start der Periode, in der (start - 1 ms) liegt
    start = periodStart(start - 1, period, offset);
    starts.unshift(start);
  }
  const out = [];
  for (const s of starts) {
    const e = periodNext(s, period, offset);
    const p = rangeProfile(bars, s, e, rs, { vaPct, step });
    if (p) out.push({ start: s, end: e, prof: p, live: now < e });
  }
  return out;
}

/** Automatische Zeilengröße für eine Preisspanne (rows ≈ Anzahl Zeilen). */
export function autoRows(lo, hi, rows = 80) {
  return niceStep(Math.max(hi - lo, Math.abs(hi) * 1e-4) / Math.max(4, rows));
}
