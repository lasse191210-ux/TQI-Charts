// Zeichnet ein Volumenprofil (Histogramm je Preiszeile) in Bitmap-Koordinaten.
// Wird vom Overlay (Session-/Sichtbereich-Profile) und vom Fixed-Range-Werkzeug benutzt.

/**
 * p   = Profil aus calc/vprofile.js
 * o   = { xa, xb (Bitmap-x des Bereichs), place 'left'|'right', width (px), mode 'volume'|'bidask'|'delta',
 *         color, vaColor, pocColor, buyColor, sellColor, va (VA farbig), pocLine, vaLines, lineColor, pocTo (x) }
 * env = { yOf(price) → Bitmap-y | null, H, vr (vertikaler Pixelfaktor), hr }
 */
export function drawProfile(ctx, p, o, env) {
  const { yOf, H, vr, hr } = env;
  const rs = p.rs;
  const ya = yOf(p.r0 * rs), yb = yOf((p.r0 + 1) * rs);
  if (ya == null || yb == null || !(o.width > 1)) return;
  const rowPx = Math.abs(ya - yb);
  // zu dünne Zeilen zusammenfassen (mind. ~3 px)
  const k = rowPx >= 3 * vr ? 1 : Math.ceil((3 * vr) / Math.max(rowPx, 0.01));
  const g0 = Math.floor(p.r0 / k), g1 = Math.floor((p.r0 + p.n - 1) / k);
  const ng = g1 - g0 + 1;
  let vols = p.vol, buys = p.buy;
  if (k > 1) {
    vols = new Float64Array(ng); buys = p.buy ? new Float64Array(ng) : null;
    for (let i = 0; i < p.n; i++) {
      const g = Math.floor((p.r0 + i) / k) - g0;
      vols[g] += p.vol[i];
      if (buys) buys[g] += p.buy[i];
    }
  }
  const mode = o.mode === 'delta' && !buys ? 'volume' : (o.mode === 'bidask' && !buys ? 'volume' : o.mode);
  let maxV = 0, maxD = 0;
  for (let g = 0; g < ng; g++) {
    if (vols[g] > maxV) maxV = vols[g];
    if (buys) { const d = Math.abs(2 * buys[g] - vols[g]); if (d > maxD) maxD = d; }
  }
  if (!(maxV > 0)) return;
  const W = o.width;
  const left = o.place !== 'right';
  const x0 = left ? o.xa : o.xb;
  for (let g = 0; g < ng; g++) {
    const v = vols[g];
    if (!(v > 0)) continue;
    const rowLo = (g0 + g) * k, rowHi = rowLo + k;
    let yt = yOf(rowHi * rs), yB = yOf(rowLo * rs);
    if (yt == null || yB == null) continue;
    if (yB < -2 || yt > H + 2) continue;
    let h = yB - yt;
    const gap = h > 4 * vr ? Math.max(1, Math.round(vr)) : 0;
    yt += gap; h = Math.max(1, h - gap);
    const li0 = rowLo - p.r0, li1 = rowHi - 1 - p.r0;
    const inVa = o.va && li1 >= p.vaLo && li0 <= p.vaHi;
    const isPoc = li0 <= p.pocRow && li1 >= p.pocRow;
    if (mode === 'delta') {
      const d = 2 * buys[g] - v;
      const len = maxD > 0 ? Math.abs(d) / maxD * W : 0;
      if (len < 0.5) continue;
      ctx.fillStyle = d >= 0 ? o.buyColor : o.sellColor;
      ctx.fillRect(left ? x0 : x0 - len, yt, len, h);
    } else if (mode === 'bidask') {
      const len = v / maxV * W;
      const lb = buys[g] / maxV * W, ls = len - lb;
      ctx.fillStyle = o.sellColor;
      ctx.fillRect(left ? x0 : x0 - len, yt, ls, h);
      ctx.fillStyle = o.buyColor;
      ctx.fillRect(left ? x0 + ls : x0 - lb, yt, lb, h);
      if (isPoc) { ctx.strokeStyle = o.pocColor; ctx.lineWidth = Math.max(1, hr); ctx.strokeRect(left ? x0 : x0 - len, yt, len, h); }
    } else {
      const len = v / maxV * W;
      ctx.fillStyle = isPoc ? o.pocColor : inVa ? o.vaColor : o.color;
      ctx.fillRect(left ? x0 : x0 - len, yt, len, h);
    }
  }
  // Linien
  const line = (price, color, xa, xb, dash) => {
    const y = yOf(price);
    if (y == null || y < 0 || y > H) return;
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, hr);
    ctx.setLineDash(dash ? [4 * hr, 3 * hr] : []);
    const yy = Math.round(y) + 0.5;
    ctx.beginPath(); ctx.moveTo(xa, yy); ctx.lineTo(xb, yy); ctx.stroke();
    ctx.setLineDash([]);
  };
  if (o.pocLine) line(p.poc, o.pocColor, o.xa, o.pocTo ?? o.xb, false);
  if (o.vaLines) { line(p.vah, o.lineColor || o.vaColor, o.xa, o.xb, true); line(p.val, o.lineColor || o.vaColor, o.xa, o.xb, true); }
}
