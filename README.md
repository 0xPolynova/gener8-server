# Gener8 API

Standalone Node server for wallet auth, token gating, generation, and Supabase. Deploy this folder as its own GitHub repo on Render.

## Local

```bash
cp .env.example .env
# fill SESSION_SECRET, SUPABASE_PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

Runs on `http://localhost:4000`. Health check: `GET /health`.

Point the Next.js app at it with `NEXT_PUBLIC_API_URL=http://localhost:4000`.

## Render

Create a **Web Service** from this repo (root directory = repo root).

| Setting | Value |
|---|---|
| Language / runtime | **Node** |
| Instance | Starter (or Free) |
| **Build command** | `npm install && npm run build` |
| **Start command** | `npm start` |
| Health check path | `/health` |

Render sets `PORT` automatically. Do not override it.

### Environment variables

| Key | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `APP_URL` | yes | Frontend origin, e.g. `https://gener8.vercel.app` |
| `CORS_ORIGINS` | yes | Comma-separated frontend origins. Include `APP_URL` |
| `SESSION_SECRET` | yes | Long random string. Render can generate this |
| `SUPABASE_PROJECT_URL` | yes | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role only — never put this on the frontend |
| `SOLANA_RPC_URL` | yes | Mainnet RPC |
| `GENER8_TOKEN_MINT` | when live | Leave empty while `DEMO_MODE=true` |
| `GENER8_TOKEN_DECIMALS` | no | Default `9` |
| `GENER8_MIN_BALANCE` | no | Default `10000` |
| `GENER8_DAILY_GENERATIONS` | no | Default `5` |
| `VIDEO_PROVIDER` | no | `mock` until a live vendor is wired |
| `VIDEO_PROVIDER_API_KEY` | when live | |
| `VIDEO_PROVIDER_BASE_URL` | when live | |
| `DEMO_MODE` | no | `true` until the mint is set |
| `DEMO_TOKEN_BALANCE` | no | Default `25000` |

After deploy, set `NEXT_PUBLIC_API_URL` on the frontend to the Render URL, e.g. `https://gener8server.onrender.com` (no trailing slash).

## Schema

If the Supabase project has no tables yet, run `supabase/schema.sql` once in the SQL editor. The server seeds catalog data on first successful connect.
