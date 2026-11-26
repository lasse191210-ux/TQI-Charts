// Zeichenwerkzeuge wie in TradingView: Trendlinie, Strahl, horizontale Linie/Strahl, vertikale Linie,
// Rechteck, Fibonacci, Preisspanne (Messen), Text, Long-/Short-Position. Speicherung je Coin im Browser.
import { storage, floorIndex, tfMs, fmtPct, fmtDateTime, rgba, uid, nf, fmtCompact, lowerBound, niceStep } from '../util.js';
import { rangeProfile, autoRows } from '../calc/vprofile.js';
import { valueArea } from '../calc/profile.js';
import { drawProfile } from './vpdraw.js';
import { letterOf } from './tpo.js';
import { ALERT_CONDS } from '../alerts.js';

export const TOOLS = [
  ['cursor', 'Kreuz'], ['trend', 'Trendlinie'], ['ray', 'Strahl'], ['hline', 'Horizontale Linie'], ['hray', 'Horizontaler Strahl'],
  ['vline', 'Vertikale Linie'], ['rect', 'Rechteck'], ['fib', 'Fibonacci Retracement'], ['measure', 'Preisspanne messen'], ['fvp', 'Fixed Range Volume Profile'], ['ftpo', 'Fixed Range TPO'], ['avwap', 'Anchored VWAP'],
  ['text', 'Text'], ['long', 'Long-Position'], ['short', 'Short-Position'], ['alert', 'Alarm (Preis)'],
];
const ONE_POINT = new Set(['hline', 'hray', 'vline', 'text', 'long', 'short', 'avwap', 'alert']);
const FIB = [[0, '#787b86'], [0.236, '#f23645'], [0.382, '#ff9800'], [0.5, '#4caf50'], [0.618, '#089981'], [0.786, '#00bcd4'], [1, '#787b86'], [1.618, '#2962ff']];
export const COLORS = ['#2962ff', '#e91e63', '#7c3aed', '#f0a93b', '#26a69a', '#ef5350', '#131722', '#ffffff'];
/** Linien-Zeichnungen: Strichart, Beschriftung und Verlängern einstellbar (Rechtsklick → Einstellungen). */
export const LINE_TYPES = new Set(['trend', 'ray', 'hline', 'hray', 'vline', 'rect']);
const dashOf = (d, hr) => (d === 'dashed' ? [6 * hr, 4 * hr] : d === 'dotted' ? [1.5 * hr, 3 * hr] : []);

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
  /** Zeichnung kopieren (wie TradingView „Klonen“): leicht versetzt, damit man sie sieht. */
  clone(it) {
    const c = JSON.parse(JSON.stringify(it));
    c.id = uid(); c.locked = false;
    const dl = Math.max(2, Math.round(Math.abs(this.tToL(it.pts[1]?.t ?? it.pts[0].t) - this.tToL(it.pts[0].t)) * 0.1));
    c.pts = c.pts.map(q => ({ t: this.lToT(this.tToL(q.t) + dl), p: q.p }));
    this.items.push(c); this.sel = c; this._changed();
    return c;
  }
  /** Neue Zeichnung an einem Preis (Chart-Menü: horizontale Linie / Alarm hier). */
  addAt(type, p) {
    const b = this.app.bars, t = b[b.length - 1]?.t;
    if (!(p > 0) || t == null) return null;
    const it = this._create(type, { t, p });
    if (!it) return null;
    this.items.push(it); this.sel = it; this._changed();
    return it;
  }

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
  tToX(t) {
    const l = this.tToL(t);
    if (l == null) return null;
    // logicalToCoordinate kann nur ganze Indizes – Zwischenwerte selbst interpolieren
    const ts = this.chart.timeScale(), f = Math.floor(l), x = ts.logicalToCoordinate(f);
    return x == null ? null : x + (l - f) * (ts.options().barSpacing || 6);
  }
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
    // TQI Trader: Linien ziehen, Strg/Umschalt/Alt-Klick bzw. „antippen“ setzt Entry/Stop/Ziel (vor allen anderen Eingaben)
    el.addEventListener('pointerdown', (e) => {
      const T = this.app.trader;
      if (!T || !this.series || this.tool !== 'cursor' || e.button > 0) return;
      const { x, y } = rel(e, el);
      if (T.pick || ((e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) && T.open)) {
        const p = this.series.coordinateToPrice(y);
        if (p != null && T.chartClick(p, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey })) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      }
      const W = el.clientWidth;
      const hit = x < W ? T.lines().find(l => l.drag && Math.abs((this.pToY(l.p) ?? -1e9) - y) < (e.pointerType === 'touch' ? 12 : 6)) : null;
      if (!hit) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this._trDrag = { id: hit.id, p: hit.p };
      this.chart.applyOptions({ handleScroll: false, handleScale: false });
      try { el.setPointerCapture(e.pointerId); } catch { /* egal */ }
    }, true);
    el.addEventListener('pointermove', (e) => {
      const d = this._trDrag;
      if (!d) {
        const T = this.app.trader;
        if (T && e.pointerType === 'mouse' && this.tool === 'cursor' && this.series) {
          const { y } = rel(e, el);
          this._trHover = T.lines().some(l => l.drag && Math.abs((this.pToY(l.p) ?? -1e9) - y) < 6);
          if (this._trHover) el.style.cursor = 'ns-resize';
        }
        return;
      }
      e.stopImmediatePropagation();
      const { y } = rel(e, el);
      const p = this.series.coordinateToPrice(y);
      if (p == null) return;
      d.p = p;
      this.app.trader.dragLine(d.id, p, false);
      this._axisViews = this._buildAxis();
      this.requestUpdate?.();
    }, true);
    const trEnd = (e) => {
      const d = this._trDrag;
      if (!d) return;
      e.stopImmediatePropagation();
      this._trDrag = null;
      this.chart.applyOptions({ handleScroll: true, handleScale: true });
      this.app.trader.dragLine(d.id, d.p, true);
      this._changed(false);
    };
    el.addEventListener('pointerup', trEnd, true);
    el.addEventListener('pointercancel', trEnd, true);
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
        el.style.cursor = h ? (h.handle != null ? 'grab' : 'pointer') : (this._trHover ? 'ns-resize' : '');
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
    // Rechtsklick: auf einer Zeichnung → Menü der Zeichnung (Einstellungen, Klonen, Sperren, Löschen), sonst Chart-Menü
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.pending) return;
      const { x, y } = rel(e, el);
      const hit = !this.app.state.drawHide ? this._hit(x, y) : null;
      if (hit) { this.sel = hit.item; this._changed(false); this.app.ui.openDrawingMenu(hit.item, e.clientX, e.clientY); return; }
      const p = this.series && y < el.clientHeight - 26 ? this.series.coordinateToPrice(y) : null;
      this.app.ui.openChartMenu(e.clientX, e.clientY, p);
    }, true);
    // Doppelklick auf eine Zeichnung → Einstellungen
    el.addEventListener('dblclick', (e) => {
      if (this.tool !== 'cursor' || this.app.state.drawHide) return;
      const { x, y } = rel(e, el);
      const hit = this._hit(x, y);
      if (!hit) return;
      e.preventDefault(); e.stopPropagation();
      this.sel = hit.item; this._changed(false);
      this.app.ui.openDrawingSettings(hit.item);
    }, true);
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { this.remove(this.sel); e.preventDefault(); }
      if (e.key === 'Escape') { if (this.pending) { this.pending = null; this.requestUpdate?.(); } if (this.tool !== 'cursor') this.setTool('cursor'); else if (this.sel) { this.sel = null; this._changed(false); } }
    });
  }

  _create(type, pt) {
    const base = { id: uid(), type, pts: [pt, { ...pt }], color: type === 'long' || type === 'short' ? null : '#2962ff', width: 2 };
    if (type === 'hline' || type === 'hray') base.color = '#7c3aed';
    if (type === 'avwap') { base.color = '#2962ff'; base.width = 2; base.src = 'hlc3'; base.bands = 1; }
    if (type === 'alert') { base.color = '#131722'; base.width = 1; base.cond = 'cross'; this.app.alerts?.askPermission(); }
    if (type === 'ftpo') { base.color = '#131722'; base.width = 1; base.block = '30m'; base.vaPct = 68; base.clip = false; base.mode = 'letters'; }
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
    if (it.type === 'ftpo') this.app.ensureNeeds();
  }

  _dragTo(x, y) {
    const d = this.drag, it = d.item;
    const pt = this.pointAt(x, y);
    if (!pt) return;
    if (it.type === 'alert') it.fired = null;
    const p0 = this.pointAt(d.x0, d.y0);
    if (it.type === 'avwap') { it.pts[0] = { t: d.handle === 0 ? pt.t : this.lToT(Math.round(this.tToL(d.orig[0].t) + this.tToL(pt.t) - this.tToL(p0.t))), p: pt.p }; this._axisViews = this._buildAxis(); this.requestUpdate?.(); return; }
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
      if (this.sel === it && it.type === 'avwap') {
        const r = this._avwap(it);
        if (r && near(this.tToX(this.app.bars[r.i0].t), this.pToY(r.v[0]))) return { item: it, handle: 0 };
      } else if (this.sel === it && (it.type === 'fvp' || it.type === 'ftpo')) {
        const b = it.type === 'fvp' ? this._fvpBox(it) : this._ftpoBox(it);
        const first = it.pts[0].t <= it.pts[1].t ? 0 : 1;
        if (b && near(b.xa, b.yt)) return { item: it, handle: first };
        if (b && near(b.xb, b.yb)) return { item: it, handle: 1 - first };
      } else if (this.sel === it) {
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
        case 'avwap': {
          const r = this._avwap(it);
          if (!r) break;
          const l = Math.round(this.chart.timeScale().coordinateToLogical(x));
          const j = l - r.i0;
          if (j < 0 || j >= r.v.length) break;
          const ys = [r.v[j]];
          if (r.bands) for (let m = 1; m <= r.bands; m++) ys.push(r.v[j] + m * r.sd[j], r.v[j] - m * r.sd[j]);
          for (const p of ys) { const py = this.pToY(p); if (py != null && Math.abs(py - y) < 6) return { item: it }; }
          break;
        }
        case 'fvp': case 'ftpo': {
          const b = it.type === 'fvp' ? this._fvpBox(it) : this._ftpoBox(it);
          if (b && x >= b.xa - 4 && x <= b.xb + 4 && y >= b.yt - 4 && y <= b.yb + 4) return { item: it };
          break;
        }
        case 'hline': case 'alert': if (Math.abs(y - g.y1) < 6) return { item: it }; break;
        case 'hray': if (Math.abs(y - g.y1) < 6 && x >= g.x1 - 6) return { item: it }; break;
        case 'vline': if (g.x1 != null && Math.abs(x - g.x1) < 6) return { item: it }; break;
        case 'trend': case 'ray': {
          if (g.x1 == null || g.x2 == null) break;
          let x1 = g.x1, y1 = g.y1, x2 = g.x2, y2 = g.y2;
          const k2 = x2 !== x1 ? (y2 - y1) / (x2 - x1) : null;
          if (k2 != null && (it.type === 'ray' || it.ext)) { const xe = x2 > x1 ? W : 0; y2 = y1 + k2 * (xe - x1); x2 = xe; }
          if (k2 != null && it.extL) { const xs = g.x2 > g.x1 ? 0 : W; y1 = g.y1 + k2 * (xs - g.x1); x1 = xs; }
          if (segDist(x, y, x1, y1, x2, y2) < 6) return { item: it };
          break;
        }
        case 'text': { const f = (it.fs || 13) / 13; if (g.x1 != null && x >= g.x1 - 4 && x <= g.x1 + 8 * f * (it.text?.length || 1) && Math.abs(y - g.y1) < 12 * f) return { item: it }; break; }
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
    const add = (p, bg) => out.push({ coordinate: () => this.pToY(p) ?? -100, text: () => this.app.fmt(p), textColor: () => (lightCol(bg) ? '#131722' : '#fff'), backColor: () => bg, visible: () => true, tickVisible: () => true });
    for (const ln of this.app.trader?.lines() || []) add(this._trDrag?.id === ln.id ? this._trDrag.p : ln.p, ln.color);
    if (this.app.state.drawHide) return out;
    for (const it of this.items) {
      if (it.type === 'avwap') { const r = this._avwap(it); if (r && r.v.length) add(r.v[r.v.length - 1], it.color); continue; }
      if (it.type === 'hline' || it.type === 'hray') { if (it.axis !== false) add(it.pts[0].p, it.color); }
      else if (it.type === 'alert') add(it.pts[0].p, it.fired ? '#787b86' : (this.app.theme.dark ? '#5d606b' : '#131722'));
      else if (it === this.sel && it.type === 'ftpo') {
        const p = this._ftpo(it);
        if (p && p.poc != null) { add(p.poc, '#e91e63'); add(p.vah, '#131722'); add(p.val, '#131722'); }
      }
      else if (it === this.sel && it.type === 'fvp') {
        const p = this._fvp(it);
        if (p) { add(p.poc, '#f0961e'); add(p.vah, '#5b7fe0'); add(p.val, '#5b7fe0'); }
      } else if (it === this.sel) {
        if (it.type === 'long' || it.type === 'short') { add(it.pts[0].p, '#2962ff'); add(it.stop, '#ef5350'); add(it.target, '#26a69a'); }
        else if (it.type !== 'vline' && it.type !== 'text') { add(it.pts[0].p, it.color); add(it.pts[1].p, it.color); }
      }
    }
    return out;
  }

  /** Zeilen der Legende (für Trader-Beschriftungen, damit sie nicht darunter liegen); kurz zwischengespeichert. */
  _legendRows() {
    const now = performance.now();
    if (this._lgc && now - this._lgc.t < 300) return this._lgc.rows;
    const rows = [];
    const ce = this.app.ui.chartEl, le = document.getElementById('legend');
    if (ce && le) {
      const c = ce.getBoundingClientRect();
      for (const r of le.querySelectorAll('.lg-row')) {
        const b = r.getBoundingClientRect();
        if (b.height > 0) rows.push({ top: b.top - c.top, bottom: b.bottom - c.top, right: b.right - c.left });
      }
    }
    this._lgc = { t: now, rows };
    return rows;
  }

  // ---------------------------------------------------------------- Zeichnen
  _draw(target) {
    if (!this.series) return;
    const trLines = this.app.trader?.lines() || [];
    const list = this.app.state.drawHide ? [] : (this.pending ? [...this.items, this.pending] : this.items);
    if (!list.length && !trLines.length) return;
    const th = this.app.theme;
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const W = bitmapSize.width, H = bitmapSize.height;
      const X = (x) => x * hr, Y = (y) => y * vr;
      const font = (px, w = 500) => `${w} ${Math.round(px * vr)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      // TQI Trader: Entry / Stop / Ziel (ziehbar), Position, Orders – Beschriftung links wie im ATAS-Chart-Trader,
      // aber nicht unter der Legende (dann rechts daneben)
      const lgRows = trLines.length ? this._legendRows() : [];
      for (const ln of trLines) {
        const pp = this._trDrag?.id === ln.id ? this._trDrag.p : ln.p;
        const y0 = this.pToY(pp);
        if (y0 == null) continue;
        const yy = Math.round(Y(y0)) + 0.5;
        ctx.strokeStyle = ln.color; ctx.lineWidth = Math.max(1, ln.width * hr);
        ctx.setLineDash(ln.dash === 'dashed' ? [6 * hr, 4 * hr] : ln.dash === 'dotted' ? [2 * hr, 3 * hr] : ln.dash === 'sparse' ? [2 * hr, 6 * hr] : []);
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = font(10.5, 600);
        const tw = ctx.measureText(ln.label).width + 14 * hr;
        let lx = 8;
        for (const r of lgRows) if (y0 >= r.top - 10 && y0 <= r.bottom + 10) lx = Math.max(lx, r.right + 10);
        const bx = lx * hr, by = yy - 9 * vr;
        ctx.fillStyle = ln.color; roundRect(ctx, bx, by, tw + (ln.drag ? 10 * hr : 0), 18 * vr, 3 * hr); ctx.fill();
        ctx.fillStyle = lightCol(ln.color) ? '#131722' : '#ffffff';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        if (ln.drag) { ctx.fillText('⇕', bx + 4 * hr, yy); ctx.fillText(ln.label, bx + 16 * hr, yy); } else ctx.fillText(ln.label, bx + 7 * hr, yy);
      }
      for (const it of list) {
        const g = this._geom(it);
        if (g.y1 == null && it.type !== 'vline') continue;
        const sel = it === this.sel || it === this.pending;
        const col = it.color || '#2962ff';
        ctx.lineWidth = Math.max(1, (it.width || 1) * hr * (sel ? 1 : 0.85));
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.setLineDash(LINE_TYPES.has(it.type) ? dashOf(it.dash, hr) : []);
        const handles = [];
        switch (it.type) {
          case 'trend': case 'ray': {
            if (g.x1 == null || g.x2 == null) break;
            let x1 = g.x1, y1 = g.y1, x2 = g.x2, y2 = g.y2;
            const k = x2 !== x1 ? (y2 - y1) / (x2 - x1) : null;
            // Strahl bzw. „nach rechts/links verlängern“
            if (k != null && (it.type === 'ray' || it.ext)) { const xe = x2 > x1 ? W / hr : 0; y2 = y1 + k * (xe - x1); x2 = xe; }
            if (k != null && it.extL) { const xs = g.x2 > g.x1 ? 0 : W / hr; y1 = g.y1 + k * (xs - g.x1); x1 = xs; }
            ctx.beginPath(); ctx.moveTo(X(x1), Y(y1)); ctx.lineTo(X(x2), Y(y2)); ctx.stroke();
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
            ctx.fillStyle = rgba(col, it.fillA ?? 0.14);
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
          case 'avwap': {
            const r = this._avwap(it);
            if (!r) break;
            const ts = this.chart.timeScale();
            const xs = new Array(r.v.length);
            for (let j = 0; j < r.v.length; j++) { const xx = ts.logicalToCoordinate(r.i0 + j); xs[j] = xx == null ? null : X(xx); }
            const path = (vals, k) => {
              ctx.beginPath(); let pen = false;
              for (let j = 0; j < vals.length; j++) {
                const v = k ? vals[j] : vals[j];
                const py = this.pToY(v);
                if (xs[j] == null || py == null || !Number.isFinite(v)) { pen = false; continue; }
                if (!pen) { ctx.moveTo(xs[j], Y(py)); pen = true; } else ctx.lineTo(xs[j], Y(py));
              }
              ctx.stroke();
            };
            // Bänder (Fläche ±1σ, Linien ±1/2/3σ)
            if (r.bands) {
              const up1 = r.v.map((v, j) => v + r.sd[j]), dn1 = r.v.map((v, j) => v - r.sd[j]);
              ctx.fillStyle = rgba(col, 0.07);
              ctx.beginPath(); let started = false;
              for (let j = 0; j < up1.length; j++) { const py = this.pToY(up1[j]); if (xs[j] == null || py == null) continue; if (!started) { ctx.moveTo(xs[j], Y(py)); started = true; } else ctx.lineTo(xs[j], Y(py)); }
              for (let j = dn1.length - 1; j >= 0; j--) { const py = this.pToY(dn1[j]); if (xs[j] == null || py == null) continue; ctx.lineTo(xs[j], Y(py)); }
              ctx.closePath(); if (started) ctx.fill();
              ctx.strokeStyle = rgba(col, 0.6); ctx.lineWidth = Math.max(1, hr);
              for (let m = 1; m <= r.bands; m++) { path(r.v.map((v, j) => v + m * r.sd[j]), 1); path(r.v.map((v, j) => v - m * r.sd[j]), 1); }
            }
            ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, (it.width || 2) * hr);
            path(r.v, 0);
            // Anker und Name
            const ax = xs[0], ay = this.pToY(r.v[0]);
            if (ax != null && ay != null) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ax, Y(ay), 3.5 * hr, 0, Math.PI * 2); ctx.fill(); }
            const lj = r.v.length - 1, ly = this.pToY(r.v[lj]);
            if (xs[lj] != null && ly != null) {
              ctx.font = font(10.5, 600); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = col;
              ctx.fillText('AVWAP', xs[lj] + 8 * hr, Y(ly));
            }
            if (ax != null && ay != null) handles.push([ax / hr, ay]);
            break;
          }
          case 'fvp': {
            const b = this._fvpBox(it);
            if (!b) break;
            const p = b.p;
            ctx.fillStyle = rgba(col, sel ? 0.08 : 0.04);
            ctx.fillRect(X(b.xa), Y(b.yt), X(b.xb - b.xa), Y(b.yb - b.yt));
            if (sel) { ctx.strokeStyle = rgba(col, 0.6); ctx.lineWidth = Math.max(1, hr); ctx.strokeRect(X(b.xa), Y(b.yt), X(b.xb - b.xa), Y(b.yb - b.yt)); }
            const mode = it.mode || 'volume';
            drawProfile(ctx, p, {
              xa: X(b.xa), xb: X(b.xb), width: X(b.xb - b.xa) * (it.wf || 0.4), place: 'left', mode, va: true,
              color: rgba('#8c94a6', 0.5), vaColor: rgba('#6a8ee8', 0.5), pocColor: rgba('#f0961e', 0.9),
              buyColor: rgba('#26a69a', 0.55), sellColor: rgba('#ef5350', 0.55), pocLine: true, vaLines: true, lineColor: rgba('#5b7fe0', 0.85),
            }, { yOf: (pr) => { const yy = this.pToY(pr); return yy == null ? null : Y(yy); }, H, vr, hr });
            ctx.font = font(10.5, 600); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            const lab = (txt, price, c) => { const yy = this.pToY(price); if (yy == null) return; ctx.fillStyle = c; ctx.fillText(txt, X(b.xb) - 4 * hr, Y(yy) - 7 * vr); };
            lab(`POC ${this.app.fmt(p.poc)}`, p.poc, '#e08a14');
            lab(`VAH ${this.app.fmt(p.vah)}`, p.vah, '#5b7fe0');
            lab(`VAL ${this.app.fmt(p.val)}`, p.val, '#5b7fe0');
            ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = font(10.5, 500);
            ctx.fillStyle = th.dark ? '#b2b5be' : '#50535e';
            const dl = Number.isFinite(p.delta) ? ` · Δ ${p.delta >= 0 ? '+' : '−'}${fmtCompact(Math.abs(p.delta))}` : '';
            ctx.fillText(`Vol ${fmtCompact(p.total)}${dl}`, X(b.xa) + 2 * hr, Y(b.yb) + 4 * vr);
            handles.push([b.xa, b.yt], [b.xb, b.yb]);
            break;
          }
          case 'alert': {
            const y = Math.round(Y(g.y1)) + 0.5;
            const c = it.fired ? '#787b86' : (th.dark ? '#d1d4dc' : '#131722');
            ctx.strokeStyle = c; ctx.lineWidth = Math.max(1, hr);
            ctx.setLineDash([6 * hr, 4 * hr]);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
            ctx.setLineDash([]);
            const cond = (ALERT_CONDS.find(q => q[0] === (it.cond || 'cross')) || ALERT_CONDS[0])[1];
            const txt = it.fired ? `Alarm ausgelöst · ${this.app.fmt(it.pts[0].p)}` : `Alarm: ${cond} ${this.app.fmt(it.pts[0].p)}`;
            ctx.font = font(10.5, 600); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
            const tw = ctx.measureText(txt).width;
            const bx = W - tw - 30 * hr;
            bell(ctx, bx - 12 * hr, y - 13 * vr, 9 * hr, c);
            ctx.fillStyle = c; ctx.fillText(txt, W - 26 * hr, y - 3 * vr);
            if (g.x1 != null) handles.push([g.x1, g.y1]);
            break;
          }
          case 'ftpo': {
            const b = this._ftpoBox(it);
            if (!b) break;
            const p = b.p;
            const ink = th.dark ? '#d1d4dc' : '#131722';
            ctx.fillStyle = rgba(ink, sel ? 0.05 : 0.025);
            ctx.fillRect(X(b.xa), Y(b.yt), X(b.xb - b.xa), Y(b.yb - b.yt));
            if (sel) { ctx.strokeStyle = rgba(ink, 0.5); ctx.lineWidth = Math.max(1, hr); ctx.setLineDash([4 * hr, 3 * hr]); ctx.strokeRect(X(b.xa), Y(b.yt), X(b.xb - b.xa), Y(b.yb - b.yt)); ctx.setLineDash([]); }
            const boxW = X(b.xb - b.xa);
            const cw = Math.max(1.5 * hr, Math.min(12 * hr, boxW * 0.85 / Math.max(1, p.maxCount)));
            const yRow = (k) => { const yy = this.pToY((p.r0 + k) * p.rs); return yy == null ? null : Y(yy); };
            const rowH = Math.abs((yRow(0) ?? 0) - (yRow(1) ?? 0));
            const letters = it.mode !== 'blocks' && rowH >= 8 * vr && cw >= 6 * hr;
            const xa = X(b.xa);
            if (letters) { ctx.font = `600 ${Math.round(Math.max(7 * vr, Math.min(rowH * 0.9, cw * 1.1, 13 * vr)))}px -apple-system, "Segoe UI", Roboto, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; }
            for (let r = 0; r < p.rows.length; r++) {
              const list = p.rows[r];
              if (!list.length) continue;
              const yt = yRow(r + 1), yb = yRow(r);
              if (yt == null || yb == null || yb < -10 || yt > H + 10) continue;
              const isPoc = r === p.pocRow, inVa = r >= p.vaLo && r <= p.vaHi;
              if (letters) {
                ctx.fillStyle = isPoc ? '#e91e63' : rgba(ink, inVa ? 0.95 : 0.6);
                for (let j = 0; j < list.length; j++) ctx.fillText(letterOf(list[j]), xa + (j + 0.5) * cw, (yt + yb) / 2);
              } else {
                const h = Math.max(1, yb - yt - (yb - yt > 3 * vr ? 1 : 0));
                ctx.fillStyle = isPoc ? 'rgba(233,30,99,0.8)' : rgba(ink, inVa ? 0.5 : 0.25);
                ctx.fillRect(xa, yt, list.length * cw, h);
              }
            }
            const ln = (price, c, txt) => {
              const yy = this.pToY(price); if (yy == null) return;
              const y = Math.round(Y(yy)) + 0.5;
              ctx.strokeStyle = c; ctx.lineWidth = Math.max(1, hr);
              ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(X(b.xb), y); ctx.stroke();
              ctx.font = font(10.5, 600); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = c;
              ctx.fillText(`${txt} ${this.app.fmt(price)}`, X(b.xb) - 4 * hr, y - 2 * vr);
            };
            if (p.vah != null) { ln(p.vah, ink, 'VAH'); ln(p.val, ink, 'VAL'); }
            if (p.poc != null) ln(p.poc, '#e91e63', 'POC');
            ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = font(10.5, 500);
            ctx.fillStyle = th.dark ? '#b2b5be' : '#50535e';
            ctx.fillText(`TPO · ${p.n} Perioden à ${it.block || '30m'}${it.clip ? ' · Preisbereich' : ''}`, xa + 2 * hr, Y(b.yb) + 4 * vr);
            handles.push([b.xa, b.yt], [b.xb, b.yb]);
            break;
          }
          case 'text': {
            if (g.x1 == null) break;
            const fs = it.fs || 13;
            ctx.font = font(fs, 600); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillStyle = col; ctx.fillText(it.text || '', X(g.x1), Y(g.y1));
            if (sel) { const w = ctx.measureText(it.text || '').width; ctx.strokeStyle = rgba('#2962ff', 0.8); ctx.strokeRect(X(g.x1) - 3 * hr, Y(g.y1) - (fs * 0.75) * vr, w + 6 * hr, fs * 1.5 * vr); }
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
        if (it.label && LINE_TYPES.has(it.type)) {
          // Beschriftung: waagerechte Linien rechts über der Linie, Trendlinie am Ende, senkrechte oben, Rechteck innen oben links
          ctx.setLineDash([]);
          ctx.font = font(11.5, 600); ctx.fillStyle = col; ctx.textBaseline = 'bottom';
          const tw = ctx.measureText(it.label).width;
          if ((it.type === 'hline' || it.type === 'hray') && g.y1 != null) { ctx.textAlign = 'right'; ctx.fillText(it.label, W - 8 * hr, Y(g.y1) - 3 * vr); }
          else if ((it.type === 'trend' || it.type === 'ray') && g.x2 != null) { ctx.textAlign = g.x2 >= g.x1 ? 'right' : 'left'; ctx.fillText(it.label, X(g.x2), Y(g.y2) - 5 * vr); }
          else if (it.type === 'vline' && g.x1 != null) { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(it.label, X(g.x1) + 5 * hr, 8 * vr); }
          else if (it.type === 'rect' && g.x1 != null && g.x2 != null) { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(it.label, X(Math.min(g.x1, g.x2)) + 5 * hr, Y(Math.min(g.y1, g.y2)) + 4 * vr); }
          void tw;
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

// ---------------------------------------------------------------- Anchored VWAP
/** VWAP ab der Anker-Kerze (Quelle hlc3/ohlc4/close) mit Standardabweichung je Kerze (wie TradingView „Anchored VWAP“). */
Drawings.prototype._avwap = function (it) {
  const bars = this.app.bars;
  if (!bars.length) return null;
  let i0 = Math.max(0, floorIndex(bars, it.pts[0].t));
  if (bars[i0] && bars[i0].t < it.pts[0].t && i0 + 1 < bars.length) i0++;
  const last = bars[bars.length - 1];
  const key = `${it.pts[0].t}|${bars.length}|${bars[0].t}|${last.c}|${last.v}|${it.src}`;
  if (it._av && it._av.key === key) return { ...it._av.r, bands: it.bands || 0 };
  const src = it.src || 'hlc3';
  const n = bars.length - i0;
  if (n <= 0) return null;
  const v = new Float64Array(n), sd = new Float64Array(n);
  let sv = 0, spv = 0, sp2v = 0;
  for (let j = 0; j < n; j++) {
    const b = bars[i0 + j];
    const p = src === 'close' ? b.c : src === 'ohlc4' ? (b.o + b.h + b.l + b.c) / 4 : (b.h + b.l + b.c) / 3;
    const w = b.v > 0 ? b.v : 1e-9;
    sv += w; spv += p * w; sp2v += p * p * w;
    const m = spv / sv;
    v[j] = m; sd[j] = Math.sqrt(Math.max(0, sp2v / sv - m * m));
  }
  const r = { i0, v, sd };
  Object.defineProperty(it, '_av', { value: { key, r }, writable: true, configurable: true, enumerable: false });
  return { ...r, bands: it.bands || 0 };
};

// ---------------------------------------------------------------- Fixed Range Volume Profile
Drawings.prototype._fvpSource = function (t0, t1) {
  // feinste geladene Zeiteinheit, die den Bereich abdeckt (z. B. 1m vom Volume Profile), sonst Chart-Kerzen
  const app = this.app, chartMs = this._step();
  let best = null;
  for (const st of app.hub.storesFor(app.state.market, app.state.base)) {
    const ms = tfMs(st.tf);
    if (!st.bars.length || ms >= chartMs || st.bars[0].t > t0 || (t1 - t0) / ms > 50000) continue;
    if (!best || ms < tfMs(best.tf)) best = st;
  }
  return best ? best.bars : app.bars;
};
Drawings.prototype._fvp = function (it) {
  const bars = this.app.bars;
  if (!bars.length) return null;
  const step = this._step();
  const t0 = Math.min(it.pts[0].t, it.pts[1].t), t1 = Math.max(it.pts[0].t, it.pts[1].t) + step;
  const src = this._fvpSource(t0, t1);
  const last = src[src.length - 1];
  let lo = Infinity, hi = -Infinity;
  const i0 = floorIndex(bars, t0), i1 = Math.min(bars.length - 1, floorIndex(bars, t1 - 1));
  for (let i = Math.max(0, i0); i <= i1; i++) { if (bars[i].l < lo) lo = bars[i].l; if (bars[i].h > hi) hi = bars[i].h; }
  if (!Number.isFinite(lo)) return null;
  const rs = it.rows > 0 ? it.rows : autoRows(lo, hi, it.rowsN || 70);
  const key = `${t0}|${t1}|${rs}|${src.length}|${last?.t}|${last?.c}|${last?.v}`;
  if (!it._c || it._c.key !== key) Object.defineProperty(it, '_c', { value: { key, p: rangeProfile(src, t0, t1, rs, { vaPct: it.vaPct || 70 }) }, writable: true, configurable: true, enumerable: false });
  return it._c.p;
};
Drawings.prototype._fvpBox = function (it) {
  const p = this._fvp(it);
  if (!p) return null;
  const ts = this.chart.timeScale();
  const half = (ts.options().barSpacing || 6) / 2;
  const t0 = Math.min(it.pts[0].t, it.pts[1].t), t1 = Math.max(it.pts[0].t, it.pts[1].t);
  const xa = this.tToX(t0), xb = this.tToX(t1), yt = this.pToY(p.hi), yb = this.pToY(p.lo);
  if (xa == null || xb == null || yt == null || yb == null) return null;
  return { p, xa: xa - half, xb: xb + half, yt, yb };
};

// ---------------------------------------------------------------- Fixed Range TPO
/** TPO-Profil über einen frei gewählten Zeitraum (optional nur im gezogenen Preisbereich). */
Drawings.prototype._ftpo = function (it) {
  const app = this.app, bars = app.bars;
  if (!bars.length) return null;
  const step = this._step();
  const t0 = Math.min(it.pts[0].t, it.pts[1].t), t1 = Math.max(it.pts[0].t, it.pts[1].t) + step;
  const block = it.block || '30m', blockMs = tfMs(block);
  const st = app.hub.stores.get(`${app.state.market}|${app.state.base}|${block}`);
  const src = st && st.bars.length && st.bars[0].t <= t0 ? st.bars : bars;
  const last = src[src.length - 1];
  const pLo = Math.min(it.pts[0].p, it.pts[1].p), pHi = Math.max(it.pts[0].p, it.pts[1].p);
  const rsBase = app.tpoRowSize ? app.tpoRowSize() : app.rowSize();
  const key = `${t0}|${t1}|${block}|${it.clip ? pLo + '|' + pHi : ''}|${it.vaPct}|${rsBase}|${app.vaStep}|${src.length}|${last?.t}|${last?.h}|${last?.l}`;
  if (it._t && it._t.key === key) return it._t.p;
  // Perioden (Blöcke) bilden
  const per = [];
  for (let i = lowerBound(src, t0); i < src.length && src[i].t < t1; i++) {
    const b = src[i], k = Math.floor(b.t / blockMs) * blockMs;
    const x = per[per.length - 1];
    if (x && x.t === k) { if (b.h > x.h) x.h = b.h; if (b.l < x.l) x.l = b.l; } else per.push({ t: k, h: b.h, l: b.l });
  }
  let p = null;
  if (per.length) {
    let lo = Infinity, hi = -Infinity;
    for (const x of per) { if (x.l < lo) lo = x.l; if (x.h > hi) hi = x.h; }
    if (it.clip) { lo = Math.max(lo, pLo); hi = Math.min(hi, pHi); }
    if (hi > lo) {
      let rs = it.rows > 0 ? it.rows : rsBase;
      if ((hi - lo) / rs > 600) rs = niceStep((hi - lo) / 300);
      const r0 = Math.floor(lo / rs), n = Math.floor(hi / rs) - r0 + 1;
      const rows = Array.from({ length: n }, () => []);
      per.forEach((x, k) => {
        const a = Math.max(0, Math.floor(Math.max(x.l, lo) / rs) - r0), z = Math.min(n - 1, Math.floor(Math.min(x.h, hi) / rs) - r0);
        for (let r = a; r <= z; r++) rows[r].push(k);
      });
      const counts = rows.map(r => r.length);
      const va = valueArea(counts, it.vaPct || 68, app.vaStep || 2);
      p = { rows, r0, rs, n: per.length, lo: r0 * rs, hi: (r0 + n) * rs, maxCount: Math.max(...counts) };
      if (va) Object.assign(p, { pocRow: va.poc, vaLo: va.lo, vaHi: va.hi, poc: (r0 + va.poc + 0.5) * rs, vah: (r0 + va.hi + 1) * rs, val: (r0 + va.lo) * rs });
    }
  }
  Object.defineProperty(it, '_t', { value: { key, p }, writable: true, configurable: true, enumerable: false });
  return p;
};
Drawings.prototype._ftpoBox = function (it) {
  const p = this._ftpo(it);
  if (!p) return null;
  const half = (this.chart.timeScale().options().barSpacing || 6) / 2;
  const t0 = Math.min(it.pts[0].t, it.pts[1].t), t1 = Math.max(it.pts[0].t, it.pts[1].t);
  const xa = this.tToX(t0), xb = this.tToX(t1), yt = this.pToY(p.hi), yb = this.pToY(p.lo);
  if (xa == null || xb == null || yt == null || yb == null) return null;
  return { p, xa: xa - half, xb: xb + half, yt, yb };
};

function bell(ctx, x, y, s, c) {
  ctx.save();
  ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = Math.max(1, s / 7);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.15, y + s * 0.75);
  ctx.quadraticCurveTo(x + s * 0.2, y + s * 0.05, x + s * 0.5, y + s * 0.05);
  ctx.quadraticCurveTo(x + s * 0.8, y + s * 0.05, x + s * 0.85, y + s * 0.75);
  ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + s * 0.5, y + s * 0.9, s * 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function lightCol(c) {
  const m = /^#?([0-9a-f]{6})/i.exec(c || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;
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
