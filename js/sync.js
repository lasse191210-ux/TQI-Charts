// Sync PC ↔ Handy über ein privates GitHub Gist: Einstellungen, Indikatoren, Vorlagen, Zeichnungen und Journal-Notizen.
// Den Token (nur Berechtigung „gist“) trägt der Nutzer auf jedem Gerät selbst ein; er bleibt nur in diesem Browser.
// Nie synchronisiert: Bybit-Schlüssel, Discord/Telegram-Zugang, der Sync-Token selbst, zwischengespeicherte Marktdaten.
import { storage } from './util.js';
import { APP } from './config.js';

const CFG = 'tqi-charts:sync';
const FILE = 'tqi-charts-sync.json';
const DESC = 'TQI Charts Sync (privat)';
const API = 'https://api.github.com';
const SECRET = new Set(['tqi-charts:trader-keys', 'tqi-charts:push', CFG]);
const isSynced = (k) => !SECRET.has(k) && (k === 'tqi-charts:v1' || /^tqi-charts:v1:s\d$/.test(k) || k.startsWith('tqi-charts:draw:') || k === 'tqi-charts:journal-notes' || k === 'tqi-charts:journal-plans' || k === 'tqi-charts:multi');
/** Inhalt-Prüfsumme (Schlüssel sortiert), damit unveränderte Stände nicht hin und her geladen werden. */
function stable(x) {
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
  return JSON.stringify(x ?? null);
}
function hashOf(data) {
  const str = stable(data);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16) + ':' + str.length;
}
export const TOKEN_RE = /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,})$/;

export class Sync {
  constructor(app) {
    this.app = app;
    this.busy = false;
    this._t = 0;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.cfg.auto && this.ready) this.pullIfNewer(false).catch(() => {}); });
  }
  get cfg() { return storage.get(CFG, {}) || {}; }
  set cfg(v) { storage.set(CFG, v); }
  get ready() { const c = this.cfg; return !!(c.token && TOKEN_RE.test(c.token)); }

  /** Alle synchronisierten Einträge aus dem Browser-Speicher. */
  collect() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !isSynced(k)) continue;
      try { data[k] = JSON.parse(localStorage.getItem(k)); } catch { /* kaputt */ }
    }
    // laufender Stand des Charts (falls noch nicht gespeichert)
    data[APP.key] = this.app.state;
    return data;
  }
  async _req(method, path, body) {
    const c = this.cfg;
    const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) throw new Error('Token ungültig oder abgelaufen');
    if (r.status === 403) throw new Error('Keine Berechtigung – Token braucht den Haken „gist“');
    if (r.status === 404) { const e = new Error('Gist nicht gefunden'); e.notFound = true; throw e; }
    if (!r.ok) throw new Error('GitHub antwortet mit ' + r.status);
    return r.json();
  }
  /** Eigenes Sync-Gist suchen (für das zweite Gerät). */
  async find() {
    for (let page = 1; page <= 5; page++) {
      const list = await this._req('GET', `/gists?per_page=100&page=${page}`);
      const g = list.find(x => x.description === DESC && x.files && x.files[FILE]);
      if (g) return g.id;
      if (list.length < 100) break;
    }
    return null;
  }
  async readRemote() {
    let id = this.cfg.gistId;
    if (!id) { id = await this.find(); if (id) this.cfg = { ...this.cfg, gistId: id }; }
    if (!id) return null;
    const g = await this._req('GET', '/gists/' + id);
    const f = g.files?.[FILE];
    if (!f) return null;
    let txt = f.content;
    if (f.truncated && f.raw_url) txt = await (await fetch(f.raw_url)).text();
    try { return JSON.parse(txt); } catch { throw new Error('Sync-Datei im Gist ist beschädigt'); }
  }
  /** Hochladen (legt beim ersten Mal ein privates Gist an). */
  async push(force = false) {
    if (!this.ready) throw new Error('Erst GitHub-Token eintragen');
    if (force) this.cfg = { ...this.cfg, hash: null };
    this.busy = true;
    try {
      const at = Date.now();
      const data = this.collect(), hash = hashOf(data);
      if (hash === this.cfg.hash && this.cfg.gistId) { this.cfg = { ...this.cfg, dirty: false }; return this.cfg.lastAt || at; }
      const content = JSON.stringify({ v: 1, at, app: APP.version, device: deviceName(), data });
      const files = { [FILE]: { content } };
      let id = this.cfg.gistId;
      if (!id) id = await this.find();
      if (id) {
        try { await this._req('PATCH', '/gists/' + id, { files }); }
        catch (e) { if (!e.notFound) throw e; id = null; }
      }
      if (!id) { const g = await this._req('POST', '/gists', { description: DESC, public: false, files }); id = g.id; }
      this.cfg = { ...this.cfg, gistId: id, lastAt: at, dirty: false, hash };
      return at;
    } finally { this.busy = false; }
  }
  /** Herunterladen und übernehmen (Seite lädt danach neu). */
  async pull() {
    const r = await this.readRemote();
    if (!r || !r.data) throw new Error('Noch nichts hochgeladen – erst auf dem anderen Gerät „Hochladen“');
    this.apply(r);
    return r;
  }
  apply(r) {
    for (const [k, v] of Object.entries(r.data)) if (isSynced(k)) storage.set(k, v);
    this.cfg = { ...this.cfg, lastAt: r.at, dirty: false, hash: hashOf(r.data) };
    sessionStorage.setItem('tqi-sync-note', `Stand vom ${new Date(r.at).toLocaleString('de-DE')} (${r.device || 'anderes Gerät'}) übernommen`);
    location.reload();
  }
  /** Beim Start bzw. beim Zurückkehren: neueren Stand vom anderen Gerät übernehmen. */
  async pullIfNewer(ask = true) {
    if (!this.ready || this.busy) return false;
    const r = await this.readRemote().catch(() => null);
    if (!r || !r.at || r.at <= (this.cfg.lastAt || 0)) return false;
    if (this.cfg.dirty && !(ask && confirm(`Auf dem anderen Gerät (${r.device || '?'}) gibt es einen neueren Stand (${new Date(r.at).toLocaleString('de-DE')}). Hier gibt es auch ungesicherte Änderungen.\n\nOK = anderen Stand übernehmen, Abbrechen = diesen Stand behalten und hochladen.`))) {
      if (this.cfg.dirty) await this.push().catch(() => {});
      return false;
    }
    this.apply(r);
    return true;
  }
  /** Nach Änderungen: automatisch hochladen (gebündelt). */
  dirty() {
    if (APP.embed) return;
    const c = this.cfg;
    if (!c.token) return;
    if (!c.dirty) this.cfg = { ...c, dirty: true };
    if (!c.auto || !this.ready) return;
    clearTimeout(this._t);
    this._t = setTimeout(() => this.push().catch(e => console.warn('Sync', e)), 15000);
  }
  async start() {
    const note = sessionStorage.getItem('tqi-sync-note');
    if (note) { sessionStorage.removeItem('tqi-sync-note'); this.app.ui.toast('Sync: ' + note, 'info', 5000); }
    if (APP.embed || !this.cfg.auto || !this.ready) return;
    try { await this.pullIfNewer(true); } catch (e) { console.warn('Sync', e); }
  }
}
function deviceName() {
  const u = navigator.userAgent;
  const os = /iPhone|iPad/.test(u) ? 'iPhone/iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS/.test(u) ? 'Mac' : 'Gerät';
  const br = /Edg\//.test(u) ? 'Edge' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : /Firefox\//.test(u) ? 'Firefox' : '';
  return `${os}${br ? ' · ' + br : ''}`;
}
