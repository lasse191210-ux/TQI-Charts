# Tests für Version 1.6 (Teil 2): Session-Boxen, Termine, Symbol vergleichen, RTH Initial Balance, Bar Replay,
# Footprint, Absorption, Level-Alarme mit Discord/Telegram (simuliert), Journal (Bybit simuliert, nur lesen),
# mehrere Charts (gekoppeltes Fadenkreuz / Symbol), Sync über GitHub Gist (simuliert, keine Geheimnisse im Gist).
# Aufruf: python3 test/v16b.py  → Screenshots in test/out/v16b_*.png
import json, os, re, sys, time
from urllib.parse import urlparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e import serve, OUT
from v12 import Bybit, KEY, SECRET, BYBIT_WS
from v16 import ctx_for
from playwright.sync_api import sync_playwright

NOW = int(time.time() * 1000)
TOKEN = 'ghp_' + 'T' * 36   # nur Test (simuliertes GitHub)

class BybitJ(Bybit):
    def handle(self, route):
        u = urlparse(route.request.url)
        cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'}
        if route.request.method == 'OPTIONS': return route.fulfill(status=200, headers=cors, body='')
        if u.path == '/v5/position/closed-pnl':
            self.reqs.append({'path': u.path, 'm': 'GET', 'priv': True})
            q = dict(x.split('=') for x in u.query.split('&'))
            lst = [
              {'symbol': 'BTCUSDT', 'orderId': 'c1', 'side': 'Sell', 'qty': '0.01', 'closedSize': '0.01', 'avgEntryPrice': '84000', 'avgExitPrice': '84500', 'closedPnl': '4.2', 'openFee': '0.17', 'closeFee': '0.46', 'leverage': '5', 'fillCount': '1', 'createdTime': str(NOW - 3600000), 'updatedTime': str(NOW - 3600000)},
              {'symbol': 'ETHUSDT', 'orderId': 'c2', 'side': 'Buy', 'qty': '0.5', 'closedSize': '0.5', 'avgEntryPrice': '3000', 'avgExitPrice': '3020', 'closedPnl': '-10.9', 'openFee': '0.3', 'closeFee': '0.6', 'leverage': '3', 'fillCount': '2', 'createdTime': str(NOW - 7200000), 'updatedTime': str(NOW - 7200000)},
            ] if int(q['endTime']) > NOW - 86400000 else []
            return route.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps({'retCode': 0, 'retMsg': 'OK', 'result': {'list': lst, 'nextPageCursor': ''}}))
        if u.path == '/v5/execution/list':
            self.reqs.append({'path': u.path, 'm': 'GET', 'priv': True})
            lst = [{'execTime': str(NOW - 5400000), 'execPrice': '84000', 'execQty': '0.01', 'side': 'Buy', 'closedSize': '0', 'execType': 'Trade', 'execFee': '0.17'},
                   {'execTime': str(NOW - 3600000), 'execPrice': '84500', 'execQty': '0.01', 'side': 'Sell', 'closedSize': '0.01', 'execType': 'Trade', 'execFee': '0.46'}]
            return route.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps({'retCode': 0, 'retMsg': 'OK', 'result': {'list': lst, 'nextPageCursor': ''}}))
        return super().handle(route)

