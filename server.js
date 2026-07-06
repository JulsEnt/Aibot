import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 10000;
const FRONTEND_URL = process.env.FRONTEND_URL || "*";

app.use(cors({
  origin: FRONTEND_URL === "*" ? true : FRONTEND_URL,
  credentials: true
}));
app.use(express.json({ limit: "2mb" }));

const BASE_SYMBOLS = [
  "BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT",
  "LINKUSDT","TRXUSDT","DOTUSDT","LTCUSDT","BCHUSDT","UNIUSDT","AAVEUSDT","NEARUSDT",
  "ATOMUSDT","SUIUSDT","APTUSDT","ARBUSDT","OPUSDT","INJUSDT","FILUSDT","ICPUSDT",
  "ETCUSDT","XLMUSDT","HBARUSDT","VETUSDT","ALGOUSDT","MATICUSDT","PEPEUSDT","FETUSDT",
  "RNDRUSDT","TIAUSDT","SEIUSDT","WLDUSDT","GRTUSDT","RUNEUSDT","IMXUSDT","STXUSDT",
  "MKRUSDT","LDOUSDT","ENSUSDT","JUPUSDT","PYTHUSDT","JTOUSDT","ORDIUSDT","WIFUSDT"
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const toNum = v => Number.isFinite(Number(v)) ? Number(v) : 0;

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "ai-trade-bot-phase8/1.0" }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 180)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(id);
  }
}

function ema(values, period) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i++) out = values[i] * k + out * (1 - k);
  return out;
}

