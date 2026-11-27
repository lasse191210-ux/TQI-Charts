// Bar Replay wie TradingView: Startpunkt im Chart wählen, dann Kerze für Kerze (oder automatisch) weiterspielen.
// Der Chart und alle Indikatoren sehen nur die Kerzen bis zum Replay-Zeitpunkt (auch höhere Zeiteinheiten).
import { ICON } from './icons.js';
import { lowerBound, tfMs, fmtDateTime, escapeHtml as esc } from './util.js';

const SPEEDS = [[0.5, '1 Kerze / 2 s'], [1, '1 / s'], [2, '2 / s'], [3, '3 / s'], [5, '5 / s'], [10, '10 / s']];

export class Replay {
  constructor(app) {
    this.app = app;
    this.on = false;          // Replay aktiv (Chart abgeschnitten)
    this.selecting = false;   // wartet auf Klick für den Startpunkt
    this.t = null;            // Zeit der letzten sichtbaren Kerze
    this.playing = false;
    this.speed = 1;
    this._timer = 0;
  }

  /** Schnittzeit für Daten: alles mit Start < cut ist „bekannt“. */
  get cut() { return this.on && this.t != null ? this.t + tfMs(this.app.state.tf === '1M' ? '1W' : this.app.state.tf) : null; }

  /** Kerzen eines Speichers bis zum Replay-Zeitpunkt (Zwischenspeicher je Speicher und Schritt). */
  slice(store, tf) {
    if (!this.on || !store) return store;
    const cut = this.cut;
    const k = this._cache?.get(store);
    if (k && k.t === this.t && k.n === store.bars.length) return k.v;
    const i = lowerBound(store.bars, cut);
    // höhere Zeiteinheit: die laufende Kerze nur bis zum Replay-Zeitpunkt zeigen (aus den Chart-Kerzen gebaut)
    let bars = store.bars.slice(0, i);
    if (tf && tfMs(tf) > tfMs(this.app.state.tf) && bars.length) {
      const last = bars[bars.length - 1];
      if (last.t + tfMs(tf) > cut) {
        const src = this.app.bars, j0 = lowerBound(src, last.t);
        if (j0 < src.length) {
          let o = src[j0].o, h = -Infinity, l = Infinity, c = o, v = 0, bv = 0;
          for (let j = j0; j < src.length; j++) { const b = src[j]; if (b.h > h) h = b.h; if (b.l < l) l = b.l; c = b.c; v += b.v || 0; bv += b.bv || 0; }
          const nb = { t: last.t, o, h, l, c, v };
          if (last.bv != null) nb.bv = bv;
          bars = bars.slice(0, -1).concat([nb]);
        }
      }
    }
    const v = { ...store, bars, last: bars[bars.length - 1], key: store.key, tf: store.tf };
    (this._cache ||= new WeakMap()).set(store, { t: this.t, n: store.bars.length, v });
    return v;
  }

