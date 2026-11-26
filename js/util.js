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

// ---------- Sessions (TPO, Key Levels, Naked Levels) ----------
const _zdtf = new Map();
function zParts(tz, t) {
  let f = _zdtf.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    _zdtf.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(t)) if (p.type !== 'literal') o[p.type] = +p.value;
  if (o.hour === 24) o.hour = 0;
  return o;
}
/** Abstand Ortszeit − UTC in ms zum Zeitpunkt t. */
export function tzOffsetMs(tz, t) {
  const p = zParts(tz, t);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}
/** Ortszeit (Kalendertag + Uhrzeit in tz) → UTC-ms. */
export function zonedTime(tz, y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffsetMs(tz, guess);
  const o2 = tzOffsetMs(tz, t);
  if (guess - o2 !== t) t = guess - o2;
  return t;
}
export const SESSION_MODES = [
  ['utc', '00:00 UTC (wie TradingView Krypto)'],
  ['cme', 'CME-Session (17:00–16:00 Chicago, ohne Wochenende)'],
  ['custom', 'eigene Zeiten (z. B. 02:00–22:00 Berlin)'],
];
const hmOf = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? [Math.min(23, +m[1]), Math.min(59, +m[2])] : null; };

/**
 * Handels-Sessions. utc: Tag ab 00:00 UTC (+ offset). cme: 17:00–16:00 America/Chicago, Mo–Fr.
 * custom: start–end in Zeitzone tz (Ende ≤ Start = über Mitternacht). Kerzen außerhalb gehören zu keiner Session.
 * of(t) → [start, end, tradeDay] (tradeDay = UTC-Mitternacht des Handelstags, für Wochen/Monate).
 */
export class Sessions {
  constructor({ mode = 'utc', start = '02:00', end = '22:00', tz = 'Europe/Berlin', offset = 0 } = {}) {
    this.mode = ['utc', 'cme', 'custom'].includes(mode) ? mode : 'utc';
    this.offset = this.mode === 'utc' ? offset : 0;
    this.tz = this.mode === 'cme' ? 'America/Chicago' : (tz || 'Europe/Berlin');
    try { zParts(this.tz, 0); } catch { this.tz = 'Europe/Berlin'; }
    this.s = this.mode === 'cme' ? [17, 0] : (hmOf(start) || [2, 0]);
    this.e = this.mode === 'cme' ? [16, 0] : (hmOf(end) || [22, 0]);
    this.key = this.mode === 'utc' ? 'utc' + this.offset : `${this.mode}|${this.tz}|${this.s}|${this.e}`;
    this._cache = new Map();
  }
  get isUtc() { return this.mode === 'utc'; }
  _day(D) {
    let r = this._cache.get(D);
    if (r) return r;
    r = [];
    const sMin = this.s[0] * 60 + this.s[1], eMin = this.e[0] * 60 + this.e[1];
    const overnight = eMin <= sMin;
    for (let k = -1; k <= 1; k++) {
      const p = zParts(this.tz, (D + k) * DAY + 12 * HOUR);
      const st = zonedTime(this.tz, p.year, p.month, p.day, this.s[0], this.s[1]);
      const de = new Date(Date.UTC(p.year, p.month - 1, p.day + (overnight ? 1 : 0)));
      const en = zonedTime(this.tz, de.getUTCFullYear(), de.getUTCMonth() + 1, de.getUTCDate(), this.e[0], this.e[1]);
      if (!(en > st)) continue;
      const tradeDay = Math.floor((st + en) / 2 / DAY) * DAY;
      if (this.mode === 'cme') { const wd = new Date(tradeDay).getUTCDay(); if (wd === 0 || wd === 6) continue; }
      if (en > D * DAY && st < (D + 1) * DAY) r.push([st, en, tradeDay]);
    }
    r.sort((a, b) => a[0] - b[0]);
    this._cache.set(D, r);
    return r;
  }
  /** Session, die t enthält: [start, end, tradeDay] oder null (außerhalb). */
  of(t) {
    if (this.mode === 'utc') { const s = periodStart(t, 'day', this.offset); return [s, s + DAY, Math.floor((s + DAY / 2) / DAY) * DAY]; }
    for (const x of this._day(Math.floor(t / DAY))) if (t >= x[0] && t < x[1]) return x;
    return null;
  }
  /** Letzte Session, die bis t begonnen hat (auch wenn t danach außerhalb liegt). */
  last(t) {
    if (this.mode === 'utc') return this.of(t);
    for (let D = Math.floor(t / DAY), k = 0; k < 6; k++, D--) {
      const l = this._day(D);
      for (let i = l.length - 1; i >= 0; i--) if (l[i][0] <= t) return l[i];
    }
    return null;
  }
  /** Start der n-ten Session vor der aktuellen (0 = aktuelle/letzte). */
  back(t, n) {
    let cur = this.last(t);
    for (let i = 0; i < n && cur; i++) cur = this.last(cur[0] - 1);
    return cur ? cur[0] : t - (n + 1) * DAY;
  }
  label() {
    if (this.mode === 'utc') return this.offset ? `Tag ab ${this.offset > 0 ? '+' : ''}${Math.round(this.offset / MIN)} Min. UTC` : '00:00 UTC';
    if (this.mode === 'cme') return 'CME 17:00–16:00 Chicago';
    const f = (x) => String(x[0]).padStart(2, '0') + ':' + String(x[1]).padStart(2, '0');
    return `${f(this.s)}–${f(this.e)} ${this.tz.split('/').pop().replace('_', ' ')}`;
  }
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
    // leeres Objekt als Standard = freie Zuordnung (z. B. eigene Standardwerte, Vorlagen-Stände): gespeichert übernehmen
    if (d && typeof d === 'object' && !Array.isArray(d) && !Object.keys(d).length) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepClone(v) : d;
    else if (d && typeof d === 'object' && !Array.isArray(d)) out[k] = mergeDefaults(d, v);
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
  // #rrggbbaa: eingebaute Deckkraft (aus dem Farbwähler) mit a multiplizieren
  const al = h.length === 8 ? a * (parseInt(h.slice(6, 8), 16) / 255) : a;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, +al.toFixed(3)))})`;
}
/** Zweifarbig wie gewünscht: Schwarz (Linien, Verkauf/Short), Grau (Kauf/Long, Flächen), POC pink. */
export const INK = '#131722', INK2 = '#787b86', POC = '#e91e63';
/** Im dunklen Design wird Schwarz (#131722 / rgba(19,23,34,…)) zu hellem Grau, damit Linien sichtbar bleiben. */
export function inkMap(c, dark) {
  if (!dark || typeof c !== 'string') return c;
  if (/^#131722/i.test(c)) return '#d1d4dc' + c.slice(7);
  if (c.startsWith('rgba(19,23,34,')) return 'rgba(209,212,220,' + c.slice(14);
  return c;
}
/** Farbe für Stellen, die kein #rrggbbaa verstehen (Chart-Bibliothek). */
export function cssColor(c) { return typeof c === 'string' && /^#[0-9a-f]{8}$/i.test(c) ? rgba(c) : c; }
/** '#rrggbb[aa]' → { hex: '#rrggbb', a: 0…1 } */
export function splitColor(c) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c || '');
  if (!m) return { hex: '#888888', a: 1 };
  return { hex: '#' + m[1].toLowerCase(), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}
export function joinColor(hex, a) { return a >= 0.995 ? hex : hex + Math.round(Math.max(0, a) * 255).toString(16).padStart(2, '0'); }

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
