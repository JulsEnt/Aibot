
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
  "ETCUSDT","XLMUSDT","HBARUSDT","VETUSDT","ALGOUSDT","PEPEUSDT","FETUSDT","TIAUSDT",
  "SEIUSDT","WLDUSDT","GRTUSDT","RUNEUSDT","IMXUSDT","STXUSDT","MKRUSDT","LDOUSDT",
  "ENSUSDT","JUPUSDT","PYTHUSDT","JTOUSDT","ORDIUSDT","WIFUSDT","ARUSDT","SANDUSDT",
  "MANAUSDT","AXSUSDT","GALAUSDT","CHZUSDT","CRVUSDT","COMPUSDT","SNXUSDT","DYDXUSDT"
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const toNum = v => Number.isFinite(Number(v)) ? Number(v) : 0;

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "ai-trade-bot-phase9" }});
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
    const diff = closes[i] - closes[i-1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function atrPct(candles, period=14) {
  if (candles.length <= period) return 0;
  const trs = [];
  for (let i=candles.length-period;i<candles.length;i++) {
    const c=candles[i], p=candles[i-1];
    trs.push(Math.max(c.high-c.low, Math.abs(c.high-p.close), Math.abs(c.low-p.close)));
  }
  const atr = trs.reduce((a,b)=>a+b,0)/trs.length;
  return (atr/(candles.at(-1)?.close || 1))*100;
}

function macd(closes) { return ema(closes,12) - ema(closes,26); }

async function binanceCandles(symbol) {
  const data = await fetchJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=96`);
  return data.map(k => ({openTime:k[0], open:toNum(k[1]), high:toNum(k[2]), low:toNum(k[3]), close:toNum(k[4]), volume:toNum(k[5])}));
}
async function bybitCandles(symbol) {
  const data = await fetchJson(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=15&limit=96`);
  const list=(data.result?.list||[]).slice().reverse();
  return list.map(k=>({openTime:toNum(k[0]), open:toNum(k[1]), high:toNum(k[2]), low:toNum(k[3]), close:toNum(k[4]), volume:toNum(k[5])}));
}
async function okxCandles(symbol) {
  const instId=symbol.replace("USDT","-USDT");
  const data=await fetchJson(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=15m&limit=96`);
  const list=(data.data||[]).slice().reverse();
  return list.map(k=>({openTime:toNum(k[0]), open:toNum(k[1]), high:toNum(k[2]), low:toNum(k[3]), close:toNum(k[4]), volume:toNum(k[5])}));
}
async function latestPrice(symbol) {
  const providers = [
    async()=>({exchange:"Binance", price:toNum((await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`)).price)}),
    async()=>({exchange:"Bybit", price:toNum((await fetchJson(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`)).result?.list?.[0]?.lastPrice)}),
    async()=>({exchange:"OKX", price:toNum((await fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${symbol.replace("USDT","-USDT")}`)).data?.[0]?.last)})
  ];
  let err="";
  for (const p of providers) {
    try { const r=await p(); if (r.price>0) return r; } catch(e) { err=e.message; }
  }
  throw new Error(err || "Price unavailable");
}

async function getCandles(symbol) {
  const providers=[["Binance",binanceCandles],["Bybit",bybitCandles],["OKX",okxCandles]];
  let lastErr="";
  for (const [exchange,fn] of providers) {
    try {
      const candles=await fn(symbol);
      if (candles.length>=30 && candles.at(-1).close>0) return {exchange,candles};
    } catch(e) { lastErr = `${exchange}: ${e.message}`; }
  }
  throw new Error(lastErr || "No market data provider");
}

