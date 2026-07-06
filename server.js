import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { getState, deposit, withdraw, runPaperCycle, toggleEmergency, approveDeposit, approveWithdraw, syncScanner } from './services_platform.js';
import { get24hTickers, getCandles, scanMarket, analyzeSymbol } from './binance_market.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'paper-only', phase: 6, marketData: 'multi-provider-rest', providers: ['Binance','Bybit','OKX'] }));
app.get('/api/state', (req, res) => res.json(getState()));
app.post('/api/deposit', (req, res) => res.json(deposit(Number(req.body.amount || 0))));
app.post('/api/withdraw', (req, res) => res.json(withdraw(Number(req.body.amount || 0))));
app.post('/api/admin/deposit/:id/approve', (req, res) => res.json(approveDeposit(req.params.id)));
app.post('/api/admin/withdraw/:id/approve', (req, res) => res.json(approveWithdraw(req.params.id)));
app.post('/api/emergency', (req, res) => res.json(toggleEmergency(Boolean(req.body.enabled))));

app.get('/api/market/tickers', async (req, res) => {
  try { res.json({ ok: true, data: await get24hTickers(), source: 'Live market data: Binance with Bybit/OKX fallback' }); }
  catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

app.get('/api/market/candles/:symbol', async (req, res) => {
  try { res.json({ ok: true, data: await getCandles(req.params.symbol, req.query.interval || '15m', Number(req.query.limit || 120)), source: 'Live candles: Binance with Bybit/OKX fallback' }); }
  catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

app.get('/api/market/analyze/:symbol', async (req, res) => {
  try { res.json({ ok: true, data: await analyzeSymbol(req.params.symbol), source: 'Live candles: Binance with Bybit/OKX fallback' }); }
  catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

app.post('/api/scan', async (req, res) => {
  try {
    const minScore = Number(req.body?.minSafetyScore || getState().risk.minSafetyScore || 90);
    const scanner = await scanMarket(minScore);
    res.json(syncScanner(scanner, 'Live market data'));
  } catch (err) {
    res.status(502).json(syncScanner([], 'Market data unavailable', err.message));
  }
});

app.post('/api/paper-cycle', (req, res) => res.json(runPaperCycle()));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
