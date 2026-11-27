# Tests für Version 1.5: Single Prints / Selling Tails / Buying Tails nur bis zur ersten Berührung (dann geschlossen),
# keine doppelten Zonen aus Key Levels und Naked Levels.
# Aufruf: python3 test/v15.py  → Screenshots in test/out/v15_*.png
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
        st = {'template': 'bild', 'tplV': 2, 'colorsV': 2, 'btV': 3, 'paintV': 1, 'hvbV': 1, 'theme': 'light', 'tf': '15m', 'rightOpen': False,
              'indicators': [{'uid': 'k1', 'type': 'keylevels', 'visible': True, 's': {'pq': False, 'py': False, 'w52l': False}},
                             {'uid': 'n1', 'type': 'naked', 'visible': True, 's': {'singles': False}}]}
        ctx = browser.new_context(viewport={'width': 1440, 'height': 860}, locale='de-DE', timezone_id='Europe/Berlin')
        ctx.add_init_script(FAKE_WS.replace('%LAST%', str(LAST)))
        ctx.add_init_script(f"localStorage.setItem('tqi-charts:v1', {json.dumps(json.dumps(st))});")
        ctx.route(re.compile(r'https://(fapi|api|data-api)\.binance(\.vision|\.com).*'), route_handler)
        ctx.route(re.compile(r'https://(api\.bybit|www\.okx|api\.exchange\.coinbase)\.com.*'), route_handler)
        ctx.route(re.compile(r'https://www\.bitstamp\.net/.*'), route_handler)
        page = ctx.new_page()
        page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
        page.goto('http://127.0.0.1:8765/index.html')
        page.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000)
        page.wait_for_timeout(5000)
        R['zones'] = page.evaluate("""() => {
          const d = tqi.data.get('k1'), b = tqi.bars, sc = tqi.overlay.scene;
          const zones = d.naked.items.filter(x => x.kind !== 'poc' && x.kind !== 'ufa');
          let touched = 0, open = 0, firstOk = 0, firstBad = [], drawnToTouch = 0, labelsOnClosed = 0;
          for (const x of zones) {
            if (x.touched == null) { open++; continue; }
            touched++;
            if (x.st !== 'closed') firstBad.push(['nicht geschlossen', x.label]);
            // erste Chart-Kerze nach Session-Ende in der Zone
            const day = tqi.makeCtx().profiles(0).find(p => p.start === x.from);
            let first = null;
            for (const bar of b) if (bar.t >= day.end && bar.l <= x.top && bar.h >= x.bottom) { first = bar.t; break; }
            if (x.touched < b[0].t) { firstOk++; continue; } // Berührung vor dem ersten geladenen Chart-Kerze (aus 30-Min.-Daten)
            if (first == null || first === x.touched) firstOk++; else firstBad.push([x.label, new Date(x.touched).toISOString(), new Date(first).toISOString(), new Date(b[0].t).toISOString()]);
            const box = sc.boxes.find(o => o.from === x.from && o.top === x.top && o.bottom === x.bottom);
            if (box && box.to === x.touched) drawnToTouch++; else firstBad.push(['Box', x.label, x.kind, box ? new Date(box.to).toISOString() : 'keine', new Date(x.touched).toISOString(), new Date(x.from).toISOString()]);
            if (box && box.label) labelsOnClosed++;
          }
          const keys = sc.boxes.map(o => o.from + '|' + o.top + '|' + o.bottom);
          const dup = keys.length - new Set(keys).size;
          const openBoxes = sc.boxes.filter(o => o.to == null && zones.some(x => x.touched == null && x.from === o.from && x.top === o.top)).length;
          return { zones: zones.length, open, touched, firstOk, firstBad: firstBad.slice(0, 3), drawnToTouch, labelsOnClosed, duplicates: dup, openBoxesToRight: openBoxes };
        }""")
        page.evaluate("tqi.chart.timeScale().setVisibleLogicalRange({ from: tqi.bars.length - 300, to: tqi.bars.length + 5 })")
        page.screenshot(path=os.path.join(OUT, 'v15_01_tails_bis_beruehrung.png'))
        # Einstellung „ausblenden“ und „weiterlaufen“
        R['modes'] = page.evaluate("""() => {
          const ind = tqi.state.indicators.find(i => i.uid === 'k1');
          const count = () => tqi.overlay.scene.boxes.length;
          const out = {};
          for (const m of ['end', 'hide', 'extend']) { tqi.updateIndicator('k1', { ...ind.s, tailEnd: m }); out[m] = count(); }
          tqi.updateIndicator('k1', { ...ind.s, tailEnd: 'end' });
          return out;
        }""")
        ctx.close()
        browser.close()
    srv.shutdown()
    errs = [e for e in errors if 'favicon' not in e and 'manifest' not in e]
    print(json.dumps(R, ensure_ascii=False, indent=1, default=str))
    print('\nKonsole:', len(errs))
    for e in errs[:30]: print('  ', e[:300])

if __name__ == '__main__':
    main()
