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
export function buildTpoSessions(bars, { rowSize, offset = 0, sess = null, blockMs, vaPct = 68, ibMin = 60, step = 2, merges = null, splits = null }) {
  const out = [];
  let cur = null;
  const ibN = Math.max(1, Math.round(ibMin * 60000 / blockMs));
  const kOf = new Int32Array(bars.length);
  const keyOf = new Float64Array(bars.length).fill(NaN);
  const pidOf = new Float64Array(bars.length);
  const sp = splits && splits.length ? [...splits].sort((a, b) => a - b) : null;
  // Abschnitt einer Kerze: Session (Tag) → ggf. an Teilungen geschnitten → ggf. mit Nachbarn zusammengefügt
  const segOf = (t) => {
    let x;
    if (sess) { x = sess.of(t); if (!x) return null; }
    else { const st = periodStart(t, 'day', offset); x = [st, st + DAY, st]; }
    const day0 = x[0];
    let st = x[0], en = x[1];
    if (sp) for (const q of sp) { if (q <= st || q >= en) continue; if (t >= q) st = q; else { en = q; break; } }
    let merged = false;
    if (merges) for (const m of merges) if (st >= m[0] && st < m[1]) { st = m[0]; en = Math.max(en, m[1]); merged = true; break; }
    return { st, en, day0, merged };
  };
  const finish = (s) => {
    const n = s.rowHi - s.rowLo + 1;
    const rows = Array.from({ length: n }, () => []);
    const vol = new Float64Array(n);
    const lastPid = new Float64Array(n).fill(NaN);
    for (let i = s.first; i < s.first + s.n; i++) {
      if (keyOf[i] !== s.start) continue;
      const b = bars[i], k = kOf[i], pid = pidOf[i];
      const a = Math.floor(b.l / rowSize) - s.rowLo, z = Math.floor(b.h / rowSize) - s.rowLo;
      const per = b.v / (z - a + 1);
      for (let r = a; r <= z; r++) { if (lastPid[r] !== pid) { rows[r].push(k); lastPid[r] = pid; } vol[r] += per; }
    }
    s.rows = rows; s.vol = vol; s.rowSize = rowSize;
    const counts = rows.map(r => r.length);
    const va = valueArea(counts, vaPct, step);
    if (va) { s.poc = (s.rowLo + va.poc + 0.5) * rowSize; s.vah = (s.rowLo + va.hi + 1) * rowSize; s.val = (s.rowLo + va.lo) * rowSize; s.pocRow = va.poc; s.vaLo = va.lo; s.vaHi = va.hi; }
    const vva = valueArea(Array.from(vol), vaPct, step);
    if (vva) { s.vpoc = (s.rowLo + vva.poc + 0.5) * rowSize; s.vpocRow = vva.poc; s.vvaLo = vva.lo; s.vvaHi = vva.hi; }
    // Initial Balance: erste ibN Blöcke
    let ih = -Infinity, il = Infinity;
    for (let i = s.first, m = 0; i < s.first + s.n && m < ibN; i++) { if (keyOf[i] !== s.start || bars[i].t >= s.day0 + ibN * blockMs) continue; m++; ih = Math.max(ih, bars[i].h); il = Math.min(il, bars[i].l); }
    s.ibHi = ih; s.ibLo = il; s.ibDone = s.cnt >= ibN;
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
    s.cells = Math.max(1, Math.round((s.end - s.start) / blockMs));
  };
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const g = segOf(b.t);
    if (!g) { if (cur) cur.gap = true; continue; }
    kOf[i] = Math.floor((b.t - g.day0) / blockMs);
    keyOf[i] = g.st;
    pidOf[i] = g.day0 + kOf[i];
    if (!cur || cur.start !== g.st) {
      if (cur) finish(cur);
      cur = { start: g.st, end: g.en, day0: g.day0, merged: g.merged, first: i, n: 0, cnt: 0, rowLo: Infinity, rowHi: -Infinity, open: b.o, high: -Infinity, low: Infinity, close: b.c };
      out.push(cur);
    }
    cur.n = i - cur.first + 1;
    cur.cnt++;
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
        const fullEnd = x0 + (s.cells || Math.round(DAY / this.app.tpoBlockMs)) * cellW; // rechter Rand ganzer Abschnitt
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
          ctx.fillStyle = th.dark ? 'rgba(209,212,220,0.06)' : 'rgba(19,23,34,0.045)';
          ctx.fillRect(x0, ya, (o.extendVa ? fullEnd : xEnd) - x0, yb - ya);
        }
        // Single Prints hinterlegen
        if (o.singles) {
          ctx.fillStyle = th.dark ? 'rgba(209,212,220,0.12)' : 'rgba(120,123,134,0.2)';
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
          ctx.fillStyle = s.ibDone ? '#787b86' : 'rgba(120,123,134,0.5)';
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
        if (o.va && s.vah != null) { const vc = th.dark ? 'rgba(209,212,220,0.9)' : 'rgba(19,23,34,0.9)'; line(s.vah, vc, false, lineEnd); line(s.val, vc, false, lineEnd); }
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
              ctx.fillStyle = r === s.vpocRow ? 'rgba(233,30,99,0.75)' : inVa ? (th.dark ? 'rgba(120,123,134,0.55)' : 'rgba(120,123,134,0.45)') : (th.dark ? 'rgba(120,123,134,0.28)' : 'rgba(120,123,134,0.22)');
              ctx.fillRect(right - w, yt, w, h);
            }
          }
        }
        // Trennlinie zur nächsten Session
        ctx.fillStyle = th.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
        ctx.fillRect(Math.round(x0 - 8 * hr), 0, Math.max(1, hr), bitmapSize.height);
        // Datum über dem Profil (bei zusammengefügten/geteilten Profilen mit Zeitraum), Auswahlrahmen
        const yHi = pc(s.high), yLo = pc(s.low);
        if (yHi != null) {
          ctx.font = `600 ${Math.round(10 * vrr)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
          ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.fillStyle = th.dark ? 'rgba(209,212,220,0.75)' : 'rgba(19,23,34,0.7)';
          ctx.fillText(this.app.tpoLabel(s), x0, yHi * vrr - 4 * vrr);
        }
        if (this.app.tpoSel != null && this.app.tpoSel === s.start && yHi != null && yLo != null) {
          ctx.strokeStyle = '#e91e63'; ctx.lineWidth = Math.max(1, 1.5 * hr);
          ctx.setLineDash([5 * hr, 4 * hr]);
          ctx.strokeRect(x0 - 3 * hr, yHi * vrr - 16 * vrr, Math.max(lineEnd, xEnd) - x0 + 6 * hr, (yLo - yHi) * vrr + 20 * vrr);
          ctx.setLineDash([]);
        }
      }
    });
  }
}

export function sessionLabelColor(dark) { return dark ? '#c9c7c1' : '#2a2e39'; }
export { rgba };

/**
 * TPO als Overlay im Kerzenchart (Hintergrund-Ebene, Kerzen liegen darüber).
 * env = { xOfTime(t) → Bitmap-x (linke Kante), cellW (Bitmap-px je TPO-Periode), yOf(Preis) → Bitmap-y, W, H, hr, vr, dark }
 * o   = Einstellungen des TPO-Indikators
 */
export function drawTpoOverlay(ctx, sessions, o, env, blockMs) {
  const { xOfTime, cellW, yOf, W, H, hr, vr, dark } = env;
  const total = Math.round(DAY / blockMs);
  const fontFam = '-apple-system, "Segoe UI", Roboto, "SF Mono", monospace';
  const labels = [];
  for (const s of sessions) {
    if (!s.rows) continue;
    const xs = xOfTime(s.start);
    if (xs == null) continue;
    const fullEnd = xs + total * cellW;
    if (fullEnd < 0 || xs > W) continue;
    // Session-Beginn links aus dem Bild gescrollt: Profil am linken Rand festhalten (Spalten haben keine Zeitbedeutung)
    const x0 = o.sticky !== false && xs < 2 * hr && fullEnd > 40 * hr ? 2 * hr : xs;
    const rs = s.rowSize;
    const rowTop = (r) => yOf((s.rowLo + r + 1) * rs), rowBot = (r) => yOf((s.rowLo + r) * rs);
    const y0 = rowTop(s.rows.length - 1), y1 = rowBot(0);
    if (y0 == null || y1 == null || y1 < 0 || y0 > H) continue;
    const rowH = Math.abs(rowBot(0) - rowTop(0));
    const letters = o.display === 'letters' || (o.display === 'auto' && rowH >= 9 * vr && cellW >= 8 * hr);
    const profEnd = x0 + (s.maxCount + 0.5) * cellW;
    const lineEnd = o.lines === 'session' ? fullEnd : Math.max(profEnd + 6 * hr, x0 + cellW * 4);
    // Value Area hinterlegen
    if (o.va && o.vaFill && s.vaLo != null) {
      const ya = rowTop(s.vaHi), yb = rowBot(s.vaLo);
      ctx.fillStyle = rgba(o.vaFillColor, o.vaFillOpacity);
      ctx.fillRect(x0, ya, lineEnd - x0, yb - ya);
    }
    // Single Prints
    if (o.singles) {
      ctx.fillStyle = rgba(o.singleColor, 0.28);
      for (const [a, b] of s.singles) { const ya = rowTop(b), yb = rowBot(a); ctx.fillRect(x0, ya, Math.max(cellW, 3 * hr), yb - ya); }
    }
    // TPOs
    const monoCol = !o.mono || o.mono === 'auto' ? (dark ? '#d1d4dc' : '#131722') : o.mono;
    ctx.globalAlpha = o.opacity;
    if (letters) {
      // Buchstaben: zu dünne Zeilen zusammenfassen (Buchstaben bleiben lesbar), Perioden je Gruppe vereinigt
      const minPx = 10 * vr;
      const k = rowH >= minPx ? 1 : Math.ceil(minPx / Math.max(rowH, 0.01));
      const g0 = Math.floor(s.rowLo / k), g1 = Math.floor((s.rowLo + s.rows.length - 1) / k);
      const fs = Math.max(7 * vr, Math.min(rowH * k * 0.86, cellW * 1.05, 13 * vr));
      const fN = `600 ${Math.round(fs)}px ${fontFam}`, fB = `800 ${Math.round(fs)}px ${fontFam}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let g = g0; g <= g1; g++) {
        const rA = Math.max(0, g * k - s.rowLo), rB = Math.min(s.rows.length - 1, (g + 1) * k - 1 - s.rowLo);
        let list;
        if (k === 1) list = s.rows[rA];
        else { const set = new Set(); for (let r = rA; r <= rB; r++) for (const q of s.rows[r]) set.add(q); list = [...set].sort((x, y) => x - y); }
        if (!list || !list.length) continue;
        const yt = yOf((g + 1) * k * rs), yb = yOf(g * k * rs);
        if (yt == null || yb == null || yb < -10 || yt > H + 10) continue;
        const yc = yt + (yb - yt) / 2;
        const isPoc = o.poc && s.pocRow >= rA && s.pocRow <= rB;
        ctx.font = isPoc ? fB : fN;
        for (let j = 0; j < list.length; j++) {
          ctx.fillStyle = o.colors === 'mono' ? monoCol : periodColor(list[j], total, 'gradient', dark);
          ctx.fillText(letterOf(list[j]), x0 + (j + 0.5) * cellW, yc);
        }
      }
    } else {
      for (let r = 0; r < s.rows.length; r++) {
        const list = s.rows[r];
        if (!list.length) continue;
        const yt = rowTop(r), yb = rowBot(r);
        if (yb < -10 || yt > H + 10) continue;
        const h = Math.max(1, yb - yt);
        const isPoc = o.poc && r === s.pocRow;
        const gap = h > 3 * vr ? Math.max(1, Math.round(0.6 * vr)) : 0;
        const wgap = cellW > 4 * hr ? Math.max(1, Math.round(0.6 * hr)) : 0;
        if (o.colors === 'mono' || cellW < 2 * hr) {
          ctx.fillStyle = isPoc ? o.pocColor : monoCol;
          ctx.fillRect(x0, yt + gap / 2, list.length * cellW - wgap, h - gap);
        } else {
          for (let k = 0; k < list.length; k++) {
            ctx.fillStyle = isPoc ? o.pocColor : periodColor(list[k], total, 'gradient', dark);
            ctx.fillRect(x0 + k * cellW, yt + gap / 2, cellW - wgap, h - gap);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    // Initial Balance
    if (o.ib && Number.isFinite(s.ibHi)) {
      const ya = yOf(s.ibHi), yb = yOf(s.ibLo);
      if (ya != null && yb != null) { ctx.fillStyle = s.ibDone ? o.ibColor : rgba(o.ibColor, 0.5); ctx.fillRect(x0 - 4 * hr, ya, 2.5 * hr, yb - ya); }
    }
    // Linien
    const line = (p, col, name) => {
      const y = yOf(p);
      if (y == null || y < 0 || y > H) return;
      const yy = Math.round(y) + 0.5;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, hr * (o.width || 1));
      ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(lineEnd, yy); ctx.stroke();
      if (o.names) labels.push({ x: lineEnd + 3 * hr, y: yy, text: name, color: col });
    };
    if (o.va && s.vah != null) { line(s.vah, o.vaColor, 'VAH'); line(s.val, o.vaColor, 'VAL'); }
    if (o.poc && s.poc != null) line(s.poc, o.pocColor, 'POC');
  }
  if (labels.length) {
    ctx.font = `600 ${Math.round(9.5 * vr)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    labels.sort((a, b) => a.y - b.y);
    let prevY = -Infinity, prevX = null;
    for (const l of labels) {
      if (prevX != null && Math.abs(prevX - l.x) < 2 && l.y < prevY + 11 * vr) l.y = prevY + 11 * vr;
      prevY = l.y; prevX = l.x;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.x, l.y);
    }
  }
}
