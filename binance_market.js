// Phase 6 market data engine
// Uses Binance first. If Binance returns 451 or is unavailable from the host region,
// it automatically falls back to Bybit, then OKX public spot market data.

const BINANCE_BASES = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com'
];
const BYBIT_BASE = 'https://api.bybit.com';
const OKX_BASE = 'https://www.okx.com';

export const SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','TRXUSDT','LINKUSDT','AVAXUSDT',
  'SUIUSDT','DOTUSDT','LTCUSDT','BCHUSDT','AAVEUSDT','UNIUSDT','NEARUSDT','ATOMUSDT','PEPEUSDT','OPUSDT',
  'ARBUSDT','APTUSDT','FILUSDT','INJUSDT','SEIUSDT','ETCUSDT','XLMUSDT','RENDERUSDT','MATICUSDT','WIFUSDT',
  'FETUSDT','ICPUSDT','FTMUSDT','RUNEUSDT','ALGOUSDT','HBARUSDT','VETUSDT','MKRUSDT','GRTUSDT','TIAUSDT'
];

function toOkxSymbol(symbol) {
  return symbol.replace('USDT', '-USDT');
}

function fromOkxSymbol(instId) {
  return instId.replace('-', '');
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'ai-trade-bot-market-data/1.0'
      }
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const extra = json?.msg || json?.message || text?.slice(0, 180) || res.statusText;
      throw new Error(`${res.status} ${extra}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestBinance(path) {
  let lastError;
  for (const base of BINANCE_BASES) {
    try {
      return await fetchJson(base + path);
    } catch (err) {
      lastError = err;
      // Try the next Binance mirror. If all fail, caller will fall back to another exchange.
    }
  }
  throw new Error(`Binance request failed: ${lastError?.message || 'unknown error'}`);
}

async function getBinance24hTickers() {
  const data = await requestBinance('/api/v3/ticker/24hr');
  return data
    .filter(x => SYMBOLS.includes(x.symbol))
    .map(x => ({
      symbol: x.symbol,
      price: Number(x.lastPrice),
      change24h: Number(x.priceChangePercent),
      quoteVolume: Number(x.quoteVolume),
      highPrice: Number(x.highPrice),
      lowPrice: Number(x.lowPrice),
      count: Number(x.count),
      source: 'Binance'
    }));
}

async function getBybit24hTickers() {
  const json = await fetchJson(`${BYBIT_BASE}/v5/market/tickers?category=spot`);
  const list = json?.result?.list || [];
  return list
    .filter(x => SYMBOLS.includes(x.symbol))
    .map(x => ({
      symbol: x.symbol,
      price: Number(x.lastPrice),
      change24h: Number(x.price24hPcnt || 0) * 100,
      quoteVolume: Number(x.turnover24h || 0),
      highPrice: Number(x.highPrice24h || 0),
      lowPrice: Number(x.lowPrice24h || 0),
      count: 0,
      source: 'Bybit'
    }));
}

async function getOkx24hTickers() {
  const json = await fetchJson(`${OKX_BASE}/api/v5/market/tickers?instType=SPOT`);
  const list = json?.data || [];
  return list
    .filter(x => x.instId?.endsWith('-USDT') && SYMBOLS.includes(fromOkxSymbol(x.instId)))
    .map(x => ({
      symbol: fromOkxSymbol(x.instId),
      price: Number(x.last),
      change24h: x.open24h && Number(x.open24h) > 0 ? ((Number(x.last) - Number(x.open24h)) / Number(x.open24h)) * 100 : 0,
      quoteVolume: Number(x.volCcy24h || 0),
      highPrice: Number(x.high24h || 0),
      lowPrice: Number(x.low24h || 0),
      count: 0,
      source: 'OKX'
    }));
}

export async function get24hTickers() {
  const errors = [];
  for (const provider of [getBinance24hTickers, getBybit24hTickers, getOkx24hTickers]) {
    try {
      const tickers = await provider();
      if (tickers.length) return tickers;
      errors.push('provider returned empty ticker list');
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(`All market data providers failed: ${errors.join(' | ')}`);
}

async function getBinanceCandles(symbol = 'BTCUSDT', interval = '15m', limit = 120) {
  const data = await requestBinance(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return data.map(k => ({
    openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]), closeTime: k[6], source: 'Binance'
  }));
}

function bybitInterval(interval) {
  const map = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D' };
  return map[interval] || '15';
}

async function getBybitCandles(symbol = 'BTCUSDT', interval = '15m', limit = 120) {
  const json = await fetchJson(`${BYBIT_BASE}/v5/market/kline?category=spot&symbol=${symbol}&interval=${bybitInterval(interval)}&limit=${limit}`);
  const list = json?.result?.list || [];
  return list
    .map(k => ({
      openTime: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]), closeTime: Number(k[0]), source: 'Bybit'
    }))
    .sort((a, b) => a.openTime - b.openTime);
}

function okxBar(interval) {
  const map = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };
  return map[interval] || '15m';
}

async function getOkxCandles(symbol = 'BTCUSDT', interval = '15m', limit = 120) {
  const instId = toOkxSymbol(symbol);
  const json = await fetchJson(`${OKX_BASE}/api/v5/market/candles?instId=${instId}&bar=${okxBar(interval)}&limit=${limit}`);
  const list = json?.data || [];
  return list
    .map(k => ({
      openTime: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]), closeTime: Number(k[0]), source: 'OKX'
    }))
    .sort((a, b) => a.openTime - b.openTime);
}

export async function getCandles(symbol = 'BTCUSDT', interval = '15m', limit = 120) {
  if (!SYMBOLS.includes(symbol)) throw new Error('Unsupported symbol');
  const errors = [];
  for (const provider of [getBinanceCandles, getBybitCandles, getOkxCandles]) {
    try {
      const candles = await provider(symbol, interval, limit);
      if (candles.length >= 30) return candles;
      errors.push(`${symbol}: provider returned too few candles`);
    } catch (err) {
      errors.push(`${symbol}: ${err.message}`);
    }
  }
  throw new Error(`All candle providers failed: ${errors.join(' | ')}`);
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let current = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) current = values[i] * k + current * (1 - k);
  return current;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const recent = candles.slice(-period);
  const trs = recent.map((c, idx) => {
    const prevClose = idx === 0 ? candles[candles.length - period - 1]?.close || c.close : recent[idx - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  return trs.reduce((a,b)=>a+b,0) / period;
}

export async function analyzeSymbol(symbol) {
  const candles = await getCandles(symbol, '15m', 120);
  const closes = candles.map(c => c.close);
  const price = closes.at(-1);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 100); // 100 candle proxy for MVP
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const recent = candles.slice(-20);
  const avgVol = recent.reduce((a,c)=>a+c.volume,0) / Math.max(1,recent.length);
  const lastVol = candles.at(-1).volume;
  const support = Math.min(...recent.map(c=>c.low));
  const resistance = Math.max(...recent.map(c=>c.high));
  const trend = ema20 && ema50 ? (ema20 > ema50 ? 'bullish' : 'bearish') : 'neutral';
  const volatilityPct = atr14 && price ? (atr14 / price) * 100 : 0;
  const volumeBoost = lastVol > avgVol ? 8 : 0;
  const trendScore = trend === 'bullish' ? 28 : trend === 'neutral' ? 16 : 7;
  const rsiScore = rsi14 > 50 && rsi14 < 70 ? 25 : rsi14 >= 42 && rsi14 <= 74 ? 17 : 7;
  const emaScore = ema20 && ema50 && ema200 && ema20 > ema50 && price > ema50 ? 22 : ema20 && ema50 && price > ema20 ? 14 : 6;
  const volPenalty = volatilityPct > 2.5 ? 15 : volatilityPct > 1.6 ? 8 : volatilityPct < 0.05 ? 5 : 0;
  const safety = Math.max(35, Math.min(99, Math.round(35 + trendScore + rsiScore + emaScore + volumeBoost - volPenalty)));
  const signal = safety >= 90 ? 'BUY' : safety >= 80 ? 'WATCH' : 'SKIP';
  const expectedMove = Math.max(0.08, Math.min(0.35, volatilityPct * 0.45));
  const source = candles.at(-1)?.source || 'Live market data';
  return {
    symbol, price, signal, safety, source,
    rsi: Number((rsi14 || 0).toFixed(2)),
    ema20: Number((ema20 || 0).toFixed(6)),
    ema50: Number((ema50 || 0).toFixed(6)),
    atrPct: Number(volatilityPct.toFixed(3)),
    expectedMove: Number(expectedMove.toFixed(3)),
    support: Number(support.toFixed(6)),
    resistance: Number(resistance.toFixed(6)),
    reason: signal === 'BUY'
      ? `Live ${source} candles: bullish trend, healthy RSI, acceptable volatility.`
      : `Live ${source} candles: setup not safe enough yet.`
  };
}

export async function scanMarket(minSafetyScore = 90) {
  const tickers = await get24hTickers();
  const top = tickers
    .filter(t => t.quoteVolume > 10000000 && Number.isFinite(t.price) && t.price > 0)
    .sort((a,b)=>b.quoteVolume - a.quoteVolume)
    .slice(0, 20);
  const analyses = [];
  for (const t of top) {
    try {
      const a = await analyzeSymbol(t.symbol);
      analyses.push({
        ...a,
        change24h: Number(t.change24h.toFixed(2)),
        quoteVolume: Math.round(t.quoteVolume),
        liquidity: Math.min(100, Math.round(Math.log10(Math.max(10, t.quoteVolume)) * 10)),
        tickerSource: t.source
      });
    } catch (err) {
      console.warn(`scan skipped ${t.symbol}: ${err.message}`);
    }
  }
  return analyses
    .sort((a,b)=>b.safety-a.safety)
    .slice(0, 12)
    .map(x => ({ ...x, signal: x.safety >= minSafetyScore ? 'BUY' : x.safety >= 80 ? 'WATCH' : 'SKIP' }));
}
