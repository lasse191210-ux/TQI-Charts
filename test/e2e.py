# Browser-Test mit simulierten Börsendaten (Binance-Format) und simuliertem WebSocket.
# Aufruf: python3 test/e2e.py [szenario]  → Screenshots in test/out/
import json, math, os, sys, threading, time, functools, re
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import numpy as np
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test', 'out')
os.makedirs(OUT, exist_ok=True)
MIN = 60_000
HOUR = 60 * MIN
DAY = 24 * HOUR

# ------------------------------------------------------------------ synthetische Daten
def gen(n, step, p0, sigma, seed, vol_base):
    r = np.random.default_rng(seed)
    sig = np.clip(sigma * np.exp(np.cumsum(r.normal(0, 0.02, n))) , sigma * 0.3, sigma * 4)
    drift = np.repeat(r.normal(0, sigma * 0.08, n // 500 + 1), 500)[:n]
    ret = drift + sig * r.normal(0, 1, n)
    c = p0 * np.exp(np.cumsum(ret))
    o = np.concatenate([[p0], c[:-1]])
    h = np.maximum(o, c) * (1 + np.abs(r.normal(0, 1, n)) * sig * 0.6)
    l = np.minimum(o, c) * (1 - np.abs(r.normal(0, 1, n)) * sig * 0.6)
    v = vol_base * (1 + np.abs(ret) / sig * 0.7) * (0.6 + r.random(n) * 0.8)
    spikes = r.random(n) < 0.003
    v[spikes] *= 6 + r.random(spikes.sum()) * 10
    buy = np.clip(0.5 + ret / sig * 0.12 + (r.random(n) - 0.5) * 0.1, 0.05, 0.95)
    return o, h, l, c, v, v * buy

NOW = int(time.time() * 1000) // MIN * MIN
N1 = 45 * 24 * 60
T1 = NOW - (N1 - 1) * MIN
NH = 420 * 24
TH_END = T1 // HOUR * HOUR  # 1h-Serie endet vor Start der 1m-Serie
TH = TH_END - NH * HOUR
oh, hh, lh, ch, vh, bh = gen(NH, HOUR, 82000, 0.0045, 11, 900)
scale = 60500 / ch[-1] * 1.0
oh, hh, lh, ch = oh * scale, hh * scale, lh * scale, ch * scale
o1, h1, l1, c1, v1, b1 = gen(N1, MIN, ch[-1], 0.0009, 5, 16)
t1 = T1 + np.arange(N1, dtype=np.int64) * MIN
th = TH + np.arange(NH, dtype=np.int64) * HOUR
LAST = float(c1[-1])

def agg(t, o, h, l, c, v, b, bucket_fn):
    keys = bucket_fn(t)
    idx = np.flatnonzero(np.diff(keys, prepend=keys[0] - 1))
    ends = np.append(idx[1:], len(t)) - 1
    return (keys[idx], o[idx], np.maximum.reduceat(h, idx), np.minimum.reduceat(l, idx), c[ends], np.add.reduceat(v, idx), np.add.reduceat(b, idx))

def week_floor(t):
    d = t // DAY * DAY
    dow = ((d // DAY) + 3) % 7  # 1970-01-01 war Donnerstag → Montag = 0
    return d - dow * DAY
def month_floor(t):
    import datetime
    out = np.empty_like(t)
    for i, x in enumerate(t):
        dt = datetime.datetime.utcfromtimestamp(x / 1000)
        out[i] = int(datetime.datetime(dt.year, dt.month, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)
    return out

IV_MS = {'1m': MIN, '3m': 3 * MIN, '5m': 5 * MIN, '15m': 15 * MIN, '30m': 30 * MIN, '1h': HOUR, '2h': 2 * HOUR, '4h': 4 * HOUR, '6h': 6 * HOUR, '12h': 12 * HOUR, '1d': DAY}
CACHE = {}
def series(iv, factor=1.0):
    key = (iv, factor)
    if key in CACHE: return CACHE[key]
    if iv in ('1m', '3m', '5m', '15m', '30m'):
        ms = IV_MS[iv]
        s = agg(t1, o1, h1, l1, c1, v1, b1, lambda t: t // ms * ms)
    else:
        # 1h-Historie + 1m-Teil zu 1h zusammengefasst
        p1h = agg(t1, o1, h1, l1, c1, v1, b1, lambda t: t // HOUR * HOUR)
        T = np.concatenate([th, p1h[0]]); O = np.concatenate([oh, p1h[1]]); H = np.concatenate([hh, p1h[2]]); L = np.concatenate([lh, p1h[3]])
        C = np.concatenate([ch, p1h[4]]); V = np.concatenate([vh, p1h[5]]); B = np.concatenate([bh, p1h[6]])
        if iv == '1w': fn = week_floor
        elif iv == '1M': fn = month_floor
        else:
            ms = IV_MS[iv]; fn = lambda t: t // ms * ms
        s = agg(T, O, H, L, C, V, B, fn)
    if factor != 1.0:
        s = (s[0], s[1] * factor, s[2] * factor, s[3] * factor, s[4] * factor, s[5] / factor, s[6] / factor)
    CACHE[key] = s
    return s

FACT = {'BTC': 1.0, 'ETH': 1 / 21.5, 'SOL': 1 / 410, 'XRP': 1 / 27000, 'BNB': 1 / 95, 'DOGE': 1 / 380000}
def factor_for(sym):
    for k, f in FACT.items():
        if sym.startswith(k): return f
    return 1 / 1000

def klines(q):
    sym = q.get('symbol', ['BTCUSDT'])[0]
    iv = q.get('interval', ['15m'])[0]
    limit = int(q.get('limit', ['500'])[0])
    end = int(q['endTime'][0]) if 'endTime' in q else None
    start = int(q['startTime'][0]) if 'startTime' in q else None
    T, O, H, L, C, V, B = series(iv, factor_for(sym))
    m = np.ones(len(T), bool)
    if end is not None: m &= T <= end
    if start is not None: m &= T >= start
    idx = np.flatnonzero(m)
    idx = idx[:limit] if start is not None and end is None else idx[-limit:]
    ms = IV_MS.get(iv, DAY)
    return [[int(T[i]), f'{O[i]:.2f}', f'{H[i]:.2f}', f'{L[i]:.2f}', f'{C[i]:.2f}', f'{V[i]:.4f}', int(T[i] + ms - 1), f'{V[i]*C[i]:.2f}', 100, f'{B[i]:.4f}', f'{B[i]*C[i]:.2f}', '0'] for i in idx]

def oi_hist(q):
    period = q.get('period', ['15m'])[0]
    ms = IV_MS.get(period.replace('d', 'd'), 15 * MIN) if period != '1d' else DAY
    limit = int(q.get('limit', ['500'])[0])
    start = int(q.get('startTime', [str(NOW - 29 * DAY)])[0])
    end = int(q.get('endTime', [str(NOW)])[0])
    out = []
    t = max(start, NOW - 29 * DAY) // ms * ms
    while t <= end and len(out) < limit:
        v = 85000 + 6000 * math.sin(t / DAY / 3) + 1500 * math.sin(t / HOUR)
        out.append({'symbol': q.get('symbol', ['BTCUSDT'])[0], 'sumOpenInterest': f'{v:.3f}', 'sumOpenInterestValue': f'{v*LAST:.2f}', 'timestamp': int(t)})
        t += ms
    return out

def funding(q):
    start = int(q.get('startTime', [str(NOW - 60 * DAY)])[0])
    out = []
    t = start // (8 * HOUR) * (8 * HOUR) + 8 * HOUR
    while t <= NOW and len(out) < 1000:
        out.append({'symbol': 'BTCUSDT', 'fundingTime': t, 'fundingRate': f'{0.0001 * math.sin(t / DAY / 5) + 0.00004:.8f}', 'markPrice': f'{LAST:.2f}'})
        t += 8 * HOUR
    return out

K_TR = 40  # simulierte aggTrades je 1m-Kerze
def agg_trades(q):
    f = factor_for(q.get('symbol', ['BTCUSDT'])[0])
    max_id = len(t1) * K_TR - 1
    limit = min(1000, int(q.get('limit', ['500'])[0]))
    if 'fromId' in q:
        a = int(q['fromId'][0]); b = min(max_id, a + limit - 1)
    else:
        b = max_id; a = max(0, b - limit + 1)
    out = []
    for i in range(a, b + 1):
        m = i // K_TR; j = i % K_TR
        lo, hi = l1[m] * f, h1[m] * f
        r = ((i * 2654435761) % 4294967296) / 4294967296
        buy = j < int(round(K_TR * b1[m] / v1[m]))
        out.append({'a': i, 'p': f'{lo + (hi - lo) * r:.2f}', 'q': f'{v1[m] / K_TR / f:.4f}', 'f': i, 'l': i, 'T': int(t1[m] + j * (MIN // K_TR)), 'm': not buy})
    return out

def api(url):
    u = urlparse(url)
    q = parse_qs(u.query)
    p = u.path
    if p.endswith('/klines'): return klines(q)
    if p.endswith('/aggTrades'): return agg_trades(q)
    if p.endswith('/ticker/24hr'):
        f = factor_for(q.get('symbol', ['BTCUSDT'])[0])
        return {'symbol': q.get('symbol', ['BTCUSDT'])[0], 'lastPrice': f'{LAST*f:.4f}', 'priceChangePercent': f'{(hash(q.get("symbol",[""])[0]) % 900 - 450) / 100:.2f}', 'quoteVolume': '123456789'}
    if p.endswith('/openInterestHist'): return oi_hist(q)
    if p.endswith('/fundingRate'): return funding(q)
    if p.endswith('/depth'):
        f = factor_for(q.get('symbol', ['BTCUSDT'])[0])
        mid = LAST * f
        return {'lastUpdateId': 1000, 'bids': [[f'{mid - 0.1 - i * 0.5:.1f}', f'{(i % 7) * 0.8 + 0.2:.3f}'] for i in range(800)], 'asks': [[f'{mid + 0.1 + i * 0.5:.1f}', f'{(i % 5) * 0.9 + 0.2:.3f}'] for i in range(800)]}
    if p.endswith('/premiumIndex'): return {'symbol': 'BTCUSDT', 'markPrice': f'{LAST:.2f}', 'indexPrice': f'{LAST:.2f}', 'lastFundingRate': '0.00006', 'nextFundingTime': NOW + 3 * HOUR, 'time': NOW}
    return None

# ------------------------------------------------------------------ simulierter WebSocket
FAKE_WS = """
(() => {
  const LAST = %LAST%;
  let px = LAST;
  class FakeWS {
    constructor(url) {
      this.url = url; this.readyState = 0; this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
      window.__ws = (window.__ws || []).concat([url]);
      setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); this._start(); }, 150);
    }
    _emit(obj) { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }
    _start() {
      const u = this.url;
      const combined = u.includes('/stream?');
      if (u.includes('aggTrade')) {
        this._t = setInterval(() => {
          const n = 1 + Math.floor(Math.random() * 4);
          for (let i = 0; i < n; i++) {
            px *= 1 + (Math.random() - 0.5) * 0.0006;
            const big = Math.random() < 0.04;
            const q = big ? 4 + Math.random() * 12 : Math.random() * 0.4;
            const d = { e: 'aggTrade', E: Date.now(), s: 'BTCUSDT', a: 1, p: px.toFixed(1), q: q.toFixed(3), f: 1, l: 1, T: Date.now(), m: Math.random() < 0.5 };
            this._emit(combined ? { stream: 'btcusdt@aggTrade', data: d } : d);
          }
          if (combined && Math.random() < 0.03) {
            const d = { e: 'forceOrder', E: Date.now(), o: { s: 'BTCUSDT', S: Math.random() < 0.5 ? 'SELL' : 'BUY', q: '1.2', p: px.toFixed(1), ap: px.toFixed(1), z: '1.2', T: Date.now() } };
            this._emit({ stream: 'btcusdt@forceOrder', data: d });
          }
        }, 120);
      }
      if (u.includes('bitstamp')) {
        this._t = setInterval(() => {
          px *= 1 + (Math.random() - 0.5) * 0.0006;
          this._emit({ event: 'trade', channel: 'live_trades_btcusd', data: { price: px * 0.9988, amount: Math.random() * 0.5, type: Math.random() < 0.5 ? 0 : 1, microtimestamp: String(Date.now() * 1000) } });
        }, 200);
      }
      if (u.includes('@depth@100ms')) {
        let id = 1001, prev = 995;
        this._d = setInterval(() => {
          const b = [], a = [];
          for (let i = 0; i < 12; i++) { const k = Math.floor(Math.random() * 400); b.push([(px - 0.1 - k * 0.5).toFixed(1), (Math.random() < 0.15 ? 0 : Math.random() * 4).toFixed(3)]); a.push([(px + 0.1 + k * 0.5).toFixed(1), (Math.random() < 0.15 ? 0 : Math.random() * 4).toFixed(3)]); }
          const U = prev + 1, uu = id;
          this._emit({ e: 'depthUpdate', E: Date.now(), T: Date.now(), s: 'BTCUSDT', U: id === 1001 ? 995 : U, u: uu, pu: id === 1001 ? 990 : prev, b, a });
          prev = uu; id += 3;
        }, 100);
      }
      if (u.includes('depth20')) {
        this._d = setInterval(() => {
          const b = [], a = [];
          for (let i = 0; i < 20; i++) { b.push([(px - 0.1 - i * 0.7).toFixed(1), (Math.random() * 3).toFixed(3)]); a.push([(px + 0.1 + i * 0.7).toFixed(1), (Math.random() * 3).toFixed(3)]); }
          this._emit(u.includes('fstream') ? { e: 'depthUpdate', b, a } : { lastUpdateId: 1, bids: b, asks: a });
        }, 250);
      }
    }
    send(raw) {
      // Deribit JSON-RPC (Options-Level): synthetische Optionskette um den aktuellen Kurs
      if (!this.url.includes('deribit')) return;
      let m; try { m = JSON.parse(raw); } catch { return; }
      const reply = (result) => setTimeout(() => this._emit({ jsonrpc: '2.0', id: m.id, result }), 60);
      if (m.method === 'public/get_index_price') return reply({ index_price: px, estimated_delivery_price: px });
      if (m.method === 'public/get_book_summary_by_currency') {
        const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        const now = Date.now(), out = [];
        for (const days of [1, 2, 7, 30, 90]) {
          const d = new Date(now + days * 864e5);
          const code = d.getUTCDate() + MON[d.getUTCMonth()] + String(d.getUTCFullYear()).slice(2);
          const base = Math.round(px / 1000) * 1000;
          for (let k = base - 25000; k <= base + 25000; k += 1000) {
            for (const cp of ['C', 'P']) {
              const dist = (k - px) / px;
              const oi = Math.max(5, (cp === 'C' ? (dist > 0 ? 400 : 120) : (dist < 0 ? 380 : 100)) * Math.exp(-Math.abs(dist) * 8) * (days === 7 ? 2.2 : days === 30 ? 3 : 1) * (k % 5000 === 0 ? 2.5 : 1));
              out.push({ instrument_name: `BTC-${code}-${k}-${cp}`, open_interest: oi, mark_iv: 48 + Math.abs(dist) * 60, underlying_price: px, mark_price: 0.01, volume: 10 });
            }
          }
        }
        return reply(out);
      }
      if (m.id) reply({});
    }
    close() { this.readyState = 3; clearInterval(this._t); clearInterval(this._d); this.onclose && this.onclose({}); }
  }
  FakeWS.OPEN = 1;
  window.WebSocket = FakeWS;
})();
"""

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    h = functools.partial(Quiet, directory=ROOT)
    srv = ThreadingHTTPServer(('127.0.0.1', 8765), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

BS_STEP = {60: '1m', 180: '3m', 300: '5m', 900: '15m', 1800: '30m', 3600: '1h', 7200: '2h', 14400: '4h', 21600: '6h', 43200: '12h', 86400: '1d'}
def bitstamp(url):
    # Bitstamp-Format, Preise leicht unter Binance (USD statt USDT), anderes Volumen
    u = urlparse(url); q = parse_qs(u.query); p = u.path
    m = re.match(r'/api/v2/ohlc/([a-z]+)usd/', p)
    if m:
        f = factor_for(m.group(1).upper()) * 0.9988
        step = int(q.get('step', ['900'])[0]); iv = BS_STEP.get(step, '15m')
        limit = min(1000, int(q.get('limit', ['500'])[0]))
        end = int(q['end'][0]) * 1000 if 'end' in q else None
        start = int(q['start'][0]) * 1000 if 'start' in q else None
        T, O, H, L, C, V, B = series(iv, 1.0)
        mk = np.ones(len(T), bool)
        if end is not None: mk &= T <= end
        if start is not None: mk &= T >= start
        idx = np.flatnonzero(mk)
        idx = idx[:limit] if start is not None and end is None else idx[-limit:]
        wob = lambda i: 0.6 + 0.8 * (((int(T[i]) // 900000) * 2654435761) % 1000) / 1000
        return {'data': {'pair': m.group(1).upper() + '/USD', 'ohlc': [{'timestamp': str(int(T[i]) // 1000), 'open': f'{O[i]*f:.2f}', 'high': f'{H[i]*f:.2f}', 'low': f'{L[i]*f:.2f}', 'close': f'{C[i]*f:.2f}', 'volume': f'{V[i]*0.05*wob(i):.6f}'} for i in idx]}}
    if '/ticker/' in p:
        return {'last': f'{LAST*0.9988:.2f}', 'open_24': f'{LAST*0.99:.2f}', 'open': f'{LAST*0.99:.2f}', 'volume': '1234.5'}
    if '/transactions/' in p:
        return [{'date': str(NOW // 1000 - i * 7), 'price': f'{LAST*0.9988:.2f}', 'amount': '0.5', 'tid': str(i), 'type': str(i % 2)} for i in range(200)]
    return None

def route_handler(route):
    url = route.request.url
    if 'bitstamp' in url:
        data = bitstamp(url)
        if data is not None:
            return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(data))
    if 'binance' in url:
        data = api(url)
        if data is not None:
            return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(data))
    return route.fulfill(status=404, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps({'msg': 'mock: nicht vorhanden'}))

def run(scenario='all'):
    srv = serve()
    errors = []
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
        shots = []
        def shot(page, name, wait=0):
            if wait: page.wait_for_timeout(wait)
            p = os.path.join(OUT, name + '.png'); page.screenshot(path=p); shots.append(p)
        url = 'http://127.0.0.1:8765/index.html'
        # 1) Desktop, Standard (dunkel), Vorlage „Bild“
        page = new_page({'width': 1440, 'height': 860})
        page.goto(url)
        page.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000)
        page.wait_for_timeout(3500)
        shot(page, '01_desktop_dark_bild')
        info = page.evaluate('''() => ({bars: tqi.bars.length, inds: tqi.state.indicators.map(i => i.type + (i.visible ? '' : '(aus)')), z: document.querySelector('#ztable').innerText, legend: document.querySelector('#legend').innerText.slice(0, 400), ws: window.__ws, stores: [...tqi.hub.stores.keys()].map(k => k + ':' + tqi.hub.stores.get(k).bars.length)})''')
        print(json.dumps(info, ensure_ascii=False, indent=1))
        if scenario in ('all', 'desktop'):
            # Hell
            page.click('#themeBtn'); shot(page, '02_desktop_light_bild', 1200)
            # Orderflow-Vorlage
            page.evaluate("tqi.applyTemplate('orderflow')"); shot(page, '03_desktop_light_orderflow', 3500)
            page.click('#themeBtn'); shot(page, '04_desktop_dark_orderflow', 1500)
            # Key Levels
            page.evaluate("tqi.applyTemplate('keylevels')"); shot(page, '05_desktop_dark_keylevels', 4500)
            info2 = page.evaluate('''() => tqi.state.indicators.map(i => { const d = tqi.data.get(i.uid); return i.type + ': ' + (d ? JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? v.length : (v && v.length !== undefined ? 'arr' + v.length : typeof v)]))) : 'null'); })''')
            print('\n'.join(info2))
            page.evaluate("tqi.setTf('1h')"); page.wait_for_function('window.tqi.state.tf === "1h" && tqi.bars.length > 100'); shot(page, '06_desktop_dark_keylevels_1h', 4000)
            # Dialoge
            page.evaluate("tqi.ui.openIndicatorDialog()"); shot(page, '07_dialog_indikatoren', 600)
            page.keyboard.press('Escape')
            uid = page.evaluate("tqi.state.indicators.find(i => i.type === 'keylevels').uid")
            page.evaluate(f"tqi.ui.openIndicatorSettings('{uid}')"); shot(page, '08_dialog_settings_keylevels', 600)
            page.keyboard.press('Escape')
            page.evaluate("tqi.ui.openSymbolDialog()"); shot(page, '09_dialog_symbol', 600)
            page.keyboard.press('Escape')
            # Zeichnen: Trendlinie + Long-Position + Fib
            box = page.locator('#chart').bounding_box()
            page.evaluate("tqi.drawings.setTool('trend')")
            page.mouse.click(box['x'] + 300, box['y'] + 300); page.mouse.move(box['x'] + 600, box['y'] + 200); page.mouse.click(box['x'] + 600, box['y'] + 200)
            page.evaluate("tqi.drawings.setTool('fib')")
            page.mouse.click(box['x'] + 700, box['y'] + 500); page.mouse.click(box['x'] + 900, box['y'] + 250)
            page.evaluate("tqi.drawings.setTool('long')")
            page.mouse.click(box['x'] + 950, box['y'] + 350)
            shot(page, '10_drawings', 700)
            page.evaluate("tqi.ui.app.setState({rightPanel: 'tape', rightOpen: true}, {render: true})"); shot(page, '11_tape', 1500)
            page.evaluate("tqi.ui.app.setState({rightPanel: 'dom', rightOpen: true}, {render: true})"); shot(page, '12_dom', 1500)
        page.context.close()
        if scenario in ('all', 'mobile'):
            m = new_page({'width': 390, 'height': 844}, mobile=True)
            m.goto(url)
            m.wait_for_function('window.tqi && window.tqi.bars.length > 100', timeout=20000)
            shot(m, '20_mobile_dark_bild', 3500)
            m.evaluate("tqi.setTheme('light')"); shot(m, '21_mobile_light_bild', 1500)
            m.click('#mbDraw'); shot(m, '22_mobile_tools', 500)
            m.click('#mbDraw')
            m.click('#mbInd'); shot(m, '23_mobile_indikatoren', 600)
            m.evaluate("tqi.ui.closeTopModal()")
            m.click('#mbMore'); shot(m, '24_mobile_more', 1500)
            m.evaluate("tqi.ui.closeTopModal()")
            m.evaluate("tqi.applyTemplate('orderflow')"); shot(m, '25_mobile_orderflow', 3500)
            m.context.close()
        browser.close()
    srv.shutdown()
    errs = [e for e in errors if 'favicon' not in e and 'manifest' not in e]
    print('\nKonsole:', len(errs))
    for e in errs[:40]: print('  ', e[:300])
    print('\nScreenshots:', len(shots))

if __name__ == '__main__':
    run(sys.argv[1] if len(sys.argv) > 1 else 'all')
