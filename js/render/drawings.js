// Zeichenwerkzeuge wie in TradingView: Trendlinie, Strahl, horizontale Linie/Strahl, vertikale Linie,
// Rechteck, Fibonacci, Preisspanne (Messen), Text, Long-/Short-Position. Speicherung je Coin im Browser.
import { storage, floorIndex, tfMs, fmtPct, fmtDateTime, rgba, uid, nf } from '../util.js';

export const TOOLS = [
  ['cursor', 'Kreuz'], ['trend', 'Trendlinie'], ['ray', 'Strahl'], ['hline', 'Horizontale Linie'], ['hray', 'Horizontaler Strahl'],
  ['vline', 'Vertikale Linie'], ['rect', 'Rechteck'], ['fib', 'Fibonacci Retracement'], ['measure', 'Preisspanne messen'],
  ['text', 'Text'], ['long', 'Long-Position'], ['short', 'Short-Position'],
];
const ONE_POINT = new Set(['hline', 'hray', 'vline', 'text', 'long', 'short']);
const FIB = [[0, '#787b86'], [0.236, '#f23645'], [0.382, '#ff9800'], [0.5, '#4caf50'], [0.618, '#089981'], [0.786, '#00bcd4'], [1, '#787b86'], [1.618, '#2962ff']];
export const COLORS = ['#2962ff', '#e91e63', '#7c3aed', '#f0a93b', '#26a69a', '#ef5350', '#131722', '#ffffff'];

export class Drawings {
  constructor(app) {
    this.app = app;
    this.items = [];
    this.tool = 'cursor';
    this.sel = null;
    this.pending = null;
    this.drag = null;
    this.hover = null;
    const self = this;
    this._axisViews = [];
    this.prim = {
      attached({ chart, series, requestUpdate }) { self.chart = chart; self.series = series; self.requestUpdate = requestUpdate; },
      detached() { self.series = null; },
      updateAllViews() {},
      paneViews() { return [{ zOrder: () => 'top', renderer: () => ({ draw: (t) => self._draw(t) }) }]; },
      priceAxisViews() { return self._axisViews; },
    };
    this._bind();
  }

  get key() { return 'tqi-charts:draw:' + this.app.state.base; }
  load() { this.items = storage.get(this.key, []).filter(x => x && x.type && Array.isArray(x.pts)); this.sel = null; this.pending = null; this._changed(false); }
  save() { storage.set(this.key, this.items); }
  clearAll() { this.items = []; this.sel = null; this._changed(); }
  remove(it) { this.items = this.items.filter(x => x !== it); if (this.sel === it) this.sel = null; this._changed(); }

  setTool(t) {
    this.tool = t;
    this.pending = null;
    if (t !== 'cursor') this.sel = null;
    this.app.ui.onTool(t);
    this._changed(false);
  }
  _changed(persist = true) {
    if (persist) this.save();
    this._axisViews = this._buildAxis();
    this.requestUpdate?.();
    this.app.ui.onDrawingSelect(this.sel);
  }

  // ---------------------------------------------------------------- Koordinaten
  _step() { const tf = this.app.state.tf; return tfMs(tf === '1M' ? '1W' : tf); }
  tToL(t) {
    const b = this.app.bars, n = b.length;
    if (!n) return null;
    if (t >= b[n - 1].t) return n - 1 + (t - b[n - 1].t) / this._step();
    if (t <= b[0].t) return (t - b[0].t) / this._step();
    const i = floorIndex(b, t);
    const nx = b[i + 1];
    return i + (nx ? (t - b[i].t) / (nx.t - b[i].t) : 0);
  }
  lToT(l) {
    const b = this.app.bars, n = b.length;
    if (l >= n - 1) return b[n - 1].t + (l - (n - 1)) * this._step();
    if (l <= 0) return b[0].t + l * this._step();
    const i = Math.floor(l);
    return b[i].t + (l - i) * (b[i + 1].t - b[i].t);
  }
  tToX(t) { const l = this.tToL(t); return l == null ? null : this.chart.timeScale().logicalToCoordinate(l); }
  pToY(p) { return this.series?.priceToCoordinate(p) ?? null; }
  /** Punkt aus Mausposition (x, y in CSS-Pixeln relativ zum Chart). Zeit auf Kerzenmitte, Magnet optional. */
  pointAt(x, y) {
    const ts = this.chart.timeScale();
    let l = ts.coordinateToLogical(x);
    if (l == null) return null;
    l = Math.round(l);
    let p = this.series.coordinateToPrice(y);
    if (p == null) return null;
    const b = this.app.bars[Math.max(0, Math.min(this.app.bars.length - 1, l))];
    if (this.app.state.magnet && b && l >= 0 && l < this.app.bars.length) {
      let best = p, bd = Infinity;
      for (const v of [b.o, b.h, b.l, b.c]) { const d = Math.abs(this.pToY(v) - y); if (d < bd) { bd = d; best = v; } }
      if (bd < 30) p = best;
    }
    return { t: this.lToT(l), p };
  }

