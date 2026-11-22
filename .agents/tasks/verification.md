# Moonie verification report (P8)

## Commands run

| Command | Result |
| --- | --- |
| `npm run setup` (root + signaling-server) | pass |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm test` (root) | pass, 18 files, 252 tests |
| `npm --prefix signaling-server run typecheck` | pass |
| `npm --prefix signaling-server test` | pass, 7 files, 103 tests |
| `npm run build` (Next 16.4.6) | pass; routes `/`, `/_not-found` static, `/room/[code]` dynamic |
| `npm --prefix signaling-server run build` | pass; `dist/server.js` 88.4 kB |
| `npm --prefix signaling-server run smoke` against `node signaling-server/dist/server.js` (`ALLOWED_ORIGINS`, `HOST_GRACE_MS=500`, `SWEEP_INTERVAL_MS=100`, `IDLE_MS=1000`) with `npm start` running | pass, 80/80 checks, exit 0 |

## Smoke coverage

Create and peek, create while joined, join with and without password, wrong password rejected, late-joiner snapshot (media, position, queue, chat history), host-only playback enforcement, host transfer and kick, YouTube queue, chat broadcast and history, host migration while playing (paused `playback:state` before `host:changed`), targeted `rtc:signal` (third client and viewer-to-viewer dropped), old host receives `media:state` with media null after `host:transfer`, local-file flow, game move validation including garbage payloads, hidden RPS picks, Ludo turn order, disallowed Origin (403), oversize frame (1009), invalid JSON, idle close (1008).

## Browser check

Playwright (`playwright-core`, installed in a temp directory outside the repo, using the local Chrome) loaded the landing page and `/room/ABCDEF` in light and dark mode against the production build. Result: zero console errors, zero HTTP errors, `dark` class applied in dark mode. Screenshots are in `.agents/tasks/screenshots/` (`landing-*.png`, `room-*.png`). The room screenshots show the state for a code with no live room, not a populated watch party.

## Defects found and fixed

- `/favicon.ico` returned 404 and logged a console error on first load. Added `src/app/icon.svg`.
- Environment note: this machine has `PORT=3111` set globally. Both servers inherited it and collided. Verification used explicit `PORT=8787` (signaling) and `PORT=3000` (Next). Not a code defect.

## Process cleanup

Signaling server and Next were started as background processes with recorded PIDs, then stopped. Afterwards no `node` processes remained and ports 3000 and 8787 were free.

## How to run

1. `npm run setup`
2. Terminal 1: `npm --prefix signaling-server run build; npm --prefix signaling-server start` (set `PORT`, `ALLOWED_ORIGINS`)
3. Terminal 2: `npm run build; npm start` with `NEXT_PUBLIC_SIGNALING_URL` pointing at the signaling server.

See `README.md` and `.env.example` for deployment (Vercel for Next, a separate Node host for signaling).

## Not verified

- Screen sharing across different networks, and TURN relay behavior.
- YouTube IFrame playback and sync in a real browser (needs network and a real video).
- `captureStream` for local files in each browser.
- `.mov` playback (depends on codec and browser).
- Real mobile device layouts (only desktop viewport screenshots were taken).
- Multi-browser interactive flows (two real browsers in one room); only the ws-level smoke covers these.
- Vercel deployment itself.