  // ---------------------------------------------------------------- Bedienung
  /** Startpunkt wählen: nächster Klick in den Chart. */
  select() {
    const a = this.app;
    if (!a.bars.length) return;
    this.pause();
    this.selecting = true;
    a.drawings?.setTool('cursor');
    this._bindSelect();
    this.render();
    a.ui.toast(a.ui.mobile ? 'Tippe auf die Kerze, ab der das Replay startet' : 'Klick auf die Kerze, ab der das Replay startet', 'info', 2600);
  }
  /** Replay ab Kerzen-Zeit t starten (t muss in den geladenen Kerzen liegen). */
  start(t) {
    const a = this.app;
    const all = a.chartStore?.bars || [];
    if (!all.length) return;
    const i = Math.max(1, Math.min(all.length - 2, lowerBound(all, t)));
    this.selecting = false;
    this._unbindSelect();
    this.on = true;
    this.t = all[i].t;
    this._cache = null;
    document.body.classList.add('replay-on');
    a.fullRender();
    a.ensureNeeds?.();
    try { a.chart.timeScale().scrollToRealTime(); } catch { /* egal */ }
    this.render();
  }
  /** Zu einem Datum springen (lädt ältere Kerzen nach, falls nötig). */
  async startAt(t) {
    const a = this.app, st = a.chartStore;
    if (!st) return;
    if (st.bars.length && t < st.bars[0].t) {
      a.ui.setHistoryLoading?.(true);
      try { await st.ensureFrom(t - 50 * tfMs(a.state.tf)); } catch (e) { a.ui.toast('Ältere Daten: ' + (e.message || e), 'error'); }
      a.ui.setHistoryLoading?.(false);
    }
    if (st.bars.length && t < st.bars[0].t) a.ui.toast('So weit zurück gibt es auf dieser Börse keine Kerzen – Replay startet am Anfang', 'info', 3500);
    this.start(Math.max(t, st.bars[1]?.t ?? t));
  }
  step(n = 1) {
    const a = this.app;
    if (!this.on) return false;
    const all = a.chartStore.bars;
    const i = lowerBound(all, this.t);
    const j = Math.min(all.length - 1, i + n);
    if (j <= i) { this.pause(); a.ui.toast('Replay ist bei der aktuellen Kerze angekommen', 'info', 2500); this.render(); return false; }
    this.t = all[j].t;
    a.replayStep();
    this._renderTime();
    return true;
  }
  play() {
    if (!this.on) return;
    if (this.playing) return this.pause();
    this.playing = true;
    clearInterval(this._timer);
    this._timer = setInterval(() => { if (!this.step(1)) this.pause(); }, Math.round(1000 / this.speed));
    this.render();
  }
  pause() {
    this.playing = false;
    clearInterval(this._timer);
    if (this.on) this.render();
  }
  setSpeed(v) {
    this.speed = v;
    if (this.playing) { this.playing = false; this.play(); } else this.render();
  }
  /** Replay beenden: zurück zum Live-Chart. */
  exit() {
    const a = this.app;
    this.pause();
    this.selecting = false;
    this._unbindSelect();
    const was = this.on;
    this.on = false; this.t = null; this._cache = null;
    document.body.classList.remove('replay-on');
    this.render();
    if (was) { a.fullRender(); try { a.chart.timeScale().scrollToRealTime(); } catch { /* egal */ } }
  }
  /** Symbol oder Zeiteinheit gewechselt: Replay endet. */
  reset() { if (this.on || this.selecting) this.exit(); }
  toggle() { if (this.on || this.selecting) this.exit(); else this.select(); }

  // ---------------------------------------------------------------- Startpunkt per Klick
  _bindSelect() {
    const a = this.app, el = a.ui.chartEl, wrap = el.parentElement;
    this._unbindSelect();
    const line = document.createElement('div');
    line.className = 'replay-line';
    wrap.appendChild(line);
    const pos = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const move = (e) => { const { x } = pos(e); line.style.left = Math.round(x) + 'px'; line.style.display = 'block'; };
    const down = (e) => {
      if (e.button > 0) return;
      const { x, y } = pos(e);
      if (x > el.clientWidth - 60 || y > el.clientHeight - 26) return; // Preisskala / Zeitachse
      e.preventDefault(); e.stopImmediatePropagation();
      const l = a.chart.timeScale().coordinateToLogical(x);
      if (l == null) return;
      const bars = a.chartStore.bars;
      const i = Math.max(0, Math.min(bars.length - 1, Math.round(l)));
      this.start(bars[i].t);
    };
    el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerdown', down, true);
    this._sel = { line, off: () => { el.removeEventListener('pointermove', move, true); el.removeEventListener('pointerdown', down, true); line.remove(); } };
    wrap.classList.add('replay-pick');
  }
  _unbindSelect() {
    this._sel?.off();
    this._sel = null;
    this.app.ui.chartEl?.parentElement?.classList.remove('replay-pick');
  }

