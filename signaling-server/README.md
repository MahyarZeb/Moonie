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

## Roles, queue and moderation messages
Client messages: `role:set {to, role: 'co_host' | 'member'}`, `host:transfer`, `host:kick`, `room:settings {requireApproval?, autoNext?, coHostsCanKick?, name?, theme?, password?}`, `queue:add`, `queue:approve {itemId, position?}`, `queue:skip`, `queue:remove` (also rejects or withdraws a suggestion), `queue:reorder`, `queue:play`, `chat:delete {messageId}`, `chat:mute {id, muted}`, `reaction:send {emoji}` (six allowed emoji).

Server messages: `participant:updated` carries `role` and `muted`, `room:settings` carries the three rules, `suggestions:updated`, `queue:notice {kind: 'added' | 'suggested', by, title?}` (an event, not state: `suggested` goes to hosts and co-hosts only, `added` to everyone but the adder), `chat:deleted {id}`, `reaction {from, emoji}`. `playback:state.playback.by` is the id of the participant whose command produced it, so a controller can ignore its own echo. Role fields in client messages are ignored; the server sets them.

Rate limits (per connection): `queue:add` burst 5, refill 1 per 3 s; `reaction:send` burst 5, refill 2 per second. Title lookups use YouTube oEmbed and need outbound HTTPS to `www.youtube.com`; at most 3 run at once.