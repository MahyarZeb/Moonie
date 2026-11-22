# Implementation Plan: Moonie (design.md revision 4)

Work directly on the current branch in `d:/University/Semester7/SideProject/watchparty` (no worktree). PowerShell: use `;`, not `&&`. Sections 4, 6 and 9 of `design.md` are the contract; do not copy section 22 into code comments. Never run servers in the foreground: use `Start-Process`/background mode and stop them at the end of the phase.

Decisions recorded (design is approved, so none re-decided):
- Layout: Next app at repo root, `shared/` pure TS, `signaling-server/` with its own package.json (esbuild CJS bundle, `ws` external). Server tooling (esbuild, typescript, tsx, vitest) sits in `dependencies` so Render/Railway `npm ci` works.
- Scaffolding is hand-written (repo is not empty, so no `create-next-app`). Tailwind pinned to 3.4.x.
- Fonts: try `next/font/google` in P1 and run `npm run build`. If the build fails offline, commit woff2 under `src/app/fonts/` and switch to `next/font/local` (same CSS variable names). Decide in P1 and commit the result (review note 1).
- Per-phase exit gate (every phase): `npm run typecheck; npm run lint; npm test; npm run build` at root, then `npm --prefix signaling-server run typecheck; npm --prefix signaling-server test; npm --prefix signaling-server run build`, then (P1+) start the server in the background, run `npm --prefix signaling-server run smoke` (extended each phase), stop the server, and commit with a Conventional Commit message. Never push.

## Open review notes mapped to tasks
1. (MEDIUM) Offline font build decided and committed in P1 (task P1-2).
2. (MEDIUM) Smoke assertion: old host socket receives `media:state` with no `sessionId` after `host:transfer` while sharing (task P3-6, and re-run in P8).
3. (MEDIUM) README states that `room:peek` on a password room still returns count, room name and host name (task P7-6).
4. (NIT) Treat sections 4, 6, 9 as the contract; keep section 22 out of code comments (all phases).
5. (NIT) Implement the `createOffer`/`createAnswer` fallback when `setLocalDescription()` with no args is unsupported, in `PeerLink.ts` from the start (task P3-2).
6. (NIT) Keep `THREE_SIXES_FORFEIT` the single switch in `shared/games/ludo.ts` and mention the house rule in the games UI help text (task P6-1, P6-4).
7. (NIT) Pin dependency versions from the registry at install time (`npm view`/`npm install --save-exact` or the resolved lockfile versions) and record them in the README (tasks P1-1, P7-6).

---

# Implementation Plan

## P1: Landing, aesthetic, create/join, room UI, ephemeral state, signaling server

