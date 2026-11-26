# TQI Charts

Krypto-Charts im Browser, aufgebaut wie DM Charts / TradingView – mit den eigenen Indikatoren aus dem ATAS-Nachbau (KeyLevelsAll) und den TradingView-Indikatoren von WEB3 Vince.

**Live:** https://lasse191210-ux.github.io/TQI-Charts/

## Funktionen

- **Charts:** TradingView Lightweight Charts™ 5.3 (lokal eingebunden), Kerzen, hohle Kerzen, Balken, Linie, Fläche, Heikin Ashi, Zeiteinheiten 1m bis 1M, Historie lädt beim Zurückscrollen nach, Log-/Prozent-Skala, Zeitzone lokal oder UTC
- **Börsen:** Binance Perp + Spot, Bybit Perp + Spot, OKX Perp, Coinbase Spot – öffentliche Schnittstellen, live über WebSocket
- **Meine Indikatoren (TQI)**
  - VWAP mit VAH/VAL (±1σ) und Bändern 2–4, Tag/Woche/Monat/Quartal/Jahr, Vorperiode
  - Rolling VWAP 365/90/30/7/14/1 Tage, Auto-Auflösung (max. 1000 Kerzen pro Fenster), 0,05σ-Band, Z-Score-Tabelle
  - High Volume Bars (15 Min., Z-Score 144, Schwelle 2,5) mit POC und Value Area aus 1-Minuten-Kerzen
  - VWAP-Level Woche/Monat/Quartal/Jahr (laufend und vorherig)
  - Value Areas pd/3d/7d/pw/2w/pm, Composites 28/56 Tage, Composite mit Datum, Vortage einzeln
  - Naked POC, Naked UFA, Single Prints, Tails (30-Min-TPO), berührte Level schließen nach Session-Ende
  - SFP, institutionelle Level (52w, pw/pm/pd H/L, do/wo/mo/qo/yo, 200/50-Tage-Durchschnitt), Volumen-Kerzen
- **Orderflow:** Volumen nach Delta, CVD, Open Interest, Funding, große Trades als Blasen, Liquidationen, Trades-Tape, Orderbuch (DOM), Watchlist
- **Standard:** EMA/SMA, Bollinger, RSI, MACD, ATR
- **Zeichnen:** Trendlinie, Strahl, horizontale Linie/Strahl, vertikale Linie, Rechteck, Fibonacci, Preisspanne, Text, Long-/Short-Position, Magnet, sperren, ausblenden
- **Vorlagen:** „Wie mein TradingView“ (Standard), Orderflow, Key Levels (wie ATAS), Alles, Nur Kerzen
- Dunkel und hell, Handy-Ansicht wie die TradingView-App, Screenshot, als App auf den Home-Bildschirm legbar

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

Tests: `node --test test/calc.test.mjs` (Rechnungen), `python3 test/e2e.py` und `python3 test/functional.py` (Browser mit simulierten Börsendaten, braucht Playwright).

## Lizenzen

TradingView Lightweight Charts™ – Copyright (c) TradingView, Inc., Apache License 2.0 (`js/vendor/`). Das TradingView-Logo im Chart ist der vorgeschriebene Hinweis.