function scoreMarket(symbol,candles,exchange) {
  const closes=candles.map(c=>c.close), last=candles.at(-1), first=candles[0], price=last.close;
  const change24h=((last.close-first.open)/first.open)*100;
  const r=rsi(closes), e20=ema(closes.slice(-40),20), e50=ema(closes.slice(-80),50), m=macd(closes), atr=atrPct(candles);
  const valueVolume=candles.slice(-20).reduce((a,c)=>a+(c.volume*c.close),0)/20;
  const liquidity=Math.max(30,Math.min(99,Math.round(Math.log10(Math.max(valueVolume,1))*12)));
  let safety=50;
  if (price>e20 && e20>e50) safety+=20;
  if (r>=45 && r<=68) safety+=17;
  if (m>0) safety+=8;
  if (atr>0.08 && atr<1.6) safety+=14;
  if (liquidity>=75) safety+=10;
  if (Math.abs(change24h)>8) safety-=12;
  if (r>74 || r<26) safety-=14;
  if (atr>2.6) safety-=10;
  safety=Math.max(0,Math.min(99,Math.round(safety)));
  let signal="SKIP", reason=`Live ${exchange} candles: setup not safe enough yet.`;
  if (safety>=88 && price>e20 && e20>e50 && r>=48 && r<=66 && m>0) {
    signal="BUY"; reason=`Live ${exchange} candles: trend, RSI, MACD, liquidity and volatility passed safety filters.`;
  } else if (safety>=78) {
    signal="WATCH"; reason=`Live ${exchange} candles: promising setup, waiting for stronger confirmation.`;
  }
  return {symbol, price:+price.toFixed(6), change24h:+change24h.toFixed(2), signal, safety, rsi:+r.toFixed(2), atrPct:+atr.toFixed(3), expectedMove:Math.max(0.05,Math.min(0.75,+(atr*0.42).toFixed(3))), liquidity, exchange, reason};
}

const traders=[
  {id:"t1", name:"Zen Hedge", style:"Capital protection", score:71, winRate:61, drawdown:2.9, risk:"Low"},
  {id:"t2", name:"Trend Alpha", style:"Trend following", score:67, winRate:58, drawdown:4.4, risk:"Medium"},
  {id:"t3", name:"Micro Scalper", style:"Small moves", score:64, winRate:55, drawdown:5.1, risk:"Medium"}
];

let state={
  balance:1000, equity:1000, startBalance:1000,
  demoDeposits:[], withdrawals:[], emergencyStop:false, botRunning:false, botStatus:"Online",
  risk:{perTrade:1, dailyLossLimit:3, maxOpenTrades:1, minSafetyScore:78, takeProfitPct:0.18, stopLossPct:0.35},
  alerts:[{id:"a0", type:"System", text:"Phase 9 continuous paper trader ready. Real trading locked.", time:new Date().toLocaleTimeString()}],
  scanner:[], trades:[], traders, openTrade:null, wins:0, losses:0, closedPnl:0,
  admin:{users:1,pendingDeposits:0,pendingWithdrawals:0,realMoneyLocked:true,mode:"Continuous Paper Trading"},
  dataMode:"Waiting", lastUpdated:null, marketError:null
};

let cacheAt=0;
const CACHE_MS=30_000;

function addAlert(type,text){ state.alerts.unshift({id:`a${Date.now()}-${Math.random()}`, type, text, time:new Date().toLocaleTimeString()}); state.alerts=state.alerts.slice(0,30); }
function publicState(){ state.admin.pendingDeposits=state.demoDeposits.filter(d=>d.status==="pending").length; state.admin.pendingWithdrawals=state.withdrawals.filter(w=>w.status==="pending").length; return {ok:true,state}; }

