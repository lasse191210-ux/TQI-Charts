// VWAP mit VAH/VAL (±1σ) und Bändern, Rolling VWAP, Perioden-Zusammenfassungen.
// Rechnung wie im ATAS-Nachbau (KeyLevelsAll): Summen aus src·v, v, v·src², σ = √(Σv·src²/Σv − vwap²).
import { periodStart, nextTf, floorTf } from '../util.js';

export function srcOf(b, kind) {
  switch (kind) {
    case 'hlc3': return (b.h + b.l + b.c) / 3;
    case 'close': return b.c;
    case 'hl2': return (b.h + b.l) / 2;
    default: return (b.o + b.h + b.l + b.c) / 4; // ohlc4
  }
}

/**
 * Verankerter VWAP je Periode (Tag/Woche/Monat/Quartal/Jahr), Periodenstart = UTC-Mitternacht + offset.
 * Unvollständige erste Periode (Daten beginnen mitten in der Periode) wird als NaN ausgegeben.
 */
export function anchoredVwap(bars, { source = 'ohlc4', period = 'day', offset = 0, allowPartial = false } = {}) {
  const n = bars.length;
  const vwap = new Float64Array(n).fill(NaN);
  const sd = new Float64Array(n).fill(NaN);
  const isNew = new Uint8Array(n);
  const pStart = new Float64Array(n);
  const prev = []; // abgeschlossene Perioden: {start, vwap, sd}
  if (!n) return { vwap, sd, isNew, pStart, prev };
  const ref = bars[0].c;
  let s0 = 0, s1 = 0, s2 = 0, cur = NaN, partial = false, lastV = NaN, lastS = NaN;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const ps = periodStart(b.t, period, offset);
    if (ps !== cur) {
      if (!Number.isNaN(cur) && !partial && Number.isFinite(lastV)) prev.push({ start: cur, vwap: lastV, sd: lastS });
      s0 = s1 = s2 = 0; cur = ps; isNew[i] = 1;
      partial = !allowPartial && i === 0 && b.t > ps;
    }
    const p = srcOf(b, source) - ref, v = b.v;
    s0 += v; s1 += p * v; s2 += v * p * p;
    pStart[i] = ps;
    if (s0 > 0) {
      const m = s1 / s0;
      lastV = m + ref; lastS = Math.sqrt(Math.max(0, s2 / s0 - m * m));
      if (!partial) { vwap[i] = lastV; sd[i] = lastS; }
    }
  }
  return { vwap, sd, isNew, pStart, prev, cur: partial ? null : { start: cur, vwap: lastV, sd: lastS } };
}

/** Aktuelle und vorherige Periode (VWAP, σ) aus beliebigen Kerzen (z. B. 30m- oder Tageskerzen). */
export function periodSummary(bars, opts) {
  const r = anchoredVwap(bars, opts);
  return { cur: r.cur, prev: r.prev.length ? r.prev[r.prev.length - 1] : null };
}

// ---------------------------------------------------------------- Rolling VWAP
const RES = [1, 3, 5, 15, 30, 60, 120, 240, 720, 1440];
const RES_TF = { 1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 720: '12h', 1440: '1D' };

/** Auflösung wie im Pine-Original: kleinste Zeiteinheit mit höchstens maxBars Kerzen im Fenster. */
export function autoResolution(days, maxBars = 1000) {
  const mins = days * 1440;
  for (const r of RES) if (mins / r <= maxBars) return RES_TF[r];
  return '1D';
}

/**
 * Rolling VWAP auf Kerzen einer festen Auflösung.
 * Fenster wie in Pine: eine Kerze fällt heraus, sobald (t_jetzt − t_alt) >= Fensterlänge.
 * full[i] = 1, wenn das Fenster vollständig mit Daten gefüllt ist.
 */
export function rollingVwap(bars, winMs, source = 'ohlc4', resMs = 0) {
  const n = bars.length;
  const vwap = new Float64Array(n).fill(NaN);
  const sd = new Float64Array(n).fill(NaN);
  const full = new Uint8Array(n);
  if (!n) return { vwap, sd, full };
  const ref = bars[0].c;
  let s0 = 0, s1 = 0, s2 = 0, j = 0;
  const t0 = bars[0].t;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const p = srcOf(b, source) - ref, v = b.v;
    s0 += v; s1 += p * v; s2 += v * p * p;
    while (j < i && b.t - bars[j].t >= winMs) {
      const q = bars[j], pq = srcOf(q, source) - ref;
      s0 -= q.v; s1 -= pq * q.v; s2 -= q.v * pq * pq;
      j++;
    }
    if (s0 > 0) {
      const m = s1 / s0;
      vwap[i] = m + ref;
      sd[i] = Math.sqrt(Math.max(0, s2 / s0 - m * m));
    }
    full[i] = b.t - t0 + resMs >= winMs ? 1 : 0;
  }
  return { vwap, sd, full };
}

/**
 * Werte einer anderen Auflösung auf die Chart-Kerzen legen (wie request.security mit lookahead_off):
 * jede Chart-Kerze bekommt den Wert der letzten Kerze, die bis zu ihrem Schluss fertig ist;
 * die letzte (laufende) Chart-Kerze bekommt den laufenden Wert.
 */
export function projectToChart(chartBars, chartTf, resBars, resTf, values, { live = true } = {}) {
  const n = chartBars.length;
  const outV = new Float64Array(n).fill(NaN);
  const outS = new Float64Array(n).fill(NaN);
  if (!resBars.length) return { vwap: outV, sd: outS };
  let j = -1;
  for (let i = 0; i < n; i++) {
    const close = nextTf(chartBars[i].t, chartTf);
    while (j + 1 < resBars.length && nextTf(resBars[j + 1].t, resTf) <= close) j++;
    let k = j;
    if (live && i === n - 1) k = resBars.length - 1;
    if (k >= 0 && values.full[k]) { outV[i] = values.vwap[k]; outS[i] = values.sd[k]; }
  }
  return { vwap: outV, sd: outS };
}

/** Werte aus Kerzen einer gröberen/feineren Auflösung je Zeitpunkt nachschlagen (für Fenster-Start ab Session). */
export function sessionAlignedRolling(bars, days, source, offset, resTf) {
  // Variante „Fenster ab Session-Anfang“: Fensterstart = Sessionbeginn vor (days) Tagen.
  const n = bars.length;
  const vwap = new Float64Array(n).fill(NaN), sd = new Float64Array(n).fill(NaN), full = new Uint8Array(n);
  if (!n) return { vwap, sd, full };
  const ref = bars[0].c;
  let s0 = 0, s1 = 0, s2 = 0, j = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const p = srcOf(b, source) - ref;
    s0 += b.v; s1 += p * b.v; s2 += b.v * p * p;
    const winStart = periodStart(b.t, 'day', offset) - (days - 1) * 864e5;
    while (j < i && bars[j].t < winStart) {
      const q = bars[j], pq = srcOf(q, source) - ref;
      s0 -= q.v; s1 -= pq * q.v; s2 -= q.v * pq * pq; j++;
    }
    if (s0 > 0) { const m = s1 / s0; vwap[i] = m + ref; sd[i] = Math.sqrt(Math.max(0, s2 / s0 - m * m)); }
    full[i] = floorTf(bars[0].t, resTf) <= winStart ? 1 : 0;
  }
  return { vwap, sd, full };
}
