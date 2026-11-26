// Synthetische, realistische Krypto-Kerzen für Tests (deterministisch).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/** 1-Minuten-Kerzen von start bis end (ms). Startpreis p0. */
export function genMinuteBars({ start, end, p0 = 60000, seed = 7, volBase = 18 }) {
  const r = mulberry32(seed);
  const out = [];
  let p = p0, sigma = 0.0009, drift = 0;
  for (let t = start; t < end; t += 60000) {
    // Volatilitäts-Cluster und gelegentliche Trends
    sigma = Math.max(0.0003, Math.min(0.004, sigma * (1 + 0.04 * gauss(r)) + 0.00002 * (0.0009 - sigma) * 50));
    if (r() < 0.0015) drift = (r() - 0.5) * 0.0004;
    drift *= 0.999;
    const ret = drift + sigma * gauss(r);
    const o = p, c = p * (1 + ret);
    const h = Math.max(o, c) * (1 + Math.abs(gauss(r)) * sigma * 0.6);
    const l = Math.min(o, c) * (1 - Math.abs(gauss(r)) * sigma * 0.6);
    const hourUtc = new Date(t).getUTCHours();
    const season = 0.6 + 0.8 * Math.exp(-((hourUtc - 14.5) ** 2) / 8) + 0.3 * Math.exp(-((hourUtc - 8) ** 2) / 4);
    let v = volBase * season * (1 + Math.abs(ret) / sigma * 0.8) * (0.6 + r() * 0.8);
    if (r() < 0.002) v *= 6 + r() * 10; // Volumen-Spitzen
    const buyFrac = Math.min(0.95, Math.max(0.05, 0.5 + ret / sigma * 0.12 + (r() - 0.5) * 0.1));
    out.push({ t, o, h, l, c, v, bv: v * buyFrac });
    p = c;
  }
  return out;
}

export function aggregateTo(bars, ms, floorFn) {
  const out = [];
  let cur = null;
  for (const b of bars) {
    const t = floorFn ? floorFn(b.t) : Math.floor(b.t / ms) * ms;
    if (!cur || cur.t !== t) { cur = { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, bv: b.bv }; out.push(cur); }
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; cur.bv += b.bv; }
  }
  return out;
}
