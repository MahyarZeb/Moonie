# Moonie signaling server

An in-memory Node `ws` server. It owns room state (participants, host, playback, queue, chat, games) and relays WebRTC signaling. Nothing is persisted.

## Run

```powershell
npm install
npm run dev     # local, ws://localhost:8787, allows http://localhost:3000
npm run build   # bundles to dist/server.js
npm start       # runs dist/server.js
npm test
npm run smoke   # end-to-end check against a running server
```

Configuration is documented in `.env.example`. `ALLOWED_ORIGINS` is required and must list exact browser origins. Set `TRUST_PROXY_HOPS=1` behind Render, Railway or Fly so per-IP limits use the real client address. `GET /health` returns 200 for health checks.

Run a single instance, since rooms are not shared between processes. See the root `README.md` for host-specific deployment steps.
