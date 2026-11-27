# TQI Charts

Krypto-Charts im Browser, aufgebaut wie DM Charts / TradingView – mit den eigenen Indikatoren aus dem ATAS-Nachbau (KeyLevelsAll) und den TradingView-Indikatoren von WEB3 Vince.

**Live:** https://lasse191210-ux.github.io/TQI-Charts/

## Funktionen

- **Charts:** TradingView Lightweight Charts™ 5.3 (lokal eingebunden), Kerzen, hohle Kerzen, Balken, Linie, Fläche, Heikin Ashi, eigener TPO-Chart, Zeiteinheiten 1m bis 1M, Historie lädt beim Zurückscrollen nach, Log-/Prozent-Skala, Zeitzone lokal oder UTC, Countdown bis Kerzenschluss am Preis, Vollbild-Chart
- **Börsen:** Binance Perp + Spot, Bybit Perp + Spot, OKX Perp, Coinbase Spot, Bitstamp Spot (BTCUSD wie TradingView) – öffentliche Schnittstellen, live über WebSocket
- **Daten von:** Rolling VWAP und VWAP können mit den Daten einer anderen Börse rechnen als der Chart (Standard RVWAP: Bitstamp BTCUSD wie TradingView)
- **Session:** 00:00 UTC (wie TradingView), CME (17:00–16:00 Chicago) oder eigene Zeiten (z. B. 02:00–22:00 Berlin wie ATAS) für TPO, Key Levels und Naked Levels; Value Area mit 2 oder 1 Zeile pro Schritt
- **Meine Indikatoren (TQI)**
  - TPO (Market Profile) direkt im Kerzenchart als schwarze Buchstaben (oder Blöcke/Farbverlauf), POC, VAH/VAL, Initial Balance, Single Prints (Knopf „TPO“)
  - Key Levels: nPOC, Tails, Single Prints, VAH/VAL/POC von Vortag (TPO), Vorwoche, Vorquartal, Vorjahr, 52-Wochen-Tief/-Hoch
  - Volume Profile je Tag/Woche/Monat oder sichtbarer Bereich (Volumen, Kauf/Verkauf, Delta) und Fixed-Range-Werkzeug
  - VWAP mit VAH/VAL (±1σ) und Bändern 2–4, Tag/Woche/Monat/Quartal/Jahr, jedes Band eigene Farbe, Namen an/aus; über jedem Tag die Box des Vortags (VAL bis VAH, gepunktet VAH / VWAP / VAL) wie „Time-Based Daily Bands“ in TradingView
  - Rolling VWAP 365/90/30/7/14/1 Tage, Auto-Auflösung (max. 1000 Kerzen pro Fenster), 0,05σ-Band, Z-Score-Tabelle
  - High Volume Bars wie „High Volume Bars w3v“ in TradingView (Z-Score ≥ 2,5 über 144 Kerzen der Chart-Zeiteinheit): Kerzenkörper blau (steigend) / rosa (fallend), POC türkis gepunktet und Value Area grau aus 1-Minuten-Kerzen, Level laufen nach rechts bis zur ersten Berührung (nachdem der Preis sie verlassen hat), unberührte verschwinden nach 200 Kerzen; Start-Datum, Delta, Alarm
  - Volumen-Kerzen färben (Z-Score 3 / 5 über 200 Kerzen) wie TradingView: nur der Kerzenkörper
  - VWAP-Level Woche/Monat/Quartal/Jahr (laufend und vorherig)
  - Value Areas pd/3d/7d/pw/2w/pm, Composites 28/56 Tage, Composite mit Datum, Vortage einzeln
  - Naked POC, Naked UFA, Single Prints, Tails (30-Min-TPO); Single Prints und Selling/Buying Tails laufen nur bis zur ersten Berührung nach Session-Ende und enden dort (einstellbar: ausblenden oder weiterlaufen), keine doppelten Zonen aus Key Levels und Naked Levels
  - SFP, institutionelle Level (52w, pw/pm/pd H/L, do/wo/mo/qo/yo, 200/50-Tage-Durchschnitt), Volumen-Kerzen
