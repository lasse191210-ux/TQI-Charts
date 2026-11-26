# Funktionstest: viele Bedienschritte nacheinander, danach dürfen keine Fehler in der Konsole stehen.
import json, os, re, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import e2e
from playwright.sync_api import sync_playwright

def main():
    srv = e2e.serve()
    errors = []
    steps = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 1440, 'height': 860}, locale='de-DE', timezone_id='Europe/Berlin', accept_downloads=True)
        ctx.add_init_script(e2e.FAKE_WS.replace('%LAST%', str(e2e.LAST)))
        ctx.route(re.compile(r'https://(fapi|api|data-api)\.binance(\.vision|\.com).*'), e2e.route_handler)
        ctx.route(re.compile(r'https://(api\.bybit|www\.okx|api\.exchange\.coinbase)\.com.*'), e2e.route_handler)
        p = ctx.new_page()
        p.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error',) else None)
        p.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
        p.goto('http://127.0.0.1:8765/index.html')
        p.wait_for_function('window.tqi && tqi.bars.length > 100', timeout=20000)
        p.wait_for_timeout(2000)
        def step(name, js=None, wait=600, fn=None):
            n0 = len(errors)
            t0 = time.time()
            if js: p.evaluate(js)
            if fn: fn()
            p.wait_for_timeout(wait)
            steps.append((name, len(errors) - n0, round(time.time() - t0, 2)))
        for t in ['hollow', 'bars', 'line', 'area', 'ha', 'candles']:
            step('Charttyp ' + t, f"tqi.setChartType('{t}')", 400)
        for tf in ['1m', '5m', '4h', '1D', '1W', '15m']:
            step('Zeiteinheit ' + tf, f"tqi.setTf('{tf}')", 2500)
        step('Vorlage alles', "tqi.applyTemplate('alles')", 4000)
        perf = p.evaluate("""() => { const t0 = performance.now(); for (let i = 0; i < 5; i++) tqi.recompute(); return (performance.now() - t0) / 5; }""")
        steps.append(('Rechenzeit alle Indikatoren (ms)', 0, round(perf, 1)))
        for typ in ['ma', 'bb', 'rsi', 'macd', 'atr', 'htfvwap', 'volcandles']:
            step('Hinzufügen ' + typ, f"tqi.addIndicator('{typ}')", 700)
        # Einstellungen ändern
        step('VWAP Woche', """(() => { const i = tqi.state.indicators.find(x => x.type === 'vwap'); tqi.updateIndicator(i.uid, {...i.s, period: 'week', outer: true, prev: true}); })()""", 2500)
        step('RVWAP 30D + Session', """(() => { const i = tqi.state.indicators.find(x => x.type === 'rvwap'); tqi.updateIndicator(i.uid, {...i.s, w3: true, w5: true, w6: true, sessionAligned: true}); })()""", 3000)
        step('HVB gleichmäßig', """(() => { const i = tqi.state.indicators.find(x => x.type === 'hvb'); tqi.updateIndicator(i.uid, {...i.s, profile: 'even', vaLines: true, delta: true}); })()""", 800)
        step('VA beides + Tage', """(() => { const i = tqi.state.indicators.find(x => x.type === 'va'); tqi.updateIndicator(i.uid, {...i.s, basis: 'both', days: true, pm: true, range: true, poc: true, fill: 0.08}); })()""", 2500)
        step('Naked TPO + Historie', """(() => { const i = tqi.state.indicators.find(x => x.type === 'naked'); tqi.updateIndicator(i.uid, {...i.s, pocBasis: 'both', history: true, zoneEnd: 'fill', touchClose: 'now'}); })()""", 1200)
        step('CVD Reset Tag', """(() => { const i = tqi.state.indicators.find(x => x.type === 'cvd'); tqi.updateIndicator(i.uid, {...i.s, reset: 'day', style: 'hist'}); })()""", 800)
        step('Ausblenden alle', """tqi.state.indicators.forEach(i => tqi.toggleIndicator(i.uid))""", 800)
        step('Einblenden alle', """tqi.state.indicators.forEach(i => tqi.toggleIndicator(i.uid))""", 800)
        p.screenshot(path=os.path.join(e2e.OUT, '30_alles.png'))
        step('Historie nachladen', "tqi.chart.timeScale().setVisibleLogicalRange({from: -50, to: 100})", 3000)
        n_after = p.evaluate('tqi.bars.length')
        steps.append(('Kerzen nach Nachladen', 0, n_after))
        step('Zeitraum 5T', "tqi.setRange('5D')", 3000)
        step('Zeitraum 1M', "tqi.setRange('1M')", 4000)
        step('Symbol ETH', "tqi.setSymbol('ETH')", 4000)
        step('Symbol unbekannt (Bybit Spot)', "tqi.setSymbol('BTC', 'bybit-spot')", 4000)
        steps.append(('zurück auf', 0, p.evaluate('tqi.state.market + " " + tqi.state.base')))
        step('Thema hell', "tqi.setTheme('light')", 800)
        step('Session +2h, TPO 50', "Object.assign(tqi.state, {sessionOffsetMin: 120, tpoRow: 50}); tqi.ensureNeeds(); tqi.recompute()", 2500)
        step('Session 0, TPO auto', "Object.assign(tqi.state, {sessionOffsetMin: 0, tpoRow: 0}); tqi.recompute()", 800)
        # Zeichnen alle Werkzeuge
        box = p.locator('#chart').bounding_box()
        def draw_all():
            x0, y0 = box['x'], box['y']
            for k, tool in enumerate(['trend', 'ray', 'hline', 'hray', 'vline', 'rect', 'fib', 'measure', 'long', 'short']):
                p.evaluate(f"tqi.drawings.setTool('{tool}')")
                p.mouse.click(x0 + 200 + k * 50, y0 + 200 + k * 20)
                if tool not in ('hline', 'hray', 'vline', 'long', 'short'):
                    p.mouse.move(x0 + 300 + k * 50, y0 + 300 + k * 15)
                    p.mouse.click(x0 + 300 + k * 50, y0 + 300 + k * 15)
        step('Zeichnungen erstellen', fn=draw_all, wait=500)
        steps.append(('Zeichnungen', 0, p.evaluate('tqi.drawings.items.length')))
        def drag():
            it = p.evaluate("(() => { const d = tqi.drawings; const it = d.items.find(x => x.type === 'trend'); const g = d._geom(it); return g; })()")
            x0, y0 = box['x'], box['y']
            p.mouse.move(x0 + it['x1'] + (it['x2'] - it['x1']) / 2, y0 + it['y1'] + (it['y2'] - it['y1']) / 2)
            p.mouse.down(); p.mouse.move(x0 + it['x1'] + 60, y0 + it['y1'] + 40, steps=5); p.mouse.up()
        step('Trendlinie verschieben', fn=drag, wait=300)
        steps.append(('verschoben + ausgewählt', 0, p.evaluate("tqi.drawings.sel ? tqi.drawings.sel.type : null")))
        step('Auswahl löschen (Entf)', fn=lambda: p.keyboard.press('Delete'), wait=300)
        steps.append(('Zeichnungen übrig', 0, p.evaluate('tqi.drawings.items.length')))
        p.screenshot(path=os.path.join(e2e.OUT, '31_zeichnungen_hell.png'))
        step('Tastatur: Symbolsuche', fn=lambda: p.keyboard.press('s'), wait=400)
        steps.append(('Dialog offen', 0, p.evaluate("!!document.querySelector('#modal .mback')")))
        step('Escape', fn=lambda: p.keyboard.press('Escape'), wait=300)
        steps.append(('Dialog zu', 0, p.evaluate("!document.querySelector('#modal .mback')")))
        def tfq():
            p.keyboard.press('5'); p.wait_for_timeout(200); p.keyboard.press('Enter')
        step('Tastatur: 5 Enter', fn=tfq, wait=2500)
        steps.append(('Zeiteinheit', 0, p.evaluate('tqi.state.tf')))
        with p.expect_download() as dl:
            p.evaluate('tqi.screenshot()')
        steps.append(('Screenshot-Datei', 0, dl.value.suggested_filename))
        step('Panels rechts: Trades', "tqi.setState({rightPanel: 'tape', rightOpen: true})", 1500)
        step('Panels rechts: Orderbuch', "tqi.setState({rightPanel: 'dom', rightOpen: true})", 1500)
        step('Panels rechts zu', "tqi.setState({rightOpen: false})", 500)
        step('Live 5 s', None, 5000)
        steps.append(('Live-Kerzen', 0, p.evaluate('tqi.bars.length')))
        step('Neu laden (gespeicherter Zustand)', fn=lambda: (p.reload(), p.wait_for_function('window.tqi && tqi.bars.length > 50', timeout=20000)), wait=2500)
        steps.append(('Zustand nach Reload', 0, p.evaluate("tqi.state.tf + ' ' + tqi.state.theme + ' ' + tqi.state.indicators.length + ' Ind., ' + tqi.drawings.items.length + ' Zeichn.'")))
        p.screenshot(path=os.path.join(e2e.OUT, '32_nach_reload.png'))
        b.close()
    srv.shutdown()
    for s in steps: print(f'{s[0]:<38} Fehler={s[1]}  {s[2]}')
    print('\nFehler gesamt:', len(errors))
    for e in errors[:30]: print('  ', e[:400])

main()