def main():
    srv = serve()
    errors, R, sent = [], {}, []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        def page_for(st, w=1440, h=860, mobile=False, extra=None):
            ctx = ctx_for(browser, st, w, h, mobile)
            if extra: extra(ctx)
            p = ctx.new_page()
            p.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
            p.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
            p.on('dialog', lambda d: d.accept())
            return ctx, p
        base = {'template': 'leer', 'tplV': 2, 'colorsV': 2, 'btV': 3, 'paintV': 1, 'hvbV': 1, 'theme': 'light', 'tf': '15m', 'rightOpen': False}

        # ---- 1) Session-Boxen, Termine, Vergleich, IB
        ctx, p = page_for({**base, 'indicators': [{'uid': 's1', 'type': 'sessions', 'visible': True, 's': {}}, {'uid': 'e1', 'type': 'events', 'visible': True, 's': {}},
                                                  {'uid': 'c1', 'type': 'compare', 'visible': True, 's': {'sym': 'ETH'}}, {'uid': 'i1', 'type': 'ib', 'visible': True, 's': {}}]})
        p.goto('http://127.0.0.1:8765/index.html'); p.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000); p.wait_for_timeout(4000)
        p.evaluate("tqi.chart.timeScale().setVisibleLogicalRange({ from: tqi.bars.length - 300, to: tqi.bars.length + 5 })"); p.wait_for_timeout(500)
        R['ind'] = p.evaluate("""() => {
          const s = tqi.data.get('s1').list, ib = tqi.data.get('i1').list, e = tqi.data.get('e1'), c = tqi.data.get('c1');
          const ibOk = ib.every(x => { const d = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(x.st)); return d === '09:30' && x.ibEnd - x.st === 3600000; });
          return { sessions: s.length, kinds: [...new Set(s.map(x => x.k))].join(''), ib: ib.length, ibAt0930NY: ibOk, ibHiLo: ib.every(x => x.hi >= x.lo),
            events: e.list.length, nextEvent: e.next && e.next.name, cmpVals: c ? c.vals.filter(Number.isFinite).length : 0,
            stores: [...tqi.hub.stores.keys()].filter(k => k.includes('|ETH|')).length, legend: [...document.querySelectorAll('#legend .lg-title')].map(x => x.textContent) };
        }""")
        p.screenshot(path=os.path.join(OUT, 'v16b_01_sessions_ib_vergleich.png'))
        # Replay
        p.click('#replayBtn'); p.wait_for_timeout(200)
        box = p.evaluate("() => { const r = tqi.ui.chartEl.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }")
        p.mouse.click(box['x'] + box['w'] * 0.5, box['y'] + box['h'] * 0.5); p.wait_for_timeout(600)
        r1 = p.evaluate("() => ({ on: tqi.replay.on, n: tqi.bars.length, all: tqi.chartStore.bars.length, d1Last: tqi.makeCtx().store('1D').bars.at(-1).t <= tqi.replay.t, status: document.querySelector('#status span').textContent, ibFuture: tqi.data.get('i1').list.every(x => x.st <= tqi.replay.cut) })")
        p.keyboard.press('Shift+ArrowRight'); p.wait_for_timeout(200)
        r1['afterStep'] = p.evaluate("tqi.bars.length")
        p.click('#replayBar [data-r="play"]'); p.wait_for_timeout(1300); p.click('#replayBar [data-r="play"]')
        r1['afterPlay'] = p.evaluate("tqi.bars.length")
        p.screenshot(path=os.path.join(OUT, 'v16b_02_replay.png'))
        p.click('#replayBar [data-r="exit"]'); p.wait_for_timeout(500)
        r1['exit'] = p.evaluate("({ on: tqi.replay.on, n: tqi.bars.length === tqi.chartStore.bars.length })")
        R['replay'] = r1
        ctx.close()

        # ---- 2) Footprint und Absorption (1 Min.)
        ctx, p = page_for({**base, 'tf': '1m', 'indicators': [{'uid': 'f1', 'type': 'footprint', 'visible': True, 's': {}}, {'uid': 'a1', 'type': 'absorption', 'visible': True, 's': {'k': 0.6, 'prog': 1.5, 'flip': False}}]})
        p.goto('http://127.0.0.1:8765/index.html'); p.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000); p.wait_for_timeout(8000)
        p.evaluate("tqi.chart.timeScale().setVisibleLogicalRange({ from: tqi.bars.length - 14, to: tqi.bars.length + 1 })"); p.wait_for_timeout(600)
        R['footprint'] = p.evaluate("""() => {
          const d = tqi.data.get('f1'), a = tqi.data.get('a1');
          const b = d.bars.at(-2); let bid = 0, ask = 0; for (const c of b.cells.values()) { bid += c[0]; ask += c[1]; }
          const bar = tqi.bars[b.i];
          return { fp: !!tqi.bt.fp, rb: d.rb, bars: d.bars.length, cellsVsBar: Math.abs((bid + ask) - bar.v) / bar.v < 0.05 ? 'Volumen passt' : [bid + ask, bar.v], abs: a.list.length, absDirs: [...new Set(a.list.map(x => x.dir))].join(','), note: d.note };
        }""")
        p.screenshot(path=os.path.join(OUT, 'v16b_03_footprint.png'))
        ctx.close()

        # ---- 3) Level-Alarme mit Discord / Telegram (simuliert)
        def push_routes(c):
            def disc(route): sent.append(('discord', route.request.post_data)); route.fulfill(status=204, body='')
            def tg(route):
                sent.append(('telegram', route.request.post_data))
                route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body='{"ok":true,"result":[{"message":{"chat":{"id":424242}}}]}')
            c.route(re.compile(r'https://discord\.com/api/webhooks/.*'), disc)
            c.route(re.compile(r'https://api\.telegram\.org/.*'), tg)
        ctx, p = page_for({**base, 'indicators': [{'uid': 'k1', 'type': 'keylevels', 'visible': True, 's': {}}, {'uid': 'i1', 'type': 'ib', 'visible': True, 's': {}}]}, extra=push_routes)
        p.goto('http://127.0.0.1:8765/index.html'); p.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000); p.wait_for_timeout(2500)
        p.evaluate("tqi.ui.openAlerts()"); p.wait_for_timeout(200); p.click('#alLevels'); p.wait_for_timeout(250)
        p.click('label.chk:has([data-k="on"]) i'); p.wait_for_timeout(150)
        p.fill('#pDc', 'https://discord.com/api/webhooks/123456789/abcDEF_ghi-jkl'); p.dispatch_event('#pDc', 'change')
        p.fill('#pTgT', '123456789:AAEhBOweik6ad6PsVMRxjeQKmPKMQ2nRZQs'); p.dispatch_event('#pTgT', 'change')
        p.click('#pTgGet'); p.wait_for_timeout(400)
        p.screenshot(path=os.path.join(OUT, 'v16b_04_level_alarme.png'))
        p.click('#pTest'); p.wait_for_timeout(500); p.click('#laOk'); p.wait_for_timeout(300)
        R['alarm'] = p.evaluate("""() => {
          tqi.hub.stopLive();
          const c = tqi.lvAlerts.cands, lv = c.find(x => !x.zone);
          tqi._loadedAt = Date.now() - 20000;
          tqi.lvAlerts.last = lv.p - 1; tqi.lvAlerts.check(lv.p + 1); tqi.lvAlerts.check(lv.p - 1); tqi.lvAlerts.check(lv.p + 1);
          return { cands: c.length, zones: c.filter(x => x.zone).length, fired: [...tqi.lvAlerts.fired.keys()].length, chat: document.querySelector('#pTgC')?.value ?? JSON.parse(localStorage.getItem('tqi-charts:push')).tgChat,
            notInState: !JSON.stringify(tqi.state).includes('AAEhBOweik') && !JSON.stringify(tqi.state).includes('webhooks') };
        }""")
        p.wait_for_timeout(600)
        R['alarm']['sent'] = [s[0] for s in sent]
        R['alarm']['text'] = [s[1] for s in sent if s[0] == 'telegram' and s[1] and 'ber%C3%BChrt' in s[1]][:1]
        ctx.close()

        # ---- 4) Journal (Bybit simuliert, nur lesen)
        by = BybitJ()
        def jr(c):
            c.add_init_script(BYBIT_WS)
            c.add_init_script(f"localStorage.setItem('tqi-charts:trader-keys', JSON.stringify({{ demo: {{ key: '{KEY}', secret: '{SECRET}' }} }}));")
            c.route(re.compile(r'https://api(-demo)?\.bybit\.com/.*'), by.handle)
        ctx, p = page_for({**base, 'indicators': []}, extra=jr)
        p.goto('http://127.0.0.1:8765/index.html'); p.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000); p.wait_for_timeout(2000)
        p.evaluate("tqi.journal.open()"); p.wait_for_timeout(1500)
        p.fill('.jr-row[data-id^="c1"] input[data-n="risk"]', '10'); p.dispatch_event('.jr-row[data-id^="c1"] input[data-n="risk"]', 'change'); p.wait_for_timeout(200)
        R['journal'] = p.evaluate("""() => ({ trades: tqi.journal.trades.map(x => x.symbol + (x.long ? ' Long ' : ' Short ') + x.pnl).join(' | '), rows: document.querySelectorAll('.jr-row').length,
          r: document.querySelector('.jr-row[data-id^="c1"] .jr-r')?.textContent, marks: tqi.overlay.scene.marks.length, csvHead: tqi.journal.csv(tqi.journal.trades).split('\\n')[0].slice(1, 40) })""")
        R['journal']['badSig'] = by.bad_sig
        R['journal']['writes'] = [x['path'] for x in by.reqs if x.get('m') == 'POST']
        p.screenshot(path=os.path.join(OUT, 'v16b_05_journal.png'))
        ctx.close()

        # ---- 5) Mehrere Charts
        ctx, p = page_for({**base, 'template': 'bild'})
        p.goto('http://127.0.0.1:8765/index.html?multi=4'); p.wait_for_timeout(9000)
        frames = [f for f in p.frames if 'slot=' in f.url]
        R['multi'] = {'cells': len(frames), 'tfs': [f.evaluate("tqi.state.tf") for f in frames], 'desktop': all(f.evaluate("innerWidth >= 761") for f in frames)}
        cell = p.query_selector('.mh-cell[data-slot="1"]').bounding_box()
        p.mouse.move(cell['x'] + cell['width'] * 0.5, cell['y'] + cell['height'] * 0.5); p.wait_for_timeout(120)
        p.mouse.move(cell['x'] + cell['width'] * 0.52, cell['y'] + cell['height'] * 0.5); p.wait_for_timeout(500)
        R['multi']['xhairOthers'] = [f.evaluate("tqi.crossIdx != null") for f in frames[1:]]
        p.screenshot(path=os.path.join(OUT, 'v16b_06_mehrere_charts.png'))
        p.check('[data-c="sym"]', force=True)
        frames[0].evaluate("tqi.setSymbol('ETH')"); p.wait_for_timeout(4000)
        R['multi']['symLinked'] = [f.evaluate("tqi.state.base") for f in frames]
        ctx.close()

        # ---- 6) Sync über GitHub Gist (simuliert)
        G = {'id': None, 'files': {}}
        def gh(route):
            r = route.request
            cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS'}
            if r.method == 'OPTIONS': return route.fulfill(status=204, headers=cors, body='')
            if r.headers.get('authorization') != 'Bearer ' + TOKEN: return route.fulfill(status=401, headers=cors, body='{}')
            u = r.url
            if r.method == 'GET' and '/gists?' in u: return route.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps([{'id': G['id'], 'description': 'TQI Charts Sync (privat)', 'files': {k: {} for k in G['files']}}] if G['id'] else []))
            if r.method == 'POST': b = json.loads(r.post_data); G.update(id='g1', public=b['public'], files={k: v['content'] for k, v in b['files'].items()}); return route.fulfill(status=201, headers=cors, content_type='application/json', body='{"id":"g1"}')
            if r.method == 'PATCH': b = json.loads(r.post_data); G['files'].update({k: v['content'] for k, v in b['files'].items()}); return route.fulfill(status=200, headers=cors, content_type='application/json', body='{"id":"g1"}')
            return route.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps({'id': G['id'], 'files': {k: {'content': v, 'truncated': False} for k, v in G['files'].items()}}))
        def sy(c):
            c.route(re.compile(r'https://api\.github\.com/.*'), gh)
            c.add_init_script("localStorage.setItem('tqi-charts:trader-keys', JSON.stringify({ demo: { key: 'K', secret: 'GEHEIM-SECRET' } }));")
            c.route(re.compile(r'https://api(-demo)?\.bybit\.com/.*'), BybitJ().handle)
        ctx, A = page_for({**base, 'template': 'bild'}, extra=sy)
        A.goto('http://127.0.0.1:8765/index.html'); A.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000); A.wait_for_timeout(1500)
        A.evaluate("tqi.drawings.addAt('hline', tqi.bars.at(-1).c * 1.01)")
        A.evaluate("tqi.ui.openSync()"); A.wait_for_timeout(200)
        A.fill('#syTok', TOKEN); A.dispatch_event('#syTok', 'change'); A.click('#syUp'); A.wait_for_timeout(1200)
        A.screenshot(path=os.path.join(OUT, 'v16b_07_sync.png'))
        raw = G['files'].get('tqi-charts-sync.json', '')
        ctx.close()
        ctxB, B = page_for({'theme': 'dark', 'tf': '1h'}, 390, 844, True, extra=sy)
        B.goto('http://127.0.0.1:8765/index.html'); B.wait_for_function('window.tqi && window.tqi.bars.length > 50', timeout=20000); B.wait_for_timeout(800)
        B.evaluate("tqi.ui.openSync()"); B.wait_for_timeout(200)
        B.fill('#syTok', TOKEN); B.dispatch_event('#syTok', 'change'); B.click('#syDown'); B.wait_for_timeout(4000)
        B.wait_for_function('window.tqi && window.tqi.bars.length > 50', timeout=20000)
        R['sync'] = {'private': G.get('public') is False, 'noSecrets': not any(x in raw for x in ['GEHEIM-SECRET', TOKEN, 'trader-keys']), 'keys': sorted(json.loads(raw)['data'].keys()) if raw else None,
                     'B': B.evaluate("({ tf: tqi.state.tf, theme: tqi.state.theme, draws: tqi.drawings.items.length })")}
        ctxB.close()
        browser.close()
    srv.shutdown()
    print(json.dumps(R, indent=1, ensure_ascii=False))
    print('\nKonsole:', len(errors))
    for e in errors[:12]: print(' ', e)

if __name__ == '__main__':
    main()
