// Standard-Indikatoren (wie in TradingView): SMA, EMA, Bollinger, RSI, MACD, ATR, CVD.
import { sma, ema, rma, periodStart } from '../util.js';
import { srcOf } from './vwap.js';

export function maLine(bars, { length = 20, type = 'ema', source = 'close' } = {}) {
  const v = bars.map(b => srcOf(b, source));
  return type === 'sma' ? sma(v, length) : ema(v, length);
}

export function bollinger(bars, { length = 20, mult = 2, source = 'close' } = {}) {
  const v = bars.map(b => srcOf(b, source));
  const mid = sma(v, length);
  const up = new Float64Array(v.length).fill(NaN), dn = new Float64Array(v.length).fill(NaN);
  for (let i = length - 1; i < v.length; i++) {
    let s = 0;
    for (let k = i - length + 1; k <= i; k++) s += (v[k] - mid[i]) ** 2;
    const d = Math.sqrt(s / length);
    up[i] = mid[i] + mult * d; dn[i] = mid[i] - mult * d;
  }
  return { mid, up, dn };
}

export function rsi(bars, { length = 14 } = {}) {
  const n = bars.length;
  const gains = new Float64Array(n).fill(NaN), losses = new Float64Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const d = bars[i].c - bars[i - 1].c;
    gains[i] = Math.max(d, 0); losses[i] = Math.max(-d, 0);
  }
  const ag = rma(gains, length), al = rma(losses, length);
  const out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(ag[i]) || !Number.isFinite(al[i])) continue;
    out[i] = al[i] === 0 ? 100 : ag[i] === 0 ? 0 : 100 - 100 / (1 + ag[i] / al[i]);
  }
  return out;
}

export function macd(bars, { fast = 12, slow = 26, signal = 9 } = {}) {
  const c = bars.map(b => b.c);
  const f = ema(c, fast), s = ema(c, slow);
  const line = new Float64Array(c.length).fill(NaN);
  for (let i = 0; i < c.length; i++) if (Number.isFinite(f[i]) && Number.isFinite(s[i])) line[i] = f[i] - s[i];
  const first = line.findIndex(Number.isFinite);
  const sig = new Float64Array(c.length).fill(NaN);
  if (first >= 0) {
    const sub = ema(Array.from(line.slice(first)), signal);
    for (let i = 0; i < sub.length; i++) sig[first + i] = sub[i];
  }
  const hist = new Float64Array(c.length).fill(NaN);
  for (let i = 0; i < c.length; i++) if (Number.isFinite(line[i]) && Number.isFinite(sig[i])) hist[i] = line[i] - sig[i];
  return { line, sig, hist };
}

export function atr(bars, { length = 14 } = {}) {
  const tr = bars.map((b, i) => i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)));
  return rma(tr, length);
}

/** Delta je Kerze (Taker-Kauf − Taker-Verkauf) und CVD mit optionalem Reset (none|day|week). */
export function cvd(bars, { reset = 'none', offset = 0 } = {}) {
  const n = bars.length;
  const delta = new Float64Array(n).fill(NaN), cum = new Float64Array(n).fill(NaN);
  let acc = 0, cur = NaN;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (reset !== 'none') {
      const ps = periodStart(b.t, reset, offset);
      if (ps !== cur) { acc = 0; cur = ps; }
    }
    if (!Number.isFinite(b.bv)) continue;
    const d = 2 * b.bv - b.v;
    delta[i] = d; acc += d; cum[i] = acc;
  }
  return { delta, cum };
}

export function heikinAshi(bars) {
  const out = [];
  let po = NaN, pc = NaN;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const c = (b.o + b.h + b.l + b.c) / 4;
    const o = i === 0 ? (b.o + b.c) / 2 : (po + pc) / 2;
    out.push({ t: b.t, o, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c), c, v: b.v, bv: b.bv });
    po = o; pc = c;
  }
  return out;
}
