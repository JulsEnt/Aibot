import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 10000;
const FRONTEND_URL = process.env.FRONTEND_URL || "*";

app.use(cors({ origin: FRONTEND_URL === "*" ? true : FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "2mb" }));

const SYMBOLS = [
  "BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT",
  "LINKUSDT","TRXUSDT","DOTUSDT","LTCUSDT","BCHUSDT","UNIUSDT","AAVEUSDT","NEARUSDT",
  "ATOMUSDT","SUIUSDT","APTUSDT","ARBUSDT","OPUSDT","INJUSDT","FILUSDT","ICPUSDT",
  "ETCUSDT","XLMUSDT","HBARUSDT","VETUSDT","ALGOUSDT","MATICUSDT","PEPEUSDT","FETUSDT",
  "RNDRUSDT","TIAUSDT","SEIUSDT","WLDUSDT","GRTUSDT","RUNEUSDT","IMXUSDT","STXUSDT",
  "MKRUSDT","LDOUSDT","ENSUSDT","JUPUSDT","PYTHUSDT","JTOUSDT","ORDIUSDT","WIFUSDT"
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const toNum = v => Number.isFinite(Number(v)) ? Number(v) : 0;

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "ai-trade-bot/compatible" } });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 160)}`);
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
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function atrPct(candles, period = 14) {
  if (candles.length <= period) return 0;
  const trs = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const atr = trs.reduce((a,b)=>a+b,0) / trs.length;
  return (atr / (candles.at(-1)?.close || 1)) * 100;
}

function macd(closes) {
  return ema(closes, 12) - ema(closes, 26);
}

async function binanceCandles(symbol) {
  const data = await fetchJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=96`);
  return data.map(k => ({ openTime:k[0], open:toNum(k[1]), high:toNum(k[2]), low:toNum(k[3]), close:toNum(k[4]), volume:toNum(k[5]) }));
}

async function bybitCandles(symbol) {
  const data = await fetchJson(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=15&limit=96`);
  const list = (data.result?.list || []).slice().reverse();
  return list.map(k => ({ openTime:toNum(k[0]), open:toNum(k[1]), high:toNum(k[2]), low:toNum(k[3]), close:toNum(k[4]), volume:toNum(k[5]) }));
}

async function okxCandles(symbol) {
  const instId = symbol.replace("USDT", "-USDT");
  const data = await fetchJson(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=15m&limit=96`);
  const list = (data.data || []).slice().reverse();
  return list.map(k => ({ openTime:toNum(k[0]), open:toNum(k[1]), high:toNum(k[2]), low:toNum(k[3]), close:toNum(k[4]), volume:toNum(k[5]) }));
}

async function getCandles(symbol) {
  const providers = [["Binance", binanceCandles], ["Bybit", bybitCandles], ["OKX", okxCandles]];
  let lastErr = "";
  for (const [exchange, fn] of providers) {
    try {
      const candles = await fn(symbol);
      if (candles.length >= 30 && candles.at(-1).close > 0) return { exchange, candles };
    } catch (e) {
      lastErr = `${exchange}: ${e.message}`;
    }
  }
  throw new Error(lastErr || "No market data provider available");
}

function scoreMarket(symbol, candles, exchange) {
  const closes = candles.map(c => c.close);
  const last = candles.at(-1), first = candles[0];
  const price = last.close;
  const change24h = ((last.close - first.open) / first.open) * 100;
  const r = rsi(closes);
  const e20 = ema(closes.slice(-40), 20);
  const e50 = ema(closes.slice(-80), 50);
  const m = macd(closes);
  const atr = atrPct(candles);
  const valueVolume = candles.slice(-20).reduce((a,c)=>a+(c.volume*c.close),0)/20;
  const liquidity = Math.max(30, Math.min(99, Math.round(Math.log10(Math.max(valueVolume,1))*12)));

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
    expectedMove: Math.max(0.05, Math.min(0.75, +(atr * 0.42).toFixed(3))),
    liquidity,
    exchange,
    reason
  };
}

const traders = [
  { id:"t1", name:"Zen Hedge", style:"Capital protection", score:71, winRate:61, drawdown:2.9, risk:"Low", copied:true, paused:false },
  { id:"t2", name:"Trend Alpha", style:"Trend following", score:67, winRate:58, drawdown:4.4, risk:"Medium", copied:false, paused:false },
  { id:"t3", name:"Micro Scalper", style:"Small moves", score:64, winRate:55, drawdown:5.1, risk:"Medium", copied:false, paused:true }
];

let state = {
  balance: 1000,
  equity: 1000,
  demoDeposits: [],
  withdrawals: [],
  emergencyStop: false,
  botStatus: "Online",
  risk: { perTrade: 1, dailyLossLimit: 3, maxOpenTrades: 3, minSafetyScore: 90, maxTraderDrawdown: 10 },
  alerts: [{ id:"a0", type:"System", text:"Backend connected. Real money trading locked.", time:new Date().toLocaleTimeString() }],
  scanner: [],
  trades: [],
  traders,
  admin: { users: 1, pendingDeposits: 0, pendingWithdrawals: 0, realMoneyLocked: true, mode: "Paper Trading" },
  dataMode: "Waiting for backend market scan",
  lastUpdated: null,
  marketError: null
};

let cacheAt = 0;
const CACHE_MS = 30_000;

function publicState() {
  state.admin.pendingDeposits = state.demoDeposits.filter(d => d.status === "pending").length;
  state.admin.pendingWithdrawals = state.withdrawals.filter(w => w.status === "pending").length;
  return { ok: true, state };
}

