// Level-Alarme: Kurs berührt ein Level (pdVAH, nPOC, IBH, VWAP-Band …) oder läuft in eine Zone (Tails, Single Prints,
// Absorption), neue Signale (Big Trades, Absorption) und Termine (CPI, FOMC …).
// Meldung im Chart, Ton, System-Benachrichtigung und – wenn eingerichtet – aufs Handy über Discord oder Telegram.
// Webhook und Bot-Token trägt der Nutzer selbst ein; sie bleiben nur in diesem Browser (nicht in Vorlagen oder Sync).
import { fmtPrice, storage, zonedTime, fmtTime, MIN, claimOnce } from './util.js';
import { ECON_EVENTS } from './config.js';

export const LA_GROUPS = [
  ['keylevels', 'Key Levels (pdVAH, pdVAL, pdPOC, pw … )', ['keylevels', 'htfvwap', 'va', 'inst']],
  ['naked', 'Naked Levels (nPOC, Tails, Single Prints, UFA)', ['naked']],
  ['ib', 'RTH Initial Balance (IBH, IBL, Erweiterungen)', ['ib']],
  ['vwap', 'VWAP und Bänder', ['vwap', 'rvwap']],
  ['sessions', 'Session Hoch / Tief (Asia, London, New York)', ['sessions']],
  ['options', 'Options-Level (Walls, HVL, Max Pain)', ['options']],
];
export const LA_DEFAULT = {
  on: false, groups: { keylevels: true, naked: true, ib: true, vwap: false, sessions: false, options: false },
  zones: true, bigtrades: false, absorption: true, hvb: true, events: true, eventsMin: 15, cooldown: 30, push: true,
};
const PUSH_KEY = 'tqi-charts:push';

export class LevelAlerts {
  constructor(app) {
    this.app = app;
    this.cands = [];
    this.last = null;
    this.fired = new Map(); // Schlüssel → Zeit
    this.seen = { big: 0, abs: 0 };
    this.evFired = new Set(storage.get('tqi-charts:evfired', []));
    setInterval(() => this.checkEvents(), 30000);
  }
  get cfg() { const c = this.app.state.levelAlerts || {}; return { ...LA_DEFAULT, ...c, groups: { ...LA_DEFAULT.groups, ...(c.groups || {}) } }; }
  get push() { return storage.get(PUSH_KEY, {}) || {}; }
  set push(v) { storage.set(PUSH_KEY, v); }
  get pushReady() { const p = this.push; return !!(p.discord || (p.tgToken && p.tgChat)); }

  reset() { this.cands = []; this.last = null; this.seen = { big: 0, abs: 0, init: false }; }

  /** Nach jedem Neuberechnen: Level und Zonen aus den eingeschalteten Indikatoren sammeln, neue Signale melden. */
  update(scene) {
    const c = this.cfg;
    if (!c.on) { this.cands = []; return; }
    const on = new Set();
    for (const [k, , types] of LA_GROUPS) if (c.groups[k]) for (const t of types) on.add(t);
    const out = [];
    for (const lv of scene.levels) if (lv.src && on.has(lv.src) && lv.label && lv.to == null && Number.isFinite(lv.p)) out.push({ key: lv.src + '|' + lv.label, p: lv.p, name: lv.label });
    for (const ln of scene.lines) {
      if (!ln.src || !on.has(ln.src) || !ln.label || ln.rebase) continue;
      let v = NaN;
      for (let i = ln.vals.length - 1; i >= Math.max(0, ln.vals.length - 3) && !Number.isFinite(v); i--) v = ln.vals[i];
      if (Number.isFinite(v)) out.push({ key: ln.src + '|' + ln.label, p: v, name: ln.label });
    }
    if (c.zones) for (const b of scene.boxes) {
      if (!b.src || b.to != null || !b.label || !(on.has(b.src) || b.src === 'absorption' || b.src === 'keylevels')) continue;
      out.push({ key: `${b.src}|${b.label}|${b.from}`, top: Math.max(b.top, b.bottom), bottom: Math.min(b.top, b.bottom), name: b.label, zone: true });
    }
    this.cands = out;
    this.signals(c);
  }

