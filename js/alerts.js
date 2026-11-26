// Preis-Alarme: Alarm-Linien (Zeichenwerkzeug „Alarm“) werden bei jedem Trade geprüft.
// Auslösung: Hinweis im Chart, Ton, Vibration und – wenn erlaubt – System-Benachrichtigung.
// Funktioniert, solange die Seite geöffnet ist (Handy: App/Tab im Vordergrund).
import { fmtPrice } from './util.js';

export const ALERT_CONDS = [['cross', 'kreuzt'], ['up', 'steigt über'], ['down', 'fällt unter']];

export class Alerts {
  constructor(app) {
    this.app = app;
    this.lastPrice = null;
    this.ctx = null;
    // Ton auf dem Handy erst nach einer Berührung möglich: AudioContext beim ersten Antippen freischalten
    const unlock = () => {
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch { /* kein Ton */ }
      window.removeEventListener('pointerdown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
  }

  /** Alle Alarm-Linien des aktuellen Coins. */
  list() { return (this.app.drawings?.items || []).filter(x => x.type === 'alert'); }

  /** Nach dem Wechsel des Symbols: neu anfangen (kein Auslösen durch Sprung zum neuen Kurs). */
  reset() { this.lastPrice = null; }

  check(price) {
    const prev = this.lastPrice;
    this.lastPrice = price;
    if (prev == null || prev === price) return;
    for (const it of this.list()) {
      if (it.fired) continue;
      const p = it.pts[0].p;
      const up = prev < p && price >= p, dn = prev > p && price <= p;
      const c = it.cond || 'cross';
      if ((c === 'cross' && (up || dn)) || (c === 'up' && up) || (c === 'down' && dn)) this.fire(it, up, price);
    }
  }

  fire(it, up, price) {
    const a = this.app;
    it.fired = Date.now();
    a.drawings._changed();
    const name = a.market.ticker(a.state.base);
    const txt = `${name} ${up ? '↑' : '↓'} ${fmtPrice(it.pts[0].p, a.priceDec)}${it.note ? ' · ' + it.note : ''}`;
    a.ui.toast('🔔 Alarm: ' + txt + ` (Kurs ${fmtPrice(price, a.priceDec)})`, 'alert', 12000);
    this.beep();
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* egal */ }
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification('TQI Charts · Alarm', { body: txt, tag: 'tqi-' + it.id, renotify: true });
        n.onclick = () => { window.focus(); n.close(); };
      }
    } catch { /* manche Browser nur über Service Worker */ }
  }

  beep() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.ctx;
      const t = ctx.currentTime;
      for (const [k, f] of [[0, 880], [0.22, 1175], [0.44, 880]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + k);
        g.gain.exponentialRampToValueAtTime(0.25, t + k + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + k + 0.18);
        o.connect(g).connect(ctx.destination);
        o.start(t + k); o.stop(t + k + 0.2);
      }
    } catch { /* kein Ton */ }
  }

  /** Nach Nutzer-Aktion aufrufen (Browser verlangen das): Erlaubnis für Benachrichtigungen. */
  askPermission() {
    try {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch?.(() => {});
    } catch { /* egal */ }
  }
  get permission() { return 'Notification' in window ? Notification.permission : 'unsupported'; }
}
