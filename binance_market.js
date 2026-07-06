const BINANCE_BASES = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com'
];

export const SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','TRXUSDT','LINKUSDT','AVAXUSDT',
  'SUIUSDT','DOTUSDT','LTCUSDT','BCHUSDT','AAVEUSDT','UNIUSDT','NEARUSDT','ATOMUSDT','PEPEUSDT','OPUSDT',
  'ARBUSDT','APTUSDT','FILUSDT','INJUSDT','SEIUSDT','ETCUSDT','XLMUSDT','RENDERUSDT','MATICUSDT','WIFUSDT',
  'FETUSDT','ICPUSDT','FTMUSDT','RUNEUSDT','ALGOUSDT','HBARUSDT','VETUSDT','MKRUSDT','GRTUSDT','TIAUSDT'
];

async function requestBinance(path) {
  let lastError;
  for (const base of BINANCE_BASES) {
    try {
      const res = await fetch(base + path, { headers: { 'accept': 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Binance request failed: ${lastError?.message || 'unknown error'}`);
}

export async function get24hTickers() {
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
      count: Number(x.count)
    }));
}

export async function getCandles(symbol = 'BTCUSDT', interval = '15m', limit = 120) {
  if (!SYMBOLS.includes(symbol)) throw new Error('Unsupported symbol');
  const data = await requestBinance(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return data.map(k => ({
    openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]), closeTime: k[6]
  }));
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
  const ema200 = ema(closes, 100); // 100 candle proxy for the MVP
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
  return {
    symbol, price, signal, safety,
    rsi: Number((rsi14 || 0).toFixed(2)),
    ema20: Number((ema20 || 0).toFixed(6)),
    ema50: Number((ema50 || 0).toFixed(6)),
    atrPct: Number(volatilityPct.toFixed(3)),
    expectedMove: Number(expectedMove.toFixed(3)),
    support: Number(support.toFixed(6)),
    resistance: Number(resistance.toFixed(6)),
    reason: signal === 'BUY'
      ? 'Live candles: bullish trend, healthy RSI, acceptable volatility.'
      : 'Live candles: setup not safe enough yet.'
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
      analyses.push({ ...a, change24h: Number(t.change24h.toFixed(2)), quoteVolume: Math.round(t.quoteVolume), liquidity: Math.min(100, Math.round(Math.log10(t.quoteVolume) * 10)) });
    } catch {}
  }
  return analyses.sort((a,b)=>b.safety-a.safety).slice(0, 12).map(x => ({ ...x, signal: x.safety >= minSafetyScore ? 'BUY' : x.safety >= 80 ? 'WATCH' : 'SKIP' }));
}
