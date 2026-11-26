// Zeichen-Layer auf dem Hauptchart (Lightweight-Charts-Primitive):
// Linien je Kerze, gefüllte Bänder, horizontale Level ab Zeitpunkt, Boxen, Marker, Blasen,
// Beschriftungen (ohne Überlappung) und farbige Preis-Labels an der Achse.
import { floorIndex, tfMs } from '../util.js';

export class Scene {
  constructor() { this.clear(); }
  clear() {
    this.lines = []; this.fills = []; this.levels = []; this.boxes = []; this.marks = [];
    this.bubbles = []; this.axis = []; this.barBoxes = [];
  }
  line(vals, o = {}) { this.lines.push({ vals, color: o.color || '#888', width: o.width || 1, dash: o.dash || null, breaks: o.breaks || null, label: o.label || null, lc: o.lc || o.color, alpha: o.alpha ?? 1 }); }
  fill(a, b, o = {}) { this.fills.push({ a, b, color: o.color || 'rgba(128,128,128,.15)', breaks: o.breaks || null }); }
  /** Horizontales Level: p, from (ms), to (ms | null = bis rechts), ext (Kerzen nach rechts statt bis Rand). */
  level(o) { this.levels.push(Object.assign({ width: 1, dash: null, color: '#888', label: null, lc: null, to: null, ext: null, alpha: 1 }, o)); }
  box(o) { this.boxes.push(Object.assign({ fill: 'rgba(128,128,128,.15)', stroke: null, label: null, lc: null, to: null, ext: null, labelPos: 'right' }, o)); }
  barBox(o) { this.barBoxes.push(o); }
  mark(o) { this.marks.push(Object.assign({ shape: 'up', color: '#888', size: 7, text: null }, o)); }
  bubble(o) { this.bubbles.push(o); }
  axisLabel(p, text, bg, fg) { if (Number.isFinite(p)) this.axis.push({ p, text, bg, fg }); }
}

const DASH = { dashed: [6, 4], dotted: [1.5, 3], sparse: [2, 5] };

export class OverlayPrimitive {
  constructor(app) {
    this.app = app;
    this.scene = new Scene();
    this._axisViews = [];
    this._paneBack = { zOrder: () => 'bottom', renderer: () => ({ draw: (t) => this._draw(t, 'back') }) };
    this._paneFront = { zOrder: () => 'normal', renderer: () => ({ draw: (t) => this._draw(t, 'front') }) };
  }
  attached({ chart, series, requestUpdate }) { this.chart = chart; this.series = series; this.requestUpdate = requestUpdate; }
  detached() { this.chart = null; this.series = null; }
  paneViews() { return [this._paneBack, this._paneFront]; }
  updateAllViews() { /* Koordinaten werden beim Zeichnen berechnet */ }
  priceAxisViews() { return this._axisViews; }

  setScene(scene) {
    this.scene = scene;
    const s = this.series;
    const dec = this.app.priceDec;
    this._axisViews = scene.axis.map(a => ({
      coordinate: () => s ? (s.priceToCoordinate(a.p) ?? -100) : -100,
      text: () => a.text ?? this.app.fmt(a.p, dec),
      textColor: () => a.fg,
      backColor: () => a.bg,
      visible: () => true,
      tickVisible: () => true,
    }));
    this.requestUpdate?.();
  }

