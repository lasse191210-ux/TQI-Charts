# Tests für Version 1.2: Standard-Vorlage (PC-Einstellung, Umzug aus der 2. Vorlage), Vorlagen kopieren/teilen/importieren,
# Chart-Einstellungen (wie ATAS), App-Installation, TQI Trader (Bybit, nur simuliert – Test-Schlüssel, keine echten Daten).
# Aufruf: python3 test/v12.py  → Screenshots in test/out/v12_*.png
import hashlib, hmac, json, math, os, re, sys
from urllib.parse import urlparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e
from e2e import serve, route_handler, FAKE_WS, LAST, OUT
from playwright.sync_api import sync_playwright

KEY, SECRET = 'TESTKEY-0001', 'TESTSECRET-0001'   # nur Test (simuliertes Bybit), kein echter Schlüssel
BYBIT_WS = """
(() => {
  const Base = window.WebSocket;
  class W extends Base {
    constructor(url) { super(url); if (String(url).includes('bybit.com/v5/private')) window.__bybitWs = this; }
    send(raw) {
      if (String(this.url).includes('/v5/private')) {
        let m; try { m = JSON.parse(raw); } catch { return; }
        window.__bybitSent = (window.__bybitSent || []).concat([m]);
        if (m.op === 'auth') setTimeout(() => this._emit({ op: 'auth', success: true, ret_msg: '', conn_id: 't' }), 40);
        if (m.op === 'subscribe') setTimeout(() => this._emit({ op: 'subscribe', success: true }), 40);
        return;
      }
      return super.send(raw);
    }
  }
  window.WebSocket = W;
})();
"""

class Bybit:
    """Simuliertes Bybit-Demo-Konto: prüft jede Signatur, merkt sich alle Anfragen."""
    def __init__(self):
        self.reqs = []
        self.bad_sig = 0
        self.pos = []
        self.orders = []
    def handle(self, route):
        r = route.request
        u = urlparse(r.url)
        h = r.headers
        cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'}
        if r.method == 'OPTIONS':
            return route.fulfill(status=200, headers=cors, body='')
        body = r.post_data or ''
        priv = 'x-bapi-api-key' in h
        if priv:
            payload = (u.query if r.method == 'GET' else body)
            want = hmac.new(SECRET.encode(), (h['x-bapi-timestamp'] + h['x-bapi-api-key'] + h['x-bapi-recv-window'] + payload).encode(), hashlib.sha256).hexdigest()
            if want != h.get('x-bapi-sign') or h['x-bapi-api-key'] != KEY: self.bad_sig += 1
        self.reqs.append({'m': r.method, 'path': u.path, 'q': u.query, 'body': json.loads(body) if body else None, 'priv': priv})
        p = u.path
        res = {}
        code = 0
        if p == '/v5/market/time': res = {'timeSecond': '1', 'timeNano': str(int(__import__('time').time() * 1e9))}
        elif p == '/v5/market/instruments-info': res = {'list': [{'symbol': 'BTCUSDT', 'priceFilter': {'tickSize': '0.10'}, 'lotSizeFilter': {'qtyStep': '0.001', 'minOrderQty': '0.001', 'minNotionalValue': '5'}, 'leverageFilter': {'maxLeverage': '100.00'}}]}
        elif p == '/v5/account/wallet-balance': res = {'list': [{'totalEquity': '10000', 'totalAvailableBalance': '9500', 'totalPerpUPL': '0'}]}
        elif p == '/v5/position/list': res = {'list': self.pos}
        elif p == '/v5/order/realtime': res = {'list': self.orders}
        elif p == '/v5/position/set-leverage': code = 110043
        elif p == '/v5/order/create': res = {'orderId': 'ord-' + str(len(self.reqs)) + '-abcdef', 'orderLinkId': (json.loads(body) or {}).get('orderLinkId')}
        elif p in ('/v5/position/trading-stop', '/v5/order/cancel-all', '/v5/order/cancel'): res = {}
        else: return route.fulfill(status=404, headers=cors, content_type='application/json', body='{}')
        return route.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps({'retCode': code, 'retMsg': 'OK' if not code else 'leverage not modified', 'result': res}))
    def last(self, path):
        x = [r for r in self.reqs if r['path'] == path]
        return x[-1] if x else None
    def count(self, path):
        return sum(1 for r in self.reqs if r['path'] == path)

def floor_step(x, step): return math.floor(x / step + 1e-9) * step

