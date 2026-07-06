# Render Backend-Only Deployment

Upload this backend-only project to Render as a Node Web Service.

## Render settings

Environment: Node
Build Command: npm install
Start Command: npm start

You do NOT need to set Root Directory because this ZIP already contains only the backend files.

## Environment variables

Add these in Render > Environment:

BINANCE_API_KEY=your_new_api_key
BINANCE_API_SECRET=your_new_secret_key
PORT=10000

## After deployment

Copy your Render service URL, then add it to Netlify:

VITE_API_URL=https://your-render-url.onrender.com

Then redeploy Netlify.