  /** Neue Big Trades und Absorptions-Signale (nur solche, die nach dem Laden entstehen). */
  signals(c) {
    const a = this.app, now = Date.now();
    if (!this.seen.init) { this.seen = { big: now, abs: now, init: true }; return; }
    if (now - (a._loadedAt || 0) < 8000) return;
    const name = a.market.ticker(a.state.base);
    if (c.bigtrades) {
      const ind = a.state.indicators.find(x => x.type === 'bigtrades' && x.visible);
      const d = ind && a.data.get(ind.uid);
      if (d && d.thr > 0) {
        const px = a.bars[a.bars.length - 1]?.c || 0;
        for (const o of a.bt.orders(d.thr * px)) {
          if (o.t <= this.seen.big) continue;
          this.seen.big = Math.max(this.seen.big, o.t);
          this.fire(`big|${o.t}|${o.buy}`, `${name}: Big Trade ${o.buy ? 'Kauf' : 'Verkauf'} ${fmtQ(o.q)} ${a.state.base} (${fmtQ(o.usd / 1e6)} Mio. $) bei ${fmtPrice(o.p, a.priceDec)}`, true);
        }
      }
    }
    if (c.absorption) {
      const ind = a.state.indicators.find(x => x.type === 'absorption' && x.visible);
      const d = ind && a.data.get(ind.uid);
      for (const x of d?.list || []) {
        const b = a.bars[x.mi];
        if (!b || b.t <= this.seen.abs) continue;
        this.seen.abs = b.t;
        this.fire(`abs|${b.t}|${x.dir}`, `${name}: Absorption ${x.dir > 0 ? 'bullish (Käufer absorbieren)' : 'bearish (Verkäufer absorbieren)'} bei ${fmtPrice(x.dir > 0 ? x.bottom : x.top, a.priceDec)}`, true);
      }
    }
  }

  /** Bei jedem Trade: Kurs kreuzt ein Level bzw. läuft in eine Zone. */
  check(price) {
    const prev = this.last;
    this.last = price;
    if (prev == null || prev === price || !this.cands.length || this.app.replay?.on) return;
    const a = this.app, name = a.market.ticker(a.state.base);
    for (const c of this.cands) {
      if (c.zone) {
        const inNow = price <= c.top && price >= c.bottom, inPrev = prev <= c.top && prev >= c.bottom;
        if (inNow && !inPrev) this.fire(c.key, `${name} läuft in ${c.name} (${fmtPrice(c.bottom, a.priceDec)} – ${fmtPrice(c.top, a.priceDec)}) ${price > prev ? 'von unten' : 'von oben'}`);
      } else if ((prev < c.p && price >= c.p) || (prev > c.p && price <= c.p)) {
        this.fire(c.key, `${name} berührt ${c.name} (${fmtPrice(c.p, a.priceDec)}) ${price >= c.p ? 'von unten' : 'von oben'}`);
      }
    }
  }

  /** Termine: X Minuten vorher melden (einmal je Termin). */
  checkEvents() {
    const c = this.cfg;
    if (!c.on || !c.events) return;
    const now = Date.now(), win = Math.max(1, +c.eventsMin || 15) * MIN;
    for (const [k, ev] of Object.entries(ECON_EVENTS)) {
      const ind = this.app.state.indicators.find(x => x.type === 'events');
      if (ind && !ind.s[k]) continue;
      if (!ind && k === 'ppi') continue;
      for (const day of ev.days) {
        const [y, m, d] = day.split('-').map(Number);
        const t = zonedTime('America/New_York', y, m, d, ev.at[0], ev.at[1]);
        if (t < now || t - now > win) continue;
        const key = k + '|' + day;
        if (this.evFired.has(key)) continue;
        this.evFired.add(key);
        storage.set('tqi-charts:evfired', [...this.evFired].slice(-60));
        this.fire('ev|' + key, `In ${Math.round((t - now) / MIN)} Min.: ${ev.name} (${fmtTime(t, this.app.tz)} Uhr)`, true);
      }
    }
  }

