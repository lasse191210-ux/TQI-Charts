// Grundeinstellungen, Coins, Vorlagen und Farbthemen.
export const APP = { name: 'TQI Charts', version: '1.1.0', key: 'tqi-charts:v1' };

export const COINS = [
  ['BTC', 'Bitcoin'], ['ETH', 'Ethereum'], ['SOL', 'Solana'], ['XRP', 'XRP'], ['BNB', 'BNB'], ['DOGE', 'Dogecoin'],
  ['HYPE', 'Hyperliquid'], ['SUI', 'Sui'], ['LINK', 'Chainlink'], ['AVAX', 'Avalanche'], ['ADA', 'Cardano'], ['TRX', 'TRON'],
  ['TON', 'Toncoin'], ['LTC', 'Litecoin'], ['BCH', 'Bitcoin Cash'], ['DOT', 'Polkadot'], ['NEAR', 'NEAR'], ['APT', 'Aptos'],
  ['ARB', 'Arbitrum'], ['OP', 'Optimism'], ['PEPE', 'Pepe'], ['WIF', 'dogwifhat'], ['ENA', 'Ethena'], ['AAVE', 'Aave'],
  ['UNI', 'Uniswap'], ['INJ', 'Injective'], ['TIA', 'Celestia'], ['SEI', 'Sei'], ['FET', 'Fetch.ai'], ['ETC', 'Ethereum Classic'],
  ['FIL', 'Filecoin'], ['ATOM', 'Cosmos'], ['XLM', 'Stellar'], ['HBAR', 'Hedera'], ['ONDO', 'Ondo'], ['TAO', 'Bittensor'],
];
export const COIN_NAME = Object.fromEntries(COINS);

/** Vorlagen: welche Indikatoren mit welchen Abweichungen von den Standardwerten. */
export const TEMPLATES = {
  bild: {
    name: 'Standard (wie mein TradingView)',
    desc: 'RVWAP 365/90/7 mit Z-Tabelle, VWAP-Bänder, Key Levels (TPO, durchgezogen ab Entstehung), SFP, Options-Level, Big Trades. TPO über den TPO-Knopf.',
    list: [
      { type: 'rvwap' },
      { type: 'hvb', visible: false },
      { type: 'vwap', s: { period: 'day' } },
      { type: 'tpo', visible: false },
      { type: 'keylevels' },
      { type: 'sfp' },
      { type: 'options' },
      { type: 'bigtrades' },
    ],
  },
  keylevels: {
    name: 'Nur Key Levels',
    desc: 'Kerzen mit Key Levels (nPOC, Tails, Singles, VAH/VAL/POC Vortag, Woche, Quartal, Jahr, 52W-Tief) und SFP',
    list: [{ type: 'tpo', visible: false }, { type: 'keylevels' }, { type: 'sfp' }],
  },
  tpo: {
    name: 'TPO-Ansicht (wie MMT)',
    desc: 'Market Profile je Tag. Profil antippen → mit Nachbar zusammenfügen, an einer Stelle teilen oder wieder trennen.',
    chart: 'tpo',
    list: [],
  },
  orderflow: {
    name: 'Orderflow',
    desc: 'VWAP, Key Levels, Big Trades, Liquidationen, dazu Panels: Volumen nach Delta, CVD, Open Interest',
    list: [
      { type: 'vwap', s: { period: 'day' } }, { type: 'keylevels' }, { type: 'sfp' },
      { type: 'bigtrades' }, { type: 'liq' },
      { type: 'volume' }, { type: 'cvd' }, { type: 'oi' },
    ],
  },
  leer: { name: 'Nur Kerzen', desc: 'Keine Indikatoren', list: [] },
};

export const DEFAULT_STATE = {
  market: 'binance-perp', base: 'BTC', tf: '15m', chartType: 'candles', lastType: 'candles',
  tpo: { block: '30m', rowSize: 0, display: 'auto', colors: 'mono', vaPct: 68, ibMin: 60, poc: true, va: true, vaFill: true, ib: true, openClose: true, singles: true, vp: true, vpWidth: 0.3, nakedPoc: true, extendVa: false },
  theme: 'light', candles: 'auto', tz: 'local', sessionOffsetMin: 0,
  session: { mode: 'utc', start: '02:00', end: '22:00', tz: 'Europe/Berlin' }, vaStep: 2,
  template: 'bild', indicators: null, tplState: {}, userTpls: [], tpoEdits: {}, colorsV: 0,
  watchlist: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'HYPE', 'SUI', 'LINK', 'AVAX', 'ADA', 'LTC'],
  favTfs: ['1m', '5m', '15m', '1h', '4h', '1D'],
  rightPanel: 'watch', rightOpen: true,
  display: { labelSize: 10, labelOffset: 3, labelNoOverlap: true, labelBg: false },
  tpoRow: 0, log: false, pct: false, autoScale: true,
  magnet: false, drawLock: false, drawHide: false,
  tapeMin: 0, domStep: 0, legendOpen: true,
  myDefaults: {}, recentColors: [], countdown: true, symLabel: true,
};

export const THEMES = {
  dark: {
    dark: true,
    bg: '#141413', text: '#b6b4ae', grid: 'rgba(240,238,232,0.045)', border: '#2b2b29', crosshair: '#75736d',
    labelBg: 'rgba(20,20,19,0.8)',
    levelLine: '#8c8c8c', levelText: '#c4c2bc', levelDim: '#5f5f5f', levelDimText: '#9a9894', ufa: '#e8e6e1',
    candles: { up: '#26a69a', down: '#ef5350', wickUp: '#26a69a', wickDown: '#ef5350', borderUp: '#26a69a', borderDown: '#ef5350' },
  },
  light: {
    dark: false,
    bg: '#ffffff', text: '#131722', grid: 'rgba(42,46,57,0.06)', border: '#e0e3eb', crosshair: '#9598a1',
    labelBg: 'rgba(255,255,255,0.85)',
    levelLine: '#505050', levelText: '#3c3c3c', levelDim: '#a3a3a3', levelDimText: '#757575', ufa: '#000000',
    candles: { up: '#ffffff', down: '#131722', wickUp: '#131722', wickDown: '#131722', borderUp: '#131722', borderDown: '#131722' },
  },
};
export const CANDLE_STYLES = {
  tv: { name: 'Grün / Rot', up: '#26a69a', down: '#ef5350', wickUp: '#26a69a', wickDown: '#ef5350', borderUp: '#26a69a', borderDown: '#ef5350' },
  sw: { name: 'Schwarz / Weiß (wie Bild)', light: { up: '#ffffff', down: '#131722', wickUp: '#131722', wickDown: '#131722', borderUp: '#131722', borderDown: '#131722' }, dark: { up: '#e8e6e1', down: '#5d5c58', wickUp: '#e8e6e1', wickDown: '#8a8984', borderUp: '#e8e6e1', borderDown: '#8a8984' } },
  tqi: { name: 'TQI Pink / Violett', up: '#7c3aed', down: '#db2777', wickUp: '#7c3aed', wickDown: '#db2777', borderUp: '#7c3aed', borderDown: '#db2777' },
};
