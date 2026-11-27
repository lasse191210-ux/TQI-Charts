# Tests für Version 1.4: High Volume Bars wie „High Volume Bars w3v“ in TradingView (Kerzen blau/rosa gefärbt,
# POC türkis gepunktet bis zur Berührung), Volumen-Kerzen färben, VWAP-Vortagsboxen (VAH / VWAP / VAL),
# Zeichnungen: innen/außen wie TradingView und Vorlagen (Standard für neue Zeichnungen).
# Aufruf: python3 test/v14.py  → Screenshots in test/out/v14_*.png
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
            page.screenshot(path=os.path.join(OUT, 'v14_' + name + '.png'))
        url = 'http://127.0.0.1:8765/index.html'

        # ================================================================ 1) alter Stand → High Volume Bars wie TradingView
        old = {'template': 'bild', 'tplV': 2, 'colorsV': 2, 'btV': 3, 'paintV': 0, 'theme': 'light', 'tf': '15m', 'indicators': [
            {'uid': 'h1', 'type': 'hvb', 'visible': True, 's': {'tfMin': 15, 'length': 144, 'threshold': 2.5, 'pocColor': '#e91e63', 'vaColor': '#787b86', 'vaOpacity': 0.24, 'mark': True, 'delta': False, 'pocLife': 200, 'vaLife': 200}},
            {'uid': 'v1', 'type': 'volcandles', 'visible': True, 's': {'lookback': 200, 'sd': 3, 'sdExtreme': 5, 'color': '#787b86', 'extremeColor': '#131722', 'opacity': 0.3}},
            {'uid': 'w1', 'type': 'vwap', 'visible': True, 's': {'period': 'day'}}]}
        page = new_page({'width': 1440, 'height': 860}, storage=old)
        page.wait_for_timeout(4000)
        R['hvb_settings'] = page.evaluate("(s => ({ tfMin: s.tfMin, bull: s.bull, bear: s.bear, pocColor: s.pocColor, pocStyle: s.pocStyle, vaColor: s.vaColor, deltaShow: s.deltaShow, removeOn: s.removeOn, touchLeft: s.touchLeft, oldKeys: ['vaOpacity', 'delta', 'markColor'].filter(k => k in s) }))(tqi.state.indicators.find(i => i.type === 'hvb').s)")
        R['volcandles_settings'] = page.evaluate("(s => ({ color: s.color, extremeColor: s.extremeColor, opacity: s.opacity }))(tqi.state.indicators.find(i => i.type === 'volcandles').s)")
        # Kerzen gefärbt: Körper in Blau (steigend) / Rosa (fallend), Rand und Docht unverändert; HVB vor Volumen-Kerzen
        R['hvb_paint'] = page.evaluate("""() => {
          const ind = tqi.state.indicators.find(i => i.type === 'hvb'), d = tqi.data.get(ind.uid);
          const data = tqi.series.data(), byT = new Map(data.map(x => [x.time * 1000, x]));
          const vc = tqi.data.get(tqi.state.indicators.find(i => i.type === 'volcandles').uid);
          const hvbT = new Set(d.list.map(h => h.t));
          let ok = 0, bad = [], border = 0;
          for (const h of d.list) {
            const x = byT.get(h.t);
            const want = h.bull ? 'rgba(144,191,249,1)' : 'rgba(250,161,164,1)';
            const got = x?.color;
            if (got && (got === ind.s.bull || got === want || got.replace(/\\s/g, '') === want)) ok++; else bad.push([h.t, h.bull, got]);
            if (x && (x.borderColor || x.wickColor)) border++;
          }
          const vcOnly = vc.list.filter(x => !hvbT.has(x.t));
          const vcPainted = vcOnly.filter(x => byT.get(x.t)?.color).length;
          return { hvbs: d.list.length, ok, bad: bad.slice(0, 3), borderOrWickChanged: border, volcandlesOnly: vcOnly.length, volcandlesPainted: vcPainted, tf: d.tf };
        }""")
        # Level: enden bei der ersten Berührung, nachdem der Preis das Level verlassen hat; unberührte verschwinden nach 200 Kerzen
        R['hvb_levels'] = page.evaluate("""() => {
          const ind = tqi.state.indicators.find(i => i.type === 'hvb'), d = tqi.data.get(ind.uid), b = tqi.bars;
          let checked = 0, wrong = 0, open = 0, gone = 0;
          for (const h of d.list) {
            if (!h.prof) continue;
            const poc = h.prof.poc;
            let left = false, touch = null;
            for (let j = h.i + 1; j < b.length; j++) { const inside = b[j].l <= poc && b[j].h >= poc; if (!left) { if (!inside) left = true; continue; } if (inside) { touch = b[j].t; break; } }
            checked++;
            if ((h.poc.end ?? null) !== touch) wrong++;
            if (h.poc.end == null) { if (h.poc.gone) gone++; else open++; }
          }
          return { checked, wrong, openToRight: open, removedUntouched: gone };
        }""")
        # VWAP: Box des Vortags über jedem Tag (VAL bis VAH, gepunktet VAH / VWAP / VAL)
        R['vwap_boxes'] = page.evaluate("""() => {
          const ind = tqi.state.indicators.find(i => i.type === 'vwap'), d = tqi.data.get(ind.uid);
          const sc = tqi.overlay.scene;
          const prev = d.prev;
          const boxes = sc.boxes.filter(x => prev.some(p => Math.abs(x.top - (p.vwap + p.sd)) < 1e-6 && Math.abs(x.bottom - (p.vwap - p.sd)) < 1e-6));
          const dotted = sc.levels.filter(l => l.dash === 'dotted' && prev.some(p => Math.abs(l.p - p.vwap) < 1e-6)).length;
          const last = boxes[boxes.length - 1];
          return { days: prev.length, boxes: boxes.length, dottedVwapLines: dotted, lastFrom: last && new Date(last.from).toISOString(), lastTo: last && new Date(last.to).toISOString(), pbox: ind.s.pbox };
        }""")
        page.evaluate("tqi.chart.timeScale().setVisibleLogicalRange({ from: tqi.bars.length - 160, to: tqi.bars.length + 5 })")
        shot(page, '01_hvb_wie_tradingview', 800)
        uid = page.evaluate("tqi.state.indicators.find(i => i.type === 'hvb').uid")
        page.evaluate(f"tqi.ui.openIndicatorSettings('{uid}')"); page.wait_for_timeout(400)
        R['hvb_dialog'] = page.evaluate("document.querySelector('#modal .mdlg')?.innerText.replace(/\\s+/g, ' ').slice(0, 500)")
        shot(page, '02_hvb_einstellungen')
        page.evaluate("tqi.ui.closeTopModal()")

        # ================================================================ 2) Zeichnungen: innen / außen und Vorlagen
        box = page.locator('#chart').bounding_box()
        page.evaluate("tqi.drawings.setTool('rect')")
        page.mouse.click(box['x'] + 300, box['y'] + 250); page.mouse.move(box['x'] + 500, box['y'] + 380); page.mouse.click(box['x'] + 500, box['y'] + 380)
        page.wait_for_timeout(200)
        page.evaluate("tqi.ui.openDrawingSettings(tqi.drawings.items.at(-1))"); page.wait_for_timeout(300)
        R['rect_dialog'] = page.evaluate("document.querySelector('#modal .mdlg')?.innerText.replace(/\\s+/g, ' ').slice(0, 300)")
        shot(page, '03_rechteck_einstellungen')
        # außen: gestrichelt, Breite 1; innen: eigene Farbe mit Deckkraft (wie Farbwähler)
        page.select_option('#modal [data-k=dash]', 'dashed')
        page.click('#modal [data-w="1"]')
        page.evaluate("""() => { const it = tqi.drawings.items.at(-1); }""")
        # Hintergrund-Farbe über den Farbwähler: Palette + Deckkraft
        page.click('#modal [data-sw="bg"]'); page.wait_for_timeout(200)
        page.click('.cpick .cp-grid [data-c]:nth-child(20)')
        page.evaluate("""() => { const r = document.querySelector('.cpick .cp-op input'); r.value = 35; r.dispatchEvent(new Event('input', { bubbles: true })); }""")
        page.keyboard.press('Escape'); page.wait_for_timeout(100)
        page.click('#modal #dsOk'); page.wait_for_timeout(200)
        R['rect_style'] = page.evaluate("(it => ({ color: it.color, width: it.width, dash: it.dash, bgOn: it.bgOn, bg: it.bg }))(tqi.drawings.items.at(-1))")
        # Als Standard speichern → neue Rechtecke sehen genauso aus
        page.evaluate("tqi.ui.openDrawingSettings(tqi.drawings.items.at(-1))"); page.wait_for_timeout(300)
        page.click('#dsTpl'); page.wait_for_timeout(200)
        R['tpl_menu'] = page.evaluate("[...document.querySelectorAll('.dd-menu button')].map(b => b.innerText.trim())")
        shot(page, '04_vorlage_menue')
        page.click('.dd-menu [data-v=def]'); page.wait_for_timeout(200)
        page.click('#modal #dsOk'); page.wait_for_timeout(200)
        page.evaluate("tqi.drawings.setTool('rect')")
        page.mouse.click(box['x'] + 650, box['y'] + 250); page.mouse.move(box['x'] + 800, box['y'] + 350); page.mouse.click(box['x'] + 800, box['y'] + 350)
        page.wait_for_timeout(200)
        R['new_rect_uses_default'] = page.evaluate("(([a, b]) => ['color', 'width', 'dash', 'bgOn', 'bg'].every(k => JSON.stringify(a[k]) === JSON.stringify(b[k])))(tqi.drawings.items.slice(-2))")
        shot(page, '05_zwei_rechtecke', 300)
        # Vorlage speichern, Stil ändern, Vorlage anwenden, Werkseinstellung
        page.once('dialog', lambda dlg: dlg.accept('Meine Box'))
        page.evaluate("tqi.ui.openDrawingSettings(tqi.drawings.items.at(-1))"); page.wait_for_timeout(200)
        page.click('#dsTpl'); page.click('.dd-menu [data-v=save]'); page.wait_for_timeout(200)
        page.select_option('#modal [data-k=dash]', 'solid'); page.wait_for_timeout(100)
        page.click('#dsTpl'); page.click('.dd-menu [data-v=use]'); page.wait_for_timeout(200)
        R['tpl_applied'] = page.evaluate("({ dash: tqi.drawings.items.at(-1).dash, tpls: (tqi.state.drawTpls.rect || []).map(t => t.name) })")
        page.click('#dsTpl'); page.click('.dd-menu [data-v=factory]'); page.wait_for_timeout(200)
        R['factory'] = page.evaluate("(it => ({ dash: it.dash, width: it.width, color: it.color, default: !!tqi.state.drawDefaults.rect }))(tqi.drawings.items.at(-1))")
        page.click('#modal #dsOk')
        # Text mit Hintergrund und Rahmen
        page.once('dialog', lambda dlg: dlg.accept('Absorption'))
        page.evaluate("tqi.drawings.setTool('text')")
        page.mouse.click(box['x'] + 350, box['y'] + 500); page.wait_for_timeout(200)
        page.evaluate("tqi.ui.openDrawingSettings(tqi.drawings.items.at(-1))"); page.wait_for_timeout(200)
        page.click('#modal label.chk:has([data-k=bgOn]) i'); page.click('#modal label.chk:has([data-k=bdOn]) i'); page.wait_for_timeout(100)
        page.click('#modal #dsOk')
        R['text_style'] = page.evaluate("(it => ({ bgOn: it.bgOn, bdOn: it.bdOn, bg: it.bg, bd: it.bd }))(tqi.drawings.items.at(-1))")
        shot(page, '06_text_hintergrund', 300)
        page.context.close()

        # ================================================================ 3) Handy
        m = new_page({'width': 390, 'height': 844}, mobile=True)
        m.wait_for_timeout(3000)
        m.evaluate("tqi.chart.timeScale().setVisibleLogicalRange({ from: tqi.bars.length - 60, to: tqi.bars.length + 3 })")
        shot(m, '10_handy_hvb', 800)
        m.context.close()
        browser.close()
    srv.shutdown()
    errs = [e for e in errors if 'favicon' not in e and 'manifest' not in e]
    print(json.dumps(R, ensure_ascii=False, indent=1, default=str))
    print('\nKonsole:', len(errs))
    for e in errs[:30]: print('  ', e[:300])

if __name__ == '__main__':
    main()