  fire(key, text, once = false) {
    const c = this.cfg, now = Date.now();
    const last = this.fired.get(key);
    if (last && (once || now - last < Math.max(1, +c.cooldown || 30) * MIN)) return;
    this.fired.set(key, now);
    if (this.fired.size > 500) this.fired = new Map([...this.fired].slice(-200));
    if (!claimOnce('la|' + this.app.state.market + '|' + this.app.state.base + '|' + key, once ? 6 * 3600e3 : Math.max(1, +c.cooldown || 30) * MIN)) return;
    this.notify(text, 'Level-Alarm');
  }

  /** Meldung überall hin: Chart, Ton, System-Benachrichtigung, Handy (Discord / Telegram). */
  notify(text, title = 'Alarm', { push = true } = {}) {
    const a = this.app;
    a.ui.toast('🔔 ' + text, 'alert', 12000);
    a.alerts?.beep();
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* egal */ }
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification('TQI Charts · ' + title, { body: text, tag: 'tqi-la-' + text.slice(0, 40) });
        n.onclick = () => { window.focus(); n.close(); };
      }
    } catch { /* egal */ }
    if (push && this.cfg.push && this.pushReady) this.send(`🔔 ${text}`).catch(() => {});
  }

  /** Nur aufs Handy schicken (z. B. für gezeichnete Preis-Alarme), wenn Push eingerichtet und eingeschaltet ist. */
  pushText(text) { if (this.cfg.push && this.pushReady) this.send('🔔 ' + text).catch(() => {}); }

  /** An Discord (Webhook) und/oder Telegram (Bot) schicken. Antwort ist bei „no-cors“ nicht lesbar. */
  async send(text) {
    const p = this.push, jobs = [];
    if (p.discord && DISCORD_RE.test(p.discord)) {
      const fd = new FormData();
      fd.append('content', text.slice(0, 1900));
      jobs.push(fetch(p.discord, { method: 'POST', body: fd, mode: 'no-cors' }));
    }
    if (p.tgToken && TG_TOKEN_RE.test(p.tgToken) && p.tgChat) {
      const body = new URLSearchParams({ chat_id: String(p.tgChat), text: text.slice(0, 3500), disable_web_page_preview: 'true' });
      jobs.push(fetch(`https://api.telegram.org/bot${p.tgToken}/sendMessage`, { method: 'POST', body, mode: 'no-cors' }));
    }
    const r = await Promise.allSettled(jobs);
    return { sent: jobs.length, failed: r.filter(x => x.status === 'rejected').length };
  }

  /** Telegram: Chat-ID aus den letzten Nachrichten an den Bot lesen (vorher dem Bot „/start“ schreiben). */
  async telegramChatId(token) {
    if (!TG_TOKEN_RE.test(token || '')) throw new Error('Bot-Token sieht nicht richtig aus (Zahl:Buchstaben)');
    const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || 'Telegram antwortet nicht');
    const msgs = (j.result || []).map(u => u.message || u.channel_post || u.my_chat_member).filter(Boolean);
    const chat = msgs.length ? msgs[msgs.length - 1].chat : null;
    if (!chat) throw new Error('Keine Nachricht gefunden – schreib dem Bot zuerst „/start“');
    return String(chat.id);
  }
}
export const DISCORD_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
export const TG_TOKEN_RE = /^\d{5,}:[\w-]{30,}$/;
function fmtQ(x) { return x >= 100 ? Math.round(x).toLocaleString('de-DE') : x.toLocaleString('de-DE', { maximumFractionDigits: 2 }); }
