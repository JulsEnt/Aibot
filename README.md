# Phase 10 Hard Close Fix

Upload this backend-only ZIP to Render and redeploy.

Fixes:
- `/api/state` now checks and closes trades automatically when the dashboard refreshes.
- Trades close after 5 minutes even if latest price fetch fails.
- Open trade now includes age and remaining seconds.
- Added manual test endpoint `/api/paper/close-now`.
- Balance, Win/Loss, Closed P/L update after close.

Render settings:
- Build command: npm install
- Start command: npm start
- Root directory: leave empty
