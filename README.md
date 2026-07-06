
# AI Trade Bot Phase 7 Backend

Render backend update with:
- Binance → Bybit → OKX live market-data fallback
- Top-market scanner
- RSI, EMA, MACD, ATR, liquidity and safety scoring
- Paper-trade endpoint that only opens a demo trade when safety rules pass
- Emergency stop
- Demo deposit/withdraw routes

Render:
- Build command: npm install
- Start command: npm start
- Root directory: leave empty if uploading this backend-only ZIP

Environment variables:
- BINANCE_API_KEY optional for now
- BINANCE_API_SECRET optional for now
- PORT=10000
- NODE_ENV=production
- FRONTEND_URL=https://your-netlify-site.netlify.app