  // ---------------------------------------------------------------- Leiste
  render() {
    const a = this.app;
    let bar = document.getElementById('replayBar');
    document.getElementById('replayBtn')?.classList.toggle('on', this.on || this.selecting);
    a.ui.setStatus(a.ui._lastStatus || a.hub.status);
    if (!this.on && !this.selecting) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'replayBar';
      bar.className = 'replay-bar';
      document.getElementById('chartwrap').appendChild(bar);
      bar.addEventListener('pointerdown', (e) => e.stopPropagation());
      bar.onclick = (e) => this._click(e);
    }
    const sp = SPEEDS.find(x => x[0] === this.speed) || SPEEDS[1];
    bar.innerHTML = this.selecting && !this.on
      ? `<span class="rp-t">${ICON.replay}<b>Bar Replay</b> Startpunkt im Chart anklicken</span><button class="tb" data-r="date">Datum …</button><button class="tb icon" data-r="exit" title="Replay beenden">${ICON.close}</button>`
      : `<button class="tb icon" data-r="select" title="Neuen Startpunkt wählen">${ICON.scissors}</button>
         <button class="tb icon rp-play" data-r="play" title="Abspielen / Pause (Umschalt+↓)">${this.playing ? ICON.pause : ICON.play}</button>
         <button class="tb icon" data-r="step" title="Eine Kerze weiter (Umschalt+→)">${ICON.stepFwd}</button>
         <div class="dd-wrap"><button class="tb" data-r="speed" title="Tempo">${esc(sp[1])}</button></div>
         <span class="rp-time" id="rpTime"></span>
         <button class="tb" data-r="date" title="Zu einem Datum springen">Datum …</button>
         <button class="tb rp-exit" data-r="exit" title="Replay beenden, zurück zu Live">Live ${ICON.close}</button>`;
    this._renderTime();
  }
  _renderTime() {
    const el = document.getElementById('rpTime');
    if (el && this.t != null) el.textContent = fmtDateTime(this.t, this.app.tz);
  }
  _click(e) {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    const k = b.dataset.r;
    if (k === 'select') this.select();
    if (k === 'play') this.play();
    if (k === 'step') { this.pause(); this.step(1); }
    if (k === 'exit') this.exit();
    if (k === 'date') this._askDate();
    if (k === 'speed') {
      const wrap = b.parentElement;
      wrap.querySelector('.dd-menu')?.remove();
      const m = document.createElement('div');
      m.className = 'dd-menu up';
      m.innerHTML = SPEEDS.map(([v, l]) => `<button data-sp="${v}" class="${v === this.speed ? 'on' : ''}">${esc(l)}</button>`).join('');
      wrap.appendChild(m);
      const off = (ev) => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
      setTimeout(() => document.addEventListener('pointerdown', off, true));
      m.onclick = (ev) => { const s = ev.target.closest('[data-sp]'); if (s) { m.remove(); this.setSpeed(+s.dataset.sp); } };
    }
  }
  _askDate() {
    const a = this.app;
    const d = new Date(this.t ?? Date.now() - 86400000);
    const p = (x) => String(x).padStart(2, '0');
    const def = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    const v = prompt('Replay ab Datum (TT.MM.JJJJ HH:MM, deine Zeit)', def);
    if (!v) return;
    const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?\s*$/.exec(v);
    if (!m) { a.ui.toast('Datum bitte so: 24.11.2026 15:30', 'error'); return; }
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const t = new Date(y, +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
    if (!(t < Date.now())) { a.ui.toast('Das Datum liegt in der Zukunft', 'error'); return; }
    this.startAt(t);
  }
  /** Tasten wie TradingView: Umschalt+→ eine Kerze, Umschalt+↓ Abspielen/Pause. */
  onKey(e) {
    if (!this.on || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'ArrowRight') { this.pause(); this.step(1); return true; }
    if (e.key === 'ArrowDown') { this.play(); return true; }
    return false;
  }
}