def main():
    srv = serve()
    errors = []
    R = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        def new_page(viewport, mobile=False, storage=None, bybit=None, hash_=''):
            ctx = browser.new_context(viewport=viewport, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, locale='de-DE', timezone_id='Europe/Berlin')
            ctx.add_init_script(FAKE_WS.replace('%LAST%', str(LAST)))
            ctx.add_init_script(BYBIT_WS)
            if storage is not None:
                ctx.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('tqi-charts:v1', {json.dumps(json.dumps(storage))}); sessionStorage.setItem('seeded', '1'); }}")
            ctx.route(re.compile(r'https://(fapi|api|data-api)\.binance(\.vision|\.com).*'), route_handler)
            ctx.route(re.compile(r'https://(www\.okx|api\.exchange\.coinbase)\.com.*'), route_handler)
            ctx.route(re.compile(r'https://www\.bitstamp\.net/.*'), route_handler)
            if bybit: ctx.route(re.compile(r'https://api(-demo)?\.bybit\.com/.*'), bybit.handle)
            else: ctx.route(re.compile(r'https://api\.bybit\.com.*'), route_handler)
            page = ctx.new_page()
            page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
            page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
            page.goto(url + hash_)
            page.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000)
            return page
        def shot(page, name, wait=0):
            if wait: page.wait_for_timeout(wait)
            page.screenshot(path=os.path.join(OUT, 'v12_' + name + '.png'))
        url = 'http://127.0.0.1:8765/index.html'
        inds = "tqi.state.indicators.map(i => i.type + (i.visible ? '' : '(aus)'))"

        # ================================================================ 1) Umzug: PC-Einstellung lag aus Versehen in der 2. Vorlage
        pc_list = [{'uid': f'p{i}', 'type': t, 'visible': True, 's': s} for i, (t, s) in enumerate([
            ('tpo', {}), ('keylevels', {}), ('vwap', {'period': 'day'}), ('rvwap', {'feed': 'bitstamp-spot'}), ('hvb', {}),
            ('htfvwap', {'w': False, 'pw': False, 'm': False, 'pm': False, 'q': False, 'pq': False, 'y': False, 'py': False}),
            ('naked', {'singles': False}), ('inst', {}), ('sfp', {'strength': 7}), ('volcandles', {}), ('bigtrades', {'minUsd': 777777, 'group': 'bar'})])]
        old_bild = [{'uid': 'o1', 'type': 'rvwap', 'visible': True, 's': {}}, {'uid': 'o2', 'type': 'tpo', 'visible': False, 's': {}}, {'uid': 'o3', 'type': 'keylevels', 'visible': True, 's': {}}, {'uid': 'o4', 'type': 'options', 'visible': True, 's': {}}]
        st_pc = {'template': 'keylevels', 'indicators': pc_list, 'tplState': {'bild': old_bild}, 'colorsV': 2, 'tplV': 0, 'theme': 'dark', 'market': 'binance-perp', 'base': 'BTC', 'tf': '15m'}
        page = new_page({'width': 1440, 'height': 860}, storage=st_pc)
        page.wait_for_timeout(2500)
        R['pc_migration'] = page.evaluate(f"({{ template: tqi.state.template, name: tqi.templateName(), inds: {inds}, sfpStrength: tqi.state.indicators.find(i => i.type === 'sfp')?.s.strength, bt: (b => ({{ auto: b.auto, intensity: b.intensity, group: b.group, text: b.text }}))(tqi.state.indicators.find(i => i.type === 'bigtrades').s), hasKl: 'keylevels' in (tqi.state.tplState || {{}}) }})")
        shot(page, '01_pc_standard')
        page.evaluate("tqi.applyTemplate('keylevels')"); page.wait_for_timeout(800)
        R['pc_second_reset'] = page.evaluate(inds)
        page.evaluate("tqi.applyTemplate('bild')"); page.wait_for_timeout(800)
        R['pc_back_to_standard'] = page.evaluate(f"({{ inds: {inds}, sfpStrength: tqi.state.indicators.find(i => i.type === 'sfp')?.s.strength }})")
        # Neu laden: Umzug darf nicht noch einmal laufen
        page.reload(); page.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000); page.wait_for_timeout(800)
        R['pc_after_reload'] = page.evaluate(f"({{ template: tqi.state.template, n: tqi.state.indicators.length, tplV: tqi.state.tplV }})")

        # ================================================================ 2) Vorlagen: teilen (Code), importieren, kopieren
        code = page.evaluate("tqi.exportTemplate()")
        R['share_code_len'] = len(code)
        imp = page.evaluate(f"(() => {{ const x = tqi.parseTemplate({json.dumps(code)}); return {{ name: x.name, types: x.list.map(i => i.type), sfp: x.list.find(i => i.type === 'sfp').s.strength, hv: x.list.find(i => i.type === 'htfvwap').s.w }}; }})()")
        R['share_parse'] = imp
        page.evaluate("tqi.ui.openShareTemplate()"); shot(page, '02_teilen', 500)
        page.evaluate("tqi.ui.closeTopModal()")
        page.evaluate("tqi.copyTemplateTo('orderflow'); tqi.applyTemplate('orderflow')"); page.wait_for_timeout(800)
        R['copy_to_orderflow'] = page.evaluate(f"({{ n: tqi.state.indicators.length, sfp: tqi.state.indicators.find(i => i.type === 'sfp')?.s.strength }})")
        page.evaluate("tqi.resetTemplate()"); page.wait_for_timeout(500)
        R['orderflow_reset'] = page.evaluate(inds)
        page.evaluate("tqi.applyTemplate('bild')")
        page.context.close()

        # Handy (alter Stand, Standard aktiv) → nach dem Laden PC-Einstellung in „Standard“
        st_phone = {'template': 'bild', 'indicators': old_bild, 'colorsV': 0, 'tplV': 0, 'theme': 'light'}
        m = new_page({'width': 390, 'height': 844}, mobile=True, storage=st_phone)
        m.wait_for_timeout(2500)
        R['phone_migration'] = m.evaluate(f"({{ template: tqi.state.template, inds: {inds}, naked: tqi.state.indicators.find(i => i.type === 'naked').s.singles, hv: tqi.state.indicators.find(i => i.type === 'htfvwap').s.w, rv: tqi.state.indicators.find(i => i.type === 'rvwap').s.feed }})")
        shot(m, '03_handy_standard')
        # Import über Link (#tpl=…) auf dem Handy
        m.goto(url + '#tpl=' + code); m.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000); m.wait_for_timeout(1200)
        R['phone_import_dialog'] = m.evaluate("document.querySelector('#modal .mdlg')?.innerText.slice(0, 200) || null")
        shot(m, '04_handy_import')
        if R['phone_import_dialog']:
            m.click('#imStd'); m.wait_for_timeout(1200)
        R['phone_after_import'] = m.evaluate(f"({{ template: tqi.state.template, inds: {inds}, sfp: tqi.state.indicators.find(i => i.type === 'sfp')?.s.strength, hash: location.hash }})")
        m.context.close()

        # ================================================================ 3) Chart-Einstellungen + App installieren
        page = new_page({'width': 1440, 'height': 860})
        page.wait_for_timeout(1500)
        R['install_hidden_before'] = page.evaluate("document.querySelector('#installBtn').hidden")
        page.evaluate("""() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); }""")
        page.wait_for_timeout(200)
        R['install_visible'] = page.evaluate("!document.querySelector('#installBtn').hidden")
        shot(page, '05_install_knopf')
        page.click('#installBtn'); page.wait_for_timeout(400)
        R['install_prompted'] = page.evaluate("({ prompted: window.__prompted || 0, hiddenAfter: document.querySelector('#installBtn').hidden })")
        page.evaluate("tqi.ui.openChartSettings()"); shot(page, '06_chart_einstellungen', 500)
        page.click('[data-pre="atas"]'); page.wait_for_timeout(400)
        R['chart_atas'] = page.evaluate("(() => { const o = tqi.series.options(); return { up: o.upColor, down: o.downColor, wickUp: o.wickUpColor, state: tqi.state.chartCol.up }; })()")
        shot(page, '07_chart_atas', 300)
        page.click('#csReset'); page.wait_for_timeout(300)
        R['chart_auto'] = page.evaluate("(() => { const o = tqi.series.options(); return { up: o.upColor, down: o.downColor, state: tqi.state.chartCol.up }; })()")
        page.evaluate("tqi.ui.closeTopModal()")
        page.context.close()

        # ================================================================ 4) TQI Trader (Bybit Demo, simuliert)
        by = Bybit()
        page = new_page({'width': 1440, 'height': 860}, bybit=by)
        page.wait_for_timeout(1500)
        page.click('#traderBtn'); page.wait_for_timeout(500)
        R['tr_open'] = page.evaluate("({ open: tqi.trader.open, btnOn: document.querySelector('#traderBtn').classList.contains('on'), head: document.querySelector('#rhead').innerText.replace(/\\s+/g, ' ').slice(0, 80), keyForm: !!document.querySelector('#rbody [data-k=key]') })")
        shot(page, '10_trader_schluessel')
        page.fill('#rbody [data-k=key]', KEY); page.fill('#rbody [data-k=secret]', SECRET)
        page.click('#rbody [data-save]')
        page.wait_for_function("tqi.trader.wallet && tqi.trader.wsState === 'live'", timeout=8000)
        page.wait_for_timeout(300)
        R['tr_connected'] = page.evaluate("({ ws: tqi.trader.wsState, wallet: tqi.trader.wallet, txt: document.querySelector('#rbody').innerText.slice(0, 120), keysInState: JSON.stringify(tqi.state).includes('TESTSECRET'), keyStore: Object.keys(JSON.parse(localStorage.getItem('tqi-charts:trader-keys') || '{}')) })")
        auth = page.evaluate("window.__bybitSent.find(m => m.op === 'auth')")
        exp = auth['args'][1]
        R['tr_ws_auth_ok'] = auth['args'][0] == KEY and auth['args'][2] == hmac.new(SECRET.encode(), ('GET/realtime' + str(exp)).encode(), hashlib.sha256).hexdigest()
        R['tr_ws_sub'] = page.evaluate("window.__bybitSent.find(m => m.op === 'subscribe')?.args")
        last = page.evaluate("tqi.bars[tqi.bars.length - 1].c")
        E, S, T = round(last - 150, 1), round(last - 450, 1), round(last + 750, 1)
        for k, v in (('entry', E), ('stop', S), ('target', T)):
            page.fill(f'#rbody [data-plan={k}]', str(v)); page.dispatch_event(f'#rbody [data-plan={k}]', 'change')
        page.wait_for_timeout(300)
        per = abs(E - S) + E * 0.0002 + S * 0.00055
        qty = floor_step(50 / per, 0.001)
        lev = max(1, math.ceil(qty * E / (0.9 * 9500)))
        R['tr_calc'] = page.evaluate("(() => { const c = tqi.trader.calc(); return { long: c.long, qty: c.qty, lev: c.lev, rr: c.rr, warn: c.warn, risk: c.risk }; })()")
        R['tr_calc_expected'] = {'qty': qty, 'lev': lev, 'rr': (T - E) / (E - S)}
        R['tr_lines'] = page.evaluate("tqi.trader.lines().map(l => l.id + ':' + l.label)")
        shot(page, '11_trader_plan')
        # Stop-Linie im Chart ziehen
        box = page.locator('#chart').bounding_box()
        y = page.evaluate(f"tqi.drawings.pToY({S})")
        page.mouse.move(box['x'] + 500, box['y'] + y); page.mouse.down(); page.mouse.move(box['x'] + 500, box['y'] + y + 20, steps=4); page.mouse.move(box['x'] + 500, box['y'] + y + 40, steps=4); page.mouse.up()
        page.wait_for_timeout(300)
        R['tr_drag_stop'] = page.evaluate(f"({{ before: {S}, after: tqi.trader.plan.stop, input: document.querySelector('#rbody [data-plan=stop]').value }})")
        # Strg+Klick = Entry, Alt+Klick = Ziel
        yE = page.evaluate(f"tqi.drawings.pToY({E - 50})")
        page.keyboard.down('Control'); page.mouse.click(box['x'] + 600, box['y'] + yE); page.keyboard.up('Control')
        page.wait_for_timeout(200)
        R['tr_ctrl_click_entry'] = page.evaluate(f"({{ want: {E - 50}, got: tqi.trader.plan.entry }})")
        S2 = page.evaluate("tqi.trader.plan.stop"); E2 = page.evaluate("tqi.trader.plan.entry")
        # Senden → Bestätigung → Abbrechen: keine Order
        n0 = by.count('/v5/order/create')
        page.click('#rbody [data-act=send]'); page.wait_for_timeout(400)
        R['tr_confirm_text'] = page.evaluate("document.querySelector('#modal .mdlg')?.innerText.replace(/\\s+/g, ' ').slice(0, 400)")
        shot(page, '12_trader_bestaetigen')
        page.click('#modal [data-no]'); page.wait_for_timeout(400)
        R['tr_cancel_no_order'] = by.count('/v5/order/create') == n0
        # Senden → Bestätigen → Order
        page.click('#rbody [data-act=send]'); page.wait_for_timeout(300)
        page.click('#modal [data-ok]'); page.wait_for_timeout(900)
        o = by.last('/v5/order/create')
        c = page.evaluate("tqi.trader.calc()")
        R['tr_order'] = o['body'] if o else None
        R['tr_order_check'] = bool(o) and o['body']['side'] == 'Buy' and o['body']['orderType'] == 'Limit' and o['body']['timeInForce'] == 'PostOnly' and o['body']['price'] == f'{E2:.1f}' and o['body']['stopLoss'] == f'{S2:.1f}' and o['body']['positionIdx'] == 0 and o['body']['qty'] == f"{c['qty']:.3f}"
        R['tr_setlev_before_order'] = [r['path'] for r in by.reqs if r['m'] == 'POST'][-2:]
        R['tr_bad_signatures'] = by.bad_sig
        # Stop (Ausbruch) prüfen: Trigger über dem Kurs
        page.click('#rbody [data-type=stop]'); page.wait_for_timeout(200)
        for k, v in (('entry', round(last + 200, 1)), ('stop', round(last - 100, 1))):
            page.fill(f'#rbody [data-plan={k}]', str(v)); page.dispatch_event(f'#rbody [data-plan={k}]', 'change')
        page.click('#rbody [data-act=send]'); page.wait_for_timeout(300); page.click('#modal [data-ok]'); page.wait_for_timeout(800)
        o2 = by.last('/v5/order/create')['body']
        R['tr_stop_order'] = {k: o2.get(k) for k in ('side', 'orderType', 'triggerPrice', 'triggerDirection', 'price', 'timeInForce')}
        # Market: Entry = aktueller Kurs, Short mit Stop darüber
        page.click('#rbody [data-type=market]'); page.wait_for_timeout(200)
        page.fill('#rbody [data-plan=stop]', str(round(last + 300, 1))); page.dispatch_event('#rbody [data-plan=stop]', 'change'); page.wait_for_timeout(200)
        R['tr_market'] = page.evaluate("(() => { const c = tqi.trader.calc(); return { long: c?.long, entryDisabled: document.querySelector('#rbody [data-plan=entry]').disabled, entryLine: tqi.trader.lines().find(l => l.id === 'entry')?.label }; })()")
        page.click('#rbody [data-act=send]'); page.wait_for_timeout(300); page.click('#modal [data-ok]'); page.wait_for_timeout(800)
        o3 = by.last('/v5/order/create')['body']
        R['tr_market_order'] = {k: o3.get(k) for k in ('side', 'orderType', 'qty', 'stopLoss', 'price')}
        page.click('#rbody [data-type=limit]')
        # Position + Order kommen über den WebSocket
        pos = {'symbol': 'BTCUSDT', 'side': 'Buy', 'size': '0.05', 'avgPrice': str(round(last - 100, 1)), 'stopLoss': str(round(last - 400, 1)), 'takeProfit': str(round(last + 600, 1)), 'liqPrice': str(round(last * 0.7, 1)), 'unrealisedPnl': '4.2', 'leverage': '3'}
        ordr = {'symbol': 'BTCUSDT', 'orderId': 'o-77', 'side': 'Sell', 'qty': '0.02', 'price': str(round(last + 900, 1)), 'orderType': 'Limit', 'orderStatus': 'New', 'reduceOnly': True}
        by.pos = [pos]; by.orders = [ordr]   # REST-Abfragen liefern denselben Stand
        page.evaluate(f"window.__bybitWs._emit({{ topic: 'position', data: [{json.dumps(pos)}] }})")
        page.evaluate(f"window.__bybitWs._emit({{ topic: 'order', data: [{json.dumps(ordr)}] }})")
        page.wait_for_timeout(400)
        page.evaluate("tqi.trader.plan = { entry: null, stop: null, target: null }; tqi.trader.render(true); tqi.trader.redraw()")
        R['tr_pos_panel'] = page.evaluate("document.querySelector('#rbody').innerText.replace(/\\s+/g, ' ').slice(0, 260)")
        R['tr_pos_lines'] = page.evaluate("tqi.trader.lines().map(l => l.id)")
        shot(page, '13_trader_position', 300)
        # SL ziehen → Bestätigung → trading-stop
        ysl = page.evaluate(f"tqi.drawings.pToY({pos['stopLoss']})")
        page.mouse.move(box['x'] + 500, box['y'] + ysl); page.mouse.down(); page.mouse.move(box['x'] + 500, box['y'] + ysl - 30, steps=5); page.mouse.up()
        page.wait_for_timeout(400)
        R['tr_sl_confirm'] = page.evaluate("document.querySelector('#modal .mdlg')?.innerText.replace(/\\s+/g, ' ').slice(0, 160)")
        page.click('#modal [data-ok]'); page.wait_for_timeout(700)
        R['tr_sl_request'] = by.last('/v5/position/trading-stop')['body']
        # Break-even, Order löschen, Position schließen (je mit Bestätigung)
        page.click('#rbody [data-act=be]'); page.wait_for_timeout(300); page.click('#modal [data-ok]'); page.wait_for_timeout(700)
        R['tr_be'] = by.last('/v5/position/trading-stop')['body'].get('stopLoss')
        R['tr_be_expected'] = f"{round(round(float(pos['avgPrice']) * (1 + 0.0002 + 0.00055) / 0.1) * 0.1, 1):.1f}"
        page.click('#rbody [data-cancel="o-77"]'); page.wait_for_timeout(300); page.click('#modal [data-ok]'); page.wait_for_timeout(700)
        R['tr_cancel_one'] = by.last('/v5/order/cancel')['body']
        page.click('#rbody [data-act=close]'); page.wait_for_timeout(300)
        shot(page, '14_trader_schliessen')
        page.click('#modal [data-ok]'); page.wait_for_timeout(700)
        R['tr_close'] = by.last('/v5/order/create')['body']
        # Live einschalten → Bestätigung → abbrechen: bleibt Demo
        page.click('#rbody [data-env=live]'); page.wait_for_timeout(300)
        R['tr_live_confirm'] = page.evaluate("document.querySelector('#modal .mdlg')?.innerText.replace(/\\s+/g, ' ').slice(0, 120)")
        page.click('#modal [data-no]'); page.wait_for_timeout(300)
        R['tr_still_demo'] = page.evaluate("tqi.state.trader.env")
        # Panel schließen → Linien weg, Knopf aus
        page.click('#rhead [data-x]'); page.wait_for_timeout(300)
        R['tr_closed'] = page.evaluate("({ open: tqi.trader.open, lines: tqi.trader.lines().length, btnOn: document.querySelector('#traderBtn').classList.contains('on'), right: tqi.state.rightOpen })")
        shot(page, '15_trader_zu')
        page.click('#traderBtn'); page.wait_for_timeout(500)
        R['tr_reopen'] = page.evaluate("({ open: tqi.trader.open, lines: tqi.trader.lines().length })")
        R['bybit_paths'] = sorted(set(r['path'] for r in by.reqs))
        R['bybit_hosts_live'] = sum(1 for r in by.reqs if False)
        page.context.close()

        # ================================================================ 5) Trader auf dem Handy (Blatt von unten, „antippen“)
        by2 = Bybit()
        m = new_page({'width': 390, 'height': 844}, mobile=True, bybit=by2)
        m.wait_for_timeout(1500)
        m.evaluate(f"localStorage.setItem('tqi-charts:trader-keys', JSON.stringify({{ demo: {{ key: '{KEY}', secret: '{SECRET}' }} }})); tqi.trader.keys = JSON.parse(localStorage.getItem('tqi-charts:trader-keys'))")
        m.click('#mbMore'); m.wait_for_timeout(600)
        m.click('.row-btn[data-k=trader]'); m.wait_for_timeout(1500)
        R['m_sheet'] = m.evaluate("({ open: tqi.trader.open, sheet: !!document.querySelector('.trader-sheet'), wallet: tqi.trader.wallet })")
        shot(m, '20_handy_trader')
        m.click('.trader-sheet [data-pick=stop]'); m.wait_for_timeout(500)
        R['m_pick_sheet_closed'] = m.evaluate("!document.querySelector('.trader-sheet') && tqi.trader.pick === 'stop'")
        mb = m.locator('#chart').bounding_box()
        m.touchscreen.tap(mb['x'] + 200, mb['y'] + mb['height'] * 0.7); m.wait_for_timeout(900)
        R['m_tap_sets_stop'] = m.evaluate("({ stop: tqi.trader.plan.stop, sheet: !!document.querySelector('.trader-sheet') })")
        shot(m, '21_handy_trader_stop')
        m.context.close()
        browser.close()
    srv.shutdown()
    errs = [e for e in errors if 'favicon' not in e and 'manifest' not in e]
    print(json.dumps(R, ensure_ascii=False, indent=1, default=str))
    print('\nKonsole:', len(errs))
    for e in errs[:30]: print('  ', e[:300])

if __name__ == '__main__':
    main()
