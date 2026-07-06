# AI Trade Bot Phase 9 Continuous Paper Trader

Upload this backend-only ZIP to Render.

Settings:
- Build command: npm install
- Start command: npm start
- Root directory: leave empty

Environment:
- PORT=10000
- NODE_ENV=production
- FRONTEND_URL=*

Adds continuous paper trading, monitoring, take-profit, stop-loss, balance updates, win/loss stats, and automatic rescanning.
Real-money trading remains locked.


PATCH:
- Paper-test threshold lowered so the bot opens demo trades more often.
- It can open WATCH setups for paper testing only.
- Real-money trading remains locked.
- If a trade is already open, it will not open another one until the current trade closes.
