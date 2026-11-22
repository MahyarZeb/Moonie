# Moonie 🌙

A cozy watch party and hangout site. Create a room, share the link, then watch YouTube, share your screen, play a local video file, play games and chat together. There are no accounts and no database. Rooms live in memory and disappear when everyone leaves.

## Architecture

- **Web app** (repo root): Next.js App Router, TypeScript, Tailwind CSS, Motion, Lucide. Deploys to Vercel.
- **Signaling server** (`signaling-server/`): a small Node `ws` server that holds ephemeral room state and relays WebRTC signaling. Vercel serverless functions cannot keep WebSocket connections open, so this runs on a separate host.
- **Shared code** (`shared/`): protocol types, validation and pure game reducers used by both sides.
- Screen sharing and local-file transfer use WebRTC directly between browsers. The server only exchanges connection information.
- The client talks to the server through the `SignalingTransport` interface (`src/lib/signaling`).

## Quick start

Requires Node 20 or newer.

```powershell
npm run setup      # installs root and signaling-server dependencies
npm run dev:all    # web on http://localhost:3000, signaling on ws://localhost:8787
```

`.env.development` points the web app at the local signaling server. Open the site in two browser windows to try a room.

Other scripts: `npm run build`, `npm start`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:server`. In `signaling-server/`: `npm run build`, `npm start`, `npm test`, `npm run smoke`.

## Environment variables

Web app (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SIGNALING_URL` | Required. `wss://` URL of the signaling server. Also used to build the CSP `connect-src`. |
| `NEXT_PUBLIC_STUN_URLS` | Comma-separated STUN URLs. |
| `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USERNAME`, `NEXT_PUBLIC_TURN_CREDENTIAL` | Optional TURN relay. |
| `NEXT_PUBLIC_SITE_URL` | Optional base URL for invite links. Defaults to the current origin. |

Signaling server (see `signaling-server/.env.example`): `PORT`, `ALLOWED_ORIGINS`, `ALLOW_NO_ORIGIN`, `TRUST_PROXY_HOPS`, `MAX_ROOMS`, `ROOM_MAX_PARTICIPANTS`, `MAX_CONNECTIONS_PER_IP`, `LOG_LEVEL` and timers (`RECONNECT_GRACE_MS`, `HOST_GRACE_MS`, `EMPTY_ROOM_TTL_MS`, `MAX_ROOM_AGE_MS`, `SWEEP_INTERVAL_MS`, `TURN_SKIP_MS`, `IDLE_MS`, `UNJOINED_MAX_MS`).

`NEXT_PUBLIC_*` values are inlined at build time, so redeploy the web app after changing them.

## Deploy

Deploy the signaling server first, because the web app needs its URL.

### 1. Signaling server

The server needs a host that supports long-lived WebSockets. Common settings for all hosts:

- Root directory: `signaling-server` (the build also reads `../shared`, so the host must clone the whole repository)
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/health`
- Environment: `ALLOWED_ORIGINS=https://<your-vercel-domain>` (exact origins, comma-separated) and `TRUST_PROXY_HOPS=1`. The host provides `PORT`.

**Render**: New, Web Service, connect the repo, set the settings above, choose a plan that does not sleep (free instances sleep and drop rooms), add the environment variables, deploy. Use `wss://<service>.onrender.com`.

**Railway**: New Project, Deploy from GitHub repo, set the service root directory to `signaling-server`, set the build and start commands, add the variables, then Settings, Networking, Generate Domain. Use `wss://<domain>`.

**Fly.io** (unverified, not tested in this repo): run `fly launch` inside `signaling-server/`, then use a Dockerfile and `fly.toml` along these lines.

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

```toml
app = "moonie-signaling"
[http_service]
  internal_port = 8787
  force_https = true
  auto_stop_machines = "off"
  min_machines_running = 1
[env]
  PORT = "8787"
  TRUST_PROXY_HOPS = "1"
```

Set `ALLOWED_ORIGINS` with `fly secrets set`. The Dockerfile build must also include `../shared`, so build it from the repository root with the Dockerfile path adjusted. Run a single instance: room state is in memory and is not shared between instances.

### 2. Web app on Vercel

1. Import the repository in Vercel. The framework is detected as Next.js and the root directory is the repo root.
2. Add `NEXT_PUBLIC_SIGNALING_URL=wss://<signaling-host>` and any optional variables above.
3. Deploy, then put the final Vercel domain into the server's `ALLOWED_ORIGINS` and redeploy the server if needed.

### TURN

STUN alone fails on some networks (strict NAT, corporate firewalls). For reliable screen sharing across any network, add a TURN server (for example coturn, or a hosted provider) and set the three `NEXT_PUBLIC_TURN_*` variables.

## Limitations

- Rooms are ephemeral. A server restart or an empty room removes the room, queue, chat and game state.
- Screen sharing uses a mesh: the sharer sends one stream per viewer. Expect it to work well for about 4 to 6 viewers.
- Local files are never uploaded to a server. The host's file can be sent peer to peer, or each participant can pick the same file locally. A blob URL from one device does not work on another, so the room explains when viewers need to select the file.
- Password rooms still reveal the participant count, room name and host name through `room:peek`, which the join form uses before asking for the password. Do not put secrets in a room name.
- `getDisplayMedia` needs HTTPS (or localhost) and a desktop browser. Mobile browsers generally cannot share a screen.
- YouTube videos whose owners disable embedding cannot be played.

## Handing over the host role

The host controls playback. The host can pass the role to another participant from the participant list. If the host disconnects, the server waits `HOST_GRACE_MS` for them to return and then promotes the next participant.

## Swapping the transport

All room traffic goes through the `SignalingTransport` interface in `src/lib/signaling/types.ts`. To use another real-time service, implement that interface and return it from `getTransport()` in `src/lib/signaling/index.ts`. The server-side room logic in `signaling-server/src` is the reference for what a replacement must do (authoritative room state, request and reply with `ref`, WebRTC signal relay).

## Adding auth or a database later

Identity is created in the browser (`src/lib/identity`) and rooms are held in memory by the signaling server (`signaling-server/src/registry.ts` and `room.ts`). To add accounts, verify a token during the WebSocket handshake and replace the generated identity. To persist rooms, put a store behind the registry and keep the in-memory map as a cache. Nothing else in the UI depends on where state lives.

## Security headers

`security-headers.ts` sets a Content-Security-Policy (YouTube frames only from youtube.com and youtube-nocookie.com, production `connect-src` limited to your `wss://` signaling host), `Permissions-Policy: display-capture=(self)`, `X-Content-Type-Options` and `Referrer-Policy`. Development additionally allows `ws:` and `http:`.

## Pinned dependency versions

Web app: next 16.4.6, react 19.3.1, react-dom 19.3.1, motion 14.14.0, lucide-react 1.77.0, tailwindcss 3.4.19, typescript 5.9.3, vitest 3.2.7, eslint 9.39.5, concurrently 10.0.7, postcss 8.5.33, autoprefixer 10.7.0.

Signaling server: ws 8.23.0, esbuild 0.28.2, tsx 4.23.15, typescript 5.9.3, vitest 3.2.7.

Exact versions are in `package.json` and the committed `package-lock.json` files.