  // ---------------------------------------------------------------- Zeichnen
  _draw(target, layer) {
    const chart = this.chart, series = this.series;
    if (!chart || !series) return;
    const bars = this.app.bars;
    if (!bars || !bars.length) return;
    const ts = chart.timeScale();
    const vr = ts.getVisibleLogicalRange();
    if (!vr) return;
    const sc = this.scene;
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr2 }) => {
      const W = bitmapSize.width, H = bitmapSize.height;
      const i0 = Math.max(0, Math.floor(vr.from) - 2), i1 = Math.min(bars.length - 1, Math.ceil(vr.to) + 2);
      const xOf = (i) => { const x = ts.logicalToCoordinate(i); return x == null ? null : x * hr; };
      const yOf = (p) => { const y = series.priceToCoordinate(p); return y == null ? null : y * vr2; };
      const barW = Math.max(1, (ts.options().barSpacing || 6) * hr);
      const lastIdx = bars.length - 1;
      const step = tfMs(this.app.state.tf === '1M' ? '1W' : this.app.state.tf);
      const idxOfTime = (t) => {
        if (t == null) return null;
        if (t <= bars[0].t) return 0;
        const lastT = bars[lastIdx].t;
        if (t >= lastT + step) return lastIdx + (t - lastT) / step;
        return floorIndex(bars, t);
      };
      const rightX = W;
      const labelOff = (this.app.display.labelOffset ?? 3);
      const labelX = xOf(lastIdx + labelOff);
      const labels = layer === 'front' ? (this._backLabels || []) : [];
      const fontPx = Math.round((this.app.display.labelSize || 10) * vr2);
      ctx.save();
      ctx.lineJoin = 'round';

      if (layer === 'back') {
        // gefüllte Bänder
        for (const f of sc.fills) {
          ctx.fillStyle = f.color;
          let open = false, upper = [], lower = [];
          const flush = () => {
            if (upper.length > 1) {
              ctx.beginPath();
              ctx.moveTo(upper[0][0], upper[0][1]);
              for (let k = 1; k < upper.length; k++) ctx.lineTo(upper[k][0], upper[k][1]);
              for (let k = lower.length - 1; k >= 0; k--) ctx.lineTo(lower[k][0], lower[k][1]);
              ctx.closePath(); ctx.fill();
            }
            upper = []; lower = []; open = false;
          };
          for (let i = i0; i <= i1; i++) {
            const a = f.a[i], b = f.b[i];
            if (!Number.isFinite(a) || !Number.isFinite(b) || (f.breaks && f.breaks[i] && open)) { flush(); if (!Number.isFinite(a) || !Number.isFinite(b)) continue; }
            const x = xOf(i), ya = yOf(a), yb = yOf(b);
            if (x == null || ya == null || yb == null) continue;
            upper.push([x, ya]); lower.push([x, yb]); open = true;
          }
          flush();
        }
        // Boxen (Single Prints, Tails, HVB-Value-Area …)
        for (const b of sc.boxes) {
          const ia = idxOfTime(b.from);
          if (ia == null || ia > i1 + 2) continue;
          const xa = b.from < bars[0].t ? 0 : xOf(ia);
          let xb;
          if (b.to != null) { const ib = idxOfTime(b.to); xb = xOf(ib); }
          else if (b.ext != null) xb = xOf(ia + b.ext);
          else xb = rightX;
          if (xa == null || xb == null) continue;
          if (b.ext != null && b.to == null && ia + b.ext < i0) continue;
          const y1 = yOf(b.top), y2 = yOf(b.bottom);
          if (y1 == null || y2 == null) continue;
          const yt = Math.min(y1, y2), hgt = Math.max(1, Math.abs(y2 - y1));
          ctx.fillStyle = b.fill;
          ctx.fillRect(xa, yt, Math.max(1, xb - xa), hgt);
          if (b.stroke) {
            ctx.strokeStyle = b.stroke; ctx.lineWidth = Math.max(1, hr);
            ctx.setLineDash(b.dash ? DASH[b.dash].map(v => v * hr) : []);
            ctx.strokeRect(Math.round(xa) + 0.5, Math.round(yt) + 0.5, Math.max(1, xb - xa), hgt);
            ctx.setLineDash([]);
          }
          if (b.label) labels.push({ x: b.to == null && b.ext == null ? labelX : xb + 4 * hr, y: yt + hgt / 2, text: b.label, color: b.lc || b.stroke || '#888', align: 'left' });
        }
        this._backLabels = labels;
        // Rahmen um einzelne Kerzen (Volumen-Kerzen, HVB)
        for (const bb of sc.barBoxes) {
          if (bb.i < i0 || bb.i > i1) continue;
          const x = xOf(bb.i), y1 = yOf(bb.top), y2 = yOf(bb.bottom);
          if (x == null || y1 == null || y2 == null) continue;
          const w = Math.max(3 * hr, barW * (bb.wf || 1.1));
          ctx.fillStyle = bb.fill || 'transparent';
          if (bb.fill) ctx.fillRect(x - w / 2, Math.min(y1, y2) - 2 * vr2, w, Math.abs(y2 - y1) + 4 * vr2);
          if (bb.stroke) { ctx.strokeStyle = bb.stroke; ctx.lineWidth = Math.max(1, hr); ctx.strokeRect(x - w / 2, Math.min(y1, y2) - 2 * vr2, w, Math.abs(y2 - y1) + 4 * vr2); }
        }
      } else {
        // Linien je Kerze
        for (const ln of sc.lines) {
          ctx.strokeStyle = ln.color; ctx.lineWidth = Math.max(1, ln.width * hr);
          ctx.globalAlpha = ln.alpha;
          ctx.setLineDash(ln.dash ? DASH[ln.dash].map(v => v * hr) : []);
          ctx.beginPath();
          let pen = false;
          for (let i = i0; i <= i1; i++) {
            const v = ln.vals[i];
            if (!Number.isFinite(v)) { pen = false; continue; }
            const x = xOf(i), y = yOf(v);
            if (x == null || y == null) { pen = false; continue; }
            if (!pen || (ln.breaks && ln.breaks[i])) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
          if (ln.label) {
            const v = ln.vals[lastIdx];
            const y = Number.isFinite(v) ? yOf(v) : null;
            if (y != null) labels.push({ x: xOf(lastIdx) + 6 * hr, y, text: ln.label, color: ln.lc || ln.color, align: 'left' });
          }
        }
        ctx.setLineDash([]);
        // horizontale Level
        for (const lv of sc.levels) {
          const y = yOf(lv.p);
          if (y == null || y < -50 || y > H + 50) { continue; }
          const ia = idxOfTime(lv.from);
          let xa = lv.from == null || lv.from < bars[0].t ? 0 : xOf(ia);
          let xb;
          if (lv.to != null) xb = xOf(idxOfTime(lv.to));
          else if (lv.ext != null) xb = xOf((ia ?? lastIdx) + lv.ext);
          else xb = rightX;
          if (lv.fromIdx != null) xa = xOf(lv.fromIdx);
          if (xa == null || xb == null || xb < 0 || xa > W) continue;
          if (lv.label && lv.to == null && lv.ext == null && labelX != null) xb = Math.min(xb, labelX - 4 * hr);
          ctx.strokeStyle = lv.color; ctx.lineWidth = Math.max(1, lv.width * hr);
          ctx.globalAlpha = lv.alpha;
          ctx.setLineDash(lv.dash ? DASH[lv.dash].map(v => v * hr) : []);
          const yy = Math.round(y) + (Math.round(lv.width * hr) % 2 ? 0.5 : 0);
          ctx.beginPath(); ctx.moveTo(Math.max(0, xa), yy); ctx.lineTo(Math.min(W, xb), yy); ctx.stroke();
          ctx.globalAlpha = 1;
          if (lv.label) {
            const lx = lv.to != null ? xb + 4 * hr : (lv.ext != null ? xb + 4 * hr : labelX);
            labels.push({ x: lx, y, text: lv.label, color: lv.lc || lv.color, align: 'left' });
          }
        }
        ctx.setLineDash([]);
        // Blasen (große Trades)
        for (const bu of sc.bubbles) {
          const i = idxOfTime(bu.t);
          if (i == null || i < i0 || i > i1) continue;
          const x = xOf(i), y = yOf(bu.p);
          if (x == null || y == null) continue;
          const r = bu.r * hr;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = bu.fill; ctx.fill();
          if (bu.stroke) { ctx.strokeStyle = bu.stroke; ctx.lineWidth = hr; ctx.stroke(); }
        }
        // Marker
        ctx.font = `600 ${Math.round(9 * vr2)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        for (const m of sc.marks) {
          const i = m.i != null ? m.i : idxOfTime(m.t);
          if (i == null || i < i0 || i > i1) continue;
          const x = xOf(i), y0 = yOf(m.p);
          if (x == null || y0 == null) continue;
          const s = m.size * hr;
          const up = m.shape === 'up';
          const y = up ? y0 + 6 * vr2 + s : y0 - 6 * vr2 - s;
          ctx.fillStyle = m.color;
          ctx.beginPath();
          if (m.shape === 'diamond') {
            ctx.moveTo(x, y0 - s); ctx.lineTo(x + s, y0); ctx.lineTo(x, y0 + s); ctx.lineTo(x - s, y0); ctx.closePath();
          } else if (up) {
            ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.9, y + s * 0.6); ctx.lineTo(x - s * 0.9, y + s * 0.6); ctx.closePath();
          } else {
            ctx.moveTo(x, y + s); ctx.lineTo(x + s * 0.9, y - s * 0.6); ctx.lineTo(x - s * 0.9, y - s * 0.6); ctx.closePath();
          }
          ctx.fill();
          if (m.text) {
            ctx.textAlign = 'center';
            ctx.textBaseline = up ? 'top' : 'bottom';
            ctx.fillText(m.text, x, up ? y + s + 2 * vr2 : y - s - 2 * vr2);
          }
        }
        // Beschriftungen ohne Überlappung
        this._drawLabels(ctx, labels, fontPx, W, H, vr2, hr);
        this._backLabels = [];
      }
      ctx.restore();
    });
  }

  _drawLabels(ctx, labels, fontPx, W, H, vr2, hr) {
    if (!labels.length) return;
    const d = this.app.display;
    ctx.font = `${fontPx}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const gap = fontPx + 2 * vr2;
    if (d.labelNoOverlap !== false) {
      // nach x gruppieren (Spalten), dann vertikal auseinanderschieben
      labels.sort((a, b) => a.y - b.y);
      const cols = [];
      for (const l of labels) {
        let col = cols.find(c => Math.abs(c.x - l.x) < 40 * hr);
        if (!col) { col = { x: l.x, items: [] }; cols.push(col); }
        col.items.push(l);
      }
      for (const c of cols) {
        let prev = -Infinity;
        for (const l of c.items) { if (l.y < prev + gap) l.y = prev + gap; prev = l.y; }
      }
    }
    for (const l of labels) {
      if (l.x == null || l.y < -gap || l.y > H + gap) continue;
      const w = ctx.measureText(l.text).width;
      const x = Math.min(l.x, W - w - 4 * hr);
      if (d.labelBg) {
        ctx.fillStyle = this.app.theme.labelBg;
        ctx.fillRect(x - 2 * hr, l.y - fontPx / 2 - 1, w + 4 * hr, fontPx + 2);
      }
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, x, l.y);
    }
  }
}