- [ ] P1-1. Scaffold the root Next app by hand and the server package.
      Write `package.json` (scripts: dev, dev:all via concurrently, build, start, lint, typecheck, test, setup = `npm install && npm --prefix signaling-server install`), `tsconfig.json` (paths `@shared/*`, `@/*`; include `src`, `shared`; exclude `signaling-server`), `next.config.ts`, `tailwind.config.ts` (3.4.x), `postcss.config.mjs`, ESLint config, `vitest.config.ts` (aliases, exclude `signaling-server/**`), `.env.example`, `.env.development`. Append `.env*.local`, `signaling-server/dist`, `.vercel`, `*.tsbuildinfo` to `.gitignore` if missing. Create `signaling-server/{package.json,tsconfig.json,vitest.config.ts,.env.example}`. Install deps, read the resolved versions with `npm ls --depth=0`, and note them for the README.
      Files: package.json, tsconfig.json, next.config.ts, tailwind.config.ts, postcss.config.mjs, eslint.config.mjs, vitest.config.ts, .gitignore, .env.example, .env.development, signaling-server/*
      Verify: `npm install; npm --prefix signaling-server install; git check-ignore -v .env.example .env.development signaling-server/.env.example` prints nothing (not ignored); `npm run typecheck` passes on the empty app.

- [ ] P1-2. Theme, fonts and global styling. (depends on P1-1)
      `src/app/fonts.ts` (Nunito body, Quicksand display, with fallback stack), `globals.css` with RGB-triple tokens for light and midnight and the six room themes, `src/lib/theme/{themeScript,useTheme,roomThemes}.ts`, inline no-flash script in `layout.tsx`, reduced-motion CSS, `src/components/ui/*` (Button, Card, Modal, Tabs, Toast, Avatar, Badge, Tooltip, IconButton, Spinner, ThemeToggle), `src/lib/utils/{cn,clipboard,format}.ts`. Run `npm run build`. If it fails because Google Fonts is unreachable, commit woff2 files under `src/app/fonts/` and switch to `next/font/local` (review note 1).
      Files: src/app/{layout.tsx,fonts.ts,globals.css}, src/components/ui/*, src/lib/theme/*, src/lib/utils/*
      Verify: `npm run typecheck; npm run lint; npm run build` pass without network assumptions beyond what the chosen font path needs.

- [ ] P1-3. Shared module: constants, protocol, validate, roomCode. (depends on P1-1)
      Implement `shared/{constants,protocol,validate,roomCode}.ts` and `shared/games/types.ts` exactly as design section 4 (message unions, `linkId`, `parseClientMessage`, sanitizers, `parseGameAction(kind, raw)` stub rejecting everything until P6 fills the shapes, but with the final signature). Add unit tests `shared/*.test.ts` for roomCode (seeded rng, normalize, parseRoomInput) and every validation row.
      Files: shared/*.ts, shared/games/types.ts, shared/*.test.ts
      Verify: `npm test` passes.

- [ ] P1-4. Signaling server core. (depends on P1-3)
      Implement `signaling-server/src/{config,origin,log,rateLimit,password,registry,room,server,index,dev}.ts` and `handlers/` for create, peek, join (password via scrypt hash held in memory, room_full, resume token), leave, profile:update, room:settings, host:transfer, host:kick, sync:ping, idle-socket rule (30 s, peek counts), `/health`, fail-closed `ALLOWED_ORIGINS`, 64 KiB maxPayload, per-IP caps, `clientIp` with `TRUST_PROXY_HOPS`, host grace and sweep (`HOST_GRACE_MS`, `SWEEP_INTERVAL_MS`, `IDLE_MS` env-overridable), host migration (paused playback broadcast before `host:changed`, per section 6), room cleanup. esbuild bundle script `build` -> `dist/server.js` (CJS). Unit tests in `signaling-server/test/*.test.ts` for password, origin, clientIp, rateLimit, and room.ts rows from section 16 that apply to P1 (create/join/password/full/resume/migration with fake clock/kick/`invalid_state`/idle).
      Files: signaling-server/src/**, signaling-server/test/**
      Verify: `npm --prefix signaling-server run typecheck; npm --prefix signaling-server test; npm --prefix signaling-server run build`.

- [ ] P1-5. Smoke script v1. (depends on P1-4)
      `signaling-server/scripts/smoke.ts` (run via `tsx`, npm script `smoke`, reads `SMOKE_URL` and `SMOKE_ORIGIN`): create, peek, join with no/wrong/right password, late-joiner snapshot, `room:create` while joined -> `invalid_state`, host migration (server started with `HOST_GRACE_MS=500 SWEEP_INTERVAL_MS=100`), bad Origin 403, oversized frame 1009, idle rule with `IDLE_MS=1000`. Exits non-zero on failure.
      Files: signaling-server/scripts/smoke.ts, signaling-server/package.json
      Verify: start `node signaling-server/dist/server.js` in the background with the env above and `ALLOWED_ORIGINS`, run `npm --prefix signaling-server run smoke`, expect exit 0; stop the process.

- [ ] P1-6. Client signaling and room store. (depends on P1-3)
      `src/lib/signaling/{types,WebSocketTransport,config,index}.ts` (reconnect rules, no auto-reconnect on 1008/4000/4001, `reconnect()`, `request()` with ref and timeout, `send()` while closed dropped with `lastError`), `src/lib/identity/identity.ts`, `src/lib/room/{reducer,roomStore,RoomProvider,useRoom,selectors,clockSync}.ts`, `shared/clock.ts`. Tests: WebSocketTransport with a fake WebSocket, reducer, clock, identity/session handling.
      Files: src/lib/signaling/*, src/lib/room/*, src/lib/identity/*, shared/clock.ts and tests
      Verify: `npm test` passes; `npm run typecheck`.

- [ ] P1-7. Landing page and create/join flows. (depends on P1-2, P1-6)
      `src/components/landing/*` (Navbar, Hero with exact heading and subtitle, FloatingDecor, FeatureCards, HowItWorks, Footer, CreateRoomModal, JoinRoomModal accepting code or URL), `src/app/page.tsx`, `not-found.tsx`, `error.tsx`, `global-error.tsx`. Create navigates to `/room/CODE`.
      Files: src/app/page.tsx, src/components/landing/*
      Verify: `npm run typecheck; npm run lint; npm run build`.

- [ ] P1-8. Lobby and room shell. (depends on P1-7)
      `src/app/room/[code]/{page,loading}.tsx`, `src/components/room/*` (RoomShell with Strict Mode guard and resume-first logic, Lobby with peek polling every 5 s and error states, RoomHeader, InviteButton, SettingsDialog, ParticipantList with kick/transfer, Sidebar, MobileTabBar, ReconnectBanner with Reconnect button, RoomThemeBackdrop, ErrorState), `src/components/media/MediaStage` placeholder that shows real empty state with source selector wired later. No fake buttons: tabs that have no feature yet are not rendered until their phase.
      Files: src/app/room/**, src/components/room/*, src/components/media/MediaStage.tsx
      Verify: `npm run typecheck; npm run lint; npm test; npm run build`. RoomShell Strict Mode test passes (one join, one leave).

- [ ] P1-9. P1 exit gate and commit. Run the per-phase gate above; commit `feat: landing, rooms and signaling server`.

## P2: YouTube and sync

- [x] P2-1. `shared/playback.ts` (expectedPosition, applyCommand) plus tests; `src/lib/youtube/parse.ts` with the full test table from section 16 (watch, youtu.be, shorts, embed, live, m., music., nocookie, `t=`, bare ID, evil hosts, 10/12-char IDs, empty).
      Verify: `npm test`.
- [x] P2-2. Server handlers: `media:set`, `playback:command` (host only, `not_host`, stale rev), `media:ended`, `media:error`, queue add/remove/reorder/play with the reply contract (ref copy to requester, no-op replies), auto-advance, initial playback (`playing @ 0` youtube), duplicate `queue:add` -> `invalid_state`. Extend room tests per section 16 rows.
      Files: signaling-server/src/handlers/{media,playback,queue}.ts, tests
      Verify: `npm --prefix signaling-server test`.
- [x] P2-3. Client: `loadApi.ts` (loaded once), `useYouTubePlayer.ts`, `syncController.ts` (1.5 s drift, latency compensation via clock offset, FollowerOverlay for autoplay block), `YouTubePlayer`, `QueuePanel`, `SourceSelector` (YouTube tab enabled; other tabs only appear in their phase), error code 2/5/100/101/150 mapping with friendly skip, loading states, Queue tab in sidebar. Verify the `motion/react` import path and the IFrame API CSP needs ([UNVERIFIED] items).
      Verify: `npm run typecheck; npm run lint; npm test; npm run build`.
- [x] P2-4. Extend smoke: host playback accept, non-host `not_host`, late-joiner snapshot with media+position+queue, queue play/remove, host migration while playing broadcasts paused `playback:state` before `host:changed`. Run gate, commit `feat: youtube watch together and queue`.

## P3: Screen share via WebRTC

- [ ] P3-1. Server: `share:start|stop` (source screen), `rtc:signal` relay (targeted only, sharer<->viewer only, same room, `sessionId` and `linkId` validation, 20 KiB ok / 40 KiB dropped with warn), `endShare` on all 5 triggers, `shareSession` state, `media:state` broadcast. Tests per section 16 (endShare triggers, `share:start screen` from youtube leaves queue untouched, signal rules).
      Verify: `npm --prefix signaling-server test`.
- [ ] P3-2. Client WebRTC: `iceConfig.ts` (env STUN/TURN), `support.ts`, `capture.ts` (getDisplayMedia, NotAllowedError mapping, track `ended`), `PeerLink.ts` (perfect negotiation, sharer impolite/viewers polite, candidate buffering until remote description, ICE restart, candidate size cap 2048, **`createOffer`/`createAnswer` fallback when `setLocalDescription()` without args is unsupported**, review note 5), `ShareBroadcaster.ts`, `ShareViewer.ts` with `linkId` rules from section 9 (fresh `linkId` per `viewer-ready`, stale signals dropped). Tests with fake `RTCPeerConnection`: retry link identity, stale `linkId` ignored, repeated `viewer-ready` ignored, store-driven teardown, `ended` sends `share:stop`, `share:start` rejection stops tracks.
      Verify: `npm test`.
- [ ] P3-3. UI: `ScreenSharePanel`, `ScreenView`, `LiveBadge`, who-is-sharing, unsupported-browser and permission-denied states, retry, cleanup on leave; enable the Screen tab in `SourceSelector`; participants' connection state on People tab.
      Verify: `npm run typecheck; npm run lint; npm run build`.
- [ ] P3-4. Extend smoke: three clients, `rtc:signal` reaches only its target (third client receives nothing), viewer-to-viewer dropped, share teardown on `host:transfer` and on sharer socket close. **Review note 2:** assert the old host's socket receives `media:state` with `media:null` (no `sessionId`) after `host:transfer`. Run gate, commit `feat: screen sharing over webrtc`.

## P4: Local video and sharing flow

- [x] P4-1. `src/lib/localfile/{support,hash,verify,captureStream}.ts` with tests for `verifyLocalFile` (hash equal/different, name+size fallback, case difference), `canPlayType` validation.
      Verify: `npm test`.
- [x] P4-2. Server: `media:set` local same-file (initial `paused @ 0`), `local:ready` (current rev only, `hasFile` reset only on file identity change), `share:start file` with meta validation, stream->same-file fallback using stored playback, `playback:command` during stream stored. Tests per section 16 revision 3/4 rows.
      Verify: `npm --prefix signaling-server test`.
- [x] P4-3. UI: `FileDropzone`, `LocalFilePanel` (explains both flows plainly, caveats for Safari), `LocalPlayer`, `PlayerControls` (play/pause, seek, volume, mute, fullscreen), filename/size/duration, same-file verification prompt for participants, host-controlled sync via `syncController`, stream-from-host through `ShareBroadcaster`/`ShareViewer` with `captureStream` and fallback message; enable Local tab. No blob URL ever sent.
      Verify: `npm run typecheck; npm run lint; npm test; npm run build`.
- [x] P4-4. Extend smoke (local media accepted, `local:ready`, `share:start file`, `share:stop` keeps `hasFile`). Run gate, commit `feat: local video files`.

## P5: Chat

- [x] P5-1. Server chat handlers: sanitize (trim, strip control chars, newlines to a space, 500 cap), ring buffer 100, broadcast to all incl. sender, typing, system join/leave lines, rate limit. Tests.
      Verify: `npm --prefix signaling-server test`.
- [x] P5-2. UI `src/components/chat/*` (ChatPanel, MessageList with auto-scroll and "jump to latest", MessageBubble, ChatInput, EmojiPicker static array, TypingIndicator), online count, unread badge on Chat tab, mobile tab. Reducer tests for typing expiry and chat history.
      Verify: `npm run typecheck; npm run lint; npm test; npm run build`.
- [x] P5-3. Extend smoke (chat broadcast to all, history in late-joiner snapshot, truncation at 500, join/leave system lines). Run gate, commit `feat: live chat`.

## P6: Games

- [x] P6-1. Reducers first: `shared/games/{ludo,tictactoe,rps,index}.ts` with `view()` redaction, `THREE_SIXES_FORFEIT` as the single switch (note 6), `pieceCoord` mapping, log capped at 20; finish `parseGameAction` shapes (reject `skipTurn`, wrong kind, non-integers). Tests for every row in section 16 (TTT, RPS 27 triples + 2-player matrix, Ludo rules, parseGameAction garbage).
      Verify: `npm test`.
- [x] P6-2. Server game handlers (`game:open|close|action`), seats, per-recipient redaction on broadcast and snapshot, server rng for dice, Ludo turn-skip sweep, leave/forfeit handling, `bad_request` vs `invalid_state` vs `forbidden`. Tests.
      Verify: `npm --prefix signaling-server test`.
- [x] P6-3. UI: `GamesPanel`, `GamePicker`, `ludo/{LudoBoard (SVG),Dice,LudoSeats}`, `tictactoe/TicTacToeBoard`, `rps/RpsPanel`, winner banners, restart, spectators, turn indicators, Games tab.
      Verify: `npm run typecheck; npm run lint; npm run build`.
- [x] P6-4. Games help text includes the three-sixes house rule (note 6). Extend smoke (legal and illegal TTT moves, garbage payloads -> `bad_request` with unchanged state, RPS hidden picks not visible to client B before reveal, Ludo out-of-turn rejected). Run gate, commit `feat: multiplayer games`.

## P7: Polish and deploy prep

- [ ] P7-1. Responsive pass (mobile bottom tab bar, collapsible panels), animations with `prefers-reduced-motion`, loading/not-found/error boundaries, reconnect banner states, accessibility basics (aria-labels, focus rings).
      Verify: `npm run typecheck; npm run lint; npm run build`.
- [ ] P7-2. `next.config.ts` headers: CSP with `frame-src` youtube.com and youtube-nocookie.com, `Permissions-Policy: display-capture=(self)`; dev CSP allows `ws:`/`http:`, production does not; no `localhost` in output. Add a config test (section 16 `config` row).
      Verify: `npm test`; `npm run build`.
- [ ] P7-3. Production Next run check: `npm run build; npm start` in the background, `Invoke-WebRequest` the landing page and `/room/ABCDEF`, assert response headers (AC12), stop the process.
- [ ] P7-4. Audit: no fake buttons, no placeholder text, no `localhost` in `src/`, `shared/`, `signaling-server/src` except `dev.ts`.
      Verify: `npm run lint; npm test`.
- [ ] P7-5. `.env.example` (all NEXT_PUBLIC_* variables) and `signaling-server/.env.example` (PORT, ALLOWED_ORIGINS, TRUST_PROXY_HOPS, limits, timers).
- [ ] P7-6. README: quick start (`npm run setup` then `npm run dev:all`), env vars, Vercel steps, Render/Railway/Fly step by step (incl. `TRUST_PROXY_HOPS=1`, Fly `fly.toml` + Dockerfile marked unverified), TURN, limitations (ephemeral rooms, mesh ~4-6 viewers, local file caveats, **password rooms still reveal count, room name and host name through `room:peek`**, note 3), "Handing over the host role", swapping transport, adding auth/DB, pinned dependency versions (note 7). Add `signaling-server/README.md`.
      Verify: `npm run build` still passes; README commands copy-checked against package.json scripts.
- [ ] P7-7. Run gate and commit `chore: polish and deploy prep`.

## P8: Final verification (writes `.agents/tasks/verification.md`)

- [x] P8-1. Clean install: `npm run setup` (root and `signaling-server`), then `npm run typecheck; npm run lint; npm test` and the server's `typecheck`, `test`.
- [x] P8-2. `npm run build` (Next) and `npm --prefix signaling-server run build`.
- [x] P8-3. Start the signaling server (`node signaling-server/dist/server.js` with test env: `ALLOWED_ORIGINS`, `HOST_GRACE_MS=500`, `SWEEP_INTERVAL_MS=100`, `IDLE_MS=1000`) and `npm start` for Next as background processes (`Start-Process` with redirected logs). Record PIDs. Poll `/health` until ready.
- [x] P8-4. Run the full smoke script: create, join with/without password, wrong password rejected, late-joiner snapshot, host-only playback enforcement, chat broadcast + history, game move validation including garbage payloads, host migration with paused playback broadcast, targeted `rtc:signal` only to target, old-host `media:state` teardown. Any failure: fix, rebuild, rerun.
- [x] P8-5. Optional browser check: try `npx --yes playwright` / `npx --yes puppeteer` (no devDependency added; browser download may fail). If it works, screenshot landing and a room in light and dark into `.agents/tasks/screenshots/` and assert zero console errors. If not possible, record that and why.
- [x] P8-6. Stop all background processes by recorded PIDs; confirm ports are free.
- [x] P8-7. Write `.agents/tasks/verification.md`: commands run with results, file structure, how to run, what was verified, what could NOT be verified (cross-network screen share and TURN, YouTube playback, `captureStream` per browser, `.mov`, real mobile layouts). Commit `docs: verification report`.

