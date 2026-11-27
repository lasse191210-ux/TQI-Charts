# Tests für Version 1.6: Ebenen, Objektbaum, Rückgängig, Fokus, Werkzeug-Gruppen, neue Zeichenwerkzeuge,
# Sichtbarkeit je Zeiteinheit, TPO-Profil bleibt an seiner Session stehen.
# Aufruf: python3 test/v16.py  → Screenshots in test/out/v16_*.png
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e
from e2e import serve, route_handler, FAKE_WS, LAST, OUT
from playwright.sync_api import sync_playwright

def ctx_for(browser, st, w=1440, h=860, mobile=False):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, locale='de-DE', timezone_id='Europe/Berlin', has_touch=mobile, is_mobile=mobile)
    ctx.add_init_script(FAKE_WS.replace('%LAST%', str(LAST)))
    ctx.add_init_script(f"if (!sessionStorage.getItem('init')) {{ localStorage.setItem('tqi-charts:v1', {json.dumps(json.dumps(st))}); sessionStorage.setItem('init', '1'); }}")
    ctx.route(re.compile(r'https://(fapi|api|data-api)\.binance(\.vision|\.com).*'), route_handler)
    ctx.route(re.compile(r'https://(api\.bybit|www\.okx|api\.exchange\.coinbase)\.com.*'), route_handler)
    ctx.route(re.compile(r'https://www\.bitstamp\.net/.*'), route_handler)
    return ctx

def main():
    srv = serve()
    errors = []
    R = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        st = {'template': 'bild', 'tplV': 2, 'colorsV': 2, 'btV': 3, 'paintV': 1, 'hvbV': 1, 'theme': 'light', 'tf': '15m', 'rightOpen': False,
              'indicators': [{'uid': 'k1', 'type': 'keylevels', 'visible': True, 's': {}},
                             {'uid': 'v1', 'type': 'vwap', 'visible': True, 's': {}},
                             {'uid': 'r1', 'type': 'rsi', 'visible': True, 's': {}}]}
        ctx = ctx_for(browser, st)
        page = ctx.new_page()
        page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
        page.on('dialog', lambda d: d.accept('Test-Notiz | zweite Zeile') if d.type == 'prompt' else d.accept())
        page.goto('http://127.0.0.1:8765/index.html')
        page.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000)
        page.wait_for_timeout(3000)
        page.evaluate("tqi.chart.timeScale().setVisibleLogicalRange({ from: tqi.bars.length - 160, to: tqi.bars.length + 5 })")
        page.wait_for_timeout(400)

        # ---- Werkzeugleiste: Gruppen
        R['toolbar'] = page.evaluate("""() => ({ groups: document.querySelectorAll('#tools .tg').length, more: document.querySelectorAll('#tools .tg-more').length,
          h: document.querySelector('#tools .tools-in').scrollHeight, colH: document.querySelector('#tools').clientHeight })""")
        page.hover('#tools .tg:nth-child(2)')
        page.click('#tools .tg:nth-child(2) .tg-more')
        page.wait_for_timeout(200)
        R['flyout'] = page.evaluate("() => [...document.querySelectorAll('#pop .toolgrp .mi span')].map(x => x.textContent)")
        page.screenshot(path=os.path.join(OUT, 'v16_01_werkzeug_gruppe.png'))
        page.click('#pop .toolgrp [data-t="channel"]')
        page.wait_for_timeout(150)
        R['toolAfterPick'] = page.evaluate("() => ({ tool: tqi.drawings.tool, btn: document.querySelector('#tools .tg:nth-child(2) .tool').dataset.tool, pick: tqi.state.toolPick })")

        # ---- Kanal: drei Klicks
        box = page.evaluate("() => { const r = tqi.ui.chartEl.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }")
        X = lambda f: box['x'] + box['w'] * f
        Y = lambda f: box['y'] + box['h'] * f
        page.mouse.click(X(0.35), Y(0.55)); page.wait_for_timeout(80)
        page.mouse.click(X(0.6), Y(0.35)); page.wait_for_timeout(80)
        page.mouse.move(X(0.5), Y(0.6)); page.wait_for_timeout(80)
        page.mouse.click(X(0.5), Y(0.6)); page.wait_for_timeout(150)
        R['channel'] = page.evaluate("() => { const it = tqi.drawings.items.at(-1); return { type: it.type, off: it.off, st: it._st ?? null, tool: tqi.drawings.tool }; }")
        # Pfeil (ziehen)
        page.evaluate("tqi.ui.pickTool('arrow')")
        page.mouse.move(X(0.2), Y(0.3)); page.mouse.down(); page.mouse.move(X(0.28), Y(0.45), steps=6); page.mouse.up(); page.wait_for_timeout(120)
        # Notiz (Klick, Klick, Text)
        page.evaluate("tqi.ui.pickTool('note')")
        page.mouse.click(X(0.7), Y(0.5)); page.wait_for_timeout(60)
        page.mouse.click(X(0.78), Y(0.3)); page.wait_for_timeout(150)
        # Preisbereich und Datumsbereich
        page.evaluate("tqi.ui.pickTool('prange')")
        page.mouse.move(X(0.08), Y(0.6)); page.mouse.down(); page.mouse.move(X(0.14), Y(0.4), steps=5); page.mouse.up(); page.wait_for_timeout(100)
        page.evaluate("tqi.ui.pickTool('drange')")
        page.mouse.move(X(0.4), Y(0.62)); page.mouse.down(); page.mouse.move(X(0.55), Y(0.58), steps=5); page.mouse.up(); page.wait_for_timeout(100)
        page.mouse.click(X(0.9), Y(0.9)); page.wait_for_timeout(150)
        R['drawn'] = page.evaluate("() => tqi.drawings.items.map(i => i.type + (i.text ? ':' + i.text : ''))")
        R['stored'] = page.evaluate("() => JSON.parse(localStorage.getItem(tqi.drawings.key)).map(i => Object.keys(i).filter(k => k[0] === '_'))")
        page.screenshot(path=os.path.join(OUT, 'v16_02_neue_werkzeuge.png'))
        # Treffer: Kanal anklicken (Mitte der Grundlinie), Notiz anklicken
        R['hit'] = page.evaluate("""() => {
          const d = tqi.drawings, out = {};
          for (const it of d.items) {
            let x, y;
            const g = d._geom(it);
            if (it.type === 'note') { const b = d._boxes.get(it); x = b.x + b.w / 2; y = b.y + b.h / 2; }
            else if (it.type === 'drange' || it.type === 'prange') { x = (g.x1 + g.x2) / 2; y = (g.y1 + g.y2) / 2; }
            else { x = (g.x1 + g.x2) / 2; y = (g.y1 + g.y2) / 2; }
            const h = d._hit(x, y);
            out[it.type] = !!h && h.item === it;
          }
          return out;
        }""")
        # Kanal-Breite über den Griff ziehen
        R['chanDrag'] = page.evaluate("""() => {
          const d = tqi.drawings, it = d.items.find(i => i.type === 'channel');
          d.sel = it;
          const g = d._geom(it);
          const hx = (g.x1 + g.x2) / 2, hy = d.pToY((it.pts[0].p + it.pts[1].p) / 2 + it.off);
          const h = d._hit(hx, hy);
          return { handle: h && h.handle };
        }""")

        # ---- Sichtbarkeit je Zeiteinheit (Zeichnung)
        R['visTf'] = page.evaluate("""() => {
          const d = tqi.drawings, it = d.items.find(i => i.type === 'arrow');
          it.vis = { min: false, hour: true, day: true, week: true };
          const hidden15 = !d.shown(it);
          return { hidden15 };
        }""")
        page.evaluate("tqi.drawings.sel = tqi.drawings.items.find(i => i.type === 'channel'); tqi.ui.openDrawingSettings(tqi.drawings.sel)")
        page.wait_for_timeout(200)
        R['settingsSecs'] = page.evaluate("() => [...document.querySelectorAll('#modal .f-sec')].map(x => x.textContent)")
        page.screenshot(path=os.path.join(OUT, 'v16_03_kanal_einstellungen.png'))
        page.keyboard.press('Escape'); page.wait_for_timeout(150)

        # ---- Rückgängig / Wiederholen
        n0 = page.evaluate("() => tqi.drawings.items.length")
        page.mouse.click(X(0.9), Y(0.9)); page.wait_for_timeout(80)
        page.keyboard.press('Control+z'); page.wait_for_timeout(150)
        n1 = page.evaluate("() => tqi.drawings.items.length")
        page.keyboard.press('Control+y'); page.wait_for_timeout(150)
        n2 = page.evaluate("() => tqi.drawings.items.length")
        # Indikator entfernen → rückgängig
        page.evaluate("tqi.removeIndicator('v1')"); page.wait_for_timeout(150)
        i1 = page.evaluate("() => tqi.state.indicators.map(i => i.uid)")
        page.keyboard.press('Control+z'); page.wait_for_timeout(250)
        i2 = page.evaluate("() => tqi.state.indicators.map(i => i.uid)")
        R['undo'] = {'n0': n0, 'afterUndo': n1, 'afterRedo': n2, 'indAfterRemove': i1, 'indAfterUndo': i2}

        # ---- Ebenen
        page.click('#layerBtn'); page.wait_for_timeout(200)
        R['layers'] = page.evaluate("() => [...document.querySelectorAll('#pop .lay span')].map(x => x.textContent)")
        page.screenshot(path=os.path.join(OUT, 'v16_04_ebenen.png'))
        page.click('#pop [data-layer="levels"]'); page.wait_for_timeout(250)
        R['layerOff'] = page.evaluate("() => ({ k1: tqi.state.indicators.find(i => i.uid === 'k1').visible, v1: tqi.state.indicators.find(i => i.uid === 'v1')?.visible })")
        page.click('#pop [data-layer="levels"]'); page.wait_for_timeout(250)
        R['layerOn'] = page.evaluate("() => tqi.state.indicators.find(i => i.uid === 'k1').visible")
        page.keyboard.press('Escape'); page.wait_for_timeout(100)

        # ---- Objektbaum
        page.click('#tools [data-tt="tree"]'); page.wait_for_timeout(250)
        R['tree'] = page.evaluate("() => ({ inds: document.querySelectorAll('#modal .ot-row[data-uid]').length, draws: document.querySelectorAll('#modal .ot-row[data-k]').length })")
        page.screenshot(path=os.path.join(OUT, 'v16_05_objektbaum.png'))
        page.click('#modal .ot-row[data-k="0"] [data-od="vis"]'); page.wait_for_timeout(120)
        R['treeHide'] = page.evaluate("() => tqi.drawings.items[0].hidden === true")
        page.click('#modal .ot-row[data-k="0"] [data-od="vis"]'); page.wait_for_timeout(120)
        page.click('#modal [data-all="ok"]'); page.wait_for_timeout(120)

        # ---- Fokus
        before = page.evaluate("() => ({ lv: tqi.overlay.scene.levels.length + tqi.overlay.scene.lines.length })")
        page.keyboard.press('Alt+k'); page.wait_for_timeout(300)
        R['focus'] = page.evaluate("() => ({ on: tqi.focus, body: document.body.classList.contains('focus-mode'), lv: tqi.overlay.scene.levels.length + tqi.overlay.scene.lines.length + tqi.overlay.scene.boxes.length, hit: tqi.drawings._hit(10, 10) })")
        R['focus']['before'] = before
        page.screenshot(path=os.path.join(OUT, 'v16_06_fokus.png'))
        page.keyboard.press('Alt+k'); page.wait_for_timeout(300)
        R['focusOff'] = page.evaluate("() => tqi.focus")
        # TradingView-Kürzel
        page.keyboard.press('Alt+h'); page.wait_for_timeout(100)
        R['altH'] = page.evaluate("() => tqi.drawings.tool")
        page.keyboard.press('Escape')
        R['console'] = errors[:]
        page.close(); ctx.close()

        # ---- Handy: Werkzeug-Gruppe, Mehr-Menü
        mctx = ctx_for(browser, st, 390, 844, mobile=True)
        mp = mctx.new_page()
        mp.on('pageerror', lambda e: errors.append(f'[pageerror mobil] {e}'))
        mp.goto('http://127.0.0.1:8765/index.html')
        mp.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000)
        mp.wait_for_timeout(1500)
        mp.click('#mbDraw'); mp.wait_for_timeout(200)
        mp.screenshot(path=os.path.join(OUT, 'v16_07_handy_werkzeuge.png'))
        mp.click('#tools .tg:nth-child(8) .tg-more'); mp.wait_for_timeout(250)
        R['mobileFly'] = mp.evaluate("() => [...document.querySelectorAll('#modal .toolgrp .mi span')].map(x => x.textContent)")
        mp.screenshot(path=os.path.join(OUT, 'v16_08_handy_gruppe.png'))
        mp.click('#modal .toolgrp [data-t="drange"]'); mp.wait_for_timeout(200)
        R['mobilePick'] = mp.evaluate("() => ({ tool: tqi.drawings.tool, modal: !!document.querySelector('#modal .mback') })")
        mp.evaluate("tqi.drawings.setTool('cursor')")
        mp.click('#mbMore'); mp.wait_for_timeout(250)
        R['mobileMore'] = mp.evaluate("() => [...document.querySelectorAll('#modal .row-btn span')].map(x => x.textContent)")
        mp.click('#modal .row-btn[data-k="layers"]'); mp.wait_for_timeout(250)
        mp.screenshot(path=os.path.join(OUT, 'v16_09_handy_ebenen.png'))
        mctx.close()
        browser.close()
    srv.shutdown()
    print(json.dumps(R, indent=1, ensure_ascii=False))
    print('\nKonsole:', len(errors))
    for e in errors[:10]: print(' ', e)

if __name__ == '__main__':
    main()