  // ---------------------------------------------------------------- Eingabe
  _bind() {
    const el = this.app.ui.chartEl;
    const layer = this.app.ui.drawLayer;
    const rel = (e, node) => { const r = node.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    // Zeichnen: eigene Ebene fängt alle Eingaben ab
    layer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const { x, y } = rel(e, el);
      const pt = this.pointAt(x, y);
      if (!pt) return;
      this._down = { x, y, at: Date.now() };
      if (!this.pending) {
        const it = this._create(this.tool, pt);
        if (!it) return;
        if (ONE_POINT.has(it.type)) { this._finish(it); return; }
        this.pending = it;
        try { layer.setPointerCapture(e.pointerId); } catch { /* egal */ }
      } else {
        this.pending.pts[1] = pt;
        this._finish(this.pending);
      }
    });
    layer.addEventListener('pointermove', (e) => {
      const { x, y } = rel(e, el);
      const pt = this.pointAt(x, y);
      if (pt) {
        try { this.chart.setCrosshairPosition(pt.p, this.app.bars[Math.max(0, Math.min(this.app.bars.length - 1, Math.round(this.tToL(pt.t))))]?.t / 1000, this.series); } catch { /* egal */ }
        if (this.pending) { this.pending.pts[1] = pt; this.requestUpdate?.(); }
      }
    });
    layer.addEventListener('pointerup', (e) => {
      if (!this.pending || !this._down) return;
      const { x, y } = rel(e, el);
      if (Math.hypot(x - this._down.x, y - this._down.y) > 8) { // gezogen: sofort fertig
        const pt = this.pointAt(x, y);
        if (pt) this.pending.pts[1] = pt;
        this._finish(this.pending);
      }
    });
    layer.addEventListener('pointerleave', () => { try { this.chart.clearCrosshairPosition(); } catch { /* egal */ } });