async function runScan(force = false) {
  if (!force && Date.now() - cacheAt < CACHE_MS && state.scanner.length) return state.scanner;

  const results = [];
  const errors = [];
  for (const symbol of SYMBOLS) {
    try {
      const { exchange, candles } = await getCandles(symbol);
      results.push(scoreMarket(symbol, candles, exchange));
      await sleep(70);
    } catch (e) {
      errors.push(`${symbol}: ${e.message}`);
    }
  }
  results.sort((a,b)=> b.safety - a.safety || b.liquidity - a.liquidity);
  state.scanner = results.slice(0, 20);
  state.dataMode = results[0] ? `Live ${results[0].exchange} data` : "Market data unavailable";
  state.marketError = results.length ? null : (errors[0] || "No market data returned");
  state.lastUpdated = new Date().toLocaleString();
  state.botStatus = results.length ? "Online" : "Market data error";
  state.alerts.unshift({ id:`a${Date.now()}`, type:"Scan", text:`Scanned ${results.length} markets. Best: ${results[0]?.symbol || "none"}`, time:new Date().toLocaleTimeString() });
  cacheAt = Date.now();
  return state.scanner;
}

app.get("/", (req,res) => res.json({ ok:true, service:"AI Trade Bot Backend", phase:"8.1-compatible" }));
app.get("/api/health", (req,res) => res.json({ ok:true, mode:"paper-only", phase:"8.1-compatible", endpoints:"frontend-compatible", cacheAgeMs: Date.now()-cacheAt }));
app.get("/api/state", (req,res) => res.json(publicState()));

app.post("/api/scan", async (req,res) => {
  try {
    await runScan(true);
    res.json(publicState());
  } catch (e) {
    state.marketError = e.message;
    state.dataMode = "Market data unavailable";
    res.status(503).json(publicState());
  }
});

app.get("/api/market/scan", async (req,res) => {
  try {
    await runScan(false);
    res.json({ ok:true, best: state.scanner[0] || null, markets: state.scanner });
  } catch (e) {
    res.status(503).json({ ok:false, message:e.message });
  }
});

app.post("/api/deposit", (req,res) => {
  const amount = Number(req.body.amount || 0);
  if (amount < 1000) return res.status(400).json({ ok:false, error:"Minimum demo deposit is ₦1,000" });
  const dep = { id:`D${Date.now()}`, amount, status:"pending", time:new Date().toLocaleString() };
  state.demoDeposits.unshift(dep);
  state.alerts.unshift({ id:`a${Date.now()}`, type:"Deposit", text:`Demo deposit request: ₦${amount}`, time:new Date().toLocaleTimeString() });
  res.json(publicState());
});

app.post("/api/withdraw", (req,res) => {
  const amount = Number(req.body.amount || 0);
  const wd = { id:`W${Date.now()}`, amount, status:"pending", time:new Date().toLocaleString() };
  state.withdrawals.unshift(wd);
  state.alerts.unshift({ id:`a${Date.now()}`, type:"Withdraw", text:`Demo withdrawal request: ₦${amount}`, time:new Date().toLocaleTimeString() });
  res.json(publicState());
});

app.post("/api/admin/deposit/:id/approve", (req,res) => {
  const d = state.demoDeposits.find(x => x.id === req.params.id);
  if (d && d.status === "pending") {
    d.status = "approved";
    state.balance += d.amount;
    state.equity = state.balance;
  }
  res.json(publicState());
});

app.post("/api/admin/withdraw/:id/approve", (req,res) => {
  const w = state.withdrawals.find(x => x.id === req.params.id);
  if (w && w.status === "pending") {
    w.status = "approved";
    state.balance = Math.max(0, state.balance - w.amount);
    state.equity = state.balance;
  }
  res.json(publicState());
});

app.post("/api/emergency", (req,res) => {
  state.emergencyStop = Boolean(req.body.enabled);
  state.botStatus = state.emergencyStop ? "Emergency Stop" : "Online";
  state.alerts.unshift({ id:`a${Date.now()}`, type:"Safety", text: state.emergencyStop ? "Emergency stop enabled" : "Emergency stop disabled", time:new Date().toLocaleTimeString() });
  res.json(publicState());
});

app.post("/api/paper-cycle", async (req,res) => {
  if (state.emergencyStop) return res.status(423).json({ ok:false, error:"Emergency stop is active", state });
  await runScan(false);
  const best = state.scanner.find(m => m.signal === "BUY" && m.safety >= state.risk.minSafetyScore);
  if (!best) {
    state.alerts.unshift({ id:`a${Date.now()}`, type:"Paper", text:"No safe trade available. Bot skipped.", time:new Date().toLocaleTimeString() });
    return res.json(publicState());
  }
  const pnl = +(state.balance * 0.001).toFixed(2);
  const trade = {
    id:`T${Date.now()}`,
    time:new Date().toLocaleString(),
    symbol:best.symbol,
    price:best.price,
    trader:"AI Safe Scanner",
    safety:best.safety,
    result:"OPEN",
    pnl:0,
    reason:best.reason
  };
  state.trades.unshift(trade);
  state.alerts.unshift({ id:`a${Date.now()}`, type:"Paper", text:`Paper trade opened on ${best.symbol}`, time:new Date().toLocaleTimeString() });
  res.json(publicState());
});

app.post("/api/paper/run", async (req,res) => {
  await runScan(false);
  res.json(publicState());
});

app.get("/api/paper/status", (req,res) => res.json({ ok:true, paper:{ balance: state.balance, trades: state.trades, emergencyStop: state.emergencyStop } }));

setInterval(() => runScan(false).catch(() => {}), 60_000);

app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));