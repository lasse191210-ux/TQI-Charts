// TPO-Chart (Market Profile) als eigener Charttyp.
// Unterlage sind Kerzen der Blockgröße (z. B. 30 Min. = ein Buchstabe). Jede Session (Tag) zeichnet ihr Profil
// ab dem ersten Block nach rechts: Spalte k = k-ter Block der Session, Buchstaben linksbündig gepackt (wie ATAS/TradingView).
// Rechts daneben (optional) das Volumenprofil der Session.
import { customSeriesDefaultOptions } from '../vendor/lightweight-charts.esm.js';
import { periodStart, DAY, rgba } from '../util.js';
import { valueArea } from '../calc/profile.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const letterOf = (k) => LETTERS[k % LETTERS.length];

export const TPO_DEFAULTS = {
  block: '30m', rowSize: 0, display: 'auto', colors: 'gradient', vaPct: 68, ibMin: 60,
  poc: true, va: true, vaFill: true, ib: true, openClose: true, singles: true, vp: true, vpWidth: 0.3, nakedPoc: true, extendVa: false,
};

/**
 * Profile je Session aus Block-Kerzen.
 * Ergebnis je Session: { start, first (Index der ersten Kerze), n (Blöcke), rowLo, rowHi, rows: Array<number[]> (Periodenindizes je Zeile),
 * vol: Float64Array, poc, vah, val (Preise), vpoc, ibHi, ibLo, open, close, high, low, singles: [[lo,hi]], rowSize }
 */
export function buildTpoSessions(bars, { rowSize, offset = 0, blockMs, vaPct = 68, ibMin = 60 }) {
  const out = [];
  let cur = null;
  const ibN = Math.max(1, Math.round(ibMin * 60000 / blockMs));
  const finish = (s) => {
    const n = s.rowHi - s.rowLo + 1;
    const rows = Array.from({ length: n }, () => []);
    const vol = new Float64Array(n);
    for (let i = s.first; i < s.first + s.n; i++) {
      const b = bars[i];
      const k = Math.floor((b.t - s.start) / blockMs);
      const a = Math.floor(b.l / rowSize) - s.rowLo, z = Math.floor(b.h / rowSize) - s.rowLo;
      const per = b.v / (z - a + 1);
      for (let r = a; r <= z; r++) { rows[r].push(k); vol[r] += per; }
    }
    s.rows = rows; s.vol = vol; s.rowSize = rowSize;
    const counts = rows.map(r => r.length);
    const va = valueArea(counts, vaPct, 2);
    if (va) { s.poc = (s.rowLo + va.poc + 0.5) * rowSize; s.vah = (s.rowLo + va.hi + 1) * rowSize; s.val = (s.rowLo + va.lo) * rowSize; s.pocRow = va.poc; s.vaLo = va.lo; s.vaHi = va.hi; }
    const vva = valueArea(Array.from(vol), vaPct, 2);
    if (vva) { s.vpoc = (s.rowLo + vva.poc + 0.5) * rowSize; s.vpocRow = vva.poc; s.vvaLo = vva.lo; s.vvaHi = vva.hi; }
    // Initial Balance: erste ibN Blöcke
    let ih = -Infinity, il = Infinity;
    for (let i = s.first; i < s.first + Math.min(s.n, ibN); i++) { ih = Math.max(ih, bars[i].h); il = Math.min(il, bars[i].l); }
    s.ibHi = ih; s.ibLo = il; s.ibDone = s.n >= ibN;
    // Single Prints im Körper (nicht an den Extremen)
    s.singles = [];
    let r = 0;
    while (r < n) {
      if (counts[r] !== 1) { r++; continue; }
      let e = r; while (e + 1 < n && counts[e + 1] === 1) e++;
      if (r > 0 && e < n - 1) s.singles.push([r, e]);
      r = e + 1;
    }
    s.maxCount = Math.max(...counts);
  };
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const st = periodStart(b.t, 'day', offset);
    if (!cur || cur.start !== st) {
      if (cur) finish(cur);
      cur = { start: st, end: st + DAY, first: i, n: 0, rowLo: Infinity, rowHi: -Infinity, open: b.o, high: -Infinity, low: Infinity, close: b.c };
      out.push(cur);
    }
    cur.n++;
    cur.rowLo = Math.min(cur.rowLo, Math.floor(b.l / rowSize));
    cur.rowHi = Math.max(cur.rowHi, Math.floor(b.h / rowSize));
    cur.high = Math.max(cur.high, b.h); cur.low = Math.min(cur.low, b.l); cur.close = b.c;
  }
  if (cur) finish(cur);
  return out;
}

/** Farbe je Periode: Verlauf über den Tag (blau → violett → pink → orange) oder einfarbig. */
export function periodColor(k, total, mode, dark) {
  if (mode === 'mono') return dark ? '#c9c7c1' : '#2a2e39';
  const f = total > 1 ? k / (total - 1) : 0;
  const hue = 205 + f * 175; // 205 (blau) … 380=20 (orange)
  return `hsl(${Math.round(hue % 360)}, ${dark ? 72 : 68}%, ${dark ? 62 : 46}%)`;
}