    // Bearbeiten: vor dem Chart abfangen, wenn eine Zeichnung getroffen wird
    el.addEventListener('pointerdown', (e) => {
      if (this.tool !== 'cursor' || this.app.state.drawHide || e.button > 0) return;
      const { x, y } = rel(e, el);
      const hit = this._hit(x, y);
      if (!hit) { if (this.sel) { this.sel = null; this._changed(false); } return; }
      this.sel = hit.item;
      if (this.app.state.drawLock || hit.item.locked) { this._changed(false); return; }
      this.chart.applyOptions({ handleScroll: false, handleScale: false });
      this.drag = { ...hit, x0: x, y0: y, orig: JSON.parse(JSON.stringify(hit.item.pts)), origExtra: { ...hit.item } };
      try { el.setPointerCapture(e.pointerId); } catch { /* egal */ }
      this._changed(false);
    }, true);
    el.addEventListener('pointermove', (e) => {
      if (this.tool !== 'cursor') return;
      const { x, y } = rel(e, el);
      if (this.drag) { this._dragTo(x, y); return; }
      if (e.pointerType === 'mouse') {
        const h = this._hit(x, y);
        el.style.cursor = h ? (h.handle != null ? 'grab' : 'pointer') : '';
      }
    }, true);
    const end = () => {
      if (!this.drag) return;
      this.drag = null;
      this.chart.applyOptions({ handleScroll: true, handleScale: true });
      this._changed();
    };
    el.addEventListener('pointerup', end, true);
    el.addEventListener('pointercancel', end, true);
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { this.remove(this.sel); e.preventDefault(); }
      if (e.key === 'Escape') { if (this.pending) { this.pending = null; this.requestUpdate?.(); } if (this.tool !== 'cursor') this.setTool('cursor'); else if (this.sel) { this.sel = null; this._changed(false); } }
    });
  }

  _create(type, pt) {
    const base = { id: uid(), type, pts: [pt, { ...pt }], color: type === 'long' || type === 'short' ? null : '#2962ff', width: 2 };
    if (type === 'hline' || type === 'hray') base.color = '#7c3aed';
    if (type === 'text') {
      const txt = window.prompt('Text', '');
      if (!txt) { this.setTool('cursor'); return null; }
      base.text = txt; base.color = this.app.theme.dark ? '#e8e6e1' : '#131722';
    }
    if (type === 'long' || type === 'short') {
      const r = Math.abs(pt.p) * 0.006;
      const sgn = type === 'long' ? 1 : -1;
      base.stop = pt.p - sgn * r; base.target = pt.p + sgn * 2 * r;
      base.pts[1] = { t: pt.t + 24 * this._step(), p: pt.p };
    }
    return base;
  }
  _finish(it) {
    this.pending = null;
    if (!this.items.includes(it)) this.items.push(it);
    this.sel = it;
    this.setTool('cursor');
    this._changed();
  }

  _dragTo(x, y) {
    const d = this.drag, it = d.item;
    const pt = this.pointAt(x, y);
    if (!pt) return;
    const p0 = this.pointAt(d.x0, d.y0);
    if (d.handle === 'stop') it.stop = pt.p;
    else if (d.handle === 'target') it.target = pt.p;
    else if (d.handle === 'right') it.pts[1] = { t: pt.t, p: it.pts[0].p };
    else if (d.handle != null) it.pts[d.handle] = pt;
    else {
      // ganze Zeichnung verschieben
      const dl = this.tToL(pt.t) - this.tToL(p0.t), dp = pt.p - p0.p;
      it.pts = d.orig.map(q => ({ t: this.lToT(this.tToL(q.t) + dl), p: q.p + dp }));
      if (it.stop != null) { it.stop = d.origExtra.stop + dp; it.target = d.origExtra.target + dp; }
    }
    if ((it.type === 'long' || it.type === 'short') && d.handle === 0) {
      const dp = it.pts[0].p - d.orig[0].p;
      it.stop = d.origExtra.stop + dp; it.target = d.origExtra.target + dp; it.pts[1].p = it.pts[0].p;
    }
    this._axisViews = this._buildAxis();
    this.requestUpdate?.();
  }

  // ---------------------------------------------------------------- Treffer
  _geom(it) {
    const a = it.pts[0], b = it.pts[1];
    return { x1: this.tToX(a.t), y1: this.pToY(a.p), x2: this.tToX(b.t), y2: this.pToY(b.p) };
  }
  _hit(x, y) {
    if (!this.series) return null;
    const W = this.app.ui.chartEl.clientWidth;
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      const g = this._geom(it);
      if (g.y1 == null) continue;
      const near = (px, py) => px != null && py != null && Math.hypot(x - px, y - py) < 9;
      if (this.sel === it) {
        if (it.type === 'long' || it.type === 'short') {
          if (near(g.x1, this.pToY(it.stop))) return { item: it, handle: 'stop' };
          if (near(g.x1, this.pToY(it.target))) return { item: it, handle: 'target' };
          if (near(g.x2, g.y1)) return { item: it, handle: 'right' };
          if (near(g.x1, g.y1)) return { item: it, handle: 0 };
        } else {
          if (near(g.x1, g.y1)) return { item: it, handle: 0 };
          if (!ONE_POINT.has(it.type) && near(g.x2, g.y2)) return { item: it, handle: 1 };
        }
      }
      switch (it.type) {
        case 'hline': if (Math.abs(y - g.y1) < 6) return { item: it }; break;
        case 'hray': if (Math.abs(y - g.y1) < 6 && x >= g.x1 - 6) return { item: it }; break;
        case 'vline': if (g.x1 != null && Math.abs(x - g.x1) < 6) return { item: it }; break;
        case 'trend': case 'ray': {
          if (g.x1 == null || g.x2 == null) break;
          let x2 = g.x2, y2 = g.y2;
          if (it.type === 'ray' && x2 !== g.x1) { const k2 = (y2 - g.y1) / (x2 - g.x1); x2 = x2 > g.x1 ? W : 0; y2 = g.y1 + k2 * (x2 - g.x1); }
          if (segDist(x, y, g.x1, g.y1, x2, y2) < 6) return { item: it };
          break;
        }
        case 'text': if (g.x1 != null && x >= g.x1 - 4 && x <= g.x1 + 8 * (it.text?.length || 1) && Math.abs(y - g.y1) < 12) return { item: it }; break;
        case 'long': case 'short': {
          const ys = [this.pToY(it.stop), this.pToY(it.target)];
          if (g.x1 != null && x >= Math.min(g.x1, g.x2) && x <= Math.max(g.x1, g.x2) && y >= Math.min(...ys) && y <= Math.max(...ys)) return { item: it };
          break;
        }
        default: { // rect, fib, measure
          if (g.x1 == null || g.x2 == null) break;
          const l = Math.min(g.x1, g.x2) - 4, r = Math.max(g.x1, g.x2) + 4, t = Math.min(g.y1, g.y2) - 4, bt = Math.max(g.y1, g.y2) + 4;
          if (it.type === 'fib') {
            if (x >= l && x <= (it.ext ? W : r)) for (const [lv] of FIB) { const py = this.pToY(this._fibPrice(it, lv)); if (py != null && Math.abs(y - py) < 5) return { item: it }; }
          } else if (x >= l && x <= r && y >= t && y <= bt) return { item: it };
        }
      }
    }
    return null;
  }
  _fibPrice(it, lv) { return it.pts[1].p + lv * (it.pts[0].p - it.pts[1].p); }

  // ---------------------------------------------------------------- Achsen-Labels (horizontale Linien, Auswahl)
  _buildAxis() {
    const out = [];
    const add = (p, bg) => out.push({ coordinate: () => this.pToY(p) ?? -100, text: () => this.app.fmt(p), textColor: () => '#fff', backColor: () => bg, visible: () => true, tickVisible: () => true });
    if (this.app.state.drawHide) return out;
    for (const it of this.items) {
      if (it.type === 'hline' || it.type === 'hray') add(it.pts[0].p, it.color);
      else if (it === this.sel) {
        if (it.type === 'long' || it.type === 'short') { add(it.pts[0].p, '#2962ff'); add(it.stop, '#ef5350'); add(it.target, '#26a69a'); }
        else if (it.type !== 'vline' && it.type !== 'text') { add(it.pts[0].p, it.color); add(it.pts[1].p, it.color); }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- Zeichnen
  _draw(target) {
    if (!this.series || this.app.state.drawHide) return;
    const list = this.pending ? [...this.items, this.pending] : this.items;
    if (!list.length) return;
    const th = this.app.theme;
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const W = bitmapSize.width, H = bitmapSize.height;
      const X = (x) => x * hr, Y = (y) => y * vr;
      const font = (px, w = 500) => `${w} ${Math.round(px * vr)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      for (const it of list) {
        const g = this._geom(it);
        if (g.y1 == null && it.type !== 'vline') continue;
        const sel = it === this.sel || it === this.pending;
        const col = it.color || '#2962ff';
        ctx.lineWidth = Math.max(1, (it.width || 1) * hr * (sel ? 1 : 0.85));
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.setLineDash([]);
        const handles = [];
        switch (it.type) {
          case 'trend': case 'ray': {
            if (g.x1 == null || g.x2 == null) break;
            let x2 = g.x2, y2 = g.y2;
            if (it.type === 'ray' && x2 !== g.x1) { const k = (y2 - g.y1) / (x2 - g.x1); x2 = x2 > g.x1 ? W / hr : 0; y2 = g.y1 + k * (x2 - g.x1); }
            ctx.beginPath(); ctx.moveTo(X(g.x1), Y(g.y1)); ctx.lineTo(X(x2), Y(y2)); ctx.stroke();
            handles.push([g.x1, g.y1], [g.x2, g.y2]);
            break;
          }
          case 'hline': {
            const y = Math.round(Y(g.y1)) + 0.5;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
            if (g.x1 != null) handles.push([g.x1, g.y1]);
            break;
          }
          case 'hray': {
            if (g.x1 == null) break;
            const y = Math.round(Y(g.y1)) + 0.5;
            ctx.beginPath(); ctx.moveTo(X(g.x1), y); ctx.lineTo(W, y); ctx.stroke();
            handles.push([g.x1, g.y1]);
            break;
          }
          case 'vline': {
            if (g.x1 == null) break;
            const x = Math.round(X(g.x1)) + 0.5;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            handles.push([g.x1, g.y1 ?? 20]);
            break;
          }
          case 'rect': {
            if (g.x1 == null || g.x2 == null) break;
            ctx.fillStyle = rgba(col, 0.14);
            ctx.fillRect(X(Math.min(g.x1, g.x2)), Y(Math.min(g.y1, g.y2)), X(Math.abs(g.x2 - g.x1)), Y(Math.abs(g.y2 - g.y1)));
            ctx.strokeRect(X(Math.min(g.x1, g.x2)), Y(Math.min(g.y1, g.y2)), X(Math.abs(g.x2 - g.x1)), Y(Math.abs(g.y2 - g.y1)));
            handles.push([g.x1, g.y1], [g.x2, g.y2]);
            break;
          }
          case 'fib': {
            if (g.x1 == null || g.x2 == null) break;
            const l = Math.min(g.x1, g.x2), r = it.ext ? W / hr : Math.max(g.x1, g.x2);
            ctx.font = font(10.5);
            ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
            let prevY = null;
            for (const [lv, c] of FIB) {
              const p = this._fibPrice(it, lv), y = this.pToY(p);
              if (y == null) continue;
              if (prevY != null) { ctx.fillStyle = rgba(c, 0.07); ctx.fillRect(X(l), Y(Math.min(prevY, y)), X(r - l), Y(Math.abs(y - prevY))); }
              prevY = y;
              ctx.strokeStyle = c; ctx.lineWidth = Math.max(1, hr);
              ctx.beginPath(); ctx.moveTo(X(l), Math.round(Y(y)) + 0.5); ctx.lineTo(X(r), Math.round(Y(y)) + 0.5); ctx.stroke();
              ctx.fillStyle = c;
              ctx.fillText(`${lv} (${this.app.fmt(p)})`, X(l) + 4 * hr, Y(y) - 2 * vr);
            }
            ctx.strokeStyle = rgba('#787b86', 0.6); ctx.setLineDash([4 * hr, 4 * hr]);
            ctx.beginPath(); ctx.moveTo(X(g.x1), Y(g.y1)); ctx.lineTo(X(g.x2), Y(g.y2)); ctx.stroke(); ctx.setLineDash([]);
            handles.push([g.x1, g.y1], [g.x2, g.y2]);
            break;
          }
          case 'measure': {
            if (g.x1 == null || g.x2 == null) break;
            const a = it.pts[0], b = it.pts[1];
            const up = b.p >= a.p;
            const c = up ? '#2962ff' : '#ef5350';
            ctx.fillStyle = rgba(c, 0.16);
            ctx.fillRect(X(Math.min(g.x1, g.x2)), Y(Math.min(g.y1, g.y2)), X(Math.abs(g.x2 - g.x1)), Y(Math.abs(g.y2 - g.y1)));
            ctx.strokeStyle = c; ctx.lineWidth = Math.max(1, hr);
            const mx = X((g.x1 + g.x2) / 2), my = Y((g.y1 + g.y2) / 2);
            arrow(ctx, mx, Y(g.y1), mx, Y(g.y2), 6 * hr);
            arrow(ctx, X(g.x1), my, X(g.x2), my, 6 * hr);
            const dp = b.p - a.p, pct = dp / a.p * 100;
            const nb = Math.round(this.tToL(b.t) - this.tToL(a.t));
            const ms = Math.abs(b.t - a.t);
            const dur = ms >= 864e5 ? `${Math.floor(ms / 864e5)}T ${Math.round((ms % 864e5) / 36e5)}h` : `${Math.floor(ms / 36e5)}h ${Math.round((ms % 36e5) / 6e4)}m`;
            const l1 = `${dp >= 0 ? '+' : '−'}${this.app.fmt(Math.abs(dp))} (${fmtPct(pct)})`;
            const l2 = `${nb} Kerzen, ${dur}`;
            ctx.font = font(11.5, 600);
            const w = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + 16 * hr;
            const bx = mx - w / 2, by = up ? Y(Math.min(g.y1, g.y2)) - 44 * vr : Y(Math.max(g.y1, g.y2)) + 6 * vr;
            ctx.fillStyle = c; roundRect(ctx, bx, by, w, 38 * vr, 4 * hr); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(l1, mx, by + 12 * vr); ctx.font = font(11); ctx.fillText(l2, mx, by + 27 * vr);
            break;
          }
          case 'text': {
            if (g.x1 == null) break;
            ctx.font = font(13, 600); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillStyle = col; ctx.fillText(it.text || '', X(g.x1), Y(g.y1));
            if (sel) { const w = ctx.measureText(it.text || '').width; ctx.strokeStyle = rgba('#2962ff', 0.8); ctx.strokeRect(X(g.x1) - 3 * hr, Y(g.y1) - 10 * vr, w + 6 * hr, 20 * vr); }
            break;
          }
          case 'long': case 'short': {
            if (g.x1 == null || g.x2 == null) break;
            const ye = Y(g.y1), ys = Y(this.pToY(it.stop)), yt = Y(this.pToY(it.target));
            const l = X(Math.min(g.x1, g.x2)), w = X(Math.abs(g.x2 - g.x1));
            ctx.fillStyle = rgba('#26a69a', 0.2); ctx.fillRect(l, Math.min(ye, yt), w, Math.abs(yt - ye));
            ctx.fillStyle = rgba('#ef5350', 0.2); ctx.fillRect(l, Math.min(ye, ys), w, Math.abs(ys - ye));
            ctx.strokeStyle = th.dark ? '#d1d4dc' : '#131722'; ctx.lineWidth = Math.max(1, hr);
            ctx.beginPath(); ctx.moveTo(l, Math.round(ye) + 0.5); ctx.lineTo(l + w, Math.round(ye) + 0.5); ctx.stroke();
            const e = it.pts[0].p, risk = Math.abs(e - it.stop), rew = Math.abs(it.target - e);
            const rr = risk > 0 ? rew / risk : 0;
            ctx.font = font(11, 600); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const cx = l + w / 2;
            const tag = (txt, y, bg) => { const tw = ctx.measureText(txt).width + 12 * hr; ctx.fillStyle = bg; roundRect(ctx, cx - tw / 2, y - 9 * vr, tw, 18 * vr, 3 * hr); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(txt, cx, y); };
            const dir = it.type === 'long' ? 1 : -1;
            tag(`Ziel ${this.app.fmt(it.target)} (${fmtPct(dir * (it.target - e) / e * 100)})`, yt + (yt < ye ? -12 : 12) * vr, '#089981');
            tag(`Stop ${this.app.fmt(it.stop)} (${fmtPct(dir * (it.stop - e) / e * 100)})`, ys + (ys < ye ? -12 : 12) * vr, '#f23645');
            tag(`${it.type === 'long' ? 'Long' : 'Short'} · R:R ${nf(2).format(rr)}`, ye + (yt < ye ? 12 : -12) * vr, '#2962ff');
            handles.push([g.x1, g.y1], [g.x1, this.pToY(it.stop)], [g.x1, this.pToY(it.target)], [g.x2, g.y1]);
            break;
          }
        }
        if (sel) {
          ctx.setLineDash([]);
          for (const [hx, hy] of handles) {
            if (hx == null || hy == null) continue;
            ctx.beginPath(); ctx.arc(X(hx), Y(hy), 5 * hr, 0, Math.PI * 2);
            ctx.fillStyle = th.dark ? '#141413' : '#ffffff'; ctx.fill();
            ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 1.5 * hr; ctx.stroke();
          }
        }
      }
    });
  }
}

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function arrow(ctx, x1, y1, x2, y2, s) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45));
  ctx.stroke();
}
export { fmtDateTime };
