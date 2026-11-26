// High Volume Bars: Eimer einer festen Zeiteinheit (z. B. 15 Min., UTC), deren Volumen einen
// Z-Score >= Schwelle hat. Mittel und Standardabweichung der letzten N Eimer, inklusive des aktuellen
// (wie im ATAS-Nachbau HvbDetector). Profil der Kerze aus 1-Minuten-Kerzen geschätzt.
import { valueArea } from './profile.js';

export function detectHvb(buckets, { length = 144, threshold = 2.5, confirm = false, liveLast = true } = {}) {
  const out = [];
  const n = buckets.length;
  if (n < length) return out;
  let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const v = buckets[i].v;
    s += v; s2 += v * v;
    if (i >= length) { const o = buckets[i - length].v; s -= o; s2 -= o * o; }
    if (i < length - 1) continue;
    const mean = s / length;
    const sd = Math.sqrt(Math.max(0, s2 / length - mean * mean));
    if (!(sd > 0)) continue;
    const z = (v - mean) / sd;
    const finished = !(liveLast && i === n - 1);
    if (z >= threshold && (!confirm || finished)) {
      const b = buckets[i];
      out.push({ t: b.t, i, z, v, o: b.o, h: b.h, l: b.l, c: b.c, bull: b.c >= b.o, finished });
    }
  }
  return out;
}

/** Profil einer Kerze aus feineren Kerzen: Volumen gleichmäßig auf berührte Zeilen verteilen. */
export function hvbProfile(fine, low, high, { rows = 100, vaPct = 68 } = {}) {
  const rowH = (high - low) / rows;
  const vol = new Float64Array(rows);
  let delta = 0, hasDelta = true;
  for (const b of fine) {
    if (Number.isFinite(b.bv)) delta += 2 * b.bv - b.v; else hasDelta = false;
    if (!(rowH > 0)) { vol[0] += b.v; continue; }
    const a = Math.min(rows - 1, Math.max(0, Math.floor((b.l - low) / rowH)));
    const z = Math.min(rows - 1, Math.max(0, Math.floor((b.h - low) / rowH)));
    const per = b.v / (z - a + 1);
    for (let k = a; k <= z; k++) vol[k] += per;
  }
  const va = valueArea(vol, vaPct, 1);
  if (!va || !(rowH > 0)) return { poc: (low + high) / 2, vah: high, val: low, delta: hasDelta ? delta : NaN };
  return {
    poc: low + (va.poc + 0.5) * rowH,
    vah: low + (va.hi + 1) * rowH,
    val: low + va.lo * rowH,
    delta: hasDelta ? delta : NaN,
  };
}