function rsi(closes, period = 14) {
  if (closes.length <= period) return 50;
  let gains = 0, losses = 0;
  const start = closes.length - period;
  for (let i = start; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function atrPct(candles, period = 14) {
  if (candles.length <= period) return 0;
  const trs = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
  const last = candles.at(-1)?.close || 1;
  return (atr / last) * 100;
}

function macd(closes) {
  return ema(closes, 12) - ema(closes, 26);
}

async function binanceCandles(symbol, interval = "15m", limit = 96) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const data = await fetchJson(url);
  return data.map(k => ({ openTime:k[0], open:toNum(k[1]), high:toNum(k[2]), low:toNum(k[3]), close:toNum(k[4]), volume:toNum(k[5]) }));
}

async function bybitCandles(symbol, interval = "15", limit = 96) {
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const data = await fetchJson(url);
  const list = (data.result?.list || []).slice().reverse();
  return list.map(k => ({ openTime:toNum(k[0]), open:toNum(k[1]), high:toNum(k[2]), low:toNum(k[3]), close:toNum(k[4]), volume:toNum(k[5]) }));
}

async function okxCandles(symbol, bar = "15m", limit = 96) {
  const instId = symbol.replace("USDT", "-USDT");
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;
  const data = await fetchJson(url);
  const list = (data.data || []).slice().reverse();
  return list.map(k => ({ openTime:toNum(k[0]), open:toNum(k[1]), high:toNum(k[2]), low:toNum(k[3]), close:toNum(k[4]), volume:toNum(k[5]) }));
}

async function getCandles(symbol) {
  const providers = [
    ["Binance", () => binanceCandles(symbol)],
    ["Bybit", () => bybitCandles(symbol)],
    ["OKX", () => okxCandles(symbol)]
  ];
  let lastErr = "";
  for (const [exchange, fn] of providers) {
    try {
      const candles = await fn();
      if (candles.length >= 30 && candles.at(-1).close > 0) return { exchange, candles };
    } catch (e) {
      lastErr = `${exchange}: ${e.message}`;
    }
  }
  throw new Error(lastErr || "No live market provider available");
}

function scoreMarket(symbol, candles, exchange) {
  const closes = candles.map(c => c.close);
  const last = candles.at(-1);
  const first = candles[0];
  const price = last.close;
  const change24h = ((last.close - first.open) / first.open) * 100;
  const r = rsi(closes);
  const e20 = ema(closes.slice(-40), 20);
  const e50 = ema(closes.slice(-80), 50);
  const m = macd(closes);
  const atr = atrPct(candles);
  const valueVolume = candles.slice(-20).reduce((a,c)=> a + (c.volume * c.close), 0) / 20;
  const liquidity = Math.max(30, Math.min(99, Math.round(Math.log10(Math.max(valueVolume, 1)) * 12)));

  let safety = 50;
  if (price > e20 && e20 > e50) safety += 20;
  if (r >= 45 && r <= 68) safety += 17;
  if (m > 0) safety += 8;
  if (atr > 0.08 && atr < 1.6) safety += 14;
  if (liquidity >= 75) safety += 10;
  if (Math.abs(change24h) > 8) safety -= 12;
  if (r > 74 || r < 26) safety -= 14;
  if (atr > 2.6) safety -= 10;
  safety = Math.max(0, Math.min(99, Math.round(safety)));

  const expectedMove = Math.max(0.05, Math.min(0.75, +(atr * 0.42).toFixed(3)));
  let signal = "SKIP";
  let reason = `Live ${exchange} candles: setup not safe enough yet.`;

  if (safety >= 88 && price > e20 && e20 > e50 && r >= 48 && r <= 66 && m > 0) {
    signal = "BUY";
    reason = `Live ${exchange} candles: trend, RSI, MACD, liquidity and volatility passed safety filters.`;
  } else if (safety >= 78) {
    signal = "WATCH";
    reason = `Live ${exchange} candles: promising setup, waiting for stronger confirmation.`;
  }

  return {
    symbol,
    price: +price.toFixed(6),
    change24h: +change24h.toFixed(2),
    signal,
    safety,
    rsi: +r.toFixed(2),
    atrPct: +atr.toFixed(3),
    expectedMove,
    liquidity,
    exchange,
    reason
  };
}

let cache = { at: 0, markets: [], best: null, errors: [] };
const CACHE_MS = 30_000;

async function scanMarkets(force = false) {
  if (!force && Date.now() - cache.at < CACHE_MS && cache.markets.length) return cache;

  const results = [];
  const errors = [];

  for (const symbol of BASE_SYMBOLS) {
    try {
      const { exchange, candles } = await getCandles(symbol);
      results.push(scoreMarket(symbol, candles, exchange));
      await sleep(70);
    } catch (e) {
      errors.push({ symbol, error: e.message });
    }
  }

  results.sort((a,b) => b.safety - a.safety || b.liquidity - a.liquidity);
  cache = { at: Date.now(), markets: results, best: results[0] || null, errors };
  return cache;
}

// background scanner
setInterval(() => scanMarkets(true).catch(e => console.log("background scan failed:", e.message)), CACHE_MS);

let paper = {
  balance: 1000,
  trades: [],
  openTrade: null,
  wins: 0,
  losses: 0,
  emergencyStop: false,
  lastAction: "Waiting"
};

app.get("/", (req,res) => res.json({ ok:true, service:"AI Trade Bot Backend", phase:8 }));
app.get("/api/health", (req,res) => res.json({
  ok:true,
  mode:"paper-only",
  phase:8,
  marketData:"binance-bybit-okx-live-rest",
  cacheAgeMs: Date.now() - cache.at
}));

app.get("/api/market/scan", async (req,res) => {
  try {
    const s = await scanMarkets(false);
    res.json({
      ok:true,
      generatedAt:new Date(s.at).toISOString(),
      best:s.best,
      markets:s.markets.slice(0, 20),
      errors:s.errors.slice(0, 5)
    });
  } catch (e) {
    res.status(503).json({ ok:false, message:e.message });
  }
});

app.post("/api/wallet/deposit", (req,res) => {
  const amount = Number(req.body.amount || 0);
  if (amount < 1000) return res.status(400).json({ ok:false, message:"Minimum demo deposit is ₦1,000" });
  paper.balance += amount;
  res.json({ ok:true, balance:paper.balance, message:"Demo deposit added" });
});

app.post("/api/wallet/withdraw", (req,res) => {
  res.json({ ok:true, status:"pending-admin-review", message:"Demo withdrawal request received" });
});

app.post("/api/bot/emergency-stop", (req,res) => {
  paper.emergencyStop = true;
  paper.lastAction = "Emergency stop active";
  res.json({ ok:true, emergencyStop:true, message:"Emergency stop enabled" });
});

app.post("/api/bot/reset-stop", (req,res) => {
  paper.emergencyStop = false;
  paper.lastAction = "Emergency stop cleared";
  res.json({ ok:true, emergencyStop:false, message:"Emergency stop cleared" });
});

app.post("/api/paper/run", async (req,res) => {
  if (paper.emergencyStop) return res.status(423).json({ ok:false, message:"Emergency stop is active", paper });
  if (paper.openTrade) return res.json({ ok:true, message:"Paper trade already open", trade:paper.openTrade, paper });

  const s = await scanMarkets(false);
  const best = s.markets.find(m => m.signal === "BUY" && m.safety >= 88);
  if (!best) {
    paper.lastAction = "No safe paper trade available now";
    return res.json({ ok:true, message:"No safe paper trade available now", best:s.best, paper });
  }

  const targetPct = Math.max(0.10, Math.min(0.35, best.expectedMove));
  const stopPct = 0.35;
  const trade = {
    id: `PT-${Date.now()}`,
    symbol: best.symbol,
    exchange: best.exchange,
    side: "BUY",
    entry: best.price,
    takeProfit: +(best.price * (1 + targetPct/100)).toFixed(6),
    stopLoss: +(best.price * (1 - stopPct/100)).toFixed(6),
    targetPct,
    stopPct,
    safety: best.safety,
    status: "OPEN",
    openedAt: new Date().toISOString(),
    simulatedAmount: +(paper.balance * 0.01).toFixed(2),
    reason: best.reason
  };
  paper.openTrade = trade;
  paper.trades.unshift(trade);
  paper.lastAction = `Opened paper BUY on ${best.symbol}`;
  res.json({ ok:true, message:"Paper trade opened", trade, paper });
});

app.get("/api/paper/status", (req,res) => res.json({ ok:true, paper }));

app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));