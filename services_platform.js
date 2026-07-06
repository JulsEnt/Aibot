const coins = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','TRXUSDT','LINKUSDT','AVAXUSDT','SUIUSDT','DOTUSDT','LTCUSDT','BCHUSDT','AAVEUSDT','UNIUSDT','NEARUSDT','ATOMUSDT','PEPEUSDT','OPUSDT','ARBUSDT','APTUSDT','MATICUSDT','FILUSDT','INJUSDT','SEIUSDT','FTMUSDT','ETCUSDT','XLMUSDT','RNDRUSDT'];

const traders = [
  { id:'T-001', name:'Atlas Quant', style:'Low-risk trend', winRate:72, drawdown:4.1, consistency:92, months:14, risk:18, copied:false, paused:false },
  { id:'T-002', name:'Nova Scalper', style:'Micro scalp', winRate:68, drawdown:5.6, consistency:88, months:11, risk:25, copied:true, paused:false },
  { id:'T-003', name:'Orion Swing', style:'Swing trades', winRate:64, drawdown:7.2, consistency:84, months:19, risk:31, copied:true, paused:false },
  { id:'T-004', name:'Falcon AI', style:'Momentum', winRate:70, drawdown:8.9, consistency:79, months:8, risk:38, copied:false, paused:false },
  { id:'T-005', name:'Zen Hedge', style:'Capital protection', winRate:61, drawdown:2.9, consistency:95, months:24, risk:12, copied:true, paused:false },
  { id:'T-006', name:'Blaze Futures', style:'Aggressive futures', winRate:77, drawdown:28.4, consistency:48, months:6, risk:82, copied:false, paused:true }
];

const state = {
  balance: 1000,
  equity: 1000,
  demoDeposits: [],
  withdrawals: [],
  emergencyStop: false,
  botStatus: 'Ready',
  risk: { perTrade: 1, dailyLossLimit: 3, maxOpenTrades: 3, minSafetyScore: 90, maxTraderDrawdown: 10 },
  alerts: [{ id:'A-001', type:'system', text:'Phase 6 platform loaded: backend Binance live market data + paper trading.', time:new Date().toLocaleString() }],
  scanner: [],
  trades: [],
  traders: rankTraders(traders),
  admin: { users: 1, pendingDeposits: 0, pendingWithdrawals: 0, realMoneyLocked: true, mode: 'Paper Trading' },
  dataMode: 'Waiting for backend market scan',
  lastUpdated: null,
  marketError: null
};

function id(prefix){ return `${prefix}-${Math.random().toString(36).slice(2,8).toUpperCase()}`; }
function pct(n){ return Math.round(n * 100) / 100; }
function rankTraders(list){
  return list.map(t => ({...t, score: Math.round((t.winRate*0.28)+(t.consistency*0.38)+(Math.min(t.months,24)*1.1)-(t.drawdown*2.2)-(t.risk*0.2))}))
    .sort((a,b)=>b.score-a.score);
}
function addAlert(type,text){ state.alerts.unshift({ id:id('A'), type, text, time:new Date().toLocaleString() }); state.alerts = state.alerts.slice(0,15); }
export function getState(){
  state.admin.pendingDeposits = state.demoDeposits.filter(d=>d.status==='pending').length;
  state.admin.pendingWithdrawals = state.withdrawals.filter(w=>w.status==='pending').length;
  return state;
}
export function deposit(amount){
  if(!Number.isFinite(amount) || amount < 1000) return { ok:false, error:'Minimum demo deposit is ₦1,000' };
  const d = { id:id('D'), amount, status:'pending', time:new Date().toLocaleString() };
  state.demoDeposits.unshift(d); addAlert('wallet', `Demo deposit request created: ₦${amount.toLocaleString()}`);
  return { ok:true, deposit:d, state:getState() };
}
export function approveDeposit(depositId){
  const d = state.demoDeposits.find(x=>x.id===depositId); if(!d) return {ok:false,error:'Deposit not found'};
  if(d.status !== 'approved'){ d.status='approved'; state.balance += d.amount; state.equity = state.balance; addAlert('admin', `Deposit approved: ₦${d.amount.toLocaleString()}`); }
  return {ok:true,state:getState()};
}
export function withdraw(amount){
  if(!Number.isFinite(amount) || amount <= 0) return { ok:false, error:'Enter a valid amount' };
  if(amount > state.balance) return { ok:false, error:'Insufficient demo balance' };
  const w = { id:id('W'), amount, status:'pending', time:new Date().toLocaleString() };
  state.withdrawals.unshift(w); addAlert('wallet', `Withdrawal request created: ₦${amount.toLocaleString()}`);
  return { ok:true, withdrawal:w, state:getState() };
}
export function approveWithdraw(withdrawId){
  const w = state.withdrawals.find(x=>x.id===withdrawId); if(!w) return {ok:false,error:'Withdrawal not found'};
  if(w.status !== 'approved'){ w.status='approved'; state.balance -= w.amount; state.equity = state.balance; addAlert('admin', `Withdrawal approved: ₦${w.amount.toLocaleString()}`); }
  return {ok:true,state:getState()};
}
export function toggleEmergency(enabled){
  state.emergencyStop = enabled; state.botStatus = enabled ? 'Emergency stopped' : 'Ready';
  addAlert('risk', enabled ? 'Emergency stop enabled. Bot will not trade.' : 'Emergency stop disabled. Bot is ready.');
  return { ok:true, state:getState() };
}
export function syncScanner(scanner, dataMode='Live Binance data', error=null){
  state.scanner = Array.isArray(scanner) ? scanner : [];
  state.dataMode = dataMode;
  state.marketError = error;
  state.lastUpdated = new Date().toLocaleString();
  if(error){
    addAlert('scanner', `Market data unavailable: ${error}`);
    state.botStatus = 'Market data unavailable';
    return { ok:false, error, scanner: state.scanner, state:getState() };
  }
  state.botStatus = state.emergencyStop ? 'Emergency stopped' : 'Ready';
  addAlert('scanner', `Live Binance scan completed. Best: ${state.scanner[0]?.symbol || 'None'} at ${state.scanner[0]?.safety || 0}/100.`);
  return { ok:true, scanner: state.scanner, state:getState() };
}

export function runScan(){
  const rows = coins.map(symbol => {
    const trend = 55 + Math.random()*45;
    const liquidity = 60 + Math.random()*40;
    const volatilityPenalty = Math.random()*18;
    const spreadPenalty = Math.random()*8;
    const safety = Math.round((trend*0.35)+(liquidity*0.35)+(Math.random()*25) - volatilityPenalty - spreadPenalty);
    const signal = safety >= state.risk.minSafetyScore ? 'BUY' : safety >= 78 ? 'WATCH' : 'SKIP';
    return { symbol, signal, safety: Math.max(35, Math.min(99, safety)), expectedMove: pct(0.08 + Math.random()*0.32), liquidity: Math.round(liquidity), reason: signal==='BUY'?'Strong trend + acceptable volatility':'Not safe enough yet' };
  }).sort((a,b)=>b.safety-a.safety).slice(0,12);
  state.scanner = rows; addAlert('scanner', `Market scan completed. Best: ${rows[0].symbol} at ${rows[0].safety}/100.`);
  return { ok:true, scanner: rows, state:getState() };
}
export function runPaperCycle(){
  if(state.emergencyStop) return { ok:false, error:'Emergency stop is enabled', state:getState() };
  const scan = state.scanner.length ? state.scanner : [];
  const bestCoin = scan.find(x=>x.safety >= state.risk.minSafetyScore);
  const eligible = state.traders.filter(t=>t.copied && !t.paused && t.drawdown <= state.risk.maxTraderDrawdown && t.score >= 70);
  if(!state.scanner.length){ addAlert('bot','No live scanner data yet. Run Live AI Scan first.'); return { ok:false, error:'No live scanner data. Run Live AI Scan first.', state:getState() }; }
  if(!bestCoin || !eligible.length){ addAlert('bot','No safe paper trade available. Bot skipped this cycle.'); return { ok:true, skipped:true, state:getState() }; }
  const trader = eligible[0];
  const riskAmount = pct(state.balance * state.risk.perTrade/100);
  const targetProfit = pct(state.balance * 0.001); // 0.1% micro target
  const winChance = Math.min(0.82, 0.45 + (bestCoin.safety/200) + (trader.score/500));
  const won = Math.random() < winChance;
  const pnl = won ? targetProfit : -riskAmount;
  state.balance = pct(state.balance + pnl); state.equity = state.balance;
  const trade = { id:id('TR'), time:new Date().toLocaleString(), symbol:bestCoin.symbol, side:'BUY', trader:trader.name, safety:bestCoin.safety, entry:'paper', exit:'paper', pnl, result:won?'WIN':'LOSS', reason:`Copied ${trader.name}; ${bestCoin.reason}; risk capped at ${state.risk.perTrade}%` };
  state.trades.unshift(trade); state.trades = state.trades.slice(0,50);
  if(!won && trader.drawdown > 9){ trader.paused = true; addAlert('risk', `${trader.name} auto-paused due to drawdown risk.`); }
  addAlert(won?'profit':'loss', `${trade.result}: ${bestCoin.symbol} ${pnl>=0?'+':''}₦${Math.abs(pnl).toFixed(2)}`);
  return { ok:true, trade, state:getState() };
}
