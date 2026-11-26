# Tests für Version 1.3: Big Trades wie ATAS (Auto-Filter Stark/Mittel/Schwach, jede Order einzeln, graue Kreise,
# Preis-Lage, Min/Max-Volumen) und Rechtsklick-Menüs (Zeichnung → Einstellungen, Chart → Chart-Einstellungen).
# Aufruf: python3 test/v13.py  → Screenshots in test/out/v13_*.png
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e
from e2e import serve, route_handler, FAKE_WS, LAST, OUT
from playwright.sync_api import sync_playwright

def main():
    srv = serve()
    errors = []
    R = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        def new_page(viewport, mobile=False, storage=None):
            ctx = browser.new_context(viewport=viewport, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, locale='de-DE', timezone_id='Europe/Berlin')
            ctx.add_init_script(FAKE_WS.replace('%LAST%', str(LAST)))
            if storage is not None:
                ctx.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('tqi-charts:v1', {json.dumps(json.dumps(storage))}); sessionStorage.setItem('seeded', '1'); }}")
            ctx.route(re.compile(r'https://(fapi|api|data-api)\.binance(\.vision|\.com).*'), route_handler)
            ctx.route(re.compile(r'https://(api\.bybit|www\.okx|api\.exchange\.coinbase)\.com.*'), route_handler)
            ctx.route(re.compile(r'https://www\.bitstamp\.net/.*'), route_handler)
            page = ctx.new_page()
            page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
            page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
            page.goto(url)
            page.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000)
            return page
        def shot(page, name, wait=0):
            if wait: page.wait_for_timeout(wait)
            page.screenshot(path=os.path.join(OUT, 'v13_' + name + '.png'))
        url = 'http://127.0.0.1:8765/index.html'
        BT = "tqi.state.indicators.find(i => i.type === 'bigtrades')"

        # ================================================================ 1) Big Trades: alter Stand → wie ATAS
        old = {'template': 'bild', 'tplV': 2, 'colorsV': 2, 'indicators': [
            {'uid': 'k1', 'type': 'keylevels', 'visible': True, 's': {}},
            {'uid': 'b1', 'type': 'bigtrades', 'visible': True, 's': {'minUsd': 0, 'group': 'bar', 'hours': 4, 'scale': 1, 'text': True, 'unit': 'usd', 'buy': '#787b86', 'sell': '#131722', 'opacity': 0.55}}],
            'theme': 'light', 'tf': '15m'}
        page = new_page({'width': 1440, 'height': 860}, storage=old)
        page.wait_for_function("window.tqi.bt && tqi.bt.list.length > 20", timeout=60000)
        page.wait_for_timeout(4000)
        R['bt_settings_after_migration'] = page.evaluate(f"(s => ({{ auto: s.auto, intensity: s.intensity, group: s.group, text: s.text, buy: s.buy, sell: s.sell, unit: s.unit, btV: tqi.state.btV }}))({BT}.s)")
        # Auto-Schwelle = Faktor × Ø-Volumen pro Minute der letzten 24 Std. (unabhängig nachgerechnet)
        chk = page.evaluate("""() => {
          const b = tqi.bars, last = b[b.length - 1], step = 15 * 60000;
          let v = 0, m = 0;
          for (let i = b.length - 2; i >= 0 && b[i].t >= last.t - 86400000; i--) if (b[i].v > 0) { v += b[i].v; m += 15; }
          const amv = v / m;
          const ind = tqi.state.indicators.find(i => i.type === 'bigtrades');
          const out = { amv, appAmv: tqi.avgMinVol(), px: last.c, n: {}, thr: {}, oldCount: tqi.bt.orders(200000).length, total: tqi.bt.orders(0).length };
          for (const k of ['strong', 'medium', 'weak']) {
            tqi.updateIndicator(ind.uid, { ...ind.s, intensity: k });
            const d = tqi.data.get(ind.uid);
            out.n[k] = d.list.length; out.thr[k] = d.thr;
            out['ok_' + k] = d.list.every(x => x.q >= d.thr) && d.list.length === tqi.bt.orders(0).filter(x => x.q >= d.thr).length;
          }
          tqi.updateIndicator(ind.uid, { ...ind.s, intensity: 'strong' });
          out.note = document.querySelector('#legend').innerText.split('\\n').find(l => l.includes('Big Trades'));
          return out;
        }""")
        chk['factor_strong'] = chk['thr']['strong'] / chk['amv']
        chk['factor_medium'] = chk['thr']['medium'] / chk['amv']
        chk['factor_weak'] = chk['thr']['weak'] / chk['amv']
        R['bt_auto'] = chk
        shot(page, '01_bigtrades_stark', 500)
        # Max-Volumen, feste Größe, Preis-Lage, manuelle Mindestgröße, je Kerze
        R['bt_filters'] = page.evaluate("""() => {
          const ind = tqi.state.indicators.find(i => i.type === 'bigtrades');
          const base = { ...ind.s };
          const run = (patch) => { tqi.updateIndicator(ind.uid, { ...base, ...patch }); return tqi.data.get(ind.uid); };
          const all = tqi.bt.orders(0);
          const r = {};
          let d = run({ auto: false, minVol: 5 }); r.manual5 = { n: d.list.length, want: all.filter(x => x.q >= 5).length, thr: d.thr };
          d = run({ auto: false, minVol: 5, maxVol: 10 }); r.max10 = { n: d.list.length, want: all.filter(x => x.q >= 5 && x.q <= 10).length };
          d = run({ auto: false, minVol: 5, loc: 'hl' });
          const ok = d.list.every(x => { const b = tqi.bars[tqi.drawings && (function(){ let lo = 0, hi = tqi.bars.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tqi.bars[m].t <= x.t) lo = m; else hi = m - 1; } return lo; })()]; const tol = (b.h - b.l) * 0.1; return x.p >= b.h - tol || x.p <= b.l + tol; });
          r.locHL = { n: d.list.length, allAtExtremes: ok };
          d = run({ auto: false, minVol: 5, group: 'bar' }); r.perBar = { n: d.list.length, aligned: d.list.every(x => x.t % (15 * 60000) === 0) };
          tqi.updateIndicator(ind.uid, base);
          return r;
        }""")
        # Größen der Kreise: zwischen Min und Max, feste Größe gleich
        R['bt_sizes'] = page.evaluate("""async () => {
          const { TYPES } = await import('./js/indicators.js');
          const ind = tqi.state.indicators.find(i => i.type === 'bigtrades');
          const d = { ...tqi.data.get(ind.uid) };
          const all = tqi.bt.orders(0);
          d.list = all.filter(x => x.q >= d.thr * 0.5).slice(-200);
          const rad = (s) => { const out = []; TYPES.bigtrades.draw(s, d, { bubble: (o) => out.push(o.r) }); return out; };
          const r1 = rad(ind.s), r2 = rad({ ...ind.s, fixed: true, size: 9 });
          return { n: r1.length, min: Math.min(...r1), max: Math.max(...r1), inRange: r1.every(r => r >= ind.s.minSize && r <= ind.s.maxSize), fixedAll9: r2.every(r => r === 9) };
        }""")
        # Trades-Tape markiert dieselbe Schwelle
        R['tape_big_usd'] = page.evaluate("Math.round(tqi.bigUsd())")
        R['tape_big_expected'] = round(chk['thr']['strong'] * chk['px'])
        # Einstellungen-Dialog: Min. Volumen ist bei Auto-Filter ausgegraut
        uid = page.evaluate(f"{BT}.uid")
        page.evaluate(f"tqi.ui.openIndicatorSettings('{uid}')"); page.wait_for_timeout(500)
        R['bt_dialog'] = page.evaluate("""() => { const m = document.querySelector('#modal .mdlg'); const f = m.querySelector('[data-k=minVol]'); const i = m.querySelector('[data-k=intensity]'); return { minVolDisabled: f?.disabled, intensityDisabled: i?.disabled, text: m.innerText.slice(0, 300) }; }""")
        shot(page, '02_bigtrades_einstellungen')
        page.click('#modal label.chk:has([data-k=auto]) i'); page.wait_for_timeout(300)
        R['bt_dialog_auto_off'] = page.evaluate("""() => { const m = document.querySelector('#modal .mdlg'); return { minVolDisabled: m.querySelector('[data-k=minVol]').disabled, intensityDisabled: m.querySelector('[data-k=intensity]').disabled }; }""")
        page.click('#modal label.chk:has([data-k=auto]) i'); page.wait_for_timeout(300)
        page.evaluate("tqi.ui.closeTopModal()")

        # ================================================================ 2) Rechtsklick-Menüs
        box = page.locator('#chart').bounding_box()
        cx, cy = box['x'] + 520, box['y'] + 330
        page.mouse.click(cx, cy, button='right'); page.wait_for_timeout(300)
        R['chart_menu'] = page.evaluate("[...document.querySelectorAll('.ctxmenu .mi')].map(x => x.innerText.replace(/\\s+/g, ' ').trim())")
        shot(page, '03_rechtsklick_chart')
        price_at = page.evaluate(f"tqi.drawings.series.coordinateToPrice({cy - box['y']})")
        page.click('.ctxmenu .mi:has-text("Horizontale Linie")'); page.wait_for_timeout(300)
        R['hline_from_menu'] = page.evaluate(f"(() => {{ const it = tqi.drawings.items.at(-1); return {{ type: it.type, p: it.pts[0].p, want: {price_at} }}; }})()")
        # Chart-Einstellungen über das Menü
        page.mouse.click(cx, cy + 80, button='right'); page.wait_for_timeout(300)
        page.click('.ctxmenu .mi:has-text("Chart-Einstellungen")'); page.wait_for_timeout(400)
        R['chart_settings_open'] = page.evaluate("document.querySelector('#modal .dlg-head')?.innerText")
        page.evaluate("tqi.ui.closeTopModal()")
        # Trendlinie zeichnen → Rechtsklick → Einstellungen
        page.evaluate("tqi.drawings.setTool('trend')")
        x1, y1, x2, y2 = box['x'] + 300, box['y'] + 520, box['x'] + 700, box['y'] + 420
        page.mouse.click(x1, y1); page.mouse.move(x2, y2); page.mouse.click(x2, y2); page.wait_for_timeout(200)
        n_items = page.evaluate("tqi.drawings.items.length")
        page.mouse.click(box['x'] + 500, box['y'] + 470, button='right'); page.wait_for_timeout(300)
        R['drawing_menu'] = page.evaluate("[...document.querySelectorAll('.ctxmenu .mi')].map(x => x.innerText.replace(/\\s+/g, ' ').trim())")
        shot(page, '04_rechtsklick_zeichnung')
        page.click('.ctxmenu .mi:has-text("Einstellungen")'); page.wait_for_timeout(400)
        R['drawing_dialog'] = page.evaluate("document.querySelector('#modal .mdlg')?.innerText.replace(/\\s+/g, ' ').slice(0, 300)")
        page.select_option('#modal [data-k=dash]', 'dashed')
        page.fill('#modal [data-k=label]', 'Test-Linie'); page.dispatch_event('#modal [data-k=label]', 'change')
        page.click('#modal [data-w="3"]')
        page.click('#modal label.chk:has([data-k=ext]) i')
        shot(page, '05_zeichnung_einstellungen', 300)
        page.click('#dsOk'); page.wait_for_timeout(300)
        R['trend_after'] = page.evaluate("(it => ({ dash: it.dash, label: it.label, width: it.width, ext: it.ext }))(tqi.drawings.items.at(-1))")
        shot(page, '06_trend_gestrichelt')
        # Doppelklick öffnet die Einstellungen direkt
        page.mouse.dblclick(box['x'] + 500, box['y'] + 470); page.wait_for_timeout(400)
        R['dblclick_dialog'] = page.evaluate("document.querySelector('#modal .dlg-head')?.innerText")
        page.evaluate("tqi.ui.closeTopModal()")
        # Klonen + Sperren
        page.mouse.click(box['x'] + 500, box['y'] + 470, button='right'); page.wait_for_timeout(200)
        page.click('.ctxmenu .mi:has-text("Klonen")'); page.wait_for_timeout(200)
        R['clone'] = page.evaluate(f"({{ before: {n_items}, after: tqi.drawings.items.length }})")
        page.mouse.click(box['x'] + 500, box['y'] + 470, button='right'); page.wait_for_timeout(200)
        page.click('.ctxmenu .mi:has-text("Sperren")'); page.wait_for_timeout(200)
        locked = page.evaluate("tqi.drawings.items.filter(x => x.locked).length")
        # Koordinaten: Preis der horizontalen Linie genau eintippen
        page.evaluate("tqi.ui.openDrawingSettings(tqi.drawings.items.find(x => x.type === 'hline'))"); page.wait_for_timeout(300)
        page.fill('#modal [data-k=p0]', '60000'); page.dispatch_event('#modal [data-k=p0]', 'change'); page.wait_for_timeout(200)
        page.click('#dsOk')
        R['locked_and_coords'] = page.evaluate(f"({{ locked: {locked}, hline: tqi.drawings.items.find(x => x.type === 'hline').pts[0].p }})")
        # Legende: Rechtsklick auf eine Indikator-Zeile
        row = page.locator('#legend [data-uid]').nth(1)
        row.click(button='right'); page.wait_for_timeout(300)
        R['legend_menu'] = page.evaluate("[...document.querySelectorAll('.ctxmenu .mi')].map(x => x.innerText.replace(/\\s+/g, ' ').trim())")
        page.keyboard.press('Escape'); page.wait_for_timeout(200)
        R['menu_closed_by_esc'] = page.evaluate("!document.querySelector('.ctxmenu')")
        page.context.close()

        # ================================================================ 3) Handy: Zeichnung antippen → Zahnrad → Einstellungen
        m = new_page({'width': 390, 'height': 844}, mobile=True)
        m.wait_for_timeout(1500)
        m.evaluate("(() => { const b = tqi.bars; tqi.drawings.items.push({ id: 'h1', type: 'hline', pts: [{ t: b.at(-30).t, p: b.at(-1).c }, { t: b.at(-30).t, p: b.at(-1).c }], color: '#7c3aed', width: 2 }); tqi.drawings.sel = tqi.drawings.items.at(-1); tqi.drawings._changed(); })()")
        m.wait_for_timeout(300)
        R['m_selbar_gear'] = m.evaluate("!!document.querySelector('#selbar [data-set]')")
        m.click('#selbar [data-set]'); m.wait_for_timeout(500)
        R['m_dialog'] = m.evaluate("document.querySelector('#modal .dlg-head')?.innerText")
        shot(m, '10_handy_zeichnung_einstellungen')
        m.evaluate("tqi.ui.closeTopModal()")
        shot(m, '11_handy_bigtrades', 1500)
        m.context.close()
        browser.close()
    srv.shutdown()
    errs = [e for e in errors if 'favicon' not in e and 'manifest' not in e]
    print(json.dumps(R, ensure_ascii=False, indent=1, default=str))
    print('\nKonsole:', len(errs))
    for e in errs[:30]: print('  ', e[:300])

if __name__ == '__main__':
    main()