export class TpoPaneView {
  constructor(app) {
    this.app = app;
    this._data = null;
    this.sessions = [];
    this.bySession = new Map();
    this.opts = { ...TPO_DEFAULTS };
    this._renderer = { draw: (target, pc) => this._draw(target, pc) };
  }
  setSessions(sessions, opts) {
    this.sessions = sessions;
    this.bySession = new Map(sessions.map(s => [s.first, s]));
    this.opts = opts;
  }
  renderer() { return this._renderer; }
  update(data) { this._data = data; }
  priceValueBuilder(d) { return [d.l, d.h, d.c]; }
  isWhitespace(d) { return d.c === undefined; }
  defaultOptions() { return { ...customSeriesDefaultOptions, color: '#787b86' }; }
  destroy() { this._data = null; }

  _draw(target, pc) {
    const data = this._data;
    if (!data || !data.bars.length || !this.sessions.length) return;
    const o = this.opts;
    const th = this.app.theme;
    const vr = data.visibleRange;
    const bars = data.bars;
    const from = vr ? Math.max(0, Math.floor(vr.from) - 1) : 0;
    const to = vr ? Math.min(bars.length - 1, Math.ceil(vr.to) + 1) : bars.length - 1;
    const sp = data.barSpacing * (data.conflationFactor || 1);
    // Sessions im sichtbaren Bereich
    const vis = [];
    for (const s of this.sessions) {
      if (s.first + s.n - 1 < from - 2 || s.first > to + 2) continue;
      vis.push(s);
    }
    // x ist nur für sichtbare Kerzen gesetzt: von einer sichtbaren Kerze aus gleichmäßig weiterrechnen
    let ref = -1;
    for (let i = Math.max(0, from); i <= to; i++) if (Number.isFinite(bars[i]?.x)) { ref = i; break; }
    if (ref < 0) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vrr, bitmapSize }) => {
      const W = bitmapSize.width;
      const xAt = (i) => bars[ref].x + (i - ref) * sp;
      const cellW = sp * hr;
      for (const s of vis) {
        const x0 = (xAt(s.first) - sp / 2) * hr;            // linker Rand der Session
        const xEnd = (xAt(s.first + Math.max(s.n, 1) - 1) + sp / 2) * hr; // rechter Rand (bisher)
        const fullEnd = x0 + Math.round(DAY / this.app.tpoBlockMs) * cellW; // rechter Rand ganzer Tag
        if (fullEnd < 0 || x0 > W) continue;
        const rs = s.rowSize;
        const yOfRow = (r) => pc((s.rowLo + r) * rs); // Unterkante der Zeile r
        const rowTop = (r) => pc((s.rowLo + r + 1) * rs);
        const y0 = rowTop(s.rows.length - 1), y1 = yOfRow(0);
        if (y0 == null || y1 == null) continue;
        const rowH = Math.abs((yOfRow(0) - rowTop(0))) * vrr;
        const total = Math.round(DAY / this.app.tpoBlockMs);
        const letters = o.display === 'letters' || (o.display === 'auto' && rowH >= 8 * vrr && cellW >= 7 * hr);
        const blocks = !letters && cellW >= 2.5 * hr;
        // Value Area hinterlegen
        if (o.va && o.vaFill && s.vaLo != null) {
          const ya = rowTop(s.vaHi) * vrr, yb = yOfRow(s.vaLo) * vrr;
          ctx.fillStyle = th.dark ? 'rgba(124,58,237,0.07)' : 'rgba(124,58,237,0.06)';
          ctx.fillRect(x0, ya, (o.extendVa ? fullEnd : xEnd) - x0, yb - ya);
        }
        // Single Prints hinterlegen
        if (o.singles) {
          ctx.fillStyle = th.dark ? 'rgba(240,169,59,0.16)' : 'rgba(240,169,59,0.2)';
          for (const [a, b] of s.singles) {
            const ya = rowTop(b) * vrr, yb = yOfRow(a) * vrr;
            ctx.fillRect(x0, ya, cellW * 1.15, yb - ya);
          }
        }
        // POC-Zeile hinterlegen
        if (o.poc && s.pocRow != null) {
          const ya = rowTop(s.pocRow) * vrr, yb = yOfRow(s.pocRow) * vrr;
          ctx.fillStyle = th.dark ? 'rgba(233,30,99,0.22)' : 'rgba(233,30,99,0.16)';
          ctx.fillRect(x0, ya, s.rows[s.pocRow].length * cellW, Math.max(1, yb - ya));
        }
        // TPOs
        if (letters) {
          const fs = Math.max(7 * vrr, Math.min(rowH * 0.92, cellW * 1.15, 15 * vrr));
          ctx.font = `600 ${Math.round(fs)}px -apple-system, "Segoe UI", Roboto, "SF Mono", monospace`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        }
        for (let r = 0; r < s.rows.length; r++) {
          const list = s.rows[r];
          if (!list.length) continue;
          const yt = rowTop(r) * vrr, yb = yOfRow(r) * vrr;
          if (yb < -20 || yt > bitmapSize.height + 20) continue;
          const h = Math.max(1, yb - yt);
          if (letters) {
            const yc = yt + h / 2;
            for (let c = 0; c < list.length; c++) {
              ctx.fillStyle = periodColor(list[c], total, o.colors, th.dark);
              ctx.fillText(letterOf(list[c]), x0 + (c + 0.5) * cellW, yc);
            }
          } else if (blocks) {
            const gap = h > 3 * vrr ? Math.max(1, Math.round(0.6 * vrr)) : 0;
            const wgap = cellW > 4 * hr ? Math.max(1, Math.round(0.6 * hr)) : 0;
            for (let c = 0; c < list.length; c++) {
              ctx.fillStyle = periodColor(list[c], total, o.colors, th.dark);
              ctx.fillRect(x0 + c * cellW, yt + gap / 2, cellW - wgap, h - gap);
            }
          } else {
            ctx.fillStyle = th.dark ? 'rgba(201,199,193,0.55)' : 'rgba(42,46,57,0.45)';
            ctx.fillRect(x0, yt, list.length * cellW, h);
          }
        }
        // Initial Balance: Balken links
        if (o.ib && Number.isFinite(s.ibHi)) {
          const ya = pc(s.ibHi) * vrr, yb = pc(s.ibLo) * vrr;
          ctx.fillStyle = s.ibDone ? '#2962ff' : 'rgba(41,98,255,0.5)';
          ctx.fillRect(x0 - 4 * hr, ya, 2.5 * hr, yb - ya);
        }
        // Open / Close
        if (o.openClose) {
          const yo = pc(s.open) * vrr, yc = pc(s.close) * vrr;
          ctx.fillStyle = th.dark ? '#e6e4df' : '#131722';
          ctx.beginPath(); ctx.moveTo(x0 - 1 * hr, yo); ctx.lineTo(x0 - 7 * hr, yo - 4 * vrr); ctx.lineTo(x0 - 7 * hr, yo + 4 * vrr); ctx.closePath(); ctx.fill();
          const cr = Math.floor(s.close / rs) - s.rowLo;
          const xc = x0 + ((s.rows[cr]?.length || 1)) * cellW + 2 * hr;
          ctx.beginPath(); ctx.moveTo(xc, yc); ctx.lineTo(xc + 6 * hr, yc - 4 * vrr); ctx.lineTo(xc + 6 * hr, yc + 4 * vrr); ctx.closePath(); ctx.fill();
        }
        // VAH / VAL / POC Linien
        const line = (p, col, dash, xb) => {
          const y = Math.round(pc(p) * vrr) + 0.5;
          ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, hr);
          ctx.setLineDash(dash ? [4 * hr, 3 * hr] : []);
          ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(xb, y); ctx.stroke();
          ctx.setLineDash([]);
        };
        const lineEnd = o.extendVa ? fullEnd : Math.max(xEnd, x0 + (s.maxCount + 1) * cellW);
        if (o.va && s.vah != null) { line(s.vah, th.dark ? 'rgba(167,139,250,0.9)' : 'rgba(124,58,237,0.85)', false, lineEnd); line(s.val, th.dark ? 'rgba(167,139,250,0.9)' : 'rgba(124,58,237,0.85)', false, lineEnd); }
        if (o.poc && s.poc != null) line(s.poc, '#e91e63', false, lineEnd);
        // Volumenprofil rechts
        if (o.vp && s.vol && s.vol.length) {
          const vpW = Math.max(20 * hr, (fullEnd - x0) * o.vpWidth);
          const right = fullEnd - 2 * hr;
          let mx = 0; for (const v of s.vol) if (v > mx) mx = v;
          if (mx > 0) {
            for (let r = 0; r < s.vol.length; r++) {
              const yt = rowTop(r) * vrr, yb = yOfRow(r) * vrr;
              const h = Math.max(1, yb - yt - (yb - yt > 3 * vrr ? 1 : 0));
              const w = s.vol[r] / mx * vpW;
              const inVa = s.vvaLo != null && r >= s.vvaLo && r <= s.vvaHi;
              ctx.fillStyle = r === s.vpocRow ? (th.dark ? 'rgba(240,169,59,0.85)' : 'rgba(230,138,0,0.8)') : inVa ? (th.dark ? 'rgba(120,123,134,0.55)' : 'rgba(120,123,134,0.45)') : (th.dark ? 'rgba(120,123,134,0.28)' : 'rgba(120,123,134,0.22)');
              ctx.fillRect(right - w, yt, w, h);
            }
          }
        }
        // Trennlinie zur nächsten Session
        ctx.fillStyle = th.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
        ctx.fillRect(Math.round(x0 - 8 * hr), 0, Math.max(1, hr), bitmapSize.height);
      }
    });
  }
}

export function sessionLabelColor(dark) { return dark ? '#c9c7c1' : '#2a2e39'; }
export { rgba };
