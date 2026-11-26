// Zeit, Formatierung, Speicher und kleine Helfer.
// Alle Zeiten intern in Millisekunden (UTC). Kerzen: {t, o, h, l, c, v, bv}
// bv = Taker-Kaufvolumen (NaN, wenn die Börse es nicht liefert).

export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

export const TIMEFRAMES = [
  { id: '1m', min: 1, label: '1 Minute' },
  { id: '3m', min: 3, label: '3 Minuten' },
  { id: '5m', min: 5, label: '5 Minuten' },
  { id: '15m', min: 15, label: '15 Minuten' },
  { id: '30m', min: 30, label: '30 Minuten' },
  { id: '1h', min: 60, label: '1 Stunde' },
  { id: '2h', min: 120, label: '2 Stunden' },
  { id: '4h', min: 240, label: '4 Stunden' },
  { id: '6h', min: 360, label: '6 Stunden' },
  { id: '12h', min: 720, label: '12 Stunden' },
  { id: '1D', min: 1440, label: '1 Tag' },
  { id: '1W', min: 10080, label: '1 Woche' },
  { id: '1M', min: 43200, label: '1 Monat' },
];
const TF_BY_ID = Object.fromEntries(TIMEFRAMES.map(t => [t.id, t]));

export function tfMinutes(tf) {
  const x = TF_BY_ID[tf];
  if (!x) throw new Error('Unbekannte Zeiteinheit ' + tf);
  return x.min;
}
export function tfMs(tf) { return tfMinutes(tf) * MIN; }
export function minutesToTf(min) {
  const x = TIMEFRAMES.find(t => t.min === min);
  return x ? x.id : null;
}
export function tfShort(tf) {
  // TradingView-Schreibweise in der Legende: 1, 15, 60 → "1h", 1D …
  return tf;
}

export function weekStart(t) {
  const d = Math.floor(t / DAY) * DAY;
  const dow = (new Date(d).getUTCDay() + 6) % 7; // Montag = 0
  return d - dow * DAY;
}
export function monthStart(t) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
export function quarterStart(t) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
}
export function yearStart(t) {
  return Date.UTC(new Date(t).getUTCFullYear(), 0, 1);
}

/** Start der Kerze, in der t liegt (UTC-ausgerichtet; Woche ab Montag; Monat kalendarisch). */
export function floorTf(t, tf) {
  if (tf === '1M') return monthStart(t);
  if (tf === '1W') return weekStart(t);
  const ms = tfMs(tf);
  return Math.floor(t / ms) * ms;
}
/** Start der nächsten Kerze. */
export function nextTf(t, tf) {
  if (tf === '1M') { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  if (tf === '1W') return weekStart(t) + WEEK;
  const ms = tfMs(tf);
  return Math.floor(t / ms) * ms + ms;
}

/**
 * Periodenstart. kind: day | week | month | quarter | year.
 * offset verschiebt den Sessionbeginn (ms), 0 = UTC-Mitternacht (Krypto-Standard).
 */
export function periodStart(t, kind, offset = 0) {
  const x = t - offset;
  let s;
  switch (kind) {
    case 'day': s = Math.floor(x / DAY) * DAY; break;
    case 'week': s = weekStart(x); break;
    case 'month': s = monthStart(x); break;
    case 'quarter': s = quarterStart(x); break;
    case 'year': s = yearStart(x); break;
    default: throw new Error('Periode ' + kind);
  }
  return s + offset;
}
export function periodNext(start, kind, offset = 0) {
  const x = start - offset;
  const d = new Date(x);
  let s;
  switch (kind) {
    case 'day': s = x + DAY; break;
    case 'week': s = x + WEEK; break;
    case 'month': s = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); break;
    case 'quarter': s = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1); break;
    case 'year': s = Date.UTC(d.getUTCFullYear() + 1, 0, 1); break;
    default: throw new Error('Periode ' + kind);
  }
  return s + offset;
}
export function periodPrev(start, kind, offset = 0) {
  return periodStart(start - 1, kind, offset);
}

/** Erster Index i mit arr[i].t >= t (binäre Suche). */
export function lowerBound(arr, t) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}
/** Letzter Index i mit arr[i].t <= t, sonst -1. */
export function floorIndex(arr, t) {
  return lowerBound(arr, t + 1) - 1;
}

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

/** Hübsche Schrittweite: 1, 2, 2.5, 5 × 10^k. */
export function niceStep(x) {
  if (!(x > 0)) return 1;
  const e = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, e);
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * Math.pow(10, e);
}

