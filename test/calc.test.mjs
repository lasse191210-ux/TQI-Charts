// Rechentests: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { genMinuteBars, aggregateTo } from './synth.mjs';
import { anchoredVwap, rollingVwap, autoResolution, projectToChart, srcOf } from '../js/calc/vwap.js';
import { detectHvb, hvbProfile } from '../js/calc/hvb.js';
import { valueArea, buildDayProfiles, findSingles, findUfa, firstTouch, mergeProfiles, profileLevels, autoRowSize } from '../js/calc/profile.js';
import { sfp, institutionalLevels, volumeCandles } from '../js/calc/levels.js';
import { DAY, MIN, HOUR, weekStart, floorTf, nextTf, periodStart } from '../js/util.js';

const T0 = Date.UTC(2026, 9, 1);
const m1 = genMinuteBars({ start: T0, end: T0 + 40 * DAY, seed: 3 });
const m15 = aggregateTo(m1, 15 * MIN);
const h1 = aggregateTo(m1, HOUR);
const m30 = aggregateTo(m1, 30 * MIN);
const d1 = aggregateTo(m1, DAY);

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test('Auto-Auflösung wie Pine-Original', () => {
  assert.equal(autoResolution(1), '3m');
  assert.equal(autoResolution(7), '15m');
  assert.equal(autoResolution(14), '30m');
  assert.equal(autoResolution(30), '1h');
  assert.equal(autoResolution(90), '4h');
  assert.equal(autoResolution(365), '12h');
});

test('Tages-VWAP und σ gegen Brute Force', () => {
  const r = anchoredVwap(m15, { period: 'day' });
  for (const i of [100, 500, 1234, m15.length - 1]) {
    const ps = periodStart(m15[i].t, 'day');
    let s0 = 0, s1 = 0;
    const pts = [];
    for (let k = 0; k <= i; k++) if (m15[k].t >= ps) { const p = srcOf(m15[k], 'ohlc4'); s0 += m15[k].v; s1 += p * m15[k].v; pts.push([p, m15[k].v]); }
    const vw = s1 / s0;
    const varr = pts.reduce((a, [p, v]) => a + v * (p - vw) ** 2, 0) / s0;
    assert.ok(close(r.vwap[i], vw, 1e-9), `vwap ${i}`);
    assert.ok(close(r.sd[i], Math.sqrt(varr), 1e-6), `sd ${i}`);
  }
  assert.equal(r.isNew[96], 1);
  assert.equal(r.prev.length >= 30, true);
});

test('Erste, angeschnittene Periode wird nicht gezeigt', () => {
  const cut = m15.slice(10);
  const r = anchoredVwap(cut, { period: 'day' });
  assert.ok(Number.isNaN(r.vwap[0]));
  const nextDay = cut.findIndex(b => b.t === periodStart(cut[0].t, 'day') + DAY);
  assert.ok(Number.isFinite(r.vwap[nextDay]));
});

test('Rolling VWAP 7D auf 15m gegen Brute Force', () => {
  const win = 7 * DAY;
  const r = rollingVwap(m15, win, 'ohlc4', 15 * MIN);
  for (const i of [700, 1500, m15.length - 1]) {
    let s0 = 0, s1 = 0, s2 = 0;
    for (let k = 0; k <= i; k++) {
      if (m15[i].t - m15[k].t >= win) continue;
      const p = srcOf(m15[k], 'ohlc4');
      s0 += m15[k].v; s1 += p * m15[k].v; s2 += m15[k].v * p * p;
    }
    const vw = s1 / s0;
    assert.ok(close(r.vwap[i], vw, 1e-9));
    assert.ok(close(r.sd[i], Math.sqrt(s2 / s0 - vw * vw), 1e-5));
    assert.equal(r.full[i], 1);
  }
  assert.equal(r.full[10], 0);
  // Fenster enthält genau 672 Kerzen
  let cnt = 0; const i = m15.length - 1;
  for (let k = 0; k <= i; k++) if (m15[i].t - m15[k].t < win) cnt++;
  assert.equal(cnt, 672);
});

test('Projektion: gröbere Auflösung als Treppe (lookahead_off)', () => {
  const h4 = aggregateTo(m1, 4 * HOUR);
  const vals = { vwap: Float64Array.from(h4.map((_, k) => k)), sd: new Float64Array(h4.length), full: new Uint8Array(h4.length).fill(1) };
  const chart = m15.slice(0, 200);
  const p = projectToChart(chart, '15m', h4, '4h', vals, { live: false });
  // Kerze 00:00–00:15: noch keine 4h-Kerze fertig → NaN; 03:45–04:00 → Wert der 4h-Kerze 0
  assert.ok(Number.isNaN(p.vwap[0]));
  assert.equal(p.vwap[15], 0);
  assert.equal(p.vwap[16], 0);
  assert.equal(p.vwap[31], 1);
});

test('Projektion: feinere Auflösung = letzter Wert innerhalb der Chart-Kerze', () => {
  const vals = { vwap: Float64Array.from(m15.map((_, k) => k)), sd: new Float64Array(m15.length), full: new Uint8Array(m15.length).fill(1) };
  const p = projectToChart(h1.slice(0, 10), '1h', m15, '15m', vals, { live: false });
  assert.equal(p.vwap[0], 3);
  assert.equal(p.vwap[5], 23);
});

test('High Volume Bars: Z-Score inkl. aktueller Kerze', () => {
  const hv = detectHvb(m15, { length: 144, threshold: 2.5 });
  assert.ok(hv.length > 0, 'es gibt HVBs');
  const x = hv[hv.length - 1];
  const win = m15.slice(x.i - 143, x.i + 1).map(b => b.v);
  const mean = win.reduce((a, b) => a + b, 0) / 144;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / 144);
  assert.ok(close(x.z, (m15[x.i].v - mean) / sd, 1e-6));
  // Profil aus 1m-Kerzen
  const fine = m1.filter(b => b.t >= x.t && b.t < x.t + 15 * MIN);
  const pr = hvbProfile(fine, x.l, x.h, { rows: 100 });
  assert.ok(pr.val <= pr.poc && pr.poc <= pr.vah && pr.val >= x.l - 1e-9 && pr.vah <= x.h + 1e-9);
  assert.ok(Number.isFinite(pr.delta));
});

test('Value Area: ATAS-Methode (2 Zeilen)', () => {
  const v = [1, 2, 3, 10, 4, 2, 1];
  const va = valueArea(v, 70, 2);
  assert.equal(va.poc, 3);
  assert.ok(va.lo <= 3 && va.hi >= 3);
  const got = v.slice(va.lo, va.hi + 1).reduce((a, b) => a + b, 0);
  assert.ok(got / 23 >= 0.7);
  const va1 = valueArea([5, 5, 5, 5], 50, 1);
  assert.ok(va1.hi - va1.lo + 1 === 2);
});

test('TPO-Tagesprofile, Singles, Tails, UFA', () => {
  const rs = autoRowSize(d1);
  assert.ok(rs > 0);
  const days = buildDayProfiles(m30, { rowSize: rs, now: T0 + 40 * DAY });
  assert.equal(days.length, 40);
  const d = days[5];
  // jede 30m-Kerze zählt als eine Periode
  assert.equal(d.nPeriods, 48);
  const sumTpo = d.tpo.reduce((a, b) => a + b, 0);
  assert.ok(sumTpo >= 48);
  const lv = profileLevels(d, { basis: 'vol' });
  assert.ok(lv.val <= lv.poc && lv.poc <= lv.vah);
  // gebauter Tag mit Tail und Single Print
  const t = T0;
  const bars = [
    { t, o: 100, h: 110, l: 100, c: 109, v: 10 },               // Buying Tail 100–104 (nur diese Periode)
    { t: t + 30 * MIN, o: 105, h: 112, l: 105, c: 111, v: 10 },
    { t: t + 60 * MIN, o: 105, h: 112, l: 105, c: 106, v: 10 },
    { t: t + 90 * MIN, o: 116, h: 125, l: 116, c: 120, v: 10 }, // Single Print 113–115 fehlt → Lücke? nein: 112.x..116
    { t: t + 120 * MIN, o: 116, h: 125, l: 116, c: 124, v: 10 },
    { t: t + 150 * MIN, o: 113, h: 130, l: 113, c: 125, v: 10 },// deckt 113..130, Selling Tail 126–130
  ];
  const [day] = buildDayProfiles(bars, { rowSize: 1, now: t + 2 * DAY });
  const s = findSingles(day, { minSingle: 3, minTail: 3 });
  assert.deepEqual(s.buyTail && [s.buyTail.bottom, s.buyTail.top], [100, 105]);
  assert.deepEqual(s.sellTail && [s.sellTail.bottom, s.sellTail.top], [126, 131]);
  assert.equal(s.singles.length, 1);
  assert.deepEqual([s.singles[0].bottom, s.singles[0].top], [113, 116]);
  const u = findUfa(day, { minTpos: 2 });
  assert.equal(u.high, null);
  assert.equal(u.low, null);
  const merged = mergeProfiles([days[1], days[2]]);
  assert.ok(merged.tpo.length >= Math.max(days[1].tpo.length, days[2].tpo.length));
});

test('Erste Berührung', () => {
  const bars = [{ t: 0, h: 10, l: 9 }, { t: 1, h: 12, l: 11 }, { t: 2, h: 15, l: 13 }];
  assert.equal(firstTouch(bars, 0, 14, 14), 2);
  assert.equal(firstTouch(bars, 0, 20, 20), null);
  assert.equal(firstTouch(bars, 0, 11.5, 14.5, { mode: 'fill' }), 2);
});

test('SFP am Swing-Hoch', () => {
  const mk = (h, l, c) => ({ t: 0, o: c, h, l, c, v: 1 });
  const bars = [];
  for (let i = 0; i < 6; i++) bars.push(mk(100 + i, 90 + i, 95 + i));
  bars.push(mk(120, 110, 115)); // Swing-Hoch (Index 6)
  for (let i = 0; i < 6; i++) bars.push(mk(110 - i, 100 - i, 105 - i));
  bars.push(mk(121, 108, 112)); // über 120, Schluss darunter → bearish SFP
  bars.push(mk(110, 100, 105));
  bars.forEach((b, i) => { b.t = i * 60000; });
  const r = sfp(bars, { strength: 5, minDist: 0 });
  assert.equal(r.length, 1);
  assert.equal(r[0].type, 'bear');
  assert.equal(r[0].price, 120);
});

test('Institutionelle Level', () => {
  const now = T0 + 39 * DAY + 5 * HOUR;
  const lv = institutionalLevels(d1, now);
  const get = (k) => lv.find(x => x.key === k);
  assert.equal(get('do').price, d1[39].o);
  const ws = weekStart(now);
  assert.equal(get('wo').price, d1.find(b => b.t === ws).o);
  assert.ok(get('pwH').price >= get('pwL').price);
});

test('Volumen-Kerzen', () => {
  const r = volumeCandles(m15, { lookback: 200, sd: 3, sdExtreme: 5 });
  assert.ok(r.length > 0);
});

test('Zeitraster', () => {
  const t = Date.UTC(2026, 10, 26, 7, 21);
  assert.equal(floorTf(t, '15m'), Date.UTC(2026, 10, 26, 7, 15));
  assert.equal(nextTf(t, '1M'), Date.UTC(2026, 11, 1));
  assert.equal(floorTf(t, '1W'), Date.UTC(2026, 10, 23));
});

// ---------------------------------------------------------------- 1.1: Sessions, TPO zusammenfügen/teilen
import { Sessions } from '../js/util.js';
import { buildTpoSessions } from '../js/render/tpo.js';

test('Sessions: eigene Zeiten (Berlin, Sommer/Winter) und CME ohne Wochenende', () => {
  const c = new Sessions({ mode: 'custom', start: '02:00', end: '22:00', tz: 'Europe/Berlin' });
  assert.deepEqual(c.of(Date.UTC(2026, 10, 26, 12)).slice(0, 2), [Date.UTC(2026, 10, 26, 1), Date.UTC(2026, 10, 26, 21)]);
  assert.deepEqual(c.of(Date.UTC(2026, 6, 1, 12)).slice(0, 2), [Date.UTC(2026, 6, 1, 0), Date.UTC(2026, 6, 1, 20)]);
  assert.equal(c.of(Date.UTC(2026, 10, 26, 22)), null);
  const m = new Sessions({ mode: 'cme' });
  assert.deepEqual(m.of(Date.UTC(2026, 10, 27, 10)).slice(0, 2), [Date.UTC(2026, 10, 26, 23), Date.UTC(2026, 10, 27, 22)]);
  assert.equal(m.of(Date.UTC(2026, 10, 28, 12)), null); // Samstag
  const u = new Sessions({ mode: 'utc' });
  assert.deepEqual(u.of(Date.UTC(2026, 10, 26, 16, 26)).slice(0, 2), [Date.UTC(2026, 10, 26), Date.UTC(2026, 10, 27)]);
});

test('Tagesprofile nur aus Kerzen in der Session', () => {
  const sess = new Sessions({ mode: 'custom', start: '02:00', end: '22:00', tz: 'Europe/Berlin' });
  const days = buildDayProfiles(m30, { rowSize: 10, sess, now: T0 + 40 * DAY });
  const d = days[5];
  // 20 Stunden = 40 Perioden à 30 Min.
  assert.equal(d.nPeriods, 40);
  assert.equal(d.end - d.start, 20 * HOUR);
});

test('TPO: Profile zusammenfügen und teilen', () => {
  const blockMs = 30 * MIN;
  const base = buildTpoSessions(m30, { rowSize: 10, blockMs });
  const a = base[3], b = base[4];
  const merged = buildTpoSessions(m30, { rowSize: 10, blockMs, merges: [[a.start, b.end]] });
  assert.equal(merged.length, base.length - 1);
  const mm = merged.find(s => s.start === a.start);
  assert.ok(mm.merged);
  const cnt = (s) => s.rows.reduce((x, r) => x + r.length, 0);
  assert.equal(cnt(mm), cnt(a) + cnt(b));
  const sp = a.start + 10 * HOUR;
  const split = buildTpoSessions(m30, { rowSize: 10, blockMs, splits: [sp] });
  assert.equal(split.length, base.length + 1);
  const p1 = split.find(s => s.start === a.start), p2 = split.find(s => s.start === sp);
  assert.equal(cnt(p1) + cnt(p2), cnt(a));
  assert.equal(p1.end, sp);
});