async function runScan(force=false) {
  if(!force && Date.now()-cacheAt<CACHE_MS && state.scanner.length) return state.scanner;
  const results=[], errors=[];
  for(const symbol of SYMBOLS) {
    try {
      const {exchange,candles}=await getCandles(symbol);
      results.push(scoreMarket(symbol,candles,exchange));
      await sleep(60);
    } catch(e) { errors.push(`${symbol}: ${e.message}`); }
  }
  results.sort((a,b)=>b.safety-a.safety || b.liquidity-a.liquidity);
  state.scanner=results.slice(0,20);
  state.dataMode=results[0]?`Live ${results[0].exchange} data`:"Market data unavailable";
  state.marketError=results.length?null:(errors[0] || "No market data returned");
  state.lastUpdated=new Date().toLocaleString();
  state.botStatus=state.emergencyStop?"Emergency Stop":(state.botRunning?"Auto Running":"Online");
  addAlert("Scan",`Scanned ${results.length} markets. Best: ${results[0]?.symbol || "none"}`);
  cacheAt=Date.now();
  return state.scanner;
}

function openPaper(best) {
  if (state.openTrade && state.openTrade.status === "OPEN") {
    addAlert("Paper", `Trade already open on ${state.openTrade.symbol}. Monitoring existing trade.`);
    return;
  }
  const amount=+(state.balance*(state.risk.perTrade/100)).toFixed(2);
  const tpPct=Math.max(0.1, Math.min(0.35, best.expectedMove || state.risk.takeProfitPct));
  const slPct=state.risk.stopLossPct;
  const trade={
    id:`T${Date.now()}`, time:new Date().toLocaleString(), openedAtMs:Date.now(), symbol:best.symbol, exchange:best.exchange,
    side:"BUY", entry:best.price, current:best.price, takeProfit:+(best.price*(1+tpPct/100)).toFixed(6),
    stopLoss:+(best.price*(1-slPct/100)).toFixed(6), amount, safety:best.safety, trader:"AI Safe Scanner",
    result:"OPEN", status:"OPEN", pnl:0, reason:best.reason
  };
  state.openTrade=trade; state.trades.unshift(trade);
  addAlert("Paper",`Paper trade opened on ${best.symbol}. TP: $${trade.takeProfit}, SL: $${trade.stopLoss}`);
}

async function monitorTrade() {
  if(!state.openTrade || state.openTrade.status!=="OPEN") return;
  const t=state.openTrade;
  try {
    const {price, exchange}=await latestPrice(t.symbol);
    t.current=+price.toFixed(6); 
    t.exchange=exchange;

    const openedMs = t.openedAtMs || Date.now();
    const ageMs = Date.now() - openedMs;
    let closeReason=null;

    if(price>=t.takeProfit) closeReason="TAKE_PROFIT";
    if(price<=t.stopLoss) closeReason="STOP_LOSS";

    // PAPER MODE ONLY: recycle every 5 minutes even if TP/SL was not hit.
    if(!closeReason && ageMs >= 5 * 60 * 1000) closeReason="TIME_EXIT_5M";

    if(!closeReason) {
      t.unrealizedPct = +(((price - t.entry) / t.entry) * 100).toFixed(4);
      t.unrealizedPnl = +(t.amount * (t.unrealizedPct / 100)).toFixed(4);
      return;
    }

    const pct=((price-t.entry)/t.entry)*100;
    const pnl=+(t.amount*(pct/100)).toFixed(4);
    t.pnl=pnl; 
    t.closePrice=+price.toFixed(6);
    t.result=closeReason; 
    t.status="CLOSED"; 
    t.closedAt=new Date().toLocaleString();

    state.balance=+(state.balance+pnl).toFixed(2); 
    state.equity=state.balance; 
    state.closedPnl=+(state.closedPnl+pnl).toFixed(4);
    if(pnl>=0) state.wins++; else state.losses++;

    state.openTrade=null;
    addAlert("Paper",`${closeReason}: ${t.symbol} closed. P/L ₦${pnl}. Recycling to next scan.`);
  } catch(e) { 
    addAlert("Monitor",`Could not update ${t.symbol}: ${e.message}`); 
  }
}

