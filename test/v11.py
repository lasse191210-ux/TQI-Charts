# Tests für Version 1.1: Börse für Berechnungen (Bitstamp), Sessions, Key Levels durchgezogen,
# TPO zusammenfügen/teilen, Fixed Range TPO, Alarme, Vorlagen merken.
# Aufruf: python3 test/v11.py  → Screenshots in test/out/v11_*.png
import json, os, re, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e
from e2e import serve, route_handler, FAKE_WS, LAST, OUT, series, DAY, MIN, NOW
from playwright.sync_api import sync_playwright

def bs_series(iv):
    T, O, H, L, C, V, B = series(iv, 1.0)
    f = 0.9988
    wob = np.array([0.6 + 0.8 * (((int(t) // 900000) * 2654435761) % 1000) / 1000 for t in T])
    return T, O * f, H * f, L * f, C * f, V * 0.05 * wob

def rvwap_last(T, O, H, L, C, V, days):
    src = (O + H + L + C) / 4
    t = T[-1]
    m = (t - T) < days * DAY
    return float((src[m] * V[m]).sum() / V[m].sum())

def vwap_day(T, O, H, L, C, V):
    src = (O + H + L + C) / 4
    d0 = T[-1] // DAY * DAY
    m = T >= d0
    return float((src[m] * V[m]).sum() / V[m].sum())

def main():
    srv = serve()
    errors = []
    results = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        def new_page(viewport, mobile=False, storage=None):
            ctx = browser.new_context(viewport=viewport, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, locale='de-DE', timezone_id='Europe/Berlin')
            ctx.add_init_script(FAKE_WS.replace('%LAST%', str(LAST)))
            if storage is not None:
                ctx.add_init_script(f"localStorage.setItem('tqi-charts:v1', {json.dumps(json.dumps(storage))});")
            ctx.route(re.compile(r'https://(fapi|api|data-api)\.binance(\.vision|\.com).*'), route_handler)
            ctx.route(re.compile(r'https://(api\.bybit|www\.okx|api\.exchange\.coinbase)\.com.*'), route_handler)
            ctx.route(re.compile(r'https://www\.bitstamp\.net/.*'), route_handler)
            page = ctx.new_page()
            page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
            page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
            return page
        def shot(page, name, wait=0):
            if wait: page.wait_for_timeout(wait)
            page.screenshot(path=os.path.join(OUT, 'v11_' + name + '.png'))
        url = 'http://127.0.0.1:8765/index.html'

        page = new_page({'width': 1440, 'height': 860})
        page.goto(url)
        page.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000)
        page.wait_for_timeout(3500)
        results['inds'] = page.evaluate("tqi.state.indicators.map(i => i.type + (i.visible ? '' : '(aus)'))")
        shot(page, '01_standard')

        # ---- Rolling VWAP + VWAP mit Bitstamp-Daten
        page.evaluate("""() => { for (const t of ['rvwap', 'vwap']) { const i = tqi.state.indicators.find(x => x.type === t); tqi.updateIndicator(i.uid, { ...i.s, feed: 'bitstamp-spot' }); } }""")
        page.wait_for_timeout(5000)
        got = page.evaluate("""() => {
          const rv = tqi.state.indicators.find(x => x.type === 'rvwap'), vw = tqi.state.indicators.find(x => x.type === 'vwap');
          const d = tqi.data.get(rv.uid), v = tqi.data.get(vw.uid);
          const n = tqi.bars.length - 1;
          const st = tqi.hub.stores.get('bitstamp-spot|BTC|15m');
          return { wins: d.wins.map(w => [w.label, w.res, w.now]), vwapLast: v ? v.vwap[n] : null, bsLast: st ? st.bars[st.bars.length - 1].t : null, title: tqi.ui.app.state.indicators.map(i => i.type).join(',') };
        }""")
        T, O, H, L, C, V = bs_series('15m')
        # gleiche letzte Kerze wie im Browser (Bitstamp-Mock liefert bis NOW)
        exp7 = rvwap_last(T, O, H, L, C, V, 7)
        expV = vwap_day(T, O, H, L, C, V)
        w7 = [w for w in got['wins'] if w[0] == '7D'][0]
        results['rvwap7_bitstamp'] = {'browser': w7[2], 'python': exp7, 'diff': abs(w7[2] - exp7)}
        results['vwap_bitstamp'] = {'browser': got['vwapLast'], 'python': expV, 'diff': abs((got['vwapLast'] or 0) - expV)}
        shot(page, '02_feed_bitstamp')

        # ---- Session wie ATAS (02:00–22:00 Berlin) + Key Levels durchgezogen
        page.evaluate("""() => { tqi.state.session = { mode: 'custom', start: '02:00', end: '22:00', tz: 'Europe/Berlin' }; tqi.ensureNeeds(); tqi.recompute(true); }""")
        page.wait_for_timeout(2500)
        kl = page.evaluate("""() => {
          const k = tqi.state.indicators.find(x => x.type === 'keylevels'); const d = tqi.data.get(k.uid);
          return { lines: d.lines.map(l => [l.tag, new Date(l.from).toISOString(), l.date, Math.round(l.val), Math.round(l.vah), Math.round(l.poc)]), naked: d.naked ? d.naked.items.length : 0, sess: tqi.sess.label(), s: k.s.lines };
        }""")
        results['keylevels_custom_session'] = kl
        shot(page, '03_keylevels_session_0222')
        page.evaluate("""() => { tqi.state.session = { mode: 'utc', start: '02:00', end: '22:00', tz: 'Europe/Berlin' }; tqi.recompute(true); }""")
        page.wait_for_timeout(800)
        kl2 = page.evaluate("""() => { const k = tqi.state.indicators.find(x => x.type === 'keylevels'); const d = tqi.data.get(k.uid); return d.lines.map(l => [l.tag, new Date(l.from).toISOString(), Math.round(l.val), Math.round(l.vah)]); }""")
        results['keylevels_utc'] = kl2

        # ---- Vorlagen: Einstellung bleibt beim Wechseln erhalten
        page.evaluate("""() => { const k = tqi.state.indicators.find(x => x.type === 'keylevels'); tqi.updateIndicator(k.uid, { ...k.s, width: 3 }); }""")
        page.evaluate("tqi.applyTemplate('keylevels')"); page.wait_for_timeout(800)
        page.evaluate("tqi.applyTemplate('bild')"); page.wait_for_timeout(800)
        results['template_keeps_width'] = page.evaluate("tqi.state.indicators.find(x => x.type === 'keylevels').s.width")
        results['template_keeps_feed'] = page.evaluate("tqi.state.indicators.find(x => x.type === 'rvwap').s.feed")
        page.evaluate("tqi.saveUserTemplate('Test-Vorlage')")
        results['user_tpls'] = page.evaluate("tqi.state.userTpls.map(t => t.name + ':' + t.list.length)")
        page.evaluate("tqi.ui.openTemplatePop(document.querySelector('#tplBtn'))"); shot(page, '04_vorlagen', 500)
        page.evaluate("tqi.ui.closePop()")

        # ---- Fixed Range TPO
        r = page.evaluate("""() => {
          const b = tqi.bars, n = b.length;
          const it = tqi.drawings._create('ftpo', { t: b[n - 120].t, p: b[n - 120].c });
          it.pts[1] = { t: b[n - 20].t, p: b[n - 20].c };
          tqi.drawings._finish(it);
          const p = tqi.drawings._ftpo(it);
          return p ? { n: p.n, poc: p.poc, vah: p.vah, val: p.val, rows: p.rows.length } : null;
        }""")
        results['ftpo'] = r
        shot(page, '05_fixed_range_tpo', 1200)

        # ---- Alarm
        r = page.evaluate("""() => {
          const last = tqi.bars[tqi.bars.length - 1].c;
          const it = tqi.drawings._create('alert', { t: tqi.bars[tqi.bars.length - 1].t, p: last * 1.01 });
          tqi.drawings._finish(it);
          tqi.alerts.check(last * 1.005); tqi.alerts.check(last * 1.012);
          return { fired: !!it.fired, n: tqi.alerts.list().length, toast: document.querySelector('#toasts').innerText.slice(0, 120) };
        }""")
        results['alert'] = r
        shot(page, '06_alarm', 600)
        page.evaluate("tqi.ui.openAlerts()"); shot(page, '07_alarm_liste', 500)
        page.evaluate("tqi.ui.closeTopModal()")

        # ---- TPO-Ansicht (wie MMT): zusammenfügen / teilen
        page.evaluate("tqi.applyTemplate('tpo')")
        page.wait_for_function("window.tqi.isTpo && tqi.tpoSessions && tqi.tpoSessions.length > 3", timeout=20000)
        page.wait_for_timeout(1500)
        before = page.evaluate("tqi.tpoSessions.length")
        page.evaluate("""() => { const s = tqi.tpoSessions[tqi.tpoSessions.length - 2]; tqi.selectTpo(s.first + 2); tqi.mergeTpo(-1); }""")
        page.wait_for_timeout(800)
        after = page.evaluate("""() => ({ n: tqi.tpoSessions.length, merged: tqi.tpoSessions.filter(s => s.merged).map(s => tqi.tpoLabel(s)), edits: tqi.tpoEdits() })""")
        shot(page, '08_tpo_zusammengefuegt', 600)
        page.evaluate("""() => { const s = tqi.tpoSessions[tqi.tpoSessions.length - 1]; tqi.selectTpo(s.first + Math.floor(s.n / 2)); tqi.splitTpo(); }""")
        page.wait_for_timeout(800)
        split = page.evaluate("""() => ({ n: tqi.tpoSessions.length, labels: tqi.tpoSessions.slice(-3).map(s => tqi.tpoLabel(s)), edits: tqi.tpoEdits() })""")
        shot(page, '09_tpo_geteilt', 600)
        results['tpo_merge'] = {'before': before, 'after': after, 'split': split}
        page.evaluate("tqi.resetTpoEdits()")
        page.evaluate("tqi.applyTemplate('bild')"); page.wait_for_timeout(2500)
        results['back_from_tpo'] = page.evaluate("({ chart: tqi.state.chartType, tf: tqi.state.tf, inds: tqi.state.indicators.length })")

        # ---- Einstellungen-Dialog
        page.evaluate("tqi.ui.openSettings()"); shot(page, '10_einstellungen', 500)
        page.evaluate("tqi.ui.closeTopModal()")
        page.context.close()

        # ---- Handy
        m = new_page({'width': 390, 'height': 844}, mobile=True)
        m.goto(url)
        m.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000)
        shot(m, '20_mobile', 4000)
        m.click('#mbMore'); shot(m, '21_mobile_mehr', 1200)
        m.evaluate("tqi.ui.closeTopModal()")
        m.evaluate("tqi.applyTemplate('tpo')")
        m.wait_for_function("window.tqi.isTpo && tqi.tpoSessions && tqi.tpoSessions.length > 2", timeout=20000)
        m.evaluate("""() => { const s = tqi.tpoSessions[tqi.tpoSessions.length - 1]; tqi.selectTpo(s.first + 1); }""")
        shot(m, '22_mobile_tpo_auswahl', 1200)
        m.context.close()
        browser.close()
    srv.shutdown()
    errs = [e for e in errors if 'favicon' not in e and 'manifest' not in e]
    print(json.dumps(results, ensure_ascii=False, indent=1, default=str))
    print('\nKonsole:', len(errs))
    for e in errs[:30]: print('  ', e[:300])

if __name__ == '__main__':
    main()
