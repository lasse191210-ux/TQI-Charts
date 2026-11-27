// Footprint-Kerzen wie ATAS / TradingView: je Preisstufe Verkauf (Bid, links) × Kauf (Ask, rechts) der aggressiven
// Orders, POC der Kerze, Imbalances (diagonal: Ask gegen Bid eine Stufe tiefer) und Delta / Volumen unter der Kerze.

const fmtV = (x, dec) => {
  if (!(x > 0)) return '0';
  if (x >= 1e6) return (x / 1e6).toFixed(1).replace('.', ',') + 'M';
  if (x >= 1e4) return (x / 1e3).toFixed(x >= 1e5 ? 0 : 1).replace('.', ',') + 'K';
  return x.toFixed(dec).replace('.', ',');
};
const niceMult = (m) => { const steps = [1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]; for (const s of steps) if (s >= m) return s; return Math.ceil(m / 1000) * 1000; };

/**
 * fp: { bars: [{ i, t, o, h, l, c, cells: Map(Stufe → [bid, ask]) }], rb, o (Einstellungen) }
 * g:  { xOf, yOf, spacing, hr, vr, W, H, i0, i1, dark, bg }
 * Gibt zurück, ob gezeichnet wurde (zu weit herausgezoomt → false).
 */
export function drawFootprint(ctx, fp, g) {
  const o = fp.o, rb = fp.rb;
  const sp = g.spacing; // Abstand der Kerzen in CSS-Pixeln
  if (sp < (o.minSpacing || 34)) return false;
  const vis = fp.bars.filter(b => b.i >= g.i0 && b.i <= g.i1);
  if (!vis.length) return true;
  // Zeilenhöhe: feste Stufe oder automatisch ≥ 13 px je Zeile
  const ref = vis[vis.length - 1].c;
  const y1 = g.yOf(ref), y2 = g.yOf(ref + 100 * rb);
  if (y1 == null || y2 == null) return true;
  const pxPerRb = Math.abs(y1 - y2) / 100 / g.vr; // CSS-Pixel je Grund-Stufe
  const mult = o.row > 0 ? Math.max(1, Math.round(o.row / rb)) : niceMult(Math.max(1, 13 / Math.max(1e-9, pxPerRb)));
  const row = mult * rb;
  const rowPx = pxPerRb * mult;
  const colW = sp * 0.94 * g.hr;
  const fs = Math.max(8, Math.min(12, rowPx * 0.72, sp / 7.5));
  const showNum = rowPx >= 9 && sp >= (o.numSpacing || 60);
  const ratio = Math.max(1, (+o.ratio || 250) / 100), minImb = +o.minImb || 0;
  const bidCol = o.bidCol || '#f23645', askCol = o.askCol || '#089981';
  ctx.save();
  ctx.textBaseline = 'middle';
  for (const b of vis) {
    // Zellen auf Zeilenhöhe zusammenfassen
    const agg = new Map();
    for (const [r, c] of b.cells) {
      const k = Math.floor(r / mult);
      const x = agg.get(k);
      if (x) { x[0] += c[0]; x[1] += c[1]; } else agg.set(k, [c[0], c[1]]);
    }
    if (!agg.size) continue;
    let kMin = Infinity, kMax = -Infinity, maxV = 0, pocK = null, sumB = 0, sumA = 0, maxD = 0;
    for (const [k, c] of agg) {
      if (k < kMin) kMin = k; if (k > kMax) kMax = k;
      const v = c[0] + c[1];
      if (v > maxV) { maxV = v; pocK = k; }
      sumB += c[0]; sumA += c[1];
      maxD = Math.max(maxD, Math.abs(c[1] - c[0]));
    }
    const dec = maxV >= 100 ? 0 : maxV >= 10 ? 1 : 2;
    const xc = g.xOf(b.i);
    if (xc == null) continue;
    const xl = xc - colW / 2, xr = xc + colW / 2;
    const yTop = g.yOf((kMax + 1) * row), yBot = g.yOf(kMin * row);
    if (yTop == null || yBot == null) continue;
    // Hintergrund (verdeckt die Kerze darunter)
    ctx.fillStyle = g.bg;
    ctx.fillRect(xl, yTop, colW, yBot - yTop);
    // schmale Kerze links (Docht + Körper) wie im ATAS-Footprint
    const up = b.c >= b.o;
    const cx = xl + 3 * g.hr;
    ctx.strokeStyle = up ? askCol : bidCol; ctx.lineWidth = Math.max(1, g.hr);
    const yh = g.yOf(b.h), yl = g.yOf(b.l), yo = g.yOf(b.o), yc = g.yOf(b.c);
    if (yh != null && yl != null) { ctx.beginPath(); ctx.moveTo(cx, yh); ctx.lineTo(cx, yl); ctx.stroke(); }
    if (yo != null && yc != null) { ctx.fillStyle = up ? askCol : bidCol; ctx.fillRect(cx - 2 * g.hr, Math.min(yo, yc), 4 * g.hr, Math.max(g.vr, Math.abs(yc - yo))); }
    const cellL = xl + 8 * g.hr, cellW = xr - cellL, mid = cellL + cellW / 2;
    // Imbalances: Ask auf Stufe k gegen Bid auf Stufe k−1, Bid auf Stufe k gegen Ask auf Stufe k+1
    const askImb = new Set(), bidImb = new Set();
    for (const [k, c] of agg) {
      const below = agg.get(k - 1), above = agg.get(k + 1);
      if (c[1] >= minImb && c[1] > 0 && c[1] >= ratio * (below ? below[0] : 0) && (below ? below[0] > 0 : c[1] >= Math.max(minImb, maxV * 0.05))) askImb.add(k);
      if (c[0] >= minImb && c[0] > 0 && c[0] >= ratio * (above ? above[1] : 0) && (above ? above[1] > 0 : c[0] >= Math.max(minImb, maxV * 0.05))) bidImb.add(k);
    }
    for (let k = kMin; k <= kMax; k++) {
      const c = agg.get(k) || [0, 0];
      const yt = g.yOf((k + 1) * row), yb = g.yOf(k * row);
      if (yt == null || yb == null) continue;
      const h = yb - yt;
      // Zelle einfärben: Modus Delta (grün/rot nach Delta) oder Volumen (Grau nach Menge)
      const v = c[0] + c[1], d = c[1] - c[0];
      if (o.mode === 'delta') {
        const a = maxD > 0 ? Math.min(1, Math.abs(d) / maxD) : 0;
        ctx.fillStyle = d >= 0 ? hexA(askCol, 0.08 + a * 0.5) : hexA(bidCol, 0.08 + a * 0.5);
      } else {
        const a = maxV > 0 ? v / maxV : 0;
        ctx.fillStyle = g.dark ? `rgba(209,212,220,${0.04 + a * 0.22})` : `rgba(19,23,34,${0.03 + a * 0.16})`;
      }
      ctx.fillRect(cellL, yt + 0.5 * g.vr, cellW, Math.max(1, h - g.vr));
      if (k === pocK && o.poc !== false) {
        ctx.strokeStyle = o.pocCol || '#e91e63'; ctx.lineWidth = Math.max(1, 1.2 * g.hr);
        ctx.strokeRect(cellL + 0.5, yt + g.vr, cellW - 1, Math.max(1, h - 2 * g.vr));
      }
      if (!showNum) {
        if (askImb.has(k)) { ctx.fillStyle = askCol; ctx.fillRect(xr - 3 * g.hr, yt + g.vr, 3 * g.hr, Math.max(1, h - 2 * g.vr)); }
        if (bidImb.has(k)) { ctx.fillStyle = bidCol; ctx.fillRect(cellL, yt + g.vr, 3 * g.hr, Math.max(1, h - 2 * g.vr)); }
        continue;
      }
      const ym = (yt + yb) / 2;
      const txt = g.dark ? '#d1d4dc' : '#131722';
      if (o.mode === 'delta') {
        ctx.font = `600 ${Math.round(fs * g.vr)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center'; ctx.fillStyle = txt;
        ctx.fillText((d > 0 ? '+' : d < 0 ? '−' : '') + fmtV(Math.abs(d), dec), mid, ym);
      } else if (o.mode === 'volume') {
        ctx.font = `${Math.round(fs * g.vr)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center'; ctx.fillStyle = txt;
        ctx.fillText(fmtV(v, dec), mid, ym);
      } else {
        // Bid × Ask
        ctx.textAlign = 'right';
        ctx.font = `${bidImb.has(k) ? 700 : 400} ${Math.round(fs * g.vr)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = bidImb.has(k) ? bidCol : txt;
        ctx.fillText(fmtV(c[0], dec), mid - 4 * g.hr, ym);
        ctx.textAlign = 'left';
        ctx.font = `${askImb.has(k) ? 700 : 400} ${Math.round(fs * g.vr)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = askImb.has(k) ? askCol : txt;
        ctx.fillText(fmtV(c[1], dec), mid + 4 * g.hr, ym);
        ctx.fillStyle = g.dark ? 'rgba(209,212,220,.35)' : 'rgba(19,23,34,.3)';
        ctx.textAlign = 'center';
        ctx.font = `${Math.round(fs * 0.85 * g.vr)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.fillText('×', mid, ym);
      }
    }
    // gestapelte Imbalances (≥ 3 übereinander) als Balken am Rand
    if (o.stacked !== false) for (const [set, col, x] of [[askImb, askCol, xr - 2 * g.hr], [bidImb, bidCol, cellL - 3 * g.hr]]) {
      let run = [];
      const flush = () => {
        if (run.length >= 3) {
          const yt = g.yOf((run[run.length - 1] + 1) * row), yb = g.yOf(run[0] * row);
          if (yt != null && yb != null) { ctx.fillStyle = col; ctx.fillRect(x, yt, 2 * g.hr, yb - yt); }
        }
        run = [];
      };
      for (let k = kMin; k <= kMax + 1; k++) { if (set.has(k)) run.push(k); else flush(); }
    }
    // Delta und Volumen unter der Kerze
    if (o.stats !== false && yBot != null) {
      const dlt = sumA - sumB;
      const fz = Math.max(8, Math.min(11, sp / 8));
      ctx.font = `600 ${Math.round(fz * g.vr)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      const dd = Math.max(sumA, sumB) >= 100 ? 0 : 1;
      ctx.fillStyle = dlt >= 0 ? askCol : bidCol;
      ctx.fillText((dlt >= 0 ? 'Δ +' : 'Δ −') + fmtV(Math.abs(dlt), dd), xc, yBot + 9 * g.vr);
      ctx.fillStyle = g.dark ? '#9598a1' : '#6a6d78';
      ctx.font = `${Math.round(fz * g.vr)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText('V ' + fmtV(sumA + sumB, dd), xc, yBot + 21 * g.vr);
    }
    if (b.partial) { // Kerze nur teilweise geladen
      ctx.fillStyle = g.dark ? 'rgba(20,20,19,.55)' : 'rgba(255,255,255,.55)';
      ctx.fillRect(xl, yTop, colW, yBot - yTop);
    }
  }
  ctx.restore();
  return true;
}

function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}