// ---------- Formatierung (Deutsch, wie TradingView mit de-Einstellung) ----------
const nfCache = new Map();
export function nf(dec) {
  let f = nfCache.get(dec);
  if (!f) {
    f = new Intl.NumberFormat('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    nfCache.set(dec, f);
  }
  return f;
}
export function priceDecimals(p) {
  const a = Math.abs(p);
  if (!(a > 0)) return 2;
  if (a >= 100) return 2;
  if (a >= 10) return 3;
  if (a >= 1) return 4;
  if (a >= 0.1) return 5;
  if (a >= 0.01) return 6;
  if (a >= 0.0001) return 7;
  return 8;
}
export function fmtPrice(p, dec) {
  if (!Number.isFinite(p)) return '–';
  return nf(dec ?? priceDecimals(p)).format(p);
}
export function fmtNum(x, dec = 2) {
  if (!Number.isFinite(x)) return '–';
  return nf(dec).format(x);
}
export function fmtSigned(x, dec = 2) {
  if (!Number.isFinite(x)) return '–';
  return (x > 0 ? '+' : x < 0 ? '−' : '') + nf(dec).format(Math.abs(x));
}
export function fmtPct(x, dec = 2) {
  if (!Number.isFinite(x)) return '–';
  return fmtSigned(x, dec) + ' %';
}
export function fmtCompact(x, dec = 2) {
  if (!Number.isFinite(x)) return '–';
  const a = Math.abs(x);
  const s = x < 0 ? '−' : '';
  if (a >= 1e9) return s + nf(dec).format(a / 1e9) + ' B';
  if (a >= 1e6) return s + nf(dec).format(a / 1e6) + ' M';
  if (a >= 1e3) return s + nf(dec).format(a / 1e3) + ' K';
  if (a >= 100) return s + nf(0).format(a);
  if (a >= 1) return s + nf(Math.min(dec, 2)).format(a);
  return s + nf(4).format(a);
}

// ---------- Zeitzone ----------
const dtfCache = new Map();
function dtf(tz, opts) {
  const key = tz + JSON.stringify(opts);
  let f = dtfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('de-DE', { timeZone: tz, hourCycle: 'h23', ...opts });
    dtfCache.set(key, f);
  }
  return f;
}
export function localTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
export function fmtDateTime(t, tz, withSeconds = false) {
  return dtf(tz, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) }).format(t);
}
export function fmtTime(t, tz, withSeconds = false) {
  return dtf(tz, { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) }).format(t);
}
export function fmtDate(t, tz) {
  return dtf(tz, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(t);
}
/** Kurzes Datum für Level-Beschriftungen, z. B. "24.11." (UTC, Session-Tag). */
export function fmtDayLabel(t) {
  const d = new Date(t);
  return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.';
}
export function tzOffsetLabel(tz, t = Date.now()) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(t);
    const v = p.find(x => x.type === 'timeZoneName');
    return v ? v.value.replace('GMT', 'UTC') : 'UTC';
  } catch { return 'UTC'; }
}

// ---------- Speicher ----------
export const storage = {
  get(key, def) {
    try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
  },
  del(key) { try { localStorage.removeItem(key); } catch { /* egal */ } },
};

// ---------- Ereignisse ----------
export class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, fn) {
    if (!this._h.has(ev)) this._h.set(ev, new Set());
    this._h.get(ev).add(fn);
    return () => this._h.get(ev)?.delete(fn);
  }
  emit(ev, ...args) {
    const s = this._h.get(ev);
    if (s) for (const fn of [...s]) { try { fn(...args); } catch (e) { console.error(e); } }
  }
}

/** Führt fn höchstens einmal pro Animationsframe aus (bzw. höchstens alle minMs). */
export function frameThrottle(fn, minMs = 0) {
  let pending = false, last = 0, timer = 0;
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
  const run = () => { pending = false; last = Date.now(); fn(); };
  return function () {
    if (pending) return;
    pending = true;
    const wait = Math.max(0, minMs - (Date.now() - last));
    if (wait > 0) { clearTimeout(timer); timer = setTimeout(() => raf(run), wait); } else raf(run);
  };
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function uid() { return Math.random().toString(36).slice(2, 10); }

export function deepClone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

/** Mischt gespeicherte Werte in Standardwerte (nur bekannte Schlüssel, Typen bleiben). */
export function mergeDefaults(defaults, saved) {
  const out = deepClone(defaults);
  if (!saved || typeof saved !== 'object') return out;
  for (const k of Object.keys(out)) {
    if (!(k in saved)) continue;
    const d = out[k], v = saved[k];
    if (d && typeof d === 'object' && !Array.isArray(d)) out[k] = mergeDefaults(d, v);
    else if (Array.isArray(d)) out[k] = Array.isArray(v) ? v : d;
    else if (typeof d === typeof v) out[k] = v;
  }
  return out;
}

/** Hex-Farbe + Deckkraft (0–1) → rgba(). */
export function rgba(hex, a = 1) {
  if (!hex) return `rgba(0,0,0,${a})`;
  if (hex.startsWith('rgb')) return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Deckende Mischung: Farbe a mit Deckkraft über Hintergrund bg. */
export function mixHex(a, bg, alpha) {
  const p = (h) => { let x = h.replace('#', ''); if (x.length === 3) x = x.split('').map(c => c + c).join(''); const n = parseInt(x.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const A = p(a), B = p(bg);
  return '#' + A.map((v, i) => Math.round(B[i] + (v - B[i]) * alpha).toString(16).padStart(2, '0')).join('');
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Kurse gleitender Durchschnitt etc. */
export function sma(values, n) {
  const out = new Float64Array(values.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i];
    if (i >= n) s -= values[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
export function ema(values, n) {
  const out = new Float64Array(values.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = NaN, s = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (i < n - 1) { s += v; continue; }
    if (i === n - 1) { s += v; prev = s / n; out[i] = prev; continue; }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
/** Wilder-Glättung (RMA) wie in Pine. */
export function rma(values, n) {
  const out = new Float64Array(values.length).fill(NaN);
  let prev = NaN, s = 0, cnt = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) { out[i] = prev; continue; }
    if (cnt < n) { s += v; cnt++; if (cnt === n) { prev = s / n; out[i] = prev; } continue; }
    prev = (prev * (n - 1) + v) / n;
    out[i] = prev;
  }
  return out;
}
