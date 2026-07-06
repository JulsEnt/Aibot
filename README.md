# AI Trade Bot Phase 10: 5-Minute Paper Recycling

Upload this backend-only ZIP to Render.

Settings:
- Build command: npm install
- Start command: npm start
- Root directory: leave empty

What changed:
- Open paper trade now tracks unrealized P/L.
- Trade closes automatically at Take Profit, Stop Loss, OR after 5 minutes.
- Balance updates after every closed trade.
- Win/Loss and Closed P/L update.
- After close, the bot scans again and can open the next paper trade.
- Real-money trading remains locked.