async function autoCycle() {
  if(!state.botRunning || state.emergencyStop) return;
  await monitorTrade();
  if(state.openTrade) return;
  await runScan(false);
  let best = state.scanner.find(m => m.signal === "BUY" && m.safety >= state.risk.minSafetyScore);
  if (!best) best = state.scanner.find(m => m.signal === "WATCH" || m.signal === "BUY");
  if (!best) best = state.scanner[0];

  if (best) {
    // PAPER MODE ONLY: open the best available setup so the user can test lifecycle.
    // Real-money trading remains locked.
    openPaper(best);
  } else {
    addAlert("Paper", "No market data available, so no paper trade could be opened.");
  }
}

setInterval(()=>autoCycle().catch(e=>addAlert("Error",e.message)), 20000);

app.get("/",(req,res)=>res.json({ok:true,service:"AI Trade Bot Backend",phase:9}));
app.get("/api/health",(req,res)=>res.json({ok:true,mode:"continuous-paper-only",phase:9,cacheAgeMs:Date.now()-cacheAt}));
app.get("/api/state",(req,res)=>res.json(publicState()));
app.post("/api/scan",async(req,res)=>{ await runScan(true); res.json(publicState()); });
app.get("/api/market/scan",async(req,res)=>{ await runScan(false); res.json({ok:true,best:state.scanner[0]||null,markets:state.scanner}); });

app.post("/api/deposit",(req,res)=>{ const amount=Number(req.body.amount||0); if(amount<1000) return res.status(400).json({ok:false,error:"Minimum demo deposit is ₦1,000"}); const d={id:`D${Date.now()}`,amount,status:"approved",time:new Date().toLocaleString()}; state.demoDeposits.unshift(d); state.balance+=amount; state.equity=state.balance; addAlert("Deposit",`Demo deposit added: ₦${amount}`); res.json(publicState()); });
app.post("/api/withdraw",(req,res)=>{ const amount=Number(req.body.amount||0); const w={id:`W${Date.now()}`,amount,status:"pending",time:new Date().toLocaleString()}; state.withdrawals.unshift(w); addAlert("Withdraw",`Demo withdrawal requested: ₦${amount}`); res.json(publicState()); });
app.post("/api/emergency",(req,res)=>{ state.emergencyStop=Boolean(req.body.enabled); state.botRunning=false; state.botStatus=state.emergencyStop?"Emergency Stop":"Online"; addAlert("Safety",state.emergencyStop?"Emergency stop enabled":"Emergency stop disabled"); res.json(publicState()); });
app.post("/api/bot/start",(req,res)=>{ state.emergencyStop=false; state.botRunning=true; state.botStatus="Auto Running"; addAlert("Bot","Continuous paper trader started"); res.json(publicState()); });
app.post("/api/bot/stop",(req,res)=>{ state.botRunning=false; state.botStatus="Stopped"; addAlert("Bot","Continuous paper trader stopped"); res.json(publicState()); });

app.post("/api/paper-cycle",async(req,res)=>{
  if(state.emergencyStop) return res.status(423).json({ok:false,error:"Emergency stop is active",state});
  state.botRunning = true;
  state.botStatus = "Auto Running";
  await runScan(true);
  await autoCycle();
  res.json(publicState());
});
app.post("/api/paper/run",async(req,res)=>{ await runScan(true); await autoCycle(); res.json(publicState()); });

app.post("/api/paper/force-open", async (req,res) => {
  if(state.emergencyStop) return res.status(423).json({ok:false,error:"Emergency stop is active",state});
  await runScan(true);
  const best = state.scanner[0];
  if (best) openPaper(best);
  else addAlert("Paper", "No market data available for force paper trade.");
  res.json(publicState());
});

app.get("/api/paper/status",(req,res)=>res.json({ok:true,paper:{balance:state.balance,trades:state.trades,openTrade:state.openTrade,wins:state.wins,losses:state.losses,closedPnl:state.closedPnl}}));

app.listen(PORT,()=>console.log(`Backend running on http://localhost:${PORT}`));
