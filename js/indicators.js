// Alle Indikatoren: Einstellungen, Rechnung und Zeichnung.
// Hauptchart-Indikatoren zeichnen in die Scene (overlay.js), Panel-Indikatoren liefern Plots für eigene Panels.
import { DAY, MIN, periodStart, periodPrev, nf, fmtDayLabel, minutesToTf, rgba, mixHex, tfMs } from './util.js';
import { anchoredVwap, rollingVwap, sessionAlignedRolling, autoResolution, projectToChart, periodSummary } from './calc/vwap.js';
import { detectHvb, hvbProfile } from './calc/hvb.js';
import { mergeProfiles, profileLevels, findSingles, findUfa, firstTouch } from './calc/profile.js';
import { institutionalLevels, sfp, volumeCandles } from './calc/levels.js';
import { maLine, bollinger, rsi, macd, atr, cvd } from './calc/std.js';

const SRC = [['ohlc4', 'OHLC4'], ['hlc3', 'HLC3'], ['hl2', 'HL2'], ['close', 'Close']];
const PERIODS = [['day', 'Tag'], ['week', 'Woche'], ['month', 'Monat'], ['quarter', 'Quartal'], ['year', 'Jahr']];
const PERIOD_EN = { day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' };
const n2f = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const n2 = (x) => n2f.format(x);

function bandArrays(vwap, sd, m) {
  const up = new Float64Array(vwap.length), dn = new Float64Array(vwap.length);
  for (let i = 0; i < vwap.length; i++) { up[i] = vwap[i] + m * sd[i]; dn[i] = vwap[i] - m * sd[i]; }
  return { up, dn };
}
const lastFinite = (a) => { for (let i = a.length - 1; i >= 0; i--) if (Number.isFinite(a[i])) return a[i]; return NaN; };

// ============================================================================ TQI: VWAP mit VAH/VAL
const vwap = {
  type: 'vwap', name: 'VWAP mit VAH / VAL', cat: 'tqi', pane: 'main',
  desc: 'VWAP je Tag/Woche/Monat mit ±1σ als VAH/VAL und Bändern 2–4 (wie VWAP Suite).',
  defaults: { period: 'day', source: 'ohlc4', line: true, b1: true, b2: true, b3: true, b4: true, m1: 1, m2: 2, m3: 3, m4: 4, zones: true, zoneOpacity: 0.14, outer: false, prev: false, labels: true, axis: true, color: '#e91e63', bandColor: '#787b86', width: 1 },
  schema: [
    { sec: 'Berechnung' },
    { k: 'period', label: 'Periode (Anker)', t: 'select', opts: PERIODS },
    { k: 'source', label: 'Quelle', t: 'select', opts: SRC },
    { sec: 'Linien' },
    { k: 'line', label: 'VWAP-Linie (Mitte)', t: 'bool' },
    { k: 'b1', label: 'VAH / VAL (Band 1)', t: 'bool' }, { k: 'm1', label: 'Multiplikator Band 1', t: 'num', min: 0, max: 20, step: 0.1 },
    { k: 'b2', label: 'Band 2', t: 'bool' }, { k: 'm2', label: 'Multiplikator Band 2', t: 'num', min: 0, max: 20, step: 0.1 },
    { k: 'b3', label: 'Band 3', t: 'bool' }, { k: 'm3', label: 'Multiplikator Band 3', t: 'num', min: 0, max: 20, step: 0.1 },
    { k: 'b4', label: 'Band 4', t: 'bool' }, { k: 'm4', label: 'Multiplikator Band 4', t: 'num', min: 0, max: 20, step: 0.1 },
    { sec: 'Darstellung' },
    { k: 'zones', label: 'Innere Zone füllen (VAH–VAL)', t: 'bool' },
    { k: 'zoneOpacity', label: 'Deckkraft innere Zone', t: 'num', min: 0, max: 1, step: 0.02 },
    { k: 'outer', label: 'Äußere Zonen füllen', t: 'bool' },
    { k: 'prev', label: 'Vorperiode: pVWAP / pVAH / pVAL', t: 'bool' },
    { k: 'labels', label: 'Beschriftung rechts', t: 'bool' },
    { k: 'axis', label: 'Preis-Labels an der Achse', t: 'bool' },
    { k: 'color', label: 'Farbe VWAP / VAH / VAL', t: 'color' },
    { k: 'bandColor', label: 'Farbe Bänder', t: 'color' },
    { k: 'width', label: 'Linienbreite VWAP', t: 'int', min: 1, max: 5 },
  ],
  title(s) {
    const ms = [1, 2, 3, 4].filter(k => s['b' + k]).map(k => n2(s['m' + k]));
    return `VWAP ${PERIOD_EN[s.period]} Bands ${s.source} ${ms.join(' ')}`;
  },
  needs(s, c) { return [{ tf: c.tf, from: periodStart(c.now, s.period, c.offset) }]; },
  compute(s, c) { return anchoredVwap(c.bars, { source: s.source, period: s.period, offset: c.offset }); },
  values(s, d, i) {
    const out = [];
    if (s.line) out.push({ v: d.vwap[i], color: s.color });
    if (s.b1) out.push({ v: d.vwap[i] + s.m1 * d.sd[i], color: s.color }, { v: d.vwap[i] - s.m1 * d.sd[i], color: s.color });
    return out;
  },
  draw(s, d, sc, c) {
    const th = c.theme;
    const br = d.isNew;
    const last = c.bars.length - 1;
    const pinkBg = th.dark ? mixHex(s.color, th.bg, 0.8) : mixHex(s.color, th.bg, 0.28);
    const pinkFg = th.dark ? '#fff' : '#131722';
    const greyBg = th.dark ? '#4a4d57' : '#9598a1';
    const bands = [];
    for (let k = 1; k <= 4; k++) if (s['b' + k]) bands.push({ k, m: s['m' + k], ...bandArrays(d.vwap, d.sd, s['m' + k]) });
    if (s.zones && s.b1) { const b1 = bands.find(b => b.k === 1); sc.fill(b1.up, b1.dn, { color: rgba(s.color, s.zoneOpacity * (c.isTpo ? 0.45 : 1)), breaks: br }); }
    if (s.outer) {
      for (let j = 1; j < bands.length; j++) {
        sc.fill(bands[j].up, bands[j - 1].up, { color: rgba(s.bandColor, 0.05 + 0.02 * j), breaks: br });
        sc.fill(bands[j - 1].dn, bands[j].dn, { color: rgba(s.bandColor, 0.05 + 0.02 * j), breaks: br });
      }
    }
    for (const b of bands) {
      const inner = b.k === 1;
      const col = inner ? rgba(s.color, 0.75) : rgba(s.bandColor, 0.8);
      sc.line(b.up, { color: col, width: 1, breaks: br, label: s.labels ? (inner ? 'VAH' : `+${n2(b.m)}σ`) : null, lc: inner ? s.color : s.bandColor });
      sc.line(b.dn, { color: col, width: 1, breaks: br, label: s.labels ? (inner ? 'VAL' : `−${n2(b.m)}σ`) : null, lc: inner ? s.color : s.bandColor });
      if (s.axis) {
        sc.axisLabel(b.up[last], null, inner ? pinkBg : greyBg, inner ? pinkFg : '#fff');
        sc.axisLabel(b.dn[last], null, inner ? pinkBg : greyBg, inner ? pinkFg : '#fff');
      }
    }
    if (s.line) {
      sc.line(d.vwap, { color: s.color, width: s.width, breaks: br, label: s.labels ? 'VWAP' : null });
      if (s.axis) sc.axisLabel(d.vwap[last], null, pinkBg, pinkFg);
    }
    if (s.prev && d.prev.length) {
      const p = d.prev[d.prev.length - 1];
      const from = periodStart(c.now, s.period, c.offset);
      const col = rgba(s.color, 0.6);
      sc.level({ p: p.vwap, from, color: col, dash: 'dashed', label: 'pVWAP', lc: s.color });
      sc.level({ p: p.vwap + s.m1 * p.sd, from, color: col, dash: 'dashed', label: 'pVAH', lc: s.color });
      sc.level({ p: p.vwap - s.m1 * p.sd, from, color: col, dash: 'dashed', label: 'pVAL', lc: s.color });
    }
  },
};

// ============================================================================ TQI: Rolling VWAP + Z-Tabelle
const RV_SLOTS = [1, 2, 3, 4, 5, 6];
const rvwapDefaults = { source: 'ohlc4', maxBars: 1000, band: 0.05, bandOpacity: 0.18, dotted: true, labels: true, axis: true, table: true, sessionAligned: false, color: '#787b86', width: 1 };
[[true, 365], [true, 90], [false, 30], [true, 7], [false, 14], [false, 1]].forEach(([on, d], i) => { rvwapDefaults['w' + (i + 1)] = on; rvwapDefaults['d' + (i + 1)] = d; });
const rvwap = {
  type: 'rvwap', name: 'Rolling VWAP (RVWAP)', cat: 'tqi', pane: 'main',
  desc: 'Rollierende VWAPs über 365/90/30/7/14/1 Tage mit Auto-Auflösung (max. 1000 Kerzen) und Z-Score-Tabelle.',
  defaults: rvwapDefaults,
  schema: [
    { sec: 'Berechnung' },
    { k: 'source', label: 'Quelle', t: 'select', opts: SRC },
    { k: 'maxBars', label: 'Auflösung: max. Kerzen pro Fenster', t: 'int', min: 50, max: 5000 },
    { k: 'sessionAligned', label: 'Fenster ab Session-Anfang (statt rollierend)', t: 'bool' },
    { sec: 'Fenster' },
    ...RV_SLOTS.flatMap(i => [{ k: 'w' + i, label: `Fenster ${i} an`, t: 'bool' }, { k: 'd' + i, label: `Fenster ${i}: Tage`, t: 'int', min: 1, max: 3650 }]),
    { sec: 'Darstellung' },
    { k: 'band', label: 'Band (× Standardabweichung, 0 = aus)', t: 'num', min: 0, max: 5, step: 0.01 },
    { k: 'bandOpacity', label: 'Deckkraft Band', t: 'num', min: 0, max: 1, step: 0.02 },
    { k: 'dotted', label: 'Linien gepunktet', t: 'bool' },
    { k: 'labels', label: 'Beschriftung rechts (7D, 90D …)', t: 'bool' },
    { k: 'axis', label: 'Preis-Labels an der Achse', t: 'bool' },
    { k: 'table', label: 'Z-Score-Tabelle', t: 'bool' },
    { k: 'color', label: 'Farbe', t: 'color' },
    { k: 'width', label: 'Linienbreite', t: 'int', min: 1, max: 5 },
  ],
  windows(s) { return RV_SLOTS.filter(i => s['w' + i] && s['d' + i] >= 1).map(i => ({ slot: i, days: s['d' + i], res: autoResolution(s['d' + i], s.maxBars) })); },
  title(s) { return `RVWAP ${s.source.toUpperCase()} (${s.maxBars} bars) ${this.windows(s).map(w => w.days).join(' ')}`; },
  needs(s, c) {
    const first = c.bars.length ? c.bars[0].t : c.now;
    return this.windows(s).map(w => ({ tf: w.res, from: first - w.days * DAY - tfMs(w.res) * 2 }));
  },
  compute(s, c) {
    const wins = [];
    for (const w of this.windows(s)) {
      const st = c.store(w.res);
      if (!st || !st.bars.length) continue;
      const resMs = tfMs(w.res);
      const vals = s.sessionAligned
        ? sessionAlignedRolling(st.bars, w.days, s.source, c.offset, w.res)
        : rollingVwap(st.bars, w.days * DAY, s.source, resMs);
      const pr = projectToChart(c.bars, c.tf, st.bars, w.res, vals);
      const vNow = vals.vwap[vals.vwap.length - 1], sNow = vals.sd[vals.sd.length - 1];
      const price = c.bars.length ? c.bars[c.bars.length - 1].c : NaN;
      const ok = vals.full[vals.full.length - 1];
      wins.push({ label: w.days + 'D', days: w.days, res: w.res, vwap: pr.vwap, sd: pr.sd, now: ok ? vNow : NaN, z: ok && sNow > 0 ? (price - vNow) / sNow : NaN });
    }
    return { wins };
  },
  values(s, d, i) { return d.wins.map(w => ({ v: w.vwap[i], color: s.color, label: w.label })); },
  draw(s, d, sc, c) {
    const last = c.bars.length - 1;
    for (const w of d.wins) {
      if (s.band > 0) {
        const b = bandArrays(w.vwap, w.sd, s.band);
        sc.fill(b.up, b.dn, { color: rgba(s.color, s.bandOpacity) });
      }
      sc.line(w.vwap, { color: s.color, width: s.width, dash: s.dotted ? 'dotted' : null, label: s.labels ? w.label : null });
      if (s.axis) sc.axisLabel(w.vwap[last], null, c.theme.dark ? '#4a4d57' : '#9598a1', '#fff');
    }
  },
};

// ============================================================================ TQI: High Volume Bars
const hvb = {
  type: 'hvb', name: 'High Volume Bars', cat: 'tqi', pane: 'main',
  desc: 'Kerzen (15 Min.) mit Volumen-Z-Score ≥ 2,5 über 144 Kerzen. POC und Value Area der Kerze aus 1-Minuten-Daten.',
  defaults: { tfMin: 15, length: 144, threshold: 2.5, confirm: false, profile: '1m', rows: 100, vaPct: 68, pocLine: true, vaLines: false, vaFill: true, delta: false, pocLife: 200, vaLife: 200, maxActive: 100, mark: true, pocColor: '#00bcd4', vaColor: '#787b86', vaOpacity: 0.24 },
  schema: [
    { sec: 'Erkennung' },
    { k: 'tfMin', label: 'Zeiteinheit (Minuten)', t: 'select', opts: [[1, '1'], [3, '3'], [5, '5'], [15, '15'], [30, '30'], [60, '60'], [240, '240']] },
    { k: 'length', label: 'Z-Score Länge', t: 'int', min: 2, max: 5000 },
    { k: 'threshold', label: 'Z-Score Schwelle', t: 'num', min: 0, max: 100, step: 0.1 },
    { k: 'confirm', label: 'Erst nach Kerzenschluss', t: 'bool' },
    { sec: 'Profil der Kerze' },
    { k: 'profile', label: 'Profil aus', t: 'select', opts: [['1m', '1-Minuten-Kerzen'], ['even', 'Kerze gleichmäßig verteilt']] },
    { k: 'rows', label: 'Zeilen pro Kerze', t: 'int', min: 5, max: 1000 },
    { k: 'vaPct', label: 'Value Area %', t: 'num', min: 1, max: 100, step: 1 },
    { sec: 'Darstellung' },
    { k: 'pocLine', label: 'POC-Linie', t: 'bool' },
    { k: 'vaLines', label: 'VAH / VAL Linien', t: 'bool' },
    { k: 'vaFill', label: 'Value Area füllen', t: 'bool' },
    { k: 'delta', label: 'Delta anzeigen', t: 'bool' },
    { k: 'mark', label: 'Kerze markieren', t: 'bool' },
    { k: 'pocLife', label: 'POC-Linie Länge (Kerzen der HVB-Zeiteinheit)', t: 'int', min: 1, max: 100000 },
    { k: 'vaLife', label: 'Value Area Länge (Kerzen der HVB-Zeiteinheit)', t: 'int', min: 1, max: 100000 },
    { k: 'maxActive', label: 'Max. aktive Level', t: 'int', min: 1, max: 1000 },
    { k: 'pocColor', label: 'Farbe POC', t: 'color' },
    { k: 'vaColor', label: 'Farbe Value Area', t: 'color' },
    { k: 'vaOpacity', label: 'Deckkraft Value Area', t: 'num', min: 0, max: 1, step: 0.02 },
  ],
  bucketTf(s) { return minutesToTf(+s.tfMin) || '15m'; },
  title(s) { return `High Volume Bars ${s.tfMin} ${s.length} ${n2(s.threshold)}`; },
  needs(s, c) {
    const first = c.bars.length ? c.bars[0].t : c.now;
    const tf = this.bucketTf(s);
    const req = [{ tf, from: first - (s.length + 4) * tfMs(tf) }];
    if (s.profile === '1m') req.push({ tf: '1m', count: 240 });
    return req;
  },
  compute(s, c) {
    const tf = this.bucketTf(s);
    const st = c.store(tf);
    if (!st || !st.bars.length) return { list: [] };
    const first = c.bars.length ? c.bars[0].t : 0;
    let list = detectHvb(st.bars, { length: s.length, threshold: s.threshold, confirm: s.confirm }).filter(h => h.t >= first);
    list = list.slice(-s.maxActive);
    const bMs = tfMs(tf);
    for (const h of list) {
      let fine = null;
      if (s.profile === '1m') fine = c.fine(h.t, h.t + bMs, !h.finished);
      if (s.profile === 'even') fine = [{ t: h.t, o: h.o, h: h.h, l: h.l, c: h.c, v: h.v, bv: NaN }];
      h.prof = fine && fine.length ? hvbProfile(fine, h.l, h.h, { rows: s.rows, vaPct: s.vaPct }) : null;
    }
    return { list, tf };
  },
  draw(s, d, sc, c) {
    for (const h of d.list) {
      if (s.mark) {
        const i = c.idx(h.t);
        if (i != null) sc.barBox({ i, top: h.h, bottom: h.l, stroke: rgba(s.pocColor, 0.9) });
      }
      const p = h.prof;
      if (!p) continue;
      const bMs = tfMs(d.tf);
      const vaTo = h.t + s.vaLife * bMs, pocTo = h.t + s.pocLife * bMs;
      if (s.vaFill) sc.box({ from: h.t, to: vaTo, top: p.vah, bottom: p.val, fill: rgba(s.vaColor, s.vaOpacity) });
      if (s.vaLines) {
        sc.level({ p: p.vah, from: h.t, to: vaTo, color: rgba(s.vaColor, 0.9) });
        sc.level({ p: p.val, from: h.t, to: vaTo, color: rgba(s.vaColor, 0.9) });
      }
      if (s.pocLine) sc.level({ p: p.poc, from: h.t, to: pocTo, color: s.pocColor, width: 1, label: s.delta && Number.isFinite(p.delta) ? `Δ ${nf(1).format(p.delta)}` : null });
    }
  },
};

// ============================================================================ TQI: VWAP-Level W M Q Y
const htfvwap = {
  type: 'htfvwap', name: 'VWAP-Level W / M / Q / Y', cat: 'tqi', pane: 'main',
  desc: 'VWAP, VAH, VAL der laufenden und vorherigen Woche, Monat, Quartal, Jahr als kurze Marken rechts.',
  defaults: { w: true, pw: true, m: true, pm: true, q: false, pq: false, y: false, py: false, source: 'ohlc4', tickBars: 15, color: 'auto' },
  schema: [
    { sec: 'Level' },
    { k: 'w', label: 'Woche: VWAP / VAH / VAL', t: 'bool' }, { k: 'pw', label: 'Vorwoche', t: 'bool' },
    { k: 'm', label: 'Monat', t: 'bool' }, { k: 'pm', label: 'Vormonat', t: 'bool' },
    { k: 'q', label: 'Quartal', t: 'bool' }, { k: 'pq', label: 'Vorquartal', t: 'bool' },
    { k: 'y', label: 'Jahr', t: 'bool' }, { k: 'py', label: 'Vorjahr', t: 'bool' },
    { sec: 'Darstellung' },
    { k: 'source', label: 'Quelle', t: 'select', opts: SRC },
    { k: 'tickBars', label: 'Länge der Markierung (Kerzen)', t: 'int', min: 1, max: 500 },
    { k: 'color', label: 'Farbe (auto = Thema)', t: 'color', auto: true },
  ],
  title(s) { return 'VWAP-Level ' + ['w', 'm', 'q', 'y'].filter(k => s[k] || s['p' + k]).map(k => k.toUpperCase()).join(' '); },
  needs(s, c) {
    const req = [];
    if (s.w || s.pw || s.m || s.pm) req.push({ tf: '30m', from: periodPrev(periodStart(c.now, 'month'), 'month') });
    if (s.q || s.pq || s.y || s.py) req.push({ tf: '4h', from: periodPrev(periodStart(c.now, 'year'), 'year') });
    return req;
  },
  compute(s, c) {
    const out = [];
    const add = (bars, kind, key) => {
      if (!bars || !bars.length) return;
      const r = periodSummary(bars, { period: kind, source: s.source, offset: c.offset, allowPartial: false });
      if (s[key] && r.cur) out.push({ name: key, ...r.cur });
      if (s['p' + key] && r.prev) out.push({ name: 'p' + key, ...r.prev });
    };
    const m30 = c.store('30m')?.bars, h4 = c.store('4h')?.bars;
    add(m30, 'week', 'w'); add(m30, 'month', 'm'); add(h4, 'quarter', 'q'); add(h4, 'year', 'y');
    return { out };
  },
  draw(s, d, sc, c) {
    const col = s.color === 'auto' ? c.theme.levelText : s.color;
    const last = c.bars.length - 1;
    for (const x of d.out) {
      const from = c.bars[Math.max(0, last - s.tickBars)]?.t;
      for (const [nm, p] of [['VWAP', x.vwap], ['VAH', x.vwap + x.sd], ['VAL', x.vwap - x.sd]]) {
        sc.level({ p, from, ext: s.tickBars + 2, color: rgba(col, 0.9), width: nm === 'VWAP' ? 2 : 1, label: x.name + nm, lc: col });
      }
    }
  },
};

// ============================================================================ TQI: Value Areas (01–04)
const va = {
  type: 'va', name: 'Value Areas & Composites', cat: 'tqi', pane: 'main',
  desc: 'VAH / VAL (und POC) von Vortag, 3 Tagen, 7 Tagen, Vorwoche, 2 Wochen, Vormonat, eigene Composites und einzelne Vortage.',
  defaults: { pd: true, d3: true, d7: true, pw: true, w2: true, pm: false, poc: false, basis: 'vol', pct: 68, step: 2, comp1: true, comp1Days: 28, comp2: true, comp2Days: 56, range: false, rangeFrom: '2026-10-01', rangeTo: '2026-10-10', days: false, daysCount: 3, daysPoc: true, fill: 0, lineColor: 'auto', textColor: '#466ee6', periodColor: '#f0961e', compColor: '#7850c8', rangeColor: '#00968c' },
  schema: [
    { sec: 'Value Areas' },
    { k: 'pd', label: 'pd (Vortag)', t: 'bool' }, { k: 'd3', label: '3d (letzte 3 Tage)', t: 'bool' }, { k: 'd7', label: '7d (letzte 7 Tage)', t: 'bool' },
    { k: 'pw', label: 'pw (Vorwoche)', t: 'bool' }, { k: 'w2', label: '2w (letzte 2 Wochen)', t: 'bool' }, { k: 'pm', label: 'pm (Vormonat)', t: 'bool' },
    { k: 'poc', label: 'POC der Value Areas zeigen', t: 'bool' },
    { k: 'basis', label: 'Berechnung aus', t: 'select', opts: [['vol', 'Volumen'], ['tpo', 'TPO'], ['both', 'beides']] },
    { k: 'pct', label: 'Value Area (%)', t: 'int', min: 50, max: 95 },
    { k: 'step', label: 'Stufen pro Schritt (ATAS-Methode = 2)', t: 'int', min: 1, max: 10 },
    { sec: 'Eigene Composites' },
    { k: 'comp1', label: 'Composite 1 anzeigen', t: 'bool' }, { k: 'comp1Days', label: 'Composite 1: Tage', t: 'int', min: 2, max: 365 },
    { k: 'comp2', label: 'Composite 2 anzeigen', t: 'bool' }, { k: 'comp2Days', label: 'Composite 2: Tage', t: 'int', min: 2, max: 365 },
    { sec: 'Composite mit festem Datum' },
    { k: 'range', label: 'Datums-Composite anzeigen', t: 'bool' },
    { k: 'rangeFrom', label: 'Von (Datum)', t: 'date' }, { k: 'rangeTo', label: 'Bis (inklusive)', t: 'date' },
    { sec: 'Vortage einzeln' },
    { k: 'days', label: 'VAH / VAL / VPOC der letzten Tage', t: 'bool' },
    { k: 'daysCount', label: 'Anzahl Tage', t: 'int', min: 1, max: 30 },
    { k: 'daysPoc', label: 'VPOC zeigen', t: 'bool' },
    { sec: 'Farben' },
    { k: 'fill', label: 'Value Area als Fläche (Deckkraft, 0 = aus)', t: 'num', min: 0, max: 1, step: 0.02 },
    { k: 'lineColor', label: 'Linienfarbe (auto = Thema)', t: 'color', auto: true },
    { k: 'textColor', label: 'Textfarbe (pd, 3d, 7d, 2w)', t: 'color' },
    { k: 'periodColor', label: 'Textfarbe (pw, pm)', t: 'color' },
    { k: 'compColor', label: 'Textfarbe Composites', t: 'color' },
    { k: 'rangeColor', label: 'Textfarbe Datums-Composite', t: 'color' },
  ],
  title(s) { return 'Value Areas ' + [['pd', 'pd'], ['d3', '3d'], ['d7', '7d'], ['pw', 'pw'], ['w2', '2w'], ['pm', 'pm']].filter(([k]) => s[k]).map(([, l]) => l).join(' ') + (s.comp1 || s.comp2 ? ' · Comp' : ''); },
  needs(s, c) {
    const today = periodStart(c.now, 'day', c.offset);
    let from = today - 8 * DAY;
    if (s.w2 || s.pw) from = Math.min(from, periodStart(c.now, 'week', c.offset) - 14 * DAY);
    if (s.pm) from = Math.min(from, periodPrev(periodStart(c.now, 'month', c.offset), 'month', c.offset));
    if (s.comp1) from = Math.min(from, today - (s.comp1Days + 1) * DAY);
    if (s.comp2) from = Math.min(from, today - (s.comp2Days + 1) * DAY);
    if (s.days) from = Math.min(from, today - (s.daysCount + 1) * DAY);
    if (s.range) { const t = Date.parse(s.rangeFrom + 'T00:00:00Z'); if (Number.isFinite(t)) from = Math.min(from, t); }
    return [{ tf: '30m', from }, { tf: '1D', count: 60 }];
  },
  compute(s, c) {
    const days = c.profiles();
    if (!days) return { sets: [], single: [], today: periodStart(c.now, 'day', c.offset) };
    const today = periodStart(c.now, 'day', c.offset);
    const done = days.filter(d => d.complete && d.end <= today);
    const sets = [];
    const bases = s.basis === 'both' ? ['vol', 'tpo'] : [s.basis];
    const add = (key, label, list, color) => {
      if (!list.length) return;
      const p = list.length === 1 ? list[0] : mergeProfiles(list);
      for (const b of bases) {
        const lv = profileLevels(p, { basis: b, pct: s.pct, step: s.step });
        if (lv) sets.push({ key, label: label + (b === 'tpo' && s.basis === 'both' ? ' (tpo)' : ''), color, ...lv });
      }
    };
    const week = periodStart(c.now, 'week', c.offset), month = periodStart(c.now, 'month', c.offset);
    if (s.pd) add('pd', 'pd', done.slice(-1), s.textColor);
    if (s.d3) add('3d', '3d', done.slice(-3), s.textColor);
    if (s.d7) add('7d', '7d', done.slice(-7), s.textColor);
    if (s.pw) add('pw', 'pw', done.filter(d => d.start >= week - 7 * DAY && d.start < week), s.periodColor);
    if (s.w2) add('2w', '2w', done.filter(d => d.start >= week - 14 * DAY && d.start < week), s.textColor);
    if (s.pm) { const pm = periodPrev(month, 'month', c.offset); add('pm', 'pm', done.filter(d => d.start >= pm && d.start < month), s.periodColor); }
    if (s.comp1) add('c1', s.comp1Days + 'd comp', done.slice(-s.comp1Days), s.compColor);
    if (s.comp2) add('c2', s.comp2Days + 'd comp', done.slice(-s.comp2Days), s.compColor);
    if (s.range) {
      const a = Date.parse(s.rangeFrom + 'T00:00:00Z'), b = Date.parse(s.rangeTo + 'T00:00:00Z');
      if (Number.isFinite(a) && Number.isFinite(b)) add('rg', 'range', days.filter(d => d.start >= a && d.start <= b && d.complete), s.rangeColor);
    }
    const single = [];
    if (s.days) for (const d of done.slice(-s.daysCount)) { const lv = profileLevels(d, { basis: s.basis === 'tpo' ? 'tpo' : 'vol', pct: s.pct, step: s.step }); if (lv) single.push({ day: d.start, ...lv }); }
    return { sets, single, today };
  },
  draw(s, d, sc, c) {
    const line = s.lineColor === 'auto' ? c.theme.levelLine : s.lineColor;
    for (const x of d.sets) {
      if (s.fill > 0) sc.box({ from: d.today, top: x.vah, bottom: x.val, fill: rgba(x.color, s.fill) });
      sc.level({ p: x.vah, from: d.today, color: line, label: x.label + ' VAH', lc: x.color });
      sc.level({ p: x.val, from: d.today, color: line, label: x.label + ' VAL', lc: x.color });
      if (s.poc) sc.level({ p: x.poc, from: d.today, color: line, dash: 'dashed', label: x.label + ' POC', lc: x.color });
    }
    for (const x of d.single) {
      const lb = fmtDayLabel(x.day);
      sc.level({ p: x.vah, from: x.day, color: c.theme.levelDim, label: 'VAH ' + lb, lc: c.theme.levelDimText });
      sc.level({ p: x.val, from: x.day, color: c.theme.levelDim, label: 'VAL ' + lb, lc: c.theme.levelDimText });
      if (s.daysPoc) sc.level({ p: x.poc, from: x.day, color: c.theme.levelDim, dash: 'dashed', label: 'VPOC ' + lb, lc: c.theme.levelDimText });
    }
  },
};

// ============================================================================ TQI: Naked Levels (05–10)
const naked = {
  type: 'naked', name: 'Naked Levels (POC, UFA, Singles, Tails)', cat: 'tqi', pane: 'main',
  desc: 'Unberührte POCs, Unfinished Auctions, Single Prints und Tails aus dem 30-Min-Market-Profile. Ein Level zählt nur, solange es nicht berührt wurde.',
  defaults: { poc: true, pocBasis: 'vol', ufa: true, ufaMin: 2, singles: true, minSingle: 3, tails: true, minTail: 3, zoneEnd: 'touch', touchClose: 'session', touchedDashed: true, tol: 0, history: false, maxHistory: 300, lookback: 60, labelDate: true, pocColor: '#dc2828', ufaColor: 'auto', singleColor: '#969696', sellTail: '#e65a5a', buyTail: '#46aae6', boxOpacity: 0.18 },
  schema: [
    { sec: 'Naked POC' },
    { k: 'poc', label: 'Naked POC anzeigen', t: 'bool' },
    { k: 'pocBasis', label: 'POC aus', t: 'select', opts: [['vol', 'Volumen'], ['tpo', 'TPO'], ['both', 'beides']] },
    { k: 'pocColor', label: 'Farbe', t: 'color' },
    { sec: 'Naked UFA (Unfinished Auction)' },
    { k: 'ufa', label: 'Naked UFA anzeigen', t: 'bool' },
    { k: 'ufaMin', label: 'Min. TPOs am Extrem', t: 'int', min: 2, max: 50 },
    { k: 'ufaColor', label: 'Farbe (auto = Thema)', t: 'color', auto: true },
    { sec: 'Single Prints' },
    { k: 'singles', label: 'Single Prints anzeigen', t: 'bool' },
    { k: 'minSingle', label: 'Min. Zeilen', t: 'int', min: 1, max: 1000 },
    { k: 'singleColor', label: 'Farbe', t: 'color' },
    { sec: 'Tails' },
    { k: 'tails', label: 'Tails anzeigen', t: 'bool' },
    { k: 'minTail', label: 'Min. Zeilen', t: 'int', min: 1, max: 1000 },
    { k: 'sellTail', label: 'Farbe Selling Tail (oben)', t: 'color' },
    { k: 'buyTail', label: 'Farbe Buying Tail (unten)', t: 'color' },
    { sec: 'Berührte Level' },
    { k: 'zoneEnd', label: 'Singles/Tails gelten als erledigt bei', t: 'select', opts: [['touch', 'Berührung'], ['fill', 'komplett gefüllt']] },
    { k: 'touchClose', label: 'Berührte Level schließen', t: 'select', opts: [['session', 'nach Session-Ende'], ['now', 'sofort']] },
    { k: 'touchedDashed', label: 'Berührte Level gestrichelt', t: 'bool' },
    { k: 'tol', label: 'Gilt als berührt ab Abstand (Preis)', t: 'num', min: 0, max: 100000, step: 0.1 },
    { k: 'history', label: 'Geschlossene Level im Verlauf stehen lassen', t: 'bool' },
    { k: 'maxHistory', label: 'Max. geschlossene Level', t: 'int', min: 0, max: 5000 },
    { sec: 'Allgemein' },
    { k: 'lookback', label: 'Historie (Tage)', t: 'int', min: 5, max: 365 },
    { k: 'labelDate', label: 'Datum in der Beschriftung', t: 'bool' },
    { k: 'boxOpacity', label: 'Box-Deckkraft', t: 'num', min: 0, max: 1, step: 0.02 },
  ],
  title(s) { return 'Naked ' + [['poc', 'POC'], ['ufa', 'UFA'], ['singles', 'Singles'], ['tails', 'Tails']].filter(([k]) => s[k]).map(([, l]) => l).join(' '); },
  needs(s, c) { return [{ tf: '30m', from: periodStart(c.now, 'day', c.offset) - (s.lookback + 1) * DAY }, { tf: '1D', count: 60 }]; },
  compute(s, c) {
    const days = c.profiles();
    if (!days) return { items: [] };
    const m30 = c.store('30m').bars;
    const today = periodStart(c.now, 'day', c.offset);
    const minStart = today - s.lookback * DAY;
    const items = [];
    const status = (touchedAt) => {
      if (touchedAt == null) return 'open';
      if (s.touchClose === 'session') {
        const end = periodStart(touchedAt, 'day', c.offset) + DAY;
        return c.now < end ? 'touched' : 'closed';
      }
      return 'closed';
    };
    for (const d of days) {
      if (!d.complete || d.end > today || d.start < minStart) continue;
      const lb = s.labelDate ? ' ' + fmtDayLabel(d.start) : '';
      if (s.poc) {
        const bases = s.pocBasis === 'both' ? ['vol', 'tpo'] : [s.pocBasis];
        for (const b of bases) {
          const lv = profileLevels(d, { basis: b, pct: 68, step: 2 });
          if (!lv) continue;
          const tt = firstTouch(m30, d.end, lv.poc, lv.poc, { tol: s.tol });
          items.push({ kind: 'poc', p: lv.poc, from: d.start, touched: tt, st: status(tt), label: 'nPOC' + (b === 'tpo' ? ' (tpo)' : '') + lb });
        }
      }
      if (s.ufa) {
        const u = findUfa(d, { minTpos: s.ufaMin });
        for (const [side, p] of [['high', u.high], ['low', u.low]]) {
          if (p == null) continue;
          const tt = firstTouch(m30, d.end, p, p, { tol: s.tol });
          items.push({ kind: 'ufa', p, from: d.start, touched: tt, st: status(tt), label: 'UFA ' + side + lb });
        }
      }
      if (s.singles || s.tails) {
        const z = findSingles(d, { minSingle: s.minSingle, minTail: s.minTail });
        const zones = [];
        if (s.singles) for (const x of z.singles) zones.push({ kind: 'single', ...x, label: 'Single Prints' + lb });
        if (s.tails && z.sellTail) zones.push({ kind: 'sellTail', ...z.sellTail, label: 'Selling Tail' + lb });
        if (s.tails && z.buyTail) zones.push({ kind: 'buyTail', ...z.buyTail, label: 'Buying Tail' + lb });
        for (const x of zones) {
          const tt = firstTouch(m30, d.end, x.bottom, x.top, { tol: s.tol, mode: s.zoneEnd === 'fill' ? 'fill' : 'touch' });
          items.push({ ...x, from: d.start, touched: tt, st: status(tt) });
        }
      }
    }
    return { items };
  },
  draw(s, d, sc, c) {
    const ufaCol = s.ufaColor === 'auto' ? c.theme.ufa : s.ufaColor;
    let hist = 0;
    for (let k = d.items.length - 1; k >= 0; k--) {
      const x = d.items[k];
      if (x.st === 'closed') { if (!s.history || hist++ >= s.maxHistory) continue; }
      const closed = x.st === 'closed';
      const dash = (x.st === 'touched' && s.touchedDashed) || closed ? 'dashed' : null;
      const to = closed ? x.touched : null;
      const alpha = closed ? 0.45 : 1;
      if (x.kind === 'poc' || x.kind === 'ufa') {
        const col = x.kind === 'poc' ? s.pocColor : ufaCol;
        sc.level({ p: x.p, from: x.from, to, color: col, dash, alpha, label: closed ? null : x.label, lc: col });
      } else {
        const col = x.kind === 'single' ? s.singleColor : x.kind === 'sellTail' ? s.sellTail : s.buyTail;
        sc.box({ from: x.from, to, top: x.top, bottom: x.bottom, fill: rgba(col, s.boxOpacity * (closed ? 0.5 : 1)), stroke: dash ? rgba(col, 0.7) : null, dash: 'dashed', label: closed ? null : x.label, lc: col });
      }
    }
  },
};

// ============================================================================ TQI: SFP
const sfpInd = {
  type: 'sfp', name: 'SFP (Swing Failure Pattern)', cat: 'tqi', pane: 'main',
  desc: 'Hoch/Tief über einen offenen Swing, Schluss zurück im Level.',
  defaults: { strength: 5, minDist: 0, maxSwings: 5, lines: true, bear: '#dc2828', bull: '#1eaa50' },
  schema: [
    { k: 'strength', label: 'Swing-Stärke (Kerzen links/rechts)', t: 'int', min: 1, max: 50 },
    { k: 'minDist', label: 'Schluss mind. so weit zurück im Level (Preis)', t: 'num', min: 0, max: 100000, step: 0.1 },
    { k: 'maxSwings', label: 'Max. offene Swings je Seite', t: 'int', min: 1, max: 50 },
    { k: 'lines', label: 'Linie vom Swing zum SFP', t: 'bool' },
    { k: 'bear', label: 'Farbe bearish SFP (am Hoch)', t: 'color' },
    { k: 'bull', label: 'Farbe bullish SFP (am Tief)', t: 'color' },
  ],
  title(s) { return `SFP ${s.strength}`; },
  needs() { return []; },
  compute(s, c) { return { list: sfp(c.bars, { strength: s.strength, minDist: s.minDist, maxSwings: s.maxSwings }) }; },
  draw(s, d, sc, c) {
    for (const x of d.list) {
      const col = x.type === 'bear' ? s.bear : s.bull;
      sc.mark({ i: x.i, p: x.type === 'bear' ? c.bars[x.i].h : c.bars[x.i].l, shape: x.type === 'bear' ? 'down' : 'up', color: col, text: 'SFP' });
      if (s.lines) sc.level({ p: x.price, from: x.swingT, to: x.t, color: rgba(col, 0.7), dash: 'dotted' });
    }
  },
};

// ============================================================================ TQI: Institutionelle Level
const inst = {
  type: 'inst', name: 'Institutionelle Level', cat: 'tqi', pane: 'main',
  desc: '52-Wochen-Hoch/Tief, Vorwoche/Vormonat/Vortag Hoch/Tief, Daily/Weekly/Monthly/Quarterly/Yearly Open, 200-/50-Tage-Durchschnitt.',
  defaults: { w52: true, pwHL: true, pmHL: true, pdHL: false, do: true, wo: true, mo: true, qo: false, yo: true, sma200: true, sma50: false, textColor: 'auto', lineColor: 'auto', sma200Color: '#c83ca0', sma50Color: '#3ca0c8' },
  schema: [
    { k: 'w52', label: '52w high / low', t: 'bool' }, { k: 'pwHL', label: 'pw high / low (Vorwoche)', t: 'bool' },
    { k: 'pmHL', label: 'pm high / low (Vormonat)', t: 'bool' }, { k: 'pdHL', label: 'pd high / low (Vortag)', t: 'bool' },
    { k: 'do', label: 'do (Daily Open)', t: 'bool' }, { k: 'wo', label: 'wo (Weekly Open)', t: 'bool' }, { k: 'mo', label: 'mo (Monthly Open)', t: 'bool' },
    { k: 'qo', label: 'qo (Quarterly Open)', t: 'bool' }, { k: 'yo', label: 'yo (Yearly Open)', t: 'bool' },
    { k: 'sma200', label: '200-Tage-Durchschnitt', t: 'bool' }, { k: 'sma50', label: '50-Tage-Durchschnitt', t: 'bool' },
    { sec: 'Farben' },
    { k: 'textColor', label: 'Textfarbe (auto = Thema)', t: 'color', auto: true },
    { k: 'lineColor', label: 'Linienfarbe (auto = Thema)', t: 'color', auto: true },
    { k: 'sma200Color', label: 'Farbe 200-Tage', t: 'color' }, { k: 'sma50Color', label: 'Farbe 50-Tage', t: 'color' },
  ],
  title() { return 'Institutionelle Level'; },
  needs() { return [{ tf: '1D', count: 400 }]; },
  compute(s, c) { const d = c.store('1D'); return { list: d ? institutionalLevels(d.bars, c.now, s) : [] }; },
  draw(s, d, sc, c) {
    const tc = s.textColor === 'auto' ? c.theme.levelText : s.textColor;
    const lc = s.lineColor === 'auto' ? c.theme.levelLine : s.lineColor;
    for (const x of d.list) {
      const col = x.key === 'sma200' ? s.sma200Color : x.key === 'sma50' ? s.sma50Color : lc;
      sc.level({ p: x.price, from: x.from, color: col, dash: x.key.endsWith('o') ? 'dashed' : null, label: x.label, lc: x.sma ? col : tc });
    }
  },
};

// ============================================================================ TQI: Volumen-Kerzen
const volcandles = {
  type: 'volcandles', name: 'Volumen-Kerzen markieren', cat: 'tqi', pane: 'main',
  desc: 'Kerzen mit sehr hohem Volumen (Z-Score gegen die letzten 200 Kerzen) markieren.',
  defaults: { lookback: 200, sd: 3, sdExtreme: 5, onlyExtreme: false, color: '#ffc83c', extremeColor: '#ff7800', opacity: 0.35 },
  schema: [
    { k: 'lookback', label: 'Vergleich mit letzten X Kerzen', t: 'int', min: 20, max: 5000 },
    { k: 'sd', label: 'Hoch ab x Standardabweichungen', t: 'num', min: 0, max: 100, step: 0.1 },
    { k: 'sdExtreme', label: 'Extrem ab x Standardabweichungen', t: 'num', min: 0, max: 100, step: 0.1 },
    { k: 'onlyExtreme', label: 'Nur extreme Kerzen', t: 'bool' },
    { k: 'color', label: 'Farbe hoch', t: 'color' }, { k: 'extremeColor', label: 'Farbe extrem', t: 'color' },
    { k: 'opacity', label: 'Deckkraft', t: 'num', min: 0, max: 1, step: 0.05 },
  ],
  title(s) { return `Volumen-Kerzen ${s.lookback} ${n2(s.sd)} ${n2(s.sdExtreme)}`; },
  needs() { return []; },
  compute(s, c) { return { list: volumeCandles(c.bars, s) }; },
  draw(s, d, sc, c) {
    for (const x of d.list) {
      if (s.onlyExtreme && x.level < 2) continue;
      const col = x.level === 2 ? s.extremeColor : s.color;
      sc.barBox({ i: x.i, top: c.bars[x.i].h, bottom: c.bars[x.i].l, fill: rgba(col, s.opacity), wf: 1.4 });
    }
  },
};

// ============================================================================ Orderflow: Panels
const volume = {
  type: 'volume', name: 'Volumen', cat: 'of', pane: 'own',
  desc: 'Volumen je Kerze, wahlweise nach Kerzenrichtung oder nach Delta (Taker-Kauf − Verkauf) gefärbt.',
  defaults: { mode: 'delta', maLen: 20, ma: true, up: '#26a69a', down: '#ef5350' },
  schema: [
    { k: 'mode', label: 'Färbung', t: 'select', opts: [['delta', 'nach Delta'], ['dir', 'nach Kerze']] },
    { k: 'ma', label: 'Durchschnitt', t: 'bool' }, { k: 'maLen', label: 'Durchschnitt Länge', t: 'int', min: 2, max: 500 },
    { k: 'up', label: 'Farbe Kauf', t: 'color' }, { k: 'down', label: 'Farbe Verkauf', t: 'color' },
  ],
  plots: [{ key: 'v', kind: 'hist', title: 'Vol' }, { key: 'ma', kind: 'line', title: 'MA', width: 1 }],
  title(s) { return `Volumen${s.mode === 'delta' ? ' (Delta)' : ''}`; },
  needs() { return []; },
  compute(s, c) {
    const n = c.bars.length;
    const v = new Float64Array(n), colors = new Array(n);
    const upA = rgba(s.up, 0.55), dnA = rgba(s.down, 0.55);
    for (let i = 0; i < n; i++) {
      const b = c.bars[i];
      v[i] = b.v;
      const byDelta = s.mode === 'delta' && Number.isFinite(b.bv);
      colors[i] = byDelta ? (2 * b.bv - b.v >= 0 ? upA : dnA) : (b.c >= b.o ? upA : dnA);
    }
    const out = { v: { values: v, colors } };
    if (s.ma) { const m = new Float64Array(n).fill(NaN); let acc = 0; for (let i = 0; i < n; i++) { acc += v[i]; if (i >= s.maLen) acc -= v[i - s.maLen]; if (i >= s.maLen - 1) m[i] = acc / s.maLen; } out.ma = { values: m, color: c.theme.dark ? '#b2b5be' : '#5d606b' }; }
    return { plots: out };
  },
};

const cvdInd = {
  type: 'cvd', name: 'CVD (Cumulative Volume Delta)', cat: 'of', pane: 'own',
  desc: 'Laufende Summe aus Taker-Käufen minus Taker-Verkäufen. Historie nur bei Binance, sonst ab Seitenstart live.',
  defaults: { reset: 'none', style: 'line', color: '#2962ff' },
  schema: [
    { k: 'reset', label: 'Zurücksetzen', t: 'select', opts: [['none', 'nie'], ['day', 'jeden Tag'], ['week', 'jede Woche']] },
    { k: 'style', label: 'Darstellung', t: 'select', opts: [['line', 'Linie'], ['hist', 'Delta je Kerze']] },
    { k: 'color', label: 'Farbe', t: 'color' },
  ],
  plots: [{ key: 'cvd', kind: 'line', title: 'CVD', width: 2 }, { key: 'd', kind: 'hist', title: 'Δ' }],
  title(s) { return `CVD${s.reset !== 'none' ? ' (' + (s.reset === 'day' ? 'Tag' : 'Woche') + ')' : ''}`; },
  needs() { return []; },
  compute(s, c) {
    const r = cvd(c.bars, { reset: s.reset, offset: c.offset });
    const plots = {};
    if (s.style === 'line') plots.cvd = { values: r.cum, color: s.color };
    else plots.d = { values: r.delta, colors: Array.from(r.delta, x => x >= 0 ? rgba('#26a69a', 0.7) : rgba('#ef5350', 0.7)) };
    const note = c.market.delta ? null : 'Delta-Historie nur bei Binance';
    return { plots, note };
  },
};

const oiInd = {
  type: 'oi', name: 'Open Interest', cat: 'of', pane: 'own',
  desc: 'Offene Kontrakte (Perps). Binance liefert die letzten 30 Tage, Bybit mehr.',
  defaults: { unit: 'coin', color: '#f0a93b' },
  schema: [{ k: 'unit', label: 'Einheit', t: 'select', opts: [['coin', 'Coins'], ['usd', 'USD']] }, { k: 'color', label: 'Farbe', t: 'color' }],
  plots: [{ key: 'oi', kind: 'line', title: 'OI', width: 2 }],
  async: 'oi',
  title() { return 'Open Interest'; },
  needs() { return []; },
  compute(s, c) {
    const pts = c.ext('oi');
    if (!c.market.oi) return { plots: {}, note: 'Open Interest gibt es nur für Perps (Binance, Bybit)' };
    if (!pts) return { plots: {}, note: 'lädt …' };
    const vals = stepToBars(c.bars, c.tf, pts.points, s.unit === 'usd' ? (p, b) => (p.usd ?? p.v * b.c) : (p) => p.v);
    return { plots: { oi: { values: vals, color: s.color } } };
  },
};

const fundingInd = {
  type: 'funding', name: 'Funding Rate', cat: 'of', pane: 'own',
  desc: 'Funding der Perps in % je Intervall, plus aktueller Schätzwert.',
  defaults: { pos: '#26a69a', neg: '#ef5350' },
  schema: [{ k: 'pos', label: 'Farbe positiv', t: 'color' }, { k: 'neg', label: 'Farbe negativ', t: 'color' }],
  plots: [{ key: 'f', kind: 'hist', title: 'Funding %' }],
  async: 'funding',
  title() { return 'Funding Rate %'; },
  needs() { return []; },
  compute(s, c) {
    if (!c.market.funding) return { plots: {}, note: 'Funding gibt es nur für Perps' };
    const pts = c.ext('funding');
    if (!pts) return { plots: {}, note: 'lädt …' };
    const vals = stepToBars(c.bars, c.tf, pts.points, (p) => p.v * 100);
    if (pts.live && Number.isFinite(pts.live.rate) && vals.length) vals[vals.length - 1] = pts.live.rate * 100;
    return { plots: { f: { values: vals, colors: Array.from(vals, x => x >= 0 ? rgba(s.pos, 0.7) : rgba(s.neg, 0.7)) } } };
  },
};

/** Punkte (t, v) als Treppe auf Kerzen legen: Wert des letzten Punkts bis Kerzenende. */
function stepToBars(bars, tf, points, get) {
  const n = bars.length;
  const out = new Float64Array(n).fill(NaN);
  if (!points || !points.length) return out;
  let j = -1;
  const step = tfMs(tf === '1M' ? '1W' : tf);
  for (let i = 0; i < n; i++) {
    const end = bars[i].t + step;
    while (j + 1 < points.length && points[j + 1].t < end) j++;
    if (j >= 0 && bars[i].t - points[j].t < Math.max(step * 3, 9 * 3600e3)) out[i] = get(points[j], bars[i]);
  }
  return out;
}

const bigtrades = {
  type: 'bigtrades', name: 'Große Trades (Blasen)', cat: 'of', pane: 'main',
  desc: 'Große Marktorders als Blasen am Preis, live ab Seitenstart. Größe nach USD-Wert.',
  defaults: { minUsd: 0, maxBubbles: 400, scale: 1, buy: '#26a69a', sell: '#ef5350', opacity: 0.45 },
  schema: [
    { k: 'minUsd', label: 'Mindestgröße USD (0 = automatisch)', t: 'int', min: 0, max: 100000000 },
    { k: 'maxBubbles', label: 'Max. Blasen', t: 'int', min: 10, max: 5000 },
    { k: 'scale', label: 'Größe', t: 'num', min: 0.2, max: 4, step: 0.1 },
    { k: 'buy', label: 'Farbe Kauf', t: 'color' }, { k: 'sell', label: 'Farbe Verkauf', t: 'color' },
    { k: 'opacity', label: 'Deckkraft', t: 'num', min: 0.05, max: 1, step: 0.05 },
  ],
  title(s) { return 'Große Trades ≥ ' + (s.minUsd > 0 ? nf(0).format(s.minUsd) + ' $' : 'auto'); },
  needs() { return []; },
  compute(s, c) { return { list: c.bigTrades(s.minUsd).slice(-s.maxBubbles) }; },
  draw(s, d, sc) {
    for (const x of d.list) {
      const r = Math.max(2.5, Math.min(28, Math.sqrt(x.usd / 25000) * 2.2 * s.scale));
      const col = x.buy ? s.buy : s.sell;
      sc.bubble({ t: x.t, p: x.p, r, fill: rgba(col, s.opacity), stroke: rgba(col, 0.9) });
    }
  },
};

const liq = {
  type: 'liq', name: 'Liquidationen', cat: 'of', pane: 'main',
  desc: 'Liquidationen live (Binance Perps). Rot = Longs liquidiert, Grün = Shorts liquidiert.',
  defaults: { minUsd: 10000, long: '#ef5350', short: '#26a69a' },
  schema: [{ k: 'minUsd', label: 'Mindestgröße USD', t: 'int', min: 0, max: 100000000 }, { k: 'long', label: 'Farbe Long-Liq.', t: 'color' }, { k: 'short', label: 'Farbe Short-Liq.', t: 'color' }],
  title(s) { return 'Liquidationen ≥ ' + nf(0).format(s.minUsd) + ' $'; },
  needs() { return []; },
  compute(s, c) { return { list: c.liqs().filter(x => x.usd >= s.minUsd), note: c.market.liq ? null : 'nur Binance Perp' }; },
  draw(s, d, sc) {
    for (const x of d.list) sc.mark({ t: x.t, p: x.p, shape: 'diamond', size: Math.max(3, Math.min(10, Math.sqrt(x.usd / 20000) * 3)), color: x.side === 'long' ? s.long : s.short });
  },
};

// ============================================================================ Standard
const ma = {
  type: 'ma', name: 'Gleitender Durchschnitt', cat: 'std', pane: 'main', multi: true,
  desc: 'EMA oder SMA.',
  defaults: { kind: 'ema', length: 200, source: 'close', color: '#2962ff', width: 1 },
  schema: [
    { k: 'kind', label: 'Typ', t: 'select', opts: [['ema', 'EMA'], ['sma', 'SMA']] },
    { k: 'length', label: 'Länge', t: 'int', min: 1, max: 2000 },
    { k: 'source', label: 'Quelle', t: 'select', opts: [['close', 'Close'], ...SRC.filter(x => x[0] !== 'close')] },
    { k: 'color', label: 'Farbe', t: 'color' }, { k: 'width', label: 'Linienbreite', t: 'int', min: 1, max: 5 },
  ],
  title(s) { return `${s.kind.toUpperCase()} ${s.length} ${s.source}`; },
  needs() { return []; },
  compute(s, c) { return { v: maLine(c.bars, { length: s.length, type: s.kind, source: s.source }) }; },
  values(s, d, i) { return [{ v: d.v[i], color: s.color }]; },
  draw(s, d, sc) { sc.line(d.v, { color: s.color, width: s.width }); },
};

const bb = {
  type: 'bb', name: 'Bollinger Bänder', cat: 'std', pane: 'main', multi: true,
  desc: 'SMA ± k × Standardabweichung.',
  defaults: { length: 20, mult: 2, source: 'close', color: '#2962ff', fill: 0.06 },
  schema: [
    { k: 'length', label: 'Länge', t: 'int', min: 2, max: 500 }, { k: 'mult', label: 'Multiplikator', t: 'num', min: 0.1, max: 10, step: 0.1 },
    { k: 'source', label: 'Quelle', t: 'select', opts: [['close', 'Close'], ...SRC.filter(x => x[0] !== 'close')] },
    { k: 'color', label: 'Farbe', t: 'color' }, { k: 'fill', label: 'Füllung (Deckkraft)', t: 'num', min: 0, max: 1, step: 0.02 },
  ],
  title(s) { return `BB ${s.length} ${n2(s.mult)}`; },
  needs() { return []; },
  compute(s, c) { return bollinger(c.bars, s); },
  values(s, d, i) { return [{ v: d.mid[i], color: s.color }, { v: d.up[i], color: s.color }, { v: d.dn[i], color: s.color }]; },
  draw(s, d, sc) {
    if (s.fill > 0) sc.fill(d.up, d.dn, { color: rgba(s.color, s.fill) });
    sc.line(d.mid, { color: rgba(s.color, 0.8) });
    sc.line(d.up, { color: s.color }); sc.line(d.dn, { color: s.color });
  },
};

const rsiInd = {
  type: 'rsi', name: 'RSI', cat: 'std', pane: 'own', multi: true,
  desc: 'Relative Strength Index.',
  defaults: { length: 14, color: '#7e57c2', ob: 70, os: 30 },
  schema: [{ k: 'length', label: 'Länge', t: 'int', min: 2, max: 200 }, { k: 'ob', label: 'Überkauft', t: 'int', min: 50, max: 100 }, { k: 'os', label: 'Überverkauft', t: 'int', min: 0, max: 50 }, { k: 'color', label: 'Farbe', t: 'color' }],
  plots: [{ key: 'rsi', kind: 'line', title: 'RSI', width: 1 }],
  hlines(s) { return [s.ob, 50, s.os]; },
  title(s) { return `RSI ${s.length}`; },
  needs() { return []; },
  compute(s, c) { return { plots: { rsi: { values: rsi(c.bars, s), color: s.color } } }; },
};

const macdInd = {
  type: 'macd', name: 'MACD', cat: 'std', pane: 'own', multi: true,
  desc: 'Moving Average Convergence Divergence.',
  defaults: { fast: 12, slow: 26, signal: 9 },
  schema: [{ k: 'fast', label: 'Schnell', t: 'int', min: 1, max: 200 }, { k: 'slow', label: 'Langsam', t: 'int', min: 1, max: 400 }, { k: 'signal', label: 'Signal', t: 'int', min: 1, max: 200 }],
  plots: [{ key: 'hist', kind: 'hist', title: 'Hist' }, { key: 'line', kind: 'line', title: 'MACD', width: 1 }, { key: 'sig', kind: 'line', title: 'Signal', width: 1 }],
  title(s) { return `MACD ${s.fast} ${s.slow} ${s.signal}`; },
  needs() { return []; },
  compute(s, c) {
    const r = macd(c.bars, s);
    return { plots: { hist: { values: r.hist, colors: Array.from(r.hist, x => x >= 0 ? rgba('#26a69a', 0.6) : rgba('#ef5350', 0.6)) }, line: { values: r.line, color: '#2962ff' }, sig: { values: r.sig, color: '#ff6d00' } } };
  },
};

const atrInd = {
  type: 'atr', name: 'ATR', cat: 'std', pane: 'own', multi: true,
  desc: 'Average True Range.',
  defaults: { length: 14, color: '#b71c1c' },
  schema: [{ k: 'length', label: 'Länge', t: 'int', min: 1, max: 500 }, { k: 'color', label: 'Farbe', t: 'color' }],
  plots: [{ key: 'atr', kind: 'line', title: 'ATR', width: 1 }],
  title(s) { return `ATR ${s.length}`; },
  needs() { return []; },
  compute(s, c) { return { plots: { atr: { values: atr(c.bars, s), color: s.color } } }; },
};

export const REGISTRY = [vwap, rvwap, hvb, htfvwap, va, naked, sfpInd, inst, volcandles, volume, cvdInd, oiInd, fundingInd, bigtrades, liq, ma, bb, rsiInd, macdInd, atrInd];
export const TYPES = Object.fromEntries(REGISTRY.map(t => [t.type, t]));
export const CATEGORIES = [['tqi', 'Meine Indikatoren (TQI)'], ['of', 'Orderflow'], ['std', 'Standard']];