- **Options-Level (Deribit, BTC/ETH):** Call Resistance, Put Support, HVL (Gamma-Flip), Max Pain, erwartete Spanne 1T/1W, Call/Put Wall, GEX 1–10, 0DTE, Major Wall – gleiche Rechnung wie im TQI Terminal
- **Orderflow:** Big Trades wie ATAS (Cumulative Trades: Marktorders mit gleicher Zeit + Seite = eine Order; Auto-Filter Stark/Mittel/Schwach = 0,6/0,4/0,25 × Durchschnittsvolumen pro Minute der letzten 24 Std., bei BTC ≈ 1 / 3–4 / 10 Orders pro Stunde; oder feste Mindestgröße in Coins, Max. Volumen, Preis-Lage am Hoch/Tief/Körper/Docht; graue Kreise, Größe nach Volumen; live und rückwirkend per REST nachgeladen, 48 Std. im Browser gespeichert), Volumen nach Delta, CVD, Open Interest, Funding, Liquidationen, Trades-Tape, Orderbuch (DOM), Watchlist
- **Standard:** EMA/SMA, Bollinger, RSI, MACD, ATR
- **Rechtsklick wie TradingView/ATAS:** auf eine Zeichnung → Einstellungen wie TradingView (außen: Rand/Linie mit Farbe, Deckkraft, Breite, Linienart; innen: Hintergrund mit Farbe und Deckkraft; Text mit Hintergrund und Rahmen; Beschriftung, Verlängern, exakte Preise; Vorlage: als Standard für neue Zeichnungen speichern, eigene Vorlagen, Werkseinstellung), Klonen, Sperren, Löschen; Doppelklick öffnet die Einstellungen direkt. In den Chart → Chart-Einstellungen, Einstellungen, Indikatoren, Vorlagen, horizontale Linie/Alarm am Preis, Trader-Entry/Stop/Ziel, Ansicht zurücksetzen. Auf eine Legenden-Zeile → Indikator-Einstellungen. Handy: Zeichnung antippen → Zahnrad
- **Zeichnen:** Trendlinie, Strahl, horizontale Linie/Strahl, vertikale Linie, Rechteck, Fibonacci, Preisspanne, Anchored VWAP (mit ±1/2/3σ-Bändern, Quelle HLC3/OHLC4/Close), Fixed Range Volume Profile, Fixed Range TPO (Zeitraum, optional Preisbereich), Text, Long-/Short-Position, Alarm, Magnet, sperren, ausblenden
- **Alarme:** Alarm-Linie ziehen (kreuzt / steigt über / fällt unter), Ton, Vibration, System-Benachrichtigung – solange die Seite offen ist
- **TPO-Ansicht (wie MMT):** Profil antippen → mit Nachbar zusammenfügen, an einer Stelle teilen, trennen
- **Einstellungen wie TradingView:** Reiter Eingaben / Stil / Sichtbarkeit, Farbwähler mit Palette und Deckkraft, Linienbreite, eigene Standardwerte speichern
- **Vorlagen:** Standard (meine Key Levels: TPO, Key Levels, VWAP-Bänder, RVWAP 365/90/7 von Bitstamp, High Volume Bars, Naked POC/UFA/Tails, Institutionelle Level, SFP, Volumen-Kerzen, Big Trades), Nur Key Levels, TPO-Ansicht (wie MMT), Orderflow, Nur Kerzen, Übersichtlich (hell) und Übersichtlich (dunkel) mit Design ohne Gitter. Einstellungen bleiben beim Wechseln erhalten, eigene Vorlagen speicherbar, in eine andere Vorlage kopieren, als Code oder Link teilen (z. B. vom PC aufs Handy) und importieren
- **Chart-Einstellungen wie ATAS:** Kerzenkörper, Rand und Docht (steigend/fallend), Hintergrund, Gitter, Fadenkreuz, Schrift, Preislinie – Vorlagen Grün/Rot, ATAS, Schwarz/Weiß, Hohl
- **TQI Trader (Bybit USDT-Perps, Demo oder Live):** Panel zum Öffnen und Schließen wie das ATAS-Trading-Panel (PC rechts, Handy von unten). Entry/Stop/Ziel per Strg/Umschalt/Alt-Klick oder „antippen“, Linien im Chart ziehen, Menge aus Risiko inkl. Gebühren, Hebel automatisch, Limit (Post-Only), Stop (Ausbruch) oder Market, SL/TP direkt an der Order, Position mit SL/TP/Liquidation, Break-even, Schließen, Orders löschen. Jede Aktion wird vorher bestätigt, nichts handelt automatisch. API-Schlüssel trägt man selbst ein (nur „Verträge – Orders und Positionen“, keine Auszahlung), sie bleiben nur im eigenen Browser
- Dunkel und hell, Handy-Ansicht wie die TradingView-App, Screenshot, als App installierbar (PC: Knopf „App installieren“ oben bzw. Chrome/Edge-Adressleiste; iPhone: Teilen → Zum Home-Bildschirm)

Einstellungen, Indikatoren, Zeichnungen und Watchlist werden nur im eigenen Browser gespeichert (localStorage).

## Bedienung

- Symbol: oben links klicken oder einfach lostippen (z. B. `ETH`)
- Zeiteinheit: Zahl tippen (`15` = 15 Minuten, `4h`, `1D`) und Enter
- Indikatoren: `ƒx Indikatoren` oder Taste `/`; Doppelklick auf eine Legenden-Zeile öffnet die Einstellungen
- Zeichnung löschen: auswählen, dann `Entf`

## Entwicklung

Reines HTML/CSS/JavaScript (ES-Module), kein Build-Schritt. Lokal starten:

```
python3 -m http.server 8000
```

Tests: `node --test test/calc.test.mjs` (Rechnungen), `python3 test/e2e.py`, `python3 test/functional.py`, `python3 test/v11.py`, `python3 test/v12.py`, `python3 test/v13.py`, `python3 test/v14.py` und `python3 test/v15.py` (Browser mit simulierten Börsendaten und simuliertem Bybit-Konto, braucht Playwright).

## Lizenzen

TradingView Lightweight Charts™ – Copyright (c) TradingView, Inc., Apache License 2.0 (`js/vendor/`). Das TradingView-Logo im Chart ist der vorgeschriebene Hinweis.
