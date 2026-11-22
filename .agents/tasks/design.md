# Moonie 🌙 — Requirements & Technical Design

Status: revision 4 (responds to the third `design-review.md`, verdict CHANGES_REQUESTED, 11 findings: 1 HIGH, 4 MEDIUM, 6 NIT). Section 22 maps each revision-4 finding to its resolution; section 21 holds the revision-3 responses and section 20 the revision-2 responses. Where earlier text conflicts with a revision-4 rule, the revision-4 rule wins and the earlier text has been edited to match. Greenfield repo (only `.git`, `.gitignore`, `.agents`, `.kiro`).

Legend: **[UNVERIFIED]** marks assumptions about library/browser behavior I could not confirm. This authoring environment had no network access (`npm view` failed with ENOTFOUND) and no browser. The implementer must re-check each marked item as the corresponding phase starts, and must pin dependency versions from the registry at `npm install` time.

---

## 1. Requirements summary

Moonie is a no-account, no-database watch-party site. A visitor creates or joins a temporary room by code or invite link. In the room they can watch YouTube in sync, share a screen or a local video over WebRTC, chat, and play Ludo, Tic-Tac-Toe and Rock-Paper-Scissors. The look is pastel, cozy and animated, with light and midnight modes.

Room state lives in the memory of a separate Node WebSocket "signaling server". It holds the host, participants, media, playback, queue, game state and a chat ring buffer. The Next.js app is deployed on Vercel and only serves UI. Everything is ephemeral and is discarded when the room empties.

### Assumptions (inferred where the brief is silent)
- A1. Maximum 8 participants per room (configurable). Screen share is a star topology (sharer to each viewer). Quality is documented as good to about 4–6 viewers because the sharer uploads one stream per viewer.
- A2. Only the host can start screen share or file streaming. Transferring host is the documented handover path.
- A3. Participant identity is a server-generated id plus a per-tab resume token. Display name and avatar come from localStorage.
- A4. Room codes are 6 characters from a no-lookalike alphabet.
- A5. Ludo ends at the first player to bring all 4 pieces home. An extra turn is granted only for rolling a 6. Three sixes in a row forfeit that turn (house rule beyond the brief's list, gated by the constant `THREE_SIXES_FORFEIT = true` in `ludo.ts`; set it to `false` to drop the rule with no other change).
- A6. One game is active per room at a time. Any participant can open the game picker while none is active. The host or a seated player can close or restart.
- A7. YouTube titles are optional metadata. If the title lookup fails, the UI shows "YouTube video (ID)".
- A8. Fixed UI language is English.

### Functional requirements (FR)
- FR1 Landing page: logo, navbar, hero (exact heading and subtitle from the brief), animated decorations, working Create Room and Join Room modals, feature cards, how-it-works, footer, theme toggle.
- FR2 Create room: name, theme, optional password, display name, avatar. The server generates a collision-checked code. The invite URL is `/room/CODE` with a copy button.
- FR3 Join: by code or pasted invite URL. Lobby screen shows room name, theme, host, participants, name/avatar picker, password prompt, and an Enter button. Handles not-found, wrong password, full room, kicked, and connection failure.
- FR4 Host model with host migration (oldest connected participant), kick, transfer, rename, theme change, set/clear password.
- FR5 YouTube: URL parsing (watch, youtu.be, shorts, embed, live, bare ID, `t=`), IFrame API loaded once, host-controlled sync, drift correction at 1.5 s, latency compensation, shared queue with auto-advance, error codes 2/5/100/101/150 with friendly skip, loading states, late joiner sync.
- FR6 Screen share: getDisplayMedia (screen, window, tab, audio when available), WebRTC with perfect negotiation, candidate queueing, ICE restart, late viewers, LIVE indicator, who-is-sharing, stop (including the browser's native stop), error and unsupported handling.
- FR7 Local file: picker and drag-drop, `canPlayType` validation, preview, custom controls, name/size/duration. Two flows: "same file" (metadata and hash verification) and "stream from host" (`captureStream` over the same WebRTC machinery) with fallback. No upload and no blob-URL sharing.
- FR8 Real-time sync with a server-authoritative store, host-only playback commands, full snapshot for late joiners.
- FR9 Chat: messages, avatars, timestamps, emoji picker, join/leave system messages, typing indicators, online count, auto-scroll with "jump to latest", capped history for late joiners.
- FR10 Games: Ludo (2–4), Tic-Tac-Toe (2 + spectators), RPS (2–8 simultaneous hidden picks). Pure shared reducers, server-validated.
- FR11 Room layout: player area, tabbed sidebar (Chat / People / Queue / Games), media selector, invite button, settings. Mobile uses a bottom tab bar.
- FR12 Light and midnight themes with a persistent toggle and no flash. Six room themes that visibly change the room. `prefers-reduced-motion` respected.
- FR13 Replaceable `SignalingTransport`; thin `identity` module.
- FR14 Vercel-ready Next app, `.env.example`, README (Vercel, Render/Railway/Fly, TURN, limitations, swapping transport, adding auth/DB, and a "Handing over the host role" section: transferring host ends any active share or file stream; the new host starts a new one).

### Non-functional requirements (NFR)
- NFR1 No DB, auth provider, or persistent storage. No hardcoded localhost in app code (dev defaults only in `.env.example`, `.env.development`, and the server `dev.ts`).
- NFR2 Server limits: ws `maxPayload` 64 KiB, token-bucket rate limits, caps on rooms, connections per IP and participants.
- NFR3 SSR-safe: no `window` at module scope; error boundaries; reconnect banner.
- NFR4 Accessibility basics: focus rings, aria-labels on icon buttons, keyboard-operable controls, contrast acceptable in both modes.
- NFR5 Playback sync error target: followers within about 1.5 s of host steady-state, and typically under 0.5 s on a healthy network.

### Acceptance criteria (AC)
1. AC1 `npm run typecheck`, `lint`, `test`, and `build` pass for the Next app. The signaling server's `typecheck`, `test`, and `build` pass.
2. AC2 Creating a room returns a 6-char code. The code is unique among live rooms. `/room/CODE` loads the lobby on another browser.
3. AC3 Join with a wrong password is rejected server-side with `wrong_password`. The correct password is accepted. A room with a password does not leak its participant list to unauthenticated peeks.
4. AC4 A late joiner's `room:joined` snapshot contains the current media, playback position, queue, game state and the last chat messages.
5. AC5 A non-host `playback:command` is rejected with `not_host` and does not change state.
6. AC6 When the host disconnects and does not return within the grace period, the oldest remaining participant becomes host and a `host:changed` event is broadcast.
7. AC7 An `rtc:signal` addressed to client B is delivered only to B. A signal to a participant of another room, or a viewer-to-viewer signal, is dropped.
8. AC8 Game moves out of turn or illegal are rejected without state change. Ludo, TTT and RPS unit tests pass for the rules listed in section 12.
9. AC9 `parseYouTubeUrl` returns the right ID for each supported URL form and `null` for invalid input.
10. AC10 Chat messages are broadcast to everyone in the room, and are truncated and stripped of control chars at 500 chars. Rendering is plain text.
11. AC11 Theme toggle persists across reload with no visible flash (inline script runs before paint).
12. AC12 Response headers include CSP `frame-src` for YouTube and `Permissions-Policy: display-capture=(self)`.
13. AC13 Starting the signaling server with `ALLOWED_ORIGINS` unset rejects every browser Origin (fail closed). A disallowed Origin gets HTTP 403 on upgrade.
14. AC14 Browser-only checks (real cross-device screen share, YouTube playback) are listed in the final report as not verifiable by script.
15. AC15 Any event that ends a share (`share:stop`, host disconnect of the sharer, `host:transfer`, kick of the sharer, `media:set`) sets `media`/`shareSession` server-side and broadcasts `media:state`. A sharer client that sees `media` no longer carrying its own `sessionId` stops all capture tracks and closes all peer links (unit-tested on `ShareBroadcaster` with a fake store; smoke test asserts the broadcasts).
16. AC16 A socket that is connected but idle (no message of any kind) for 30 s is closed. A lobby that re-peeks every 5 s is never closed by this rule.
17. AC17 `room:create`/`room:join` from a connection that is already in a room returns `invalid_state`.
18. AC18 Resuming with an invalid token never produces a fresh join; the client returns to the lobby with the password prompt when needed.

### Out of scope
Accounts, auth, DB, persistence, voice/video chat, mobile native apps, i18n, moderation tooling, SFU/MCU media servers, DataChannel file transfer (optional stretch only), multi-room navigation inside one tab.

---

## 2. Technology stack (locked on approval)

| Concern | Choice |
|---|---|
| Web app | Next.js (App Router), React, TypeScript strict. Pin latest stable 15.x or later at install **[UNVERIFIED version]** |
| Styling | Tailwind CSS 3.4.x with CSS-variable design tokens (v3 chosen because config and plugins are stable; v4 would also work but changes the config model). |
| Animation | `motion` package, imported from `motion/react` **[UNVERIFIED: confirm the import path for the installed version; fallback `framer-motion`]** |
| Icons | `lucide-react` |
| Fonts | `next/font/google`: Nunito (body), Quicksand (display). Fetched and self-hosted at build time, so the build needs network. The CSS variables carry a system-font fallback stack (`var(--font-body), ui-rounded, 'Segoe UI', system-ui, sans-serif`) and `next/font` is configured with `fallback` and `adjustFontFallback`, so the UI stays usable if fonts fail. To keep `npm run build` passing offline, `src/app/fonts.ts` wraps the loaders; if the offline build fails, the implementer switches to `next/font/local` with committed woff2 files (Quicksand and Nunito are OFL-licensed). **[UNVERIFIED: whether `next build` degrades gracefully when the Google fetch fails; in dev it falls back to the system font with a warning, in production build it errors.]** The design therefore picks one: P1 tries `next/font/google`; if the build fails offline, commit woff2 under `src/app/fonts/` and use `next/font/local` (same CSS variable names, so nothing else changes). |
| Realtime | Native `WebSocket` (client) and `ws` (server), JSON text frames |
| Media | Official YouTube IFrame Player API; native WebRTC; `getDisplayMedia`; `HTMLMediaElement.captureStream` |
| Signaling server | Node 20+ (dev machine has 24), TypeScript, `ws`, bundled with `esbuild`, run in dev with `tsx` |
| Tests | `vitest` (unit tests for shared logic and server room logic), plus a `ws`-based smoke script |
| Lint | ESLint with `eslint-config-next`. **[UNVERIFIED]** Next 16 removed `next lint`; use the `eslint .` script that `create-next-app` generates for the pinned version. |
| Dev runner | `concurrently` for `dev:all` |

No other runtime dependencies. IDs use `crypto.randomUUID`/`crypto.getRandomValues`. Emoji picker is a static array. No zod (hand-written validators in `shared/validate.ts`, to keep the shared module dependency-free).

Rejected alternatives: PartyKit/Ably/Liveblocks (external account needed for the default path; documented as a swap target through `SignalingTransport`), Socket.IO (heavier, adds a protocol layer we do not need), serverless polling (cannot hold WebSockets on Vercel).

---

## 3. Folder layout

```
/ (repo root = Next app, Vercel root)
├─ package.json                # scripts: dev, dev:all, build, start, lint, typecheck, test
├─ next.config.ts              # headers(), reactStrictMode
├─ tailwind.config.ts  postcss.config.mjs  tsconfig.json  vitest.config.ts  eslint config
├─ .env.example  .env.development  README.md  vercel.json (optional, only if needed)
├─ shared/                     # pure TS, no DOM, no Node APIs; imported by both apps
│  ├─ protocol.ts              # message unions, snapshot types, error codes
│  ├─ validate.ts              # parseClientMessage(), sanitizers
│  ├─ constants.ts             # limits, alphabets, THEMES, AVATARS, regexes
│  ├─ roomCode.ts              # generateCode(rng), normalizeCode, parseRoomInput
│  ├─ playback.ts              # expectedPosition(), applyCommand()
│  ├─ clock.ts                 # estimateOffset()
│  └─ games/ index.ts ludo.ts tictactoe.ts rps.ts types.ts
├─ signaling-server/
│  ├─ package.json tsconfig.json .env.example README.md
│  ├─ src/ index.ts (start()) dev.ts server.ts config.ts origin.ts
│  │      registry.ts room.ts password.ts rateLimit.ts handlers/*.ts log.ts
│  ├─ scripts/smoke.ts         # multi-client protocol verification against a running URL
│  └─ test/*.test.ts
├─ src/
│  ├─ app/ layout.tsx page.tsx globals.css not-found.tsx error.tsx global-error.tsx
│  │      room/[code]/page.tsx room/[code]/loading.tsx
│  ├─ components/
│  │   ├─ ui/ (Button Card Modal Tabs Toast Avatar Badge Tooltip IconButton Spinner ThemeToggle)
│  │   ├─ landing/ (Navbar Hero FloatingDecor FeatureCards HowItWorks Footer CreateRoomModal JoinRoomModal)
│  │   ├─ room/ (RoomShell Lobby RoomHeader InviteButton SettingsDialog ParticipantList
│  │   │         Sidebar MobileTabBar ReconnectBanner RoomThemeBackdrop ErrorState)
│  │   ├─ media/ (MediaStage SourceSelector YouTubePlayer QueuePanel ScreenSharePanel ScreenView
│  │   │          LocalFilePanel LocalPlayer FileDropzone PlayerControls LiveBadge)
│  │   ├─ chat/ (ChatPanel MessageList MessageBubble ChatInput EmojiPicker TypingIndicator)
│  │   └─ games/ (GamesPanel GamePicker ludo/{LudoBoard,Dice,LudoSeats} tictactoe/TicTacToeBoard rps/RpsPanel)
│  ├─ lib/
│  │   ├─ signaling/ types.ts(SignalingTransport) WebSocketTransport.ts config.ts index.ts(factory)
│  │   ├─ room/ roomStore.ts reducer.ts RoomProvider.tsx useRoom.ts selectors.ts clockSync.ts
│  │   ├─ youtube/ parse.ts loadApi.ts useYouTubePlayer.ts syncController.ts
│  │   ├─ webrtc/ iceConfig.ts support.ts capture.ts PeerLink.ts ShareBroadcaster.ts ShareViewer.ts
│  │   ├─ localfile/ support.ts hash.ts verify.ts captureStream.ts
│  │   ├─ identity/ identity.ts   # localStorage {name, avatar}; sessionStorage "moonie-session" = {code, resumeToken} (written on every room:joined; cleared on leave, kicked, room:closed, failed resume)
│  │   ├─ theme/ themeScript.ts useTheme.ts roomThemes.ts
│  │   └─ utils/ cn.ts clipboard.ts format.ts
│  └─ test/ (client unit tests colocated as *.test.ts)
```

Shared-code wiring:
- `tsconfig.json` (root): `paths: {"@shared/*": ["./shared/*"], "@/*": ["./src/*"]}`, `include: ["next-env.d.ts","src","shared"]`, and `exclude: ["signaling-server"]`, so the Next build ignores the server sources. `signaling-server/tsconfig.json` must `include: ["src","scripts","../shared"]` (server code imports `../../shared/...`; esbuild bundles it). **Scaffolding (revision 4):** the repo already holds `.git`, `.gitignore`, `.agents` and `.kiro`, so `create-next-app .` is not used (it refuses a non-empty directory). The implementer writes `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs` and the ESLint config by hand (or scaffolds in a temp directory and copies the files). **Tailwind is pinned to `tailwindcss@3.4.x`** (with `postcss` and `autoprefixer`); current scaffolds default to v4, whose config model differs, so the implementer must not accept a scaffold default. The existing `.gitignore` lists only `.env` and `.env.local`; keep it and append `.env*.local`, `signaling-server/dist`, `.vercel`, `.next`, `node_modules` and `*.tsbuildinfo` (each only if not already present). `.env.example`, `.env.development` and `signaling-server/.env.example` are not matched by any ignore rule, so no `!` negations are needed. Check with `git check-ignore -v` that none of those three files is ignored.
- Next compiles `shared/` because it is inside the project root, so no `transpilePackages` is needed. Vitest uses matching `resolve.alias` entries.
- `signaling-server` imports through the relative path `../../shared/...`. It is bundled by esbuild (`--bundle --platform=node --format=cjs --packages=external`, output `dist/server.js`). CJS is chosen so `node dist/server.js` runs without `"type":"module"` and without extension rules. `ws` stays external and is a runtime `dependency`. `esbuild`, `typescript`, `tsx`, and `vitest` are also listed under `dependencies` (not `devDependencies`) in `signaling-server/package.json`, because Render/Railway run `npm ci` with `NODE_ENV=production`, which skips devDependencies, and the build runs on the host. (Alternative `npm ci --include=dev` is documented as a fallback in the README.)
- Inside `shared/` every import is extensionless and relative (works under both `moduleResolution: bundler` and esbuild).
- Deploying the server therefore needs the repo root as the build context (monorepo style). README gives exact commands: build `npm --prefix signaling-server ci && npm --prefix signaling-server run build`, start `node signaling-server/dist/server.js`. Render root directory is the repo root; Railway uses the same commands (Railway behavior **[UNVERIFIED]**, stated in README as "should work, same commands"). Fly.io needs a build recipe, so the README includes a minimal `fly.toml` plus a 6-line `signaling-server/Dockerfile` (copy repo, `npm --prefix signaling-server ci`, build, `CMD node signaling-server/dist/server.js`), marked **[UNVERIFIED: not run in the authoring environment]**. Render and Railway need no Dockerfile.
- Root `vitest.config.ts` sets `test.exclude: ['signaling-server/**', 'node_modules/**', '.next/**']`; the server has its own `vitest.config.ts` with aliases to `../shared`.
- The Vercel project builds only the Next app. `signaling-server/` is ignored by tsc, and `.vercelignore` may exclude it.

---

## 4. Shared protocol (`shared/protocol.ts`)

Transport: one WebSocket per tab, JSON text frames, `{ type, ... }`. Client requests may carry `ref?: string` (≤ 32 chars). The server echoes `ref` on the direct reply or error.

### Core types
```ts
export type ThemeId = 'strawberry'|'lavender'|'cloud'|'vanilla'|'starlight'|'bubblegum';
export type AvatarId = 'cat'|'bunny'|'bear'|'panda'|'fox'|'frog'|'chick'|'unicorn'|'octopus'|'penguin'|'hamster'|'koala';

export interface Participant { id: string; name: string; avatar: AvatarId; joinedAt: number; connected: boolean;
  hasFile?: boolean; /* same-file flow readiness, server-set from local:ready, reset to false only when the file identity changes (see section 6 "local:ready"), not on every media change */ }

export interface LocalFileMeta { name: string; size: number; lastModified: number; mime: string; durationSec?: number; hash?: string; }

export type MediaState =
  | { kind: 'youtube'; rev: number; videoId: string; title?: string; startedBy: string }
  | { kind: 'screen';  rev: number; sharerId: string; sessionId: string; hasAudio: boolean }
  | { kind: 'local';   rev: number; file: LocalFileMeta; delivery: 'same-file'|'stream';
      sharerId?: string; sessionId?: string; hasAudio?: boolean };   // sharerId/sessionId only for 'stream'

// rev semantics: `media.rev` increments on every media change (media:set, share:start, endShare, queue advance). `playback.rev` ALWAYS equals the current `media.rev` and is NOT incremented per command; command ordering relies on the single WebSocket's in-order delivery.
export interface PlaybackState { rev: number; status: 'playing'|'paused'; positionSec: number; updatedAt: number /* server epoch ms */; }

export interface QueueItem { id: string; videoId: string; title?: string; addedBy: string; addedAt: number; }
export interface ChatMessage { id: string; kind: 'user'|'system'; from?: string; name?: string; avatar?: AvatarId; text: string; ts: number; }

export interface RoomSnapshot {
  code: string; name: string; theme: ThemeId; hasPassword: boolean;
  hostId: string; createdAt: number; maxParticipants: number;
  participants: Participant[];
  media: MediaState | null;
  playback: PlaybackState;                // meaningful when media kind is youtube/local; else paused @0
  queue: QueueItem[];                     // upcoming items, ≤ 50
  game: GameView | null;                  // redacted per recipient (see section 12)
  chat: ChatMessage[];                    // last ≤ 100
  serverTime: number;
}
// RoomPeek.count = CONNECTED participants only; the server's room_full check counts ALL participants, including disconnected-in-grace ones. The lobby can therefore show "3/8" and still get room_full; the lobby copy for room_full reads "This room is full right now (someone may be reconnecting). Try again in a moment."
export interface RoomPeek { code: string; name: string; theme: ThemeId; hasPassword: boolean; count: number; max: number;
                            hostName: string; participants?: Pick<Participant,'name'|'avatar'>[]; /* omitted when hasPassword (accepted: the lobby of a password room shows only the count until joined) */ }

// Payload helper types (defined in shared/protocol.ts, used by SignalingTransport)
export type CreateRoomInput = Omit<Extract<ClientMessage, { type: 'room:create' }>, 'type' | 'ref'>;
export type JoinRoomInput   = Omit<Extract<ClientMessage, { type: 'room:join' }>,   'type' | 'ref'>;
export type JoinedPayload   = Omit<Extract<ServerMessage, { type: 'room:joined' }>, 'type' | 'ref'>;
```
`Extract` works on `{ref?} & (A|B)` because TypeScript distributes the intersection over the union into `({ref?}&A) | ({ref?}&B)`.

Types in `shared/games/types.ts` (imported by `protocol.ts`):
```ts
export type GameKind = 'ludo'|'tictactoe'|'rps';
export type Color = 'red'|'green'|'yellow'|'blue';
export type Choice = 'rock'|'paper'|'scissors';
export interface Seat { playerId: string; name: string; avatar: AvatarId }
export type GameAction = LudoAction | TttAction | RpsAction;   // SINGLE definition. No `game` discriminator field: the server dispatches on room.game.kind and `parseGameAction(kind, raw)` (section 4 validation) checks the shape against that kind's action set
// `skipTurn` (Ludo) is dispatched only by the server sweep, never by a client, and never by the host. parseGameAction rejects it.
export type RpsView = Omit<RpsState,'picks'|'result'> & { picks: Record<string, 'none'|'locked'|Choice>;   // 'none' = not yet picked; others' picks are 'locked' while choosing; the viewer's own pick is shown; all shown when revealed
                                                           result: RpsState['result'] };            // result is null until revealed
export type GameView = LudoState | TttState | RpsView;      // Ludo and TTT contain no hidden information, so view() returns the state unchanged
```
`Actor` stays as defined in section 12. There is no `GameEvent` type: `Result` carries only `state`.

### Client → server
```ts
export type ClientMessage = { ref?: string } & (
  | { type: 'room:create'; name: string; theme: ThemeId; password?: string; displayName: string; avatar: AvatarId }
  | { type: 'room:peek'; code: string }
  | { type: 'room:join'; code: string; password?: string; displayName: string; avatar: AvatarId; resumeToken?: string }  // resumeToken present = resume attempt ONLY (see section 6 Resume)
  | { type: 'room:leave' }
  | { type: 'profile:update'; displayName?: string; avatar?: AvatarId }
  | { type: 'room:settings'; name?: string; theme?: ThemeId; password?: string | null }   // host only; null clears
  | { type: 'host:transfer'; to: string }                                                 // host only
  | { type: 'host:kick'; id: string }                                                     // host only
  | { type: 'sync:ping'; t0: number }
  | { type: 'media:set'; media: { kind:'youtube'; videoId: string; title?: string } | { kind:'local'; file: LocalFileMeta; delivery:'same-file' } | null } // host
  | { type: 'playback:command'; rev: number; action: 'play'|'pause'|'seek'; positionSec: number; hostServerTime?: number } // host
  | { type: 'local:ready'; rev: number; ready: boolean }                                  // any participant; "my file matches the host's" (same-file flow); server sets Participant.hasFile and broadcasts participant:updated
  | { type: 'media:ended'; rev: number }                                                  // host
  | { type: 'media:error'; rev: number; code: number }                                    // host
  | { type: 'queue:add'; videoId: string; title?: string }
  | { type: 'queue:remove'; itemId: string }                                              // host or adder
  | { type: 'queue:reorder'; itemId: string; toIndex: number }                            // host
  | { type: 'queue:play'; itemId: string }                                                // host
  | { type: 'share:start'; source: 'screen'|'file'; hasAudio: boolean; file?: LocalFileMeta }  // host
  | { type: 'share:stop' }                                                                // host
  | { type: 'rtc:signal'; to: string; sessionId: string; linkId: string; data: RtcSignalData }   // linkId: client-generated by the viewer, 1-32 chars; relayed unchanged
  | { type: 'chat:send'; text: string }
  | { type: 'chat:typing'; typing: boolean }
  | { type: 'game:open'; kind: GameKind }
  | { type: 'game:close' }                                                                // host or seated player
  | { type: 'game:action'; action: GameAction }
);
export type RtcSignalData =
  | { t: 'viewer-ready'; reason?: 'initial'|'retry' }
  | { t: 'description'; description: { type: 'offer'|'answer'; sdp: string } }
  | { t: 'candidate'; candidate: { candidate: string; sdpMid?: string|null; sdpMLineIndex?: number|null; usernameFragment?: string|null } | null };
```

### Server → client
```ts
export type ServerMessage =
  | { type: 'room:info'; peek: RoomPeek; ref?: string }
  | { type: 'room:joined'; selfId: string; resumeToken: string; snapshot: RoomSnapshot; resumed: boolean; ref?: string }
  | { type: 'room:closed'; reason: 'expired'|'empty' }
  | { type: 'kicked' }
  | { type: 'participant:joined'; participant: Participant }
  | { type: 'participant:updated'; participant: Participant }
  | { type: 'participant:left'; id: string; reason: 'left'|'timeout'|'kicked' }
  | { type: 'host:changed'; hostId: string; reason: 'left'|'transfer'|'timeout' }
  | { type: 'room:settings'; name: string; theme: ThemeId; hasPassword: boolean }
  | { type: 'sync:pong'; t0: number; serverTime: number }
  | { type: 'media:state'; media: MediaState | null; playback: PlaybackState; queue: QueueItem[]; ref?: string }
  | { type: 'playback:state'; playback: PlaybackState; ref?: string }
  | { type: 'queue:updated'; queue: QueueItem[]; ref?: string }
  | { type: 'rtc:signal'; from: string; sessionId: string; linkId: string; data: RtcSignalData }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'chat:typing'; id: string; typing: boolean }
  | { type: 'game:state'; game: GameView | null }
  | { type: 'error'; code: ErrorCode; message: string; ref?: string };

export type ErrorCode = 'bad_request'|'not_found'|'wrong_password'|'locked_out'|'room_full'|'rate_limited'
  |'not_host'|'forbidden'|'invalid_state'|'too_large'|'server_busy'|'stale';
```
Room creation replies with `room:joined` (the creator is joined immediately and is host). Guest flow: `room:peek` → `room:info` → `room:join` → `room:joined`. A connection holds at most one room membership: `room:create` or `room:join` while already in a room replies `invalid_state` (the client calls `leaveRoom()` first). `room:peek` is allowed any time, joined or not, and is not a subscription; the lobby polls it (section 7).

**Reply contract for `request()` (revision 3).** Every request-style message gets exactly one reply carrying its `ref`: either one success message from the table or an `error`. Rule: when a mutation is broadcast, the server sends the requester its own copy of the broadcast with `ref` set, and all other recipients get the same payload without `ref` (one send per recipient, no duplicate for the requester). If the request succeeds but changes nothing (for example `media:set` with identical media, `queue:reorder` to the same index), the server still replies to the requester only, with the current `media:state` / `queue:updated` carrying the `ref`, and broadcasts nothing. This prevents a 10 s timeout on no-op success.

| Request | Success reply (with `ref`) | Notes |
|---|---|---|
| `room:peek` | `room:info` | |
| `room:create`, `room:join` (incl. resume) | `room:joined` | |
| `media:set` | `media:state` | |
| `share:start` | `media:state` | |
| `queue:add` | `queue:updated`, or `media:state` if the add started playback (queue empty and media null) | |
| `queue:remove`, `queue:reorder` | `queue:updated` | |
| `queue:play` | `media:state` (the item leaves the queue and becomes media) | |

Fire-and-forget messages (`playback:command`, `chat:*`, `game:*`, `media:ended`, `media:error`, `share:stop`, `rtc:signal`) never need a reply; their errors come back without `ref` unless the client attached one. The client uses `request()` only for the rows above.

Error delivery: a server `error` carries the `ref` of the request that caused it when there is one. Errors with a `ref` reject the matching `request()` promise. Errors without a `ref` (fire-and-forget `send()` calls) are dispatched to the store as `lastError` and shown as a toast, except `stale` (silently ignored) and `rate_limited` (coalesced to one toast per 5 s).

### Validation of external input (client messages, enforced in `shared/validate.ts` at the server's trust boundary; the client reuses the sanitizers)
| Field | Rule | On failure |
|---|---|---|
| frame | text, valid JSON object, ≤ 64 KiB (ws `maxPayload` closes the socket with 1009 above this) | `bad_request`; unknown `type` → `bad_request` (connection stays) |
| `code` | after `normalizeCode`: 6 chars in the alphabet | `bad_request` (invalid) or `not_found` (valid but absent) |
| `displayName` | required, string, trimmed, control chars removed, 1–24 chars | `bad_request` |
| `avatar`, `theme` | required, member of the constants lists | `bad_request` |
| room `name` | required on create, 1–40 chars after sanitizing | `bad_request` |
| `password` | optional string, 4–64 chars (never logged) | `bad_request` |
| `videoId` | `/^[A-Za-z0-9_-]{11}$/` | `bad_request` |
| `title` | optional, ≤ 120 chars, sanitized | truncated |
| `positionSec` | finite number, 0 ≤ x ≤ 86400 | `bad_request` |
| `rev` | integer; must equal current `media.rev` | `stale` (ignored by clients, not shown) |
| `LocalFileMeta` | name 1–255 sanitized, size 1..2^40, lastModified ≥ 0, mime `video/*` ≤ 100 chars, durationSec 0..86400 optional, hash `/^[0-9a-f]{64}$/` optional | `bad_request` |
| chat `text` | string, trimmed, control chars removed (newline kept as space), 1–500 chars (longer is truncated, empty is rejected) | `bad_request` if empty |
| `rtc:signal` | `to` is a connected participant in the same room and not self, `sessionId` equals the active session, `linkId` is a string of 1–32 chars matching `/^[A-Za-z0-9_-]+$/`, sender or recipient is the sharer, description sdp ≤ 32 KiB, `candidate.candidate` ≤ 2048 chars, `candidate.sdpMid` and `candidate.usernameFragment` ≤ 256 chars each, `sdpMLineIndex` an integer 0..255 or null, `data.t` in the known set. The server does not interpret `linkId`; it relays it unchanged | silently dropped; oversize SDP is logged at `warn` (code and size only), oversize candidate fields and other drops at debug (prevents amplification) |
| `local:ready` | `ready` boolean; only accepted while `media.kind==='local' && delivery==='same-file'`, else ignored | `bad_request` (type) / ignored |
| `queue:reorder.toIndex` | integer, clamped to `[0, len-1]` | clamped |
| `game:action` | **two stages.** (1) Shape: `parseGameAction(room.game.kind, raw)` in `shared/validate.ts` (rules below) returns a typed `GameAction` or `null`. (2) Rules: the per-game reducer. If `room.game` is null the handler replies `invalid_state` before parsing | shape error → `bad_request`; rule error → `invalid_state` (wrong phase, illegal move, not your turn) or `forbidden` (not seated, not allowed to act), each with a reason string |
| `ref` | optional string, 1–32 chars | field dropped (message still processed) |
| ids (`host:transfer.to`, `host:kick.id`, `queue.itemId`, `rtc:signal.to`, `rtc:signal.sessionId`) | string, 1–64 chars, must exist in the room where applicable | `bad_request` (format), `not_found` (unknown participant or item), except `rtc:signal` which is dropped silently |
| `host:transfer.to`, `host:kick.id` equal to self | not allowed | `invalid_state` |
| `host:transfer.to` not connected | not allowed | `invalid_state` |
| `queue:remove` by a non-host who is not the item's adder | not allowed | `forbidden` |
| `game:open.kind` | member of `['ludo','tictactoe','rps']` | `bad_request` |
| `share:start.source` | member of `['screen','file']` | `bad_request` |
| `share:start.hasAudio` | boolean | `bad_request` |
| `share:start.file` | required when `source==='file'` (validated exactly like `LocalFileMeta`), forbidden when `source==='screen'` | `bad_request` |
| `media:set.media` | `null` or one of the shapes in `ClientMessage`; `kind:'local'` requires `delivery:'same-file'` | `bad_request` |
| `media:error.code` | integer 0..65535 | `bad_request` |
| `sync:ping.t0` | finite number | `bad_request` |
| `profile:update` | at least one of `displayName`, `avatar`; each validated like at join | `bad_request` |
| `room:settings` | at least one of `name`, `theme`, `password` (`null` allowed to clear); each validated as at create | `bad_request` |
| text length counting | all "chars" limits count Unicode code points (`Array.from(s).length`), not UTF-16 units | n/a |
| names (`displayName`, room `name`, file `name`) | NFC-normalized, trimmed, control chars removed, and bidi/zero-width format characters stripped (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069, U+FEFF) | stripped silently; empty after stripping is `bad_request` |

**`parseGameAction(kind: GameKind, raw: unknown): GameAction | null` (revision 4, `shared/validate.ts`).** `handlers/game.ts` calls it with `room.game.kind` before `reduce`; a `null` result replies `bad_request`. `raw` must be a plain object; extra fields are dropped (the result is rebuilt from the validated fields only). Per kind:
- `ludo`: `type` in `sit|leaveSeat|start|roll|move|restart`; `color` (required for `sit`, optional otherwise where the reducer derives the seat from the actor) in `['red','green','yellow','blue']`; `piece` (required for `move`) an integer 0..3.
- `tictactoe`: `type` in `sit|leaveSeat|move|restart`; `mark` (for `sit`) in `X|O`; `index` (for `move`) an integer 0..8.
- `rps`: `type` in `join|leave|start|pick|next|resetScores`; `choice` (for `pick`) in `rock|paper|scissors`.
- Any other `type`, including Ludo `skipTurn` and any type belonging to another game's action set, and any field of the wrong JS type (`index: "1"`, `piece: 9`, `piece: 1.5`) returns `null`.
The table above defines the split: shape errors are `bad_request`; rule errors are `invalid_state` or `forbidden`. Unit tests (`shared/validate.test.ts`) feed garbage: `index: "1"`, `piece: 9`, `{type:'skipTurn'}`, a TTT action sent to a Ludo room, `null`, an array, a string.

---

## 5. `SignalingTransport` (`src/lib/signaling/types.ts`)

```ts
export type ConnectionStatus = 'idle'|'connecting'|'open'|'reconnecting'|'closed'|'failed';
export type Unsubscribe = () => void;

export interface SignalingTransport {
  readonly status: ConnectionStatus;
  connect(): Promise<void>;                                   // resolves when open; rejects if the first attempt fails
  disconnect(): void;                                         // intentional close, no auto-reconnect
  reconnect(): void;                                          // manual retry from 'failed'/'closed'
  // room lifecycle (each resolves with the direct server reply, rejects with TransportError{code})
  peekRoom(code: string): Promise<RoomPeek>;
  createRoom(input: CreateRoomInput): Promise<JoinedPayload>;
  joinRoom(input: JoinRoomInput): Promise<JoinedPayload>;
  leaveRoom(): void;
  // messaging
  send(msg: ClientMessage): void;                             // fire-and-forget (chat, typing, playback commands, game actions)
  /** Ref-based request: resolves with the direct reply (the first ServerMessage carrying the same ref that is not an 'error'),
   *  rejects with TransportError{code} on an error carrying the ref, or TransportError('timeout') after 10 s.
   *  peekRoom/createRoom/joinRoom are thin wrappers over it. Used for share:start, media:set, queue:add/remove/reorder/play.
   *  Success replies per request are listed in the section 4 reply table; the requester's copy of a broadcast carries `ref`. */
  request(msg: ClientMessage): Promise<ServerMessage>;
  sendSignal(to: string, sessionId: string, linkId: string, data: RtcSignalData): void;   // targeted
  // events
  onMessage(handler: (msg: ServerMessage) => void): Unsubscribe;          // presence is delivered as participant:* events
  onStatus(handler: (s: ConnectionStatus, info?: { attempt: number; nextRetryMs?: number }) => void): Unsubscribe;
  /** Smoothed offset: serverNow() = Date.now() + clockOffsetMs. */
  getClockOffsetMs(): number;
}
export class TransportError extends Error { constructor(public code: ErrorCode | 'timeout' | 'network', message: string) { super(message); } }
```
Rules for `WebSocketTransport` (default implementation):
- URL from `NEXT_PUBLIC_SIGNALING_URL`; must start with `ws://` or `wss://`. If missing or invalid, `connect()` rejects with `TransportError('network', 'Signaling server is not configured')` and the UI shows a configuration error card.
- Request/reply: `ref` counter; pending map with a 10 s timeout (`TransportError('timeout')`).
- Auto-reconnect: backoff `min(8000, 500·2^n) ± 20%` jitter, status `failed` after 8 consecutive failures (the banner offers "Try again"). **No auto-reconnect** after a close with code 1008 (policy/idle/rate abuse), 4000 (replaced by another socket of the same participant), or 4001 (kicked): status becomes `closed` with a reason. **Recovery (revision 4):** (a) outside a room, the next user action (peek, join, create) calls `connect()` again lazily. (b) While a room is joined (a `{code, resumeToken}` is recorded) and status is `closed` (code 1008 or 4000; 4001 clears the session via `kicked`), `ReconnectBanner` shows a **"Reconnect"** button that calls `transport.reconnect()`. `reconnect()` opens the socket and, whenever a joined room is recorded, always sends the resume `room:join{code, resumeToken, displayName, avatar}`; it never sends a fresh join. A 4000 close means another tab took over the participant, so the banner text says "Moonie is open in another tab. Reconnect here?" and a resume from this tab replaces the other one. (c) `send()` while status is not `open` is dropped and the transport emits a local `lastError` ("Not connected. Reconnect to keep going.") that the UI shows as a toast (coalesced to one per 5 s), so a user's chat message or click never disappears silently. `request()` while not `open` rejects at once with `TransportError('network')`. Network drops (1006, 1001, 1012, etc.) auto-reconnect.
- **Resume only, never a silent fresh join.** On reopen, if a room was joined, the transport sends `room:join{code, resumeToken, displayName, avatar}` (no password is kept anywhere on the client). If the server accepts the token, the reply is delivered as `room:joined{resumed:true}` with the same participant id. If the server rejects it (`not_found`, `wrong_password`, `room_full`, `forbidden`), the transport does not retry and emits a synthetic local message `{type:'room:closed', reason:'expired'}` (the `room:closed` union member gets `'expired'`, which the server also uses for max age). The reducer then sets `phase:'lobby'`, `entered:false`, clears `snapshot`/`selfId`, and shows the lobby (with the password prompt if the room has one, via a fresh `peekRoom`). The `RoomProvider` also resets all sync controllers (YouTube, ShareBroadcaster/Viewer, LocalPlayer, game UI) on any `room:closed` or `kicked`. A new participant id (after a deliberate re-join from the lobby) always starts clean.
- Heartbeat and liveness: dead-peer detection is the server's job only (protocol ping every 20 s, terminate after 45 s without a pong; browsers answer protocol pings automatically even from background tabs). The client has **no watchdog timer** that closes the socket, because a host sharing a window leaves the Moonie tab in the background where timers are throttled (about 1/s, or 1/min under intensive throttling **[UNVERIFIED exact numbers]**). The client only reacts to `onclose`/`onerror`. `sync:ping` is for clock offset only: every 5 s while `document.visibilityState==='visible'` and every 30 s while hidden. The ping carries `t0 = Date.now()` and the transport also records `sentPerf = performance.now()`. On the pong, `rtt = performance.now() − sentPerf` (monotonic) and `offset = serverTime − (t0 + rtt/2)` (the `Date.now()` base of `t0` matches `serverNow() = Date.now() + offset`); the median of the 5 lowest-RTT samples of the last 12 is used. A visibilitychange to visible sends an immediate ping.
- Instantiated lazily through a module-level getter `getTransport()` (never at import time). One instance per tab survives route changes (Home to Room), since it is created by `RoomProvider` at the app layout level.
- Swap guide (README): implement the interface over Ably/PartyKit/Liveblocks. The server-authoritative logic would move into a room actor, with the shared reducers reused.

---

## 6. Signaling server architecture (`signaling-server/`)

### Process and HTTP
- `ws.WebSocketServer({ noServer: true, maxPayload: 65536 })` attached to a `node:http` server. `GET /health` returns `200 {"ok":true,"rooms":n,"connections":n,"uptime":s}`. `GET /` returns 200 plain text. Everything else 404. HTTP responses never include CORS headers other than `Access-Control-Allow-Origin` for allowed origins on `/health`.
- Binds `0.0.0.0:$PORT` (Render/Railway/Fly inject `PORT`, default 8787 for local).
- Graceful shutdown on SIGTERM: stop accepting, close all sockets with 1001, exit within 5 s.
- `uncaughtException`/`unhandledRejection`: log error (level error), keep running. A handler error inside a message is caught per message, logged, and the client gets `{error: bad_request}`; it never kills the process.

### Origin allow-list (`origin.ts`)
- Checked in the `upgrade` handler before `handleUpgrade`. A mismatch is answered with `HTTP/1.1 403 Forbidden` and the socket destroyed.
- `ALLOWED_ORIGINS` = comma-separated exact origins (`https://moonie.vercel.app`) and optional wildcard-subdomain entries (`https://*.vercel.app`). `*` alone allows any origin (logs a warning at start).
- Unset or empty: fail closed. No browser origin is allowed and a warning is logged. `dev.ts` sets `ALLOWED_ORIGINS ??= 'http://localhost:3000'` before importing the server.
- Missing `Origin` header (non-browser client): rejected unless `ALLOW_NO_ORIGIN=true` (used by the smoke script env). The smoke script sets an `Origin` header anyway.
- Note: this protects against cross-site WebSocket hijacking from browsers. It is not authentication, because non-browser clients can forge Origin.

### Connection limits and rate limiting (`rateLimit.ts`)
- `MAX_CONNECTIONS_PER_IP` (default 20). Client IP resolution (`clientIp(req, hops)`): with `TRUST_PROXY_HOPS = n` (integer ≥ 0, default **1**), take the **n-th entry from the right** of `X-Forwarded-For` (the entry appended by the nearest trusted proxy; anything to its left is client-controlled and ignored). If the header has fewer than n entries or `n = 0`, use `req.socket.remoteAddress`. README tells Render, Railway and Fly users to leave it at 1 (one proxy hop; **[UNVERIFIED]** per platform, so the README says to check the logged resolved IP at `LOG_LEVEL=debug`) and local dev sets it to 0. At startup, if `process.env.PORT` is set (a hosting platform) and `TRUST_PROXY_HOPS` is 0, log a warning that all users will share one IP. Exceeding the limit results in HTTP 429 on upgrade. Unit-tested with spoofed leftmost entries.
- `MAX_ROOMS` (default 300). On a create when full, the reply is `server_busy`.
- Token buckets per connection: general messages (capacity 60, refill 30/s); chat (capacity 5, refill 1 per second); `rtc:signal` (capacity 200, refill 100/s because ICE bursts); `room:create`/`room:join`/`room:peek` (capacity 10, refill 1 per 3 s). When empty: `rate_limited` error, and the message is dropped. 20 `rate_limited` events in 10 s closes the socket with code 1008. For an in-room socket this is recoverable by the user: the participant stays in the 30 s grace, and the client's "Reconnect" button (section 5) resumes with the stored token. The same applies to code 4000.
- Failed password attempts: 5 per (resolved IP, room) per 60 s, then `locked_out` for 30 s (in memory, cleaned with the room or by the sweep).
- Bucket scope: `rtc:signal` consumes only its own bucket, not the general one. All other message types consume the general bucket plus their own type bucket if listed. The peek/create/join bucket (capacity 10, refill 1 per 3 s) is what lets the lobby re-peek every 5 s (about 0.2/s) indefinitely.
- Liveness: protocol ping every 20 s; a socket without a pong in 45 s is terminated (keeps proxies from idling the connection out; Render's proxy closes idle sockets at about 55 s **[UNVERIFIED value]**).
- Idle sockets (apply only to sockets that are not in a room): closed with 1008 after `IDLE_MS` (30 s) with **no message of any kind** (peek, ping, anything counts), and after `UNJOINED_MAX_MS` (10 min) since connect regardless of activity. A lobby that re-peeks every 5 s therefore stays open for up to 10 min, and the client does not auto-reconnect after 1008; the next user action (joining) reconnects lazily. A hidden lobby tab may be closed (throttled timers); this is accepted. Sockets in a room are exempt (the 45 s protocol ping applies).

### Password hashing (`password.ts`)
`node:crypto.scrypt` (async), 16-byte random salt, 64-byte key, default cost N=16384, r=8, p=1, stored as `{salt, hash}` in room memory only. Verify with `timingSafeEqual`. Plain text is never stored or logged. Handlers per connection run through a serial promise queue so async hashing does not reorder that connection's messages.

### Rooms and registry (`registry.ts`, `room.ts`)
- `RoomRegistry`: `Map<code, Room>`. `createRoom()` generates a code with `crypto.randomInt` over the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 symbols; 31^6 ≈ 887M). It retries up to 10 times on collision, else `server_busy`.
- `Room` holds: `code, name, theme, passwordHash?, hostId, participants: Map<id, ServerParticipant{participant, socket|null, resumeToken, disconnectedAt?, typing}>`, `media, playback, queue, game, chat ring (100), mediaRev, shareSession`, `createdAt`, `lastActiveAt`.
- Room logic (`room.ts`) is plain TypeScript with an injected `Clock`, `Rng`, and a `send(participantId, msg)` sink. That keeps it unit-testable without sockets.
- Participant ids: `crypto.randomUUID()` (shortened to 12 hex chars for display-agnostic use). The `resumeToken` is a separate 24-byte random value, never broadcast.
- **Resume vs fresh join (revision 3).** If `room:join` carries a `resumeToken`, it is a resume attempt and nothing else: a token matching a participant of that room resumes it (password not required, `room_full` not applicable because the slot exists); any other token (unknown, revoked after kick, wrong room) returns `not_found` and never creates a participant, even in a room without a password. A deliberate join from the lobby omits `resumeToken` (the client clears the stored session on `room:closed`, `kicked`, `leave`, and any failed resume). Unit test: bad token on a no-password room → `not_found`, participant count unchanged.
- Join (fresh, no token): validates, checks password, checks `participants.size < maxParticipants` (disconnected-in-grace participants count) else `room_full`. Sends `room:joined` to the joiner and `participant:joined` to others. A system chat line "X joined 🌙" is added.
- Resume: a valid token replaces the old socket (the old socket closes with 4000 "replaced"), clears `disconnectedAt`, and replies `resumed: true` without a join announcement.
- Socket close: set `connected=false`, `disconnectedAt`, broadcast `participant:updated`. After `RECONNECT_GRACE_MS` (30 s), the participant is removed (`participant:left`, reason `timeout`) and a "left" system line is added. Explicit `room:leave` removes immediately.
- **Sweep timer:** one registry-level `setInterval` every `SWEEP_INTERVAL_MS` (default 1000; tests and the smoke script use 100). Each tick scans only rooms that have a pending deadline (a per-room `nextDeadline` min-heap or a `Set` of rooms with deadlines) and handles: reconnect-grace expiry, host-grace expiry, empty-room TTL, max age, unjoined-socket idle checks, and lockout cleanup. Worst-case latency of any deadline is therefore `SWEEP_INTERVAL_MS` (1 s by default), so host migration after a 10 s grace happens at 10–11 s. The timer is `unref()`ed and uses the injected `Clock`, so tests drive it with a fake clock.
- **Host migration:** if the host's socket is down for `HOST_GRACE_MS` (10 s), or the host leaves or is removed, the new host is the connected participant with the lowest `joinedAt`. Broadcast `host:changed{reason}`. Any host change (migration or `host:transfer`; the host cannot kick itself) also runs the **share teardown rule** below. **Playback freeze (revision 4):** when the host leaves, times out or is removed while `media.kind` is `youtube` or `local` and `playback.status==='playing'`, the server sets `playback = {rev: media.rev, status:'paused', positionSec: expectedPosition(playback, now), updatedAt: now}` and broadcasts `playback:state` to everyone (no `ref`) **before** `host:changed`, so followers stop extrapolating and a late joiner's snapshot agrees with live clients. If the playback is already paused, nothing is broadcast. (`host:transfer` by a live host does not freeze; the old host's player keeps playing and the new host's controls take over; if a share was active, `endShare` already paused playback.) A host that resumes later is a plain participant. If no connected participant remains, the room keeps the existing host id until the empty-room timer runs.
- **Share teardown rule (single function `endShare(room, why)`):** a share is "active" when `room.shareSession` is non-null, which is the case exactly when `media` is `kind:'screen'` or `kind:'local'` with `delivery:'stream'`. `endShare` sets `shareSession=null`, replaces `media` as follows: for `screen`, `media=null`; for `local` + `stream`, `media` becomes the same file with `delivery:'same-file'` and `playback` paused at the last known position (so the room can continue in same-file mode, fallback of flow B). It bumps `mediaRev`, and broadcasts `media:state`. It is called when: (1) `share:stop` from the host; (2) **the sharer's socket closes** (immediately, not after the grace; a reloaded host tab has lost its capture stream, so the session is dead anyway. The participant stays in grace and can `share:start` again after resuming, which is allowed because no share exists); (3) the sharer leaves, times out, or is kicked; (4) **any host change** (`host:transfer`, migration), since the sharer is always the host; (5) `media:set` (before applying the new media). Kick of the sharer is covered by (3). Because the old host can no longer send `share:stop` after a transfer, the **client** contract in section 9 (ShareBroadcaster watches the store) is what actually stops capture on the old host.
- Empty room: when `connected` count is 0 and grace has expired for all, the room is deleted after `EMPTY_ROOM_TTL_MS` (60 s, allowing a creator's page reload). `MAX_ROOM_AGE_MS` (12 h) deletes the room with `room:closed{expired}`.
- Host-only actions return `not_host`. Kicking removes the target, sends `kicked`, closes its socket with 4001, and adds a system line. The kicked participant's resume token is revoked. A kicked user can immediately rejoin with the password (if any); this is accepted for v1 and documented (no ban list). Transfer to a non-existent or disconnected id returns `invalid_state`; kick or transfer to self returns `invalid_state`.
- `room:settings`: rename, theme, set/clear password (`null` clears). Broadcast `room:settings`.
- Media: `media:set` (host) calls `endShare` if a share exists, bumps `mediaRev`, and sets the initial playback state deterministically: **`youtube` → `playing @ 0` with `updatedAt = now`** (followers blocked by autoplay see the "Tap to join" overlay), **`local` same-file → `paused @ 0`** (the host presses play once everyone has the file), `null` → media cleared, playback `paused @ 0`. Screen/stream media kinds are only creatable via `share:start`, never via `media:set`. A `media:set` whose media equals the current media (same videoId, or same file name/size/lastModified) is a no-op success (reply only, see the reply contract in section 4).
- **`share:start` rules (host only; the reply is `media:state` with `ref`, or `error` with `ref`):**
  1. Requires no active share, else `invalid_state`.
  2. `source:'screen'` is allowed from any current media (youtube, local, or none). It behaves like `media:set`: the queue is untouched, `mediaRev` is bumped, `playback` becomes `paused @ 0`, a new `sessionId` is created, `media = {kind:'screen', sharerId: host, sessionId, hasAudio}`. The previous media is not retained (the host can set it again after the share ends).
  3. `source:'file'` requires `media.kind==='local' && media.delivery==='same-file'` and `file.name`, `file.size`, `file.lastModified` equal to `media.file`, else `invalid_state`. It converts the media in place: same `file`, `delivery:'stream'`, plus `sharerId`/`sessionId`/`hasAudio`; `mediaRev` is bumped; `playback` is kept as it was (the host's element keeps its position).
  4. `playback:command` is accepted for `media.kind==='youtube'` or `media.kind==='local'` (both deliveries, including `stream`). With media `screen` or `null` it returns `invalid_state`. In stream mode the host's `LocalPlayer` keeps sending `play|pause|seek` exactly as in flow A, so `playback` always reflects the host's real position and `endShare`'s "paused at the last known position" is real. Viewers ignore `playback:state` while `delivery==='stream'` (they only render the incoming stream).
- `local:ready{rev, ready}` (any participant, accepted only while `media.kind==='local' && delivery==='same-file'` and `rev===media.rev`): sets `Participant.hasFile` and broadcasts `participant:updated`. **`hasFile` reset rule (revision 4):** all `hasFile` flags reset to false (with `participant:updated` broadcasts) only when the file identity changes: the new media is not `local`, or its `name`/`size`/`lastModified` differ from the previous `local` media. Conversions of the same file between `same-file` and `stream` (`share:start{source:'file'}` and `endShare`'s stream-to-same-file conversion) bump `mediaRev` but keep `hasFile`. `local:ready` is accepted only with `rev` equal to the current `media.rev`. Safety net on the client: whenever `media.rev` changes while the client's verified match still holds for the current file, it re-sends `local:ready{rev: newRev, ready:true}` (the server treats a repeat of the same value as a no-op without a broadcast). The host UI shows "N of M ready" and enables nothing automatically; pressing play stays the host's decision.
- Queue: `queue:add` (anyone; limit 50, a consecutive duplicate of the same videoId (same as the last queue item, or equal to the current media when the queue is empty) returns `invalid_state`; per-user limit 10 pending, `forbidden` beyond). If `media` is null and the queue is empty, the added video becomes the current media (`playing @ 0`). `queue:play{itemId}` (host) **removes that item from `queue`** and sets it as current media like `media:set` (`playing @ 0`). `media:ended{rev}` from the host with a matching rev pops the first queue item into `media` (`playing @ 0`) or, if the queue is empty, leaves the media in place with playback `paused` at `positionSec = media.durationSec ?? expectedPosition(playback, now)` (computed by the server; the message carries no position, and `durationSec` exists only for local media), then broadcasts `playback:state`. `media:error` behaves the same as ended, plus a system chat line "Skipped a video that couldn't be played 🙈". Ending a share (`endShare`) **never auto-advances** the queue and leaves the queue untouched; after a screen share, `media` is null and the host picks something.
- Game: see section 12. The server owns the `GameState` and sends per-recipient redacted views.
- Logging (`log.ts`): level from `LOG_LEVEL` (default `info`). Logs: server start/stop, connection counts (debug), room created/destroyed (info, code only, never passwords or chat text), rejects (warn: origin, rate limit), handler exceptions (error with stack). No message bodies at any level.

### Error handling matrix (server)
| Operation | Failure | Recoverable? | Caller receives | Log |
|---|---|---|---|---|
| Upgrade | bad Origin | no | HTTP 403 | warn |
| Upgrade | IP over limit | retry later | HTTP 429 | warn |
| Frame parse | not JSON, wrong shape | yes | `error bad_request` | debug |
| Frame | over 64 KiB | no | socket closed 1009 | warn |
| room:peek/join | code absent | yes | `not_found` | debug |
| room:join | wrong password | yes | `wrong_password` (after 5 fails `locked_out`) | info (code only) |
| room:join/create | room full / server full | yes | `room_full` / `server_busy` | info |
| host action by non-host | n/a | yes | `not_host` | debug |
| playback with old rev | n/a | yes | `stale` | none |
| rtc:signal invalid target | n/a | yes | dropped silently | debug |
| scrypt failure | rare | yes | `server_busy`, join not performed | error |
| Rate limit | n/a | yes | `rate_limited`, message dropped | warn on socket close |
| room:create / room:join while already in a room | n/a | yes | `invalid_state` | debug |
| share:start with an active share, or by a non-host | n/a | yes | `invalid_state` / `not_host` (with `ref`; client stops its capture tracks) | debug |
| Idle socket (no message 30 s, or 10 min unjoined) | n/a | yes (lazy reconnect on user action) | close 1008 | debug |
| In-room socket closed by rate-limit abuse (1008) or replaced (4000) | n/a | yes (user presses "Reconnect"; resume within the 30 s grace) | close 1008 / 4000; client shows `ReconnectBanner` with a Reconnect button | info |
| `game:action` with a malformed payload (`parseGameAction` returns null) | n/a | yes | `bad_request`, state unchanged | debug |
| `rtc:signal` with a bad `linkId`, oversize candidate, or stale `sessionId` | n/a | yes | dropped silently | debug |
| Resume with a token not matching a participant of that room (any room, with or without password) | n/a | yes | `not_found`; no participant is created; client clears the session and goes to the lobby | debug |
| share:start source `file` with media not matching same-file meta | n/a | yes | `invalid_state` (with `ref`; client stops its capture tracks) | debug |
| playback:command with media `screen` or null | n/a | yes | `invalid_state` | debug |
| Handler exception | n/a | yes | `bad_request` | error with stack |

---

## 7. Client room-state store (`src/lib/room/`)

- `reducer.ts`: a pure function `roomReducer(state, event)` where `event` is a `ServerMessage` or a local action (`connection`, `typing-expire`, `clear-error`). It is the single place that applies server messages to client state, so it is unit-testable.
- `roomStore.ts`: a minimal external store (`getState`, `subscribe`, `dispatch`), consumed with `useSyncExternalStore` in `useRoom(selector)`. It is not React state, so the sync controllers (YouTube, WebRTC, local video) read it imperatively and are not driven by re-renders.
- State shape:
```ts
interface RoomClientState {
  connection: ConnectionStatus; attempt: number;
  phase: 'idle'|'peeking'|'lobby'|'joining'|'in-room'|'ended';
  entered: boolean;                         // false until the user presses "Enter room"; only meaningful when phase==='in-room'
  peek?: RoomPeek; selfId?: string; snapshot?: RoomSnapshot;
  typing: Record<string, number>;           // participantId -> expiry ms
  lastError?: { code: ErrorCode|'network'; message: string };
  endedReason?: 'kicked'|'closed'|'left';
}
```
- `RoomProvider` (client component in `layout.tsx`) owns the transport, wires `onMessage -> dispatch`, and exposes actions (`createRoom`, `joinRoom`, `enter`, `leave`, plus typed senders such as `playbackCommand`, and `request`-based actions `setMedia`, `queueAdd`, `startShare` that return promises so the UI can show errors inline). A route change away from the room calls `leaveRoom()`. Un-ref'd `error` messages go to `lastError` and render as toasts (rules in section 4).
- **Reload resume (revision 3).** On every `room:joined` the provider writes `sessionStorage["moonie-session"] = {code, resumeToken}` (per tab). It is cleared on `leave`, `kicked`, `room:closed` and any failed resume. In `RoomShell`, at `phase:'idle'` for `/room/X`: if the stored `code` equals X, the shell first calls `joinRoom({code, resumeToken, displayName, avatar})` (name/avatar from `identity`). Success → `phase:'in-room', entered:true` (a creator who reloaded keeps host if within the 60 s empty-room TTL / 30 s grace). Any error (`not_found`, `wrong_password`, `room_full`, `forbidden`, network) → clear the stored session and continue with the normal `peeking → lobby` flow. A stored code different from X is cleared. Closing the tab lets the 30 s grace expire. **Strict Mode guard (revision 4):** React Strict Mode runs effects twice in development, which would send two `room:join` messages or call `leaveRoom()` twice. `RoomProvider` keeps `attemptKeyRef: string | null`; the `RoomShell` resume-then-peek effect and the leave-then-peek effect each call `provider.beginAttempt(code)`, which returns false (and the effect becomes a no-op) when `attemptKeyRef.current === code`. The key is cleared when `phase` returns to `idle` via leave, kicked, closed or a failed resume, so a deliberate later attempt for the same code works. As a second layer, `invalid_state` as the reply to a resume attempt means "already joined": the client ignores it and keeps its state. `leaveRoom()` is idempotent (a no-op when `phase==='idle'`).
- **Lobby state machine (client-only concept).** The server only knows "in a room or not". The client expresses the lobby with `phase` + `entered`:
  - Creator: `createRoom()` resolves `room:joined` → `phase:'in-room', entered:false`, and the router goes to `/room/CODE`. `RoomShell` renders `Lobby` while `!entered` (creator's lobby shows the invite link, participants, and "Enter room"). "Enter room" dispatches `{type:'enter'}` → `entered:true`.
  - Guest: opens `/room/CODE` with `phase:'idle'` → `peeking` → `lobby` (peek data shown, name/avatar picker, password field if `hasPassword`). "Enter room" calls `joinRoom()` → `joining` → `room:joined` → `phase:'in-room'` and `entered:true` directly (the press already was the "enter" action). A joined guest who reloads resumes into `in-room, entered:true`.
  - While in `lobby`/`peeking` the page re-peeks every 5 s while `document.visibilityState==='visible'` (a polling loop in `Lobby`, stopped on unmount). Password rooms show only the count (see `RoomPeek`). This is the "live peek", no server-side subscription exists.
  - Opening `/room/X` while joined to room Y (Y ≠ X): `RoomShell` first calls `leaveRoom()` (sends `room:leave`, resets controllers, waits for the store to reach `idle`), then peeks X. Opening `/room/X` while joined to X (same tab, e.g. after the create flow) just renders by `entered`.
  - Leaving the room page (route change) calls `leaveRoom()`; `entered` resets to false.
  - The server rejects `room:create`/`room:join` from an already-joined connection with `invalid_state` (AC17), so a client bug cannot create double membership.
- Failure handling in UI: `not_found` shows a cute "room not found" card with Home button and a code input. `wrong_password` keeps the password field with an inline error. `room_full` shows a message. Connection failure shows the reconnect banner and, if first connect fails, an error card with Retry.

---

## 8. YouTube sync

### URL parser (`src/lib/youtube/parse.ts`, pure)
`parseYouTubeUrl(input: string): { videoId: string; startSec?: number } | null`
- Trim. If it matches `^[A-Za-z0-9_-]{11}$`, treat it as a bare ID. Otherwise parse with `new URL` (prepend `https://` when the scheme is missing and the string looks like a host).
- Allowed hosts: `youtube.com`, `www.`, `m.`, `music.`, `youtube-nocookie.com`, `www.youtube-nocookie.com`, `youtu.be`. Anything else returns `null`.
- `youtu.be/ID`: first path segment. `/watch`: `v` param. `/shorts/ID`, `/embed/ID`, `/live/ID`, `/v/ID`: second segment. ID must match the 11-char regex. `t`/`start` param parses `90`, `90s`, `1m30s`, `1h2m3s` into seconds (applies only to the first play).
- Playlist-only links (`list=` without `v`) return `null` (out of scope).

### Loading the API (`loadApi.ts`)
A single module-level promise `loadYouTubeApi()`. It is idempotent, returns `window.YT` if already present, otherwise appends `<script src="https://www.youtube.com/iframe_api">` once and chains any pre-existing `window.onYouTubeIframeAPIReady`. It rejects after 10 s (blocked by an extension or offline), and the UI shows "Couldn't load YouTube" with Retry (resets the promise).

### Player (`useYouTubePlayer` + `YouTubePlayer`)
- `new YT.Player(el, { videoId, host: 'https://www.youtube-nocookie.com', playerVars: { enablejsapi:1, origin: location.origin, playsinline:1, rel:0, modestbranding:1, controls: isHost?1:0, disablekb: isHost?0:1, fs:0 }, events })`. Fullscreen is done by fullscreening our wrapper element (works for the host and followers with our own overlay controls). Whether `host:` is supported by the constructor is **[UNVERIFIED]**. If it fails in testing, fall back to the default host.
- The player is created once per `YouTubePlayer` mount and reused across videos with `loadVideoById`. Never recreated on re-render.
- Loading states: `unstarted/loading` shows a skeleton with a spinner until the first `PLAYING` or `CUED`.
- Errors via `onError` map: 2 invalid ID, 5 HTML5 player error, 100 not found or private, 101/150 embedding disabled by owner. The friendly text is shown on the stage, and the host's client sends `media:error{rev, code}` so the server skips to the next video.

### Time model
- The server stamps `playback.updatedAt` (server epoch ms). Client `serverNow() = Date.now() + clockOffset`.
- `expectedPosition(pb, serverNow) = pb.status==='playing' ? pb.positionSec + (serverNow − pb.updatedAt)/1000 : pb.positionSec` (`shared/playback.ts`, pure, tested). Clamped to `[0, duration]` when the duration is known.

### Host to server (latency compensation)
- Host UI actions arise from `onStateChange` (PLAYING/PAUSED) and seek detection. Seek detection: a host poll every 500 ms compares `getCurrentTime()` with the predicted `last + Δt` (only while PLAYING). The poll is suppressed while the player state is BUFFERING (a stall must not read as a seek) and for 1 s after resuming from it **[UNVERIFIED in a real browser]**. A jump above 1.0 s sends `seek`. While paused, a change of `getCurrentTime` between polls also sends `seek`.
- Each command carries `positionSec` as measured, and `hostServerTime = serverNow()` at measurement. The server computes `updatedAt = clamp(hostServerTime, now − 2000, now)` (falls back to `now` if missing). This removes the host's uplink delay from the timeline because followers extrapolate from the true measurement instant.
- The server broadcasts `playback:state`, and the host also receives it (and ignores it for control, the host is the source of truth locally).

### Follower sync loop (`syncController.ts`, runs every 1000 ms while a YouTube media is active, and immediately on each `playback:state`)
1. `expected = expectedPosition(playback, serverNow())`.
2. Status enforcement: if `playback.status==='paused'` and the player is PLAYING, call `pauseVideo()`. If `playing` and the player is PAUSED/CUED (and not the buffering/autoplay-blocked case), call `playVideo()`.
3. Drift: `drift = player.getCurrentTime() − expected`. If `|drift| > 1.5` call `seekTo(expected, true)`. Because the call itself causes events, a `suppress` flag with a 750 ms timeout ignores programmatic state changes.
4. YouTube only supports discrete playback rates (e.g. 0.25 steps), so there is no gentle rate-nudging for YouTube. Hard seek only. For local files the controller uses rate nudging between 0.3 s and 1.5 s (section 10).
5. After a seek, an extra 1.5 s cool-down avoids a seek storm while the video buffers.
6. Buffering: if the follower is BUFFERING, skip drift checks until it resumes.
- Autoplay blocking: after a `play`, if the player has not reached PLAYING within 2.5 s, show a "Tap to join 🍿" overlay. Tapping calls `playVideo()` inside a user gesture. Followers start with sound unmuted, and the overlay offers "Start muted" as an alternative. Browser autoplay policy behavior is **[UNVERIFIED across browsers]**.
- Late joiner: on `room:joined`, if `media.kind==='youtube'`, `loadVideoById({videoId, startSeconds: expected})`, then the loop corrects. The player is created after the API loads.
- Media change: on `media.rev` change, load the new video, reset the suppress state.
- Host disconnect or migration: the server freezes playback and broadcasts `playback:state{status:'paused', positionSec: expectedPosition}` before `host:changed` (section 6 "Playback freeze"); followers apply it like any `playback:state`. A newly promoted host's UI switches controls to the host mode (`controls:1` requires a player reload; accepted: recreate the player once on host change, then `loadVideoById` at the expected position).

### Queue
`QueuePanel`: add input (any participant) with parse feedback, a list with thumbnail `https://i.ytimg.com/vi/ID/mqdefault.jpg`, title (lazy via `https://www.youtube.com/oembed?url=...&format=json`, the CORS behavior of this endpoint is **[UNVERIFIED]**; failure leaves the placeholder title). The host gets play-now, remove, up/down reorder buttons (no drag-and-drop dependency). Others can remove their own items.

---

## 9. WebRTC screen share (`src/lib/webrtc/`)

### Topology and roles
Star topology: the sharer (always the host, per A2) holds one `RTCPeerConnection` per viewer. The sharer is the **impolite** peer and viewers are **polite**. Only the sharer adds tracks. A viewer never initiates media, but the handler implements the full perfect-negotiation pattern so renegotiation (track added, ICE restart) races are safe.

### ICE configuration (`iceConfig.ts`)
`getIceServers()` builds from env: `NEXT_PUBLIC_STUN_URLS` (comma list, default `stun:stun.l.google.com:19302`), and when `NEXT_PUBLIC_TURN_URL` (comma list allowed) is set, `{urls, username: NEXT_PUBLIC_TURN_USERNAME, credential: NEXT_PUBLIC_TURN_CREDENTIAL}`. `iceCandidatePoolSize: 0`, `bundlePolicy: 'max-bundle'`. README warns that `NEXT_PUBLIC_*` values are visible to every visitor, so static TURN credentials are exposed (use a TURN account with limited quota, or later swap to short-lived credentials from an API route).

### Session flow
1. Host clicks Share screen. The `ShareBroadcaster` calls `getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true })` first (the user gesture is required). It immediately attaches an `ended` listener to the video track, then calls `transport.request({type:'share:start', source:'screen', hasAudio})`. **If the request rejects** (`not_host`, `invalid_state`, `timeout`, `bad_request`), the broadcaster stops every captured track (which clears the browser's capture indicator), discards the stream, and surfaces an inline error ("Couldn't start sharing: <friendly text>") in `ScreenSharePanel`. On success the reply is a `media:state` whose `media.sessionId` becomes `ownSessionId`.
   - **Server-driven teardown (store subscription).** `ShareBroadcaster` subscribes to the room store. Whenever the snapshot's `media` is not (`screen` or `local`+`stream`) with `sessionId === ownSessionId` after having been set (cases: `share:stop` echoed, `media:set` by the host, host transfer, host migration, server cleaned up because this socket dropped, kick), it stops all tracks, closes every `PeerLink`, clears pending timers, and shows a toast ("Screen sharing ended" with the reason when known from the `host:changed`/`kicked` event). The same happens on `room:closed`, `kicked`, `leaveRoom`, and component unmount. This is what makes handover work: after `host:transfer` the old host (no longer allowed to send `share:stop`) sees `media` change and tears down locally, and the new host can start a new share.
   - A reconnect (new socket, `resumed:true`) while sharing: the server already ended the share when the old socket closed (section 6), so the resumed snapshot has `media:null` and the broadcaster tears down by the rule above. The host must press Share again.
2. Each viewer, on seeing a `media` of kind `screen` (or local `stream`), creates a `ShareViewer`. The `ShareViewer` generates a fresh `linkId` (`crypto.randomUUID()` with dashes removed, 32 chars), creates its own new `PeerLink` bound to that `linkId` (closing any previous one first), and only then sends `rtc:signal{to: sharerId, sessionId, linkId, data:{t:'viewer-ready', reason:'initial'}}`. This covers late joiners (the snapshot includes the media) and reconnecting viewers (the snapshot arrives on resume).
3. On `viewer-ready` the broadcaster keeps one entry per viewer, `links: Map<viewerId, {linkId, link: PeerLink}>`. A `viewer-ready` whose `linkId` differs from the stored one (always the case on a retry) closes and discards the old `PeerLink` and creates a **new** `PeerLink` (new `RTCPeerConnection`) keyed by `(viewerId, linkId)`. A repeat of the same `linkId` is ignored. The broadcaster then adds all tracks, and sets `contentHint` (`'detail'` for screen, `'motion'` for file streams). `onnegotiationneeded` creates and sends the offer. Sender bitrate cap `maxBitrate` 2.5 Mbps via `RTCRtpSender.setParameters` for video. Whether the browser applies it is **[UNVERIFIED]**.
4. The viewer answers. ICE candidates flow in both directions as `rtc:signal` candidates. `ontrack` assigns `event.streams[0]` to the `<video srcObject>` (muted + `playsInline` + `autoplay`, with an unmute button, since autoplay with sound can be blocked).
5. Stop: the host clicks Stop or the video track fires `ended` (browser's native "Stop sharing"). The broadcaster stops tracks, closes all links, and sends `share:stop` (fire-and-forget; if it is lost, the server still ends the share when the socket closes or the host changes). The server calls `endShare` and broadcasts `media:state`. Viewers close their link when `media` changes or `sessionId` differs.

### `PeerLink` (perfect negotiation, one per remote peer)
```ts
class PeerLink {
  pc: RTCPeerConnection; makingOffer=false; ignoreOffer=false; isSettingRemoteAnswerPending=false;
  pendingCandidates: RTCIceCandidateInit[] = [];
  // `linkId` identifies this RTCPeerConnection pair; `signal` stamps it onto every outgoing rtc:signal. The sharer is impolite, the viewer is polite.
  constructor(readonly linkId: string, private polite: boolean, private signal: (d: RtcSignalData) => void, ice: RTCConfiguration) {}
  // handlers
  onnegotiationneeded = async () => { try { makingOffer = true; await pc.setLocalDescription(); signal({t:'description', description: pc.localDescription}); } catch (e) { log } finally { makingOffer = false; } };
  onicecandidate = ({candidate}) => signal({t:'candidate', candidate: candidate ? candidate.toJSON() : null});
  async handle(data) {
    if (data.t === 'description') {
      const d = data.description;
      const readyForOffer = !makingOffer && (pc.signalingState === 'stable' || isSettingRemoteAnswerPending);
      const collision = d.type === 'offer' && !readyForOffer;
      ignoreOffer = !polite && collision;
      if (ignoreOffer) return;
      isSettingRemoteAnswerPending = d.type === 'answer';
      await pc.setRemoteDescription(d);               // implicit rollback when polite
      isSettingRemoteAnswerPending = false;
      await flushCandidates();                        // add queued candidates now that remoteDescription exists
      if (d.type === 'offer') { await pc.setLocalDescription(); signal({t:'description', description: pc.localDescription}); }
    } else if (data.t === 'candidate') {
      if (!pc.remoteDescription) { pendingCandidates.push(data.candidate); return; }   // candidate queueing
      try { await pc.addIceCandidate(data.candidate ?? undefined); } catch (e) { if (!ignoreOffer) log; }
    }
  }
}
```
**Link identity (revision 4).** Browsers reject a changed remote DTLS fingerprint on an established `RTCPeerConnection`, so a retry cannot reuse any existing connection on either side. Rules: (1) every `rtc:signal` carries `linkId`, and the server relays it unchanged. (2) The viewer generates a fresh `linkId` for each `viewer-ready` (initial and retry) and closes and recreates its own `PeerLink` **before** sending it. (3) The sharer's link for a viewer is keyed by `(viewerId, linkId)`. (4) Both sides drop any inbound `description` or `candidate` whose `linkId` is not the current one for that peer (the viewer has one current `linkId`; the sharer has one per viewer). Late ICE candidates from a discarded link are therefore ignored. (5) ICE restart (`restartIce()`) happens inside one link and keeps its `linkId`. The `ShareBroadcaster`/`ShareViewer` own the `linkId` bookkeeping; `PeerLink` itself only stores its own `linkId` and the dispatcher compares before calling `handle`.

Candidate queueing: candidates that arrive before `remoteDescription` is set are buffered per link and flushed right after `setRemoteDescription` resolves. The queue is cleared on `close()`. A null candidate (end-of-candidates) is passed as `undefined`. `setLocalDescription()` without arguments relies on browser support for implicit descriptions **[UNVERIFIED for older Safari; fall back to `createOffer`/`createAnswer` in a `try`]**.

### Failure and ICE restart
- Sharer side `pc.oniceconnectionstatechange`/`onconnectionstatechange`: on `disconnected`, wait 4 s. If it has not recovered, or on `failed`, call `pc.restartIce()` (this fires `negotiationneeded`, and the offer carries new ICE credentials). At most 2 restarts, each with a 10 s window. After that the link is closed and the sharer waits for the viewer's retry.
- Viewer side: if not `connected` within 15 s of `viewer-ready`, or on `failed`, show "Reconnecting…", auto-retry once: close the current `PeerLink`, generate a new `linkId`, create a new `PeerLink`, then send `viewer-ready{reason:'retry'}` with the new `linkId` (the sharer replaces its link as in flow step 3), then show a manual "Try again" button. The viewer sees an error message mentioning that strict networks may need a TURN server.
- Cleanup: on participant leave (`participant:left`), the sharer closes that link. On `room:joined` replacement and on unmount, everything is closed and the media tracks are stopped. A `beforeunload` handler also stops tracks.
- Late joiners need nothing special beyond `viewer-ready` (see flow step 2). Viewers who leave and rejoin get a new link.
- Session guards: every inbound signal whose `sessionId` is not the active one is ignored, and every inbound `description`/`candidate` whose `linkId` is not the current link for that peer is ignored (see "Link identity"). `viewer-ready` is the only signal that may introduce a new `linkId`, and only the sharer accepts it.
- Client-side size guard: outbound candidates over the server caps (2048 / 256 chars) are not sent (they would be dropped anyway); the unit test covers it.

### Capture errors (`capture.ts`)
`startDisplayCapture()` returns a discriminated result:
- `navigator.mediaDevices?.getDisplayMedia` missing → `{ok:false, reason:'unsupported'}`. The UI explains "Screen sharing isn't available in this browser (most phones can't share their screen). You can still watch!"
- `NotAllowedError` → `denied` (friendly text, no log above debug).
- `NotFoundError`/`AbortError` → `cancelled`.
- Other → `error` with the message.
- Audio: tab audio is available in Chromium, system audio on Windows Chromium; Firefox and Safari usually give no audio. UI states "Audio: on/off" after capture.
- Secure context: `getDisplayMedia` requires HTTPS or localhost. The UI checks `window.isSecureContext`.
- Browser-specific support claims here are **[UNVERIFIED]** until tested on real browsers.

---

## 10. Local files

### Selection and validation (`src/lib/localfile/`)
- `FileDropzone`: `<input type=file accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov">` and drag/drop. Reads `file.type` or infers from the extension (a `.mov` often has an empty type).
- `canPlayType` check: create a detached `<video>`, call `canPlayType(mime)`. `''` means unsupported. Show "This browser can't play .mov files. Try MP4 or WebM." The file is also verified at `loadedmetadata` (error event means message and reset). Size cap for UI hashing only, no cap on playback.
- Blob URL via `URL.createObjectURL(file)` is local-only and revoked on change/unmount. It is never put into any message, and the server validation rejects any `blob:` string in `LocalFileMeta.name` (no URLs accepted in the schema at all).
- Quick hash (`hash.ts`): SHA-256 over `[first 1 MiB][last 1 MiB][size as 8 bytes]` using `crypto.subtle.digest` (needs a secure context, otherwise the hash is omitted and name+size are used). Hex lowercase. Runs on `file.slice(...).arrayBuffer()`.

### Flow A: "Everyone picks the same file" (default, always available)
1. Host picks a file, the meta (name, size, lastModified, mime, duration, hash) is sent with `media:set{kind:'local', delivery:'same-file'}`.
2. Participants see a card: "Moonie host is watching **filename (size)**. Pick the same file from your device to watch together. Your file never leaves your device." plus a dropzone.
3. `verifyLocalFile(local, hostMeta)` (pure): if both hashes are present, match iff hashes are equal and sizes are equal. Otherwise match iff `size` equals and the normalized `name` equals (case-insensitive). `lastModified` is informational only. Result states: `no-file | checking | match | mismatch`. A mismatch shows "That doesn't look like the same file" and offers "Watch anyway (may be out of sync)" (explicit override).
4. After `match`, the follower's `LocalPlayer` joins the same sync loop as YouTube (with `expectedPosition`), hard seek above 1.5 s, and gentle rate nudging `playbackRate = 1 ± 0.05` for drift in 0.3 s–1.5 s, restoring 1.0 within 0.2 s. The browser clamps the rate (valid range includes 0.95/1.05 **[UNVERIFIED]**).
4b. **Readiness signal.** When `verifyLocalFile` reaches `match` (or the user chooses "Watch anyway"), the follower sends `local:ready{rev, ready:true}`; clearing or replacing the file sends `ready:false`. The host's panel shows "N of M ready" with a checkmark per participant (`Participant.hasFile`), so the host knows when to press play. The flag survives same-file/stream conversions of the same file; whenever `media.rev` changes while the follower's match still holds, the client re-sends `local:ready{rev: newRev, ready:true}` (section 6 `local:ready`).
5. The host's `LocalPlayer` shows full custom controls and sends `playback:command` for play, pause, seek (using the `seeked` event), with the same rev and `hostServerTime` logic as YouTube. Followers have play/pause locked (a lock icon with "Host controls playback"), but they have volume, mute and fullscreen.

### Flow B: "Stream from host" (captureStream, optional on capable browsers)
1. Host toggles "Stream from my device" (visible only if `typeof HTMLMediaElement.prototype.captureStream === 'function'` or `mozCaptureStream`; otherwise a note says "Your browser can't stream a file directly. Using the same-file mode instead.").
2. `captureStream.ts`: `const stream = video.captureStream?.() ?? video.mozCaptureStream?.()`. Wait up to 2 s for at least one video track (tracks may appear after playback starts, so listen for `onaddtrack`). If there are none, fall back to Flow A with a toast explaining why.
3. Reuses `ShareBroadcaster` with `source:'file'`: `request({type:'share:start', source:'file', file, hasAudio})` (rejection stops the captured tracks and keeps flow A; same teardown subscription as screen share). The `file` meta (name, size, lastModified) must equal the current same-file `media.file`, else the server returns `invalid_state` (section 6 rules). The server converts the media in place to `media{kind:'local', delivery:'stream', sharerId, sessionId}`. Viewers get the stream via the same `viewer-ready` flow and render it in `ScreenView` with a "Streaming from host's file" label (not LIVE red but a "Streaming 🎞️" badge).
4. In stream mode, the host's own controls (play/pause/seek) are the source of truth, since the captured tracks mirror the element. The host's `LocalPlayer` keeps sending `playback:command` so the server's position stays current (needed for the fallback below); viewers ignore `playback:state` while `delivery==='stream'`. Viewers have no controls (volume and fullscreen only). When the host turns streaming off (`share:stop`), the server's `endShare` converts the media to the same file with `delivery:'same-file'`, paused at the last known position, so the room continues in flow A with no extra message. The same fallback applies if the host's socket drops, host changes, or the host's tab reloads (the session is dead; the new/resumed host sees the same-file card and can start streaming again). When the host picks a different file, it sends `media:set` (which also calls `endShare`).
5. Caveats displayed in the UI info popover: Chromium and Firefox are supported, Safari is limited or unsupported; quality depends on the host's upload bandwidth; works best with up to about 4 viewers. Behavior of muting the source element and its effect on captured audio is **[UNVERIFIED]**: the host element is not muted programmatically, and the host uses the volume slider only.
6. Fallbacks: if the sharer's link fails for a viewer repeatedly, the viewer's card suggests "Pick the same file instead" (offered only if the host's meta is available, which it is).

### Optional (not implemented in the base phase)
DataChannel chunked transfer is explicitly deferred.

---

## 11. Chat (`src/components/chat/`)

- Send: `chat:send{text}`. The server sanitizes (trim, strip control chars, collapse newlines to a space, 500 char cap), builds `ChatMessage{id: randomUUID, from, name, avatar (from the participant at send time), text, ts: Date.now()}`, appends it to the ring buffer (100), and broadcasts to all, including the sender (single code path; no optimistic append, so ordering is consistent).
- System messages: join, leave, kick, host change, and "skipped video", as `kind:'system'`, produced by the server.
- Typing: `chat:typing{typing:true}` is sent on input, throttled to one per 2 s. `typing:false` is sent on send, blur, or after 3 s of idle. Clients keep `typing[id] = now + 4000` and prune with a 1 s timer, so a lost "false" expires on its own. The server relays to others (not to the sender) and clears typing on disconnect or on the participant's message.
- UI: `MessageBubble` (own messages on the right in accent, others on the left with avatar and name, timestamps via `Intl.DateTimeFormat`, system lines centered and small). `MessageList` auto-scrolls when within 80 px of the bottom, otherwise shows a "↓ New messages" pill that jumps to latest. `EmojiPicker` is a popover with about 80 static emojis in 6 categories, inserting at the caret. Messages render as React text children (no `dangerouslySetInnerHTML`; URLs are not auto-linked in v1).
- Online count: `participants.filter(connected).length` shown in the sidebar header.
- Unread badge on the Chat tab when it is not active.

---

## 12. Games (`shared/games/`, pure reducers)

### Common contract
```ts
export interface Actor { id: string; name: string; avatar: AvatarId; isHost: boolean }
export type Result<S> = { ok: true; state: S } | { ok: false; error: string };   // no events field; clients derive animations from state (rollId, lastMove)
// GameKind, Color, Choice, Seat, GameAction, GameView, RpsView are defined in shared/games/types.ts (see section 4)
// each game exports: create(): State; reduce(state, action, actor, rng: () => number): Result<State>;
//   removePlayer(state, playerId): State; view(state, viewerId): GameView  (redaction)
// GameKind and GameAction are NOT redefined here; section 4 / shared/games/types.ts is the only definition (revision 4).
```
- `reduce` is pure. All randomness comes through the injected `rng` (server passes a CSPRNG-backed float generator, tests pass fixed sequences). The client never sends dice values.
- Server (`handlers/game.ts`): `game:open{kind}` only when `room.game` is null (else `invalid_state`), `game:close` (host or seated player), `game:action` → `parseGameAction(room.game.kind, raw)` (section 4; `null` → `bad_request`, nothing changes) → `reduce`. On `ok:false` the sender receives `error{invalid_state|forbidden, message}` and nothing is broadcast. On success, the new state is stored and `game:state` is sent to each recipient as `view(state, thatId)`.
- Participant removal calls `removePlayer`. If the game would be left with too few players, it ends gracefully (a winner by forfeit for Ludo or TTT, back to the lobby phase for RPS).
- Client: `GamesPanel` renders `GameView` and dispatches `game:action`. The client never mutates the game state locally (it may run `reduce` read-only to show legal-move hints, using the Ludo `legalMoves()` export).

### Tic-Tac-Toe
```ts
interface TttState { kind:'tictactoe'; board: (null|'X'|'O')[]; /*9*/ seats: { X: Seat|null; O: Seat|null };
  turn: 'X'|'O'; status: 'waiting'|'playing'|'won'|'draw'; winner: 'X'|'O'|null; line: number[]|null;
  scores: { X:number; O:number; draws:number }; starter: 'X'|'O' }
type TttAction = {type:'sit'; mark:'X'|'O'} | {type:'leaveSeat'} | {type:'move'; index:number} | {type:'restart'}
```
Rules: `sit` on a free mark (a participant cannot hold both, otherwise error). When both seats are filled the status becomes `playing`. `move` requires status `playing`, actor is the owner of the `turn` mark, `index` an integer 0..8, and the cell is null. After a move, check the 8 lines for a win (status `won`, `line`, score +1), otherwise if the board is full, `draw`. `restart` (any seated player or the host) resets the board, alternates the starter, and keeps scores and seats. Spectators are anyone unseated. `removePlayer` of a seated player during `playing` awards the win to the opponent; seats are cleared.

### Rock-Paper-Scissors
```ts
interface RpsState { kind:'rps'; phase:'lobby'|'choosing'|'revealed'; round:number;
  players: { id:string; name:string; avatar:AvatarId; score:number }[];   // 2..8
  picks: Record<string, 'rock'|'paper'|'scissors'>;                      // server-side; redacted in views
  result: null | { winners: string[]; losers: string[]; winningChoice: Choice|null; draw: boolean; reveal: Record<string, Choice> } }
type RpsAction = {type:'join'}|{type:'leave'}|{type:'start'}|{type:'pick'; choice:Choice}|{type:'next'}|{type:'resetScores'}
```
Rules: `join` allowed in `lobby` or between rounds (phase `revealed`), up to 8. `start` requires ≥ 2 players, so the phase becomes `choosing` and round increments. `pick` is allowed only for players during `choosing`, and may be changed until everyone has picked. When the picks count equals the player count, the round resolves automatically to `revealed`. Resolution (pure `resolveRound(picks)`): distinct set size 1 or 3 means draw (no points). Size 2 means the choice that beats the other wins, every player with that choice scores +1, and the others lose. `next` (any player) starts a new `choosing` round. `view()` for another viewer replaces each pick during `choosing` with `'locked'` (true/false only for self: the viewer sees their own pick and the locked/pending state of the others), and reveals all in `revealed`. If a player leaves mid-round, their pick is dropped, and if ≥ 2 players remain and all have picked, it resolves. With fewer than 2 players, the phase returns to `lobby`.

### Ludo
Board geometry and rules (constants in `ludo.ts`, shared by the server and the SVG renderer):
- 4 colors in turn order: `red, green, yellow, blue`. The 52-square main track is indexed 0..51 clockwise. Start squares: `START = {red:0, green:13, yellow:26, blue:39}`. Safe squares: the 4 start squares and `start+8` of each (8, 21, 34, 47), 8 in total.
- Piece progress `p` per piece: `-1` in base, `0..51` on the main track (absolute square `(START[color]+p) % 52`), `52..56` the 5 home-column cells, `57` finished (center). Total 4 pieces per color.
```ts
interface LudoState { kind:'ludo'; phase:'lobby'|'playing'|'finished';
  seats: { color: Color; playerId: string|null; name: string; avatar: AvatarId; active: boolean }[]; // 4
  pieces: Record<Color, [number,number,number,number]>;
  turn: Color|null; dice: number|null; rollId: number; sixesInRow: number; winner: Color|null;
  lastMove: { color:Color; piece:number; from:number; to:number; captured: {color:Color;piece:number}[] } | null; log: string[] /* capped at LUDO_LOG_MAX = 20; oldest entries are dropped on push */ }
type LudoAction = {type:'sit'; color:Color}|{type:'leaveSeat'}|{type:'start'}|{type:'roll'}|{type:'move'; piece:number}|{type:'restart'}
              | {type:'skipTurn'}   // `skipTurn` is dispatched only by the server sweep, never by a client, and never by the host. `parseGameAction` does not accept it, so a client sending it gets `bad_request`
```
- `sit`: a free color seat in `lobby` (or a spectator joining before start). One seat per participant. `start`: ≥ 2 occupied seats, host or seated player. Only occupied seats are `active`. First turn goes to the first active color in order.
- `roll`: only the actor owning `turn`, only when `dice===null`. `value = 1 + floor(rng()*6)`, `rollId++`. If `value===6`, `sixesInRow++`; if `THREE_SIXES_FORFEIT` and that reaches 3, the move is forfeited (dice shown, then turn passes, `sixesInRow=0`). Otherwise compute `legalMoves(state, color, value)`. If the set is empty, the turn passes automatically (to the next active color, with `sixesInRow=0`; if the value was 6 the same player does not roll again, since no move was made). The roll result and the auto-pass are published in one state update with `lastMove=null` and a `log` line.
- `legalMoves`: a piece in base (`p===-1`) can move only with a 6, to `p=0`. A piece on the track or home column can move to `p+value` if `p+value ≤ 57` (**exact roll to finish**: overshoot is illegal). A destination occupied by the player's own piece is allowed (stacking, no blocks in v1; documented).
- `move{piece}`: legal only if `dice!==null` and the piece is in `legalMoves`. Apply it. Capture: if the destination `p` is on the main track (0..51), the absolute square is not safe, and one or more opponent pieces occupy that absolute square, they all return to base (`-1`). Landing on a safe square never captures (coexistence). Home-column squares are private to each color, so no captures there. If all 4 pieces of the color are at 57, the phase becomes `finished` and `winner` is set. Otherwise: if `dice===6`, the same player rolls again (`dice=null`, `turn` unchanged), else the turn passes to the next active color and `sixesInRow=0`. Reset `dice=null`.
- `restart`: only when `finished` (or host anytime): reset pieces, keep seats, phase `playing`, turn to the first active color.
- `removePlayer` (participant leaves): the seat becomes `active:false` and its pieces are removed from the board. If it was their turn, the turn passes. If only one active seat remains in `playing`, that seat wins by forfeit.
- Player at the 3rd six of a row loses the move: house rule A5 (beyond the brief's rule list), controlled by `THREE_SIXES_FORFEIT` (default `true`), documented in the UI help. The unit test for it is skipped when the constant is false.
- Disconnected turn owner: a seated player whose socket is down stalls the game up to `RECONNECT_GRACE_MS` (30 s), after which `removePlayer` runs. To avoid a long stall, the server auto-passes the turn (a `{type:'skipTurn'}` action; as stated above it is dispatched only by the server sweep, never by a client, and never by the host) when the turn owner has been disconnected for 15 s (`TURN_SKIP_MS`, checked by the sweep). The seat stays occupied if the player resumes.
- Renderer: an SVG board with a 15×15 grid mapping (`TRACK_COORDS[52]`, `HOME_COLUMN_COORDS[color][5]`, `BASE_COORDS[color][4]`, `FINISH_COORDS[color]`) generated from constants in `ludo.ts` (a pure `pieceCoord(color, piece, p)` helper, unit-tested for being a bijection of track squares). Motion animates piece movement and the dice (a rolling tumble keyed by `rollId`). Legal pieces are highlighted and clickable only for the current player. If exactly one legal move exists, a "Move!" nudge is shown but there is no auto-move (keeps behavior explicit).

---

## 13. Theming & design tokens

### Palette (CSS variables as RGB triples in `globals.css`, consumed as `rgb(var(--x) / <alpha-value>)` in `tailwind.config.ts`)
| Token | Light | Midnight (`.dark`) |
|---|---|---|
| `--bg` (page) | cream `255 248 236` | `23 20 43` |
| `--surface` (cards) | soft white `255 253 251` | `33 29 61` |
| `--surface-2` | `250 240 255` | `43 38 80` |
| `--ink` (text) | `74 60 99` | `241 235 255` |
| `--ink-soft` | `122 108 150` | `183 174 219` |
| `--pink` | `255 175 204` (pastel pink) | `255 156 200` |
| `--lavender` | `205 180 219` | `183 156 255` |
| `--blue` | `189 224 254` (baby blue) | `142 197 255` |
| `--purple` | `184 164 240` (light purple) | `160 138 235` |
| `--accent` / `--accent-2` | pink / lavender (overridden per room theme) | same roles |
| `--ring` | `184 164 240 / 0.6` | `183 156 255 / 0.6` |
Contrast of `--ink` on `--surface` meets ≥ 4.5:1 in both modes. Accent buttons use dark ink text, not white on pastel (to keep contrast).

- Radii: cards `rounded-3xl` (24 px), buttons `rounded-full`, inputs `rounded-2xl`. Soft shadows `0 10px 30px -12px rgb(var(--purple) / .45)`. Gradients: `bg-gradient-to-br from-pink/40 via-lavender/30 to-blue/40` backdrop with blurred blobs.
- Fonts: `Quicksand` (headings, `--font-display`) and `Nunito` (body, `--font-body`) through `next/font/google` with CSS variables on `<html>`.
- Decorations: `FloatingDecor` renders about 14 absolutely positioned emoji/SVG items (💖 ⭐ ✨ ☁️ 🌙) with Motion float loops, randomized with a seeded array (deterministic, so SSR/CSR match). Hidden or static when `prefers-reduced-motion` (through `useReducedMotion` and a CSS `@media (prefers-reduced-motion: reduce)` rule that disables Tailwind animations).

### Dark mode, no flash
- Tailwind `darkMode: 'class'`. `<html lang="en" suppressHydrationWarning>`. An inline `<script>` placed first in `<head>` through `dangerouslySetInnerHTML` (string from `themeScript.ts`):
```js
(function(){try{var s=localStorage.getItem('moonie-theme');var d=s==='dark'||((!s||s==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();
```
- `useTheme` (client): state `'light'|'dark'|'system'`, initialized in `useEffect` from localStorage (so SSR markup matches), writes the key, and toggles the class. `ThemeToggle` renders an icon placeholder until mounted, to avoid hydration mismatch.
- The CSP allows this inline script by `'unsafe-inline'` in `script-src` (see section 15 for the trade-off).

### Room themes (`shared/constants.ts` ids, `roomThemes.ts` visuals)
Each room theme sets `data-room-theme` on the room root and overrides `--accent`, `--accent-2`, the stage backdrop gradient, and the decoration emoji set, for light and dark:
| id | label | accent | decor |
|---|---|---|---|
| strawberry | Strawberry Milk 🍓 | pink | 🍓💖✨ |
| lavender | Lavender Dream 💜 | lavender | 💜🦋✨ |
| cloud | Cloud Nine ☁️ | baby blue | ☁️🫧⭐ |
| vanilla | Vanilla Latte 🧁 | cream and peach | 🧁🌼✨ |
| starlight | Starlight Sleepover 🌙 | light purple | 🌙⭐💫 |
| bubblegum | Bubblegum Pop 🫧 | pink + blue | 🫧🎀💖 |
The theme is part of the room snapshot, so a host theme change updates everybody live.

---

## 14. Component tree (client)

```
RootLayout (fonts, theme script, <Providers>)
├─ Providers: ThemeProvider, ToastProvider, RoomProvider (transport + store)
├─ page.tsx (landing): Navbar(ThemeToggle, buttons) · Hero(FloatingDecor, CTA buttons)
│     · FeatureCards · HowItWorks · Footer · CreateRoomModal · JoinRoomModal
└─ room/[code]/page.tsx → <RoomShell code>
     ├─ ErrorBoundary → ErrorState
     ├─ phase idle/peeking/lobby/joining, or (phase in-room and !entered) → Lobby (room name/theme, host, participant avatars
     │                               (count only for password rooms), ProfilePicker, PasswordField, EnterButton,
     │                               5 s re-peek loop, error cards)
     └─ phase in-room and entered →
         RoomThemeBackdrop
         RoomHeader (room name, code chip, InviteButton, SettingsDialog trigger, ThemeToggle, Leave)
         ReconnectBanner
         ├─ Main column: MediaStage
         │     ├─ SourceSelector (tabs: YouTube | Screen | Local file)
         │     ├─ YouTubePlayer (+ FollowerOverlay: volume, mute, fullscreen, "Tap to join" overlay, host-controls lock)
         │     │   + QueuePanel / ScreenSharePanel + ScreenView
         │     └─ LocalFilePanel (FileDropzone, LocalPlayer, PlayerControls)
         ├─ Sidebar (desktop tabs: Chat | People | Queue | Games): ChatPanel, ParticipantList, QueuePanel, GamesPanel
         └─ MobileTabBar (bottom: Watch | Chat | People | Queue | Games), panels shown one at a time
```
Layout: desktop ≥ 1024 px is a two-column grid `[1fr, 360px]`. Tablet and mobile show the stage on top with the tabbed panel below, and on mobile a fixed bottom tab bar. Host-only controls (change media, settings, kick, transfer, share) are hidden or disabled for guests, with a tooltip. The permission checks that matter are on the server.

`SettingsDialog` (host): rename room, change theme, set/clear password, per-participant kick and "make host". Guests see a read-only summary.

---

## 15. Environment variables, Vercel, headers

### Next app (`.env.example`)
```
# WebSocket URL of the deployed signaling server (wss:// in production). Required.
NEXT_PUBLIC_SIGNALING_URL=
# Optional ICE configuration
NEXT_PUBLIC_STUN_URLS=stun:stun.l.google.com:19302
NEXT_PUBLIC_TURN_URL=
NEXT_PUBLIC_TURN_USERNAME=
NEXT_PUBLIC_TURN_CREDENTIAL=
# Optional: base URL for invite links (default: current origin)
NEXT_PUBLIC_SITE_URL=
```
`.env.development` (committed, dev only) sets `NEXT_PUBLIC_SIGNALING_URL=ws://localhost:8787`. `NEXT_PUBLIC_*` values are inlined at build time, so changing them requires a redeploy.

### Signaling server (`signaling-server/.env.example`)
`PORT=8787`, `ALLOWED_ORIGINS=https://your-app.vercel.app` (required, fail closed; exact origin only. The README shows `https://*.vercel.app` as an optional extra line for preview deployments, with a warning that it admits every site hosted on vercel.app), `ALLOW_NO_ORIGIN=false`, `MAX_ROOMS=300`, `ROOM_MAX_PARTICIPANTS=8`, `MAX_CONNECTIONS_PER_IP=20`, `TRUST_PROXY_HOPS=1` (number of trusted proxies in front; 0 for local dev, 1 on Render/Railway/Fly; replaces the old `TRUST_PROXY` boolean), `LOG_LEVEL=info`, `RECONNECT_GRACE_MS=30000`, `HOST_GRACE_MS=10000`, `EMPTY_ROOM_TTL_MS=60000`, `MAX_ROOM_AGE_MS=43200000`, `SWEEP_INTERVAL_MS=1000`, `TURN_SKIP_MS=15000`, `IDLE_MS=30000` (no-message limit for sockets not in a room), `UNJOINED_MAX_MS=600000` (10 min cap for sockets not in a room). Config parsed and validated in `config.ts` (invalid numbers fall back to defaults with a warning).

### Scripts
Root `package.json`: **`setup` (`npm install && npm --prefix signaling-server install`, revision 4; the README quick start is `npm run setup`, then `npm run dev:all`, because `dev:all` fails on a fresh clone without `signaling-server/node_modules`. There is deliberately no `postinstall` hook, since it would also run on Vercel and try to install the server's dependencies there.)**, `dev` (next dev), `dev:all` (`concurrently -k -n web,signal "next dev" "npm --prefix signaling-server run dev"`), `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:server` (signaling vitest). Server: `dev` (`tsx watch src/dev.ts`), `build` (esbuild), `start` (`node dist/server.js`), `typecheck`, `test`, `smoke` (`tsx scripts/smoke.ts ws://…`). Run with Windows-friendly commands (no `&&` assumptions in scripts).

### Vercel
Zero-config Next at the repo root (framework preset detected). No `vercel.json` unless needed. Build command is the default. `signaling-server/` is excluded from the app's tsconfig and ESLint. README steps: import the repo, set `NEXT_PUBLIC_SIGNALING_URL` (and optional ICE vars), deploy, then add the Vercel domain to the signaling server's `ALLOWED_ORIGINS`. Production page uses `wss://` only (`https` pages cannot open `ws://`, and a startup check warns about mixed content).

### Headers (`next.config.ts` `headers()` for `/(.*)`)
- `Content-Security-Policy`: `default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com` (+ `'unsafe-eval'` only in development); `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob: https://i.ytimg.com https://*.ytimg.com`; `media-src 'self' blob: mediastream:`; `font-src 'self' data:`; `frame-src https://www.youtube.com https://www.youtube-nocookie.com`; `connect-src 'self' <SIGNALING_ORIGIN> https://www.youtube.com`; `object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. `<SIGNALING_ORIGIN>` is derived from `NEXT_PUBLIC_SIGNALING_URL` at config load and **keeps its WebSocket scheme** (`wss://host[:port]` or `ws://host[:port]`, no path; it is not converted to https). An invalid or empty value is omitted. In development only (`process.env.NODE_ENV !== 'production'`), `connect-src` also gets the scheme-only sources `ws:` and `http:` (no host literal, so `next.config.ts` contains no `localhost` string, honoring NFR1; the dev signaling origin is already covered by `<SIGNALING_ORIGIN>` from `.env.development`; the scheme sources cover HMR in Safari, which does not match `'self'` against `ws:` **[UNVERIFIED across browser versions]**). Production keeps the exact signaling origin only. Trade-off: `'unsafe-inline'` scripts are needed for the no-flash theme script and Next's inline bootstrap without a nonce middleware (which would force dynamic rendering of every page). Accepted for v1 and documented. Exact YouTube script and frame hosts required by the IFrame API are **[UNVERIFIED]** (`www.youtube.com/iframe_api` redirects to a script on `www.youtube.com`/`s.ytimg.com`). Verify in a real browser's console for CSP violations.
- `Permissions-Policy: display-capture=(self), camera=(), microphone=(), geolocation=()` (fullscreen and autoplay are left at their defaults so the YouTube iframe can request them).
- `Referrer-Policy: strict-origin-when-cross-origin` (YouTube embeds fail with player configuration errors when no referrer is sent, so `no-referrer` is deliberately not used).
- `X-Content-Type-Options: nosniff`.

---

## 16. Test and verification plan

### Unit tests (vitest, fast, no network)
| Area | Cases |
|---|---|
| `parseYouTubeUrl` | watch, youtu.be, shorts, embed, live, m., music., nocookie, with extra params, `t=` formats, bare ID, invalid hosts (`evilyoutube.com`, `youtube.com.evil.io`), 10-/12-char IDs, empty |
| `roomCode` | generate with a seeded rng (alphabet only, length 6), `normalizeCode` (case, spaces, hyphen), `parseRoomInput` (raw code, full URL, URL with query/hash, garbage) |
| `playback` | `expectedPosition` playing/paused, clamping, `clock.estimateOffset` |
| `validate` | each rule in the validation table, plus oversized and control-char text |
| TTT | all 8 win lines, draw, move on an occupied cell, wrong turn, spectator move, restart alternation |
| RPS | resolution for all 27 triples of 3 picks and the 2-player matrix, pick hiding in `view`, auto-reveal when all picked, leave mid-round |
| Ludo | 6 to leave base, exact roll to finish, overshoot illegal, capture on a normal square, no capture on safe squares, home-column no capture, extra turn on 6, 3 sixes forfeit, auto-pass with no legal moves, winner detection, restart, leave and forfeit, `pieceCoord` mapping uniqueness |
| `verifyLocalFile` | hash equal, hash differing, name+size fallback, name-case difference |
| client `reducer` | `room:joined` replaces the state, participant events, host change, typing expiry |
| server `room.ts` | create/join/password, room_full, resume (valid and invalid token), host migration with a fake clock and sweep, kick, queue rules (`queue:play` removes item, auto-advance, share end does not advance), `media:set` initial playback (`playing @ 0` youtube, `paused @ 0` same-file), stale rev, host-only enforcement, `endShare` on each of the 5 triggers (stop, sharer socket close, sharer leave/kick, host transfer/migration, media:set) incl. the stream→same-file fallback, create/join while in a room → `invalid_state`, idle-socket rule (30 s no message; peek counts) |
| `clientIp` | rightmost-n XFF entry, spoofed leftmost ignored, fewer entries than hops, hops=0 |
| `WebSocketTransport` (fake WebSocket) | no auto-reconnect on 1008/4000/4001, reconnect on 1006, resume rejected → synthetic `room:closed{expired}` and no fresh join, `request()` resolves/rejects/times out, no client watchdog closes a silent socket; **(revision 4)** in a joined room, a 1008 close leaves status `closed`, `reconnect()` opens a new socket and sends exactly one resume `room:join{resumeToken}` (never a fresh join), and `send()` while `closed` is dropped and emits the "Not connected" `lastError` |
| `PeerLink` / `ShareBroadcaster` / `ShareViewer` link identity (fake `RTCPeerConnection`) | **(revision 4)** a retry creates a new `RTCPeerConnection` on both sides with a new `linkId`; the sharer replaces its link for that viewer; a late candidate or description carrying the old `linkId` is ignored on both sides; a repeated `viewer-ready` with the same `linkId` is ignored; outbound candidates over 2048 chars are not sent |
| `shared/validate.ts` `parseGameAction` | **(revision 4)** valid action per kind accepted; `index: "1"`, `index: 9`, `piece: 9`, `piece: 1.5`, `{type:'skipTurn'}`, a TTT action against `ludo`, `null`, an array, a string all return `null`; `rtc:signal` validation: `linkId` empty / 33 chars / bad charset, candidate 2049 chars, `sdpMid` 257 chars → dropped |
| `RoomShell` Strict Mode | **(revision 4)** rendering twice with the Strict Mode double-effect sends exactly one `room:join` and one `room:leave`; an `invalid_state` reply to a resume is ignored |
| `ShareBroadcaster` (fake store, fake `RTCPeerConnection`/tracks) | `share:start` rejection stops tracks, media change away from own sessionId stops tracks and closes links, `ended` track event sends `share:stop` |
| client `reducer` lobby | create → `in-room, entered:false`; `enter` → `entered:true`; join → `entered:true`; `room:closed{expired}` → `lobby` |
| `password` | hash/verify success, failure, different salts |
| revision 3 additions (server `room.ts`) | resume with bad token on a no-password room → `not_found`, participant count unchanged; `request` replies carry `ref` (requester copy) and others get none; no-op `media:set` still replies; `share:start screen` from youtube media (queue untouched, playback `paused @ 0`); `share:start file` with mismatched meta / non-same-file media → `invalid_state`; `playback:command` during `stream` is stored and `endShare` fallback uses it; `playback:command` with media `screen`/null → `invalid_state`; `local:ready` sets `hasFile`, reset only when the file identity changes; **(revision 4)** `share:start file` followed by `share:stop` keeps `hasFile` true and `local:ready` with a stale rev is ignored; host migration while `playing` yields a `playback:state` paused at the extrapolated position, broadcast before `host:changed`, and the same snapshot for a late joiner; `media:ended` with an empty queue pauses at `durationSec ?? expectedPosition`; consecutive duplicate `queue:add` → `invalid_state`; `RoomPeek.count` excludes disconnected-in-grace participants while `room_full` includes them; Ludo `log` never exceeds 20; `game:action` with garbage → `bad_request` and unchanged state; rtc:signal with 20 KiB SDP accepted, 40 KiB dropped with a warn log |
| client reload resume (`RoomShell`/store, fake transport) | stored session code = URL code → resume tried first, success → `entered:true`; failure → session cleared and `peeking`; code mismatch → cleared; session cleared on leave/kicked/closed |
| `clock` | `offset = serverTime − (t0 + rtt/2)` with `t0` from `Date.now()` and rtt from `performance.now()`; median-of-lowest-5 |
| config | `next.config.ts` output contains no `localhost` string; dev CSP has `ws:`/`http:` scheme sources, production does not |
| `origin` | exact, wildcard, `*`, unset (fail closed), missing Origin |

### Integration (script, `signaling-server/scripts/smoke.ts`, run against a live server started in the background)
Using `ws` with an `Origin` header, 3 clients: create room, peek, join with no password/wrong/right password, late-joiner snapshot (after host plays a video and adds a queue item and chat), host-only playback command rejection and acceptance, chat broadcast, game open + legal and illegal TTT moves, RPS hidden picks (client B cannot see A's pick in `game:state` before reveal), host migration (host socket closed, `HOST_GRACE_MS=500` and `SWEEP_INTERVAL_MS=100` set through env, so the wait is under 1 s), share teardown (host `share:start`, then host `host:transfer` → everyone receives `media:state` with `media:null`; sharer socket close → `media:state` broadcast immediately), `room:create` while joined → `invalid_state`, idle socket behavior (a socket sending `room:peek` every few seconds survives past `IDLE_MS` overridden to 1 s), `rtc:signal` delivered only to the target (the third client must receive nothing) and a viewer-to-viewer signal being dropped, bad Origin rejected with 403, oversized frame closes 1009, rate limit triggers. The script exits non-zero on any failed assertion.

### Build and static checks (each phase exit)
`npm install` (root and `signaling-server`), `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` for the root, and `npm --prefix signaling-server run typecheck|test|build`. Fix any failure before moving to the next phase.

### Browser verification (if Playwright or puppeteer is available, otherwise report as not run)
Start both servers in the background (never foreground). Load the landing page, open the create modal, create a room, screenshot the lobby and room, in both light and dark mode, and assert there are no console errors and no CSP violations. Two browser contexts can join the same room, checking chat and participant list. Stop all background processes at the end.

### Cannot be verified by script (reported explicitly)
Real cross-network and cross-device screen share (including TURN need), YouTube playback and sync feel, autoplay-policy behavior across browsers, `captureStream` in each browser, `.mov` support, and mobile layouts on real devices.

---

## 17. Phase plan (P1..P7, in order; each ends with a green typecheck/lint/test/build and, from P1, a live server check)

- **P1 Landing, aesthetic, create/join, room UI, ephemeral state, signaling server.** Hand-write the Next app scaffolding (no `create-next-app`; Tailwind pinned to 3.4.x; `.gitignore` additions; root `setup` script; see section 3) and Tailwind tokens, fonts, theme script, `shared/` (constants, protocol, validate, roomCode), `SignalingTransport` and `WebSocketTransport`, the room store and provider, landing page, create/join modals, lobby, room shell with sidebar and mobile tab bar (panels empty-but-real: People works), settings dialog, the full signaling server (registry, rooms, password, origin, limits, host migration, snapshot, `/health`), the smoke script for P1 features, unit tests for roomCode/validate/server room logic. Exit: a room can be created and joined from two browsers (script-verified); host migration and password verified.
- **P2 YouTube and sync.** `parse.ts`, `loadApi.ts`, `YouTubePlayer`, sync controller, `shared/playback.ts`, server media/playback/queue handlers, `QueuePanel`, error mapping, tests. Exit: server-side playback rules verified by script; parser tests pass.
- **P3 Screen share via WebRTC.** `iceConfig`, `capture`, `PeerLink`, `ShareBroadcaster`/`ShareViewer`, `ScreenSharePanel`/`ScreenView`, server `share:*` and `rtc:signal` relay, LIVE badge, errors, cleanup on leave. Includes `endShare` triggers, `request()`-based `share:start` with track cleanup, and the store-driven teardown in `ShareBroadcaster`. Exit: signal relay targeting and share teardown verified by script; typecheck/build pass; real-browser check flagged as not verifiable.
- **P4 Local video and sharing flow.** `FileDropzone`, `LocalPlayer`, `PlayerControls`, hash and `verifyLocalFile`, same-file flow with sync, `captureStream` streaming with fallback and the explanatory UI. Exit: `verifyLocalFile` tests pass, server accepts `local` media.
- **P5 Chat.** Server chat handlers (limits, ring buffer, typing, system lines), `ChatPanel` components, emoji picker, unread badge, scroll behavior. Exit: chat broadcast and late-joiner history verified by script.
- **P6 Games.** `shared/games/*` reducers and tests first, then server handlers with redaction, then `GamesPanel`, the Ludo SVG board, TTT and RPS UIs. Exit: all reducer tests pass, illegal-move rejection and RPS hiding verified by script.
- **P7 Polish and deploy prep.** Responsive pass, animations and reduced motion, error boundaries and not-found/loading pages, reconnect banner states, CSP and headers tuning, `.env.example`, README (quick start `npm run setup` then `npm run dev:all`, local dev, Vercel, Render/Railway/Fly step by step incl. `TRUST_PROXY_HOPS=1`, the Fly `fly.toml`/Dockerfile snippet, TURN, limitations, "Handing over the host role (ends the current share; the new host starts a new one)", swapping transport, adding auth/DB), full verification run (all checks in section 16), browser screenshots if possible, stop all background processes, and the final report (file structure, how to run, what was and was not verified).

---

## 18. Key invariants and who enforces them

| Invariant | Owner | Why |
|---|---|---|
| Only the host controls playback, media, sharing, settings | Server (`room.ts`); UI only hides controls | The client is untrusted |
| `shareSession` is non-null only while its sharer is the connected host | Server (`endShare` on stop, sharer socket close, leave/kick, host change, `media:set`) | The server cannot trust the sharer's tab to report its own death |
| Capture tracks are live only while the server's `media.sessionId` equals the broadcaster's own session | Client `ShareBroadcaster` store subscription | The server cannot stop a browser's capture; only the client can |
| A connection holds at most one room membership | Server (`invalid_state`) | A client bug must not cause double membership |
| A failed resume never turns into a fresh join | Client transport/reducer | A fresh join changes participant id, seats and host status |
| Password is checked on join and never sent to clients | Server | Clients only get `hasPassword` |
| One active share session, signals only between sharer and viewer, same room | Server | Prevents signal abuse and stale sessions |
| Game moves are legal and in turn; dice come from the server rng | Shared reducer executed on the server | Authoritative state, clients render only |
| RPS picks stay hidden until reveal | Server `view()` redaction per recipient | Redaction on the client would leak data |
| Message and rate limits | Server (`maxPayload`, buckets) | Protects the process |
| Names, chat and file names are sanitized and rendered as text | Server sanitizes, React escapes at render | Defense in depth |
| Local file bytes and blob URLs never leave the device | Client design, and the schema has no URL or bytes field | Privacy requirement |
| Clock offset applies on the client only; the server is the sole time source for `updatedAt` | Server | Prevents host clock skew |

---

## 19. Unverified assumptions (consolidated)

1. Exact package versions (Next, React, Tailwind 3.4, `motion`, `ws`, `vitest`, `esbuild`, `tsx`, `concurrently`) and `motion/react` import path.
2. `eslint`/`next lint` script shape for the pinned Next version.
3. YT constructor `host` option (nocookie), and the exact script/frame hosts for CSP.
4. YouTube oEmbed CORS from the browser.
5. Browser autoplay behavior, `playbackRate` 0.95/1.05 clamping on `<video>`, and `RTCRtpSender` `maxBitrate` application.
6. Implicit `setLocalDescription()` support on all target browsers (fallback described).
7. `captureStream`/`mozCaptureStream` behavior, including the effect of muting on captured audio and tracks added late.
8. Render's idle timeout value (about 55 s) and that WebSocket upgrade passes through its proxy unchanged (it is documented for Render, Railway and Fly, not tested here).
9. Tab/system audio capture support per browser.

10. Added in revision 2: `next build` behavior when the Google Fonts fetch fails (fallback plan: `next/font/local`), exact Chrome timer-throttling numbers for background tabs, per-platform proxy hop count for `X-Forwarded-For` (Render/Railway/Fly), Railway build commands, Fly Dockerfile/`fly.toml` snippet, Safari `connect-src 'self'` and `ws:` in dev.

## 20. Review-finding responses (revision 2)
All 17 findings are addressed; none were backlogged or ignored.

1. **HIGH, sharer cannot stop after transfer/kick/media:set.** Addressed. Server `endShare` runs on `share:stop`, sharer socket close, sharer leave/kick/timeout, any host change, and `media:set` (section 6). Client `ShareBroadcaster` subscribes to the store and stops all tracks and links whenever `media.sessionId` no longer equals its own (section 9, step 1). README gains "Handing over the host role" (FR14, P7). AC15 and the server/client tests cover it.
2. **HIGH, host socket drop leaves a dead share.** Addressed. `endShare` runs immediately when the sharer's socket closes, for `screen` and for `local`+`stream` (which falls back to `delivery:'same-file'`, paused at the last position). A resumed host can `share:start` again because no share exists. A resumed `ShareBroadcaster` tears down locally (section 9).
3. **MEDIUM, lobby idle vs peek.** Addressed. Replaced with "no message of any kind for 30 s" plus a 10 min unjoined cap, both applying only outside rooms. Transport does not auto-reconnect on 1008/4000/4001 and reconnects lazily on the next action. No peek subscription is added (decision: polling is simpler and the peek bucket supports it); the lobby re-peeks every 5 s while visible. AC16 added.
4. **MEDIUM, client heartbeat watchdog.** Addressed. The client watchdog is removed. Liveness is server-side only (20 s ping, 45 s). `sync:ping` is for clock offset only, every 5 s visible and 30 s hidden (section 5).
5. **MEDIUM, X-Forwarded-For trust.** Addressed. `TRUST_PROXY_HOPS` (default 1) picks the n-th entry from the right; startup warning when `PORT` is set and hops is 0; README instructs per platform; spoof test added. The platform hop count is marked unverified.
6. **MEDIUM, sweep granularity.** Addressed. `SWEEP_INTERVAL_MS` default 1000 (100 in tests/smoke), one registry timer scanning rooms with pending deadlines; added to env docs.
7. **MEDIUM, create flow and lobby.** Addressed. `entered: boolean` added; create and join set `in-room`; creator's Enter sets `entered:true`; guest join sets it directly; opening `/room/X` while in room Y calls `leaveRoom()` first; the server returns `invalid_state` for create/join while in a room (AC17; section 7).
8. **MEDIUM, auto-rejoin with passwords.** Addressed. The transport attempts resume only; a rejected token produces a synthetic `room:closed{expired}`, the store returns to `lobby` with the password prompt, and all sync controllers reset. It never performs a silent fresh join (AC18; section 5).
9. **MEDIUM, no failure path for actions.** Addressed. `request()` added to `SignalingTransport` (ref-based, 10 s timeout). `share:start` (tracks stopped on rejection), `media:set`, `queue:add` use it. Un-ref'd `error`s go to `lastError` as toasts, excluding `stale` and coalescing `rate_limited` (section 4).
10. **MEDIUM, undefined types.** Addressed. `CreateRoomInput`, `JoinRoomInput`, `JoinedPayload` in `shared/protocol.ts`; `GameKind`, `Color`, `Choice`, `Seat`, `GameAction`, `GameView`, `RpsView` in `shared/games/types.ts`; Ludo and TTT views equal their state; `Result.events` removed.
11. **MEDIUM, validation table.** Addressed. Rows added for ids, enums, `share:start.file`, `media:error.code`, `sync:ping.t0`, `profile:update`, `room:settings`, `ref`, self-targeting, `queue:remove` ownership, code-point counting, and bidi/zero-width stripping.
12. **MEDIUM, `media:set` initial state.** Addressed. Chosen: youtube → `playing @ 0`; local same-file → `paused @ 0`; `queue:play` removes the item from the queue; `share:stop` leaves the queue untouched and never auto-advances (section 6).
13. **NIT, CSP scheme.** Addressed. `connect-src` keeps `ws://`/`wss://`; dev adds `ws://localhost:*` (section 15).
14. **NIT, server build/deploy.** Addressed. esbuild output is CJS (no `"type":"module"` needed), build tools are `dependencies`, root vitest excludes `signaling-server/**`, Fly gets a `fly.toml`/Dockerfile snippet marked unverified (sections 3, 15).
15. **NIT, fonts offline.** Addressed. System-font fallback stack in the CSS variables; if `next build` fails offline, switch to `next/font/local` with committed woff2 (section 2). Whether the build degrades gracefully is marked unverified.
16. **NIT, Ludo gaps.** Addressed. Auto-pass resets `sixesInRow`; the three-sixes rule stays as house rule A5; a turn owner disconnected for 15 s (`TURN_SKIP_MS`) is auto-passed by an internal `skipTurn` action (section 12).
17. **NIT, loose spots.** Addressed. Rate-limit matrix row fixed to five cells; `rtc:signal` uses its own bucket only; kicked users may rejoin (accepted for v1); password rooms hide the participant list in peeks (accepted, noted in `RoomPeek`); `FollowerOverlay` added to the component tree.

## 21. Review-finding responses (revision 3)
All 13 findings are addressed; none were backlogged or ignored. Section numbers refer to this document.

1. **MEDIUM, `request()` reply contract.** Addressed (section 4). `ref?` added to `media:state`, `playback:state`, `queue:updated`. Rule: the requester gets its own copy of a broadcast with `ref`, others get it without. A reply table maps each request to its success message; no-op successes still reply to the requester only, so nothing times out. `SignalingTransport.request` docs point to the table (section 5).
2. **MEDIUM, `share:start` preconditions and stream playback.** Addressed (section 6, "share:start rules"; section 10 flow B). `screen` is allowed from any media and acts like `media:set` (queue untouched, playback `paused @ 0`). `file` requires same-file media with equal name/size/lastModified, else `invalid_state`, and converts in place. In stream mode the host keeps sending `playback:command`, viewers ignore `playback:state`, and `playback:command` with `screen`/null media is `invalid_state`. The error matrix and tests were extended.
3. **MEDIUM, invalid resume token.** Addressed (section 6, "Resume vs fresh join"). A `resumeToken` makes the join resume-only. A non-matching token returns `not_found` and never creates a participant. The client clears the stored session on `room:closed`, `kicked`, `leave` and failed resume. Unit test added. AC18 holds.
4. **MEDIUM, reload resume trigger.** Addressed (section 7, "Reload resume"; section 3 identity note). `sessionStorage["moonie-session"] = {code, resumeToken}` is written on every `room:joined`; `RoomShell` at `idle` tries a resume first when the stored code equals the URL code, and falls back to `peeking` on any failure. Test added.
5. **MEDIUM, localhost in `next.config.ts`.** Addressed (section 15, headers). The dev CSP uses the scheme-only sources `ws:` and `http:`; the dev signaling origin comes from `NEXT_PUBLIC_SIGNALING_URL` in `.env.development`. A config test asserts no `localhost` string. NFR1 and AC12 unchanged.
6. **NIT, clock offset.** Addressed (section 5): `t0 = Date.now()` in the ping, `rtt` from `performance.now()`, `offset = serverTime − (t0 + rtt/2)`.
7. **NIT, `rev` semantics.** Addressed (section 4 core types): `playback.rev` always equals `media.rev` and is not incremented per command; ordering relies on in-order delivery of one socket.
8. **NIT, SDP cap.** Addressed (section 4 validation): 32 KiB cap (frame limit stays 64 KiB), oversize drops logged at `warn` with code and size only.
9. **NIT, three-sixes rule.** Addressed (assumption A5, section 12): constant `THREE_SIXES_FORFEIT = true` in `ludo.ts`, still on by default as a documented house rule.
10. **NIT, tooling.** Addressed (section 3): server tsconfig includes `../shared`; `.gitignore` un-ignores `.env.example` and `.env.development`.
11. **NIT, wildcard origin.** Addressed (section 15): `.env.example` lists only the exact origin; the README shows the `*.vercel.app` wildcard as an optional preview line with a warning.
12. **NIT, `RpsView.picks`.** Addressed (section 4): `Record<string,'none'|'locked'|Choice>`.
13. **NIT, same-file readiness.** Addressed: new `local:ready{rev, ready}` client message and `Participant.hasFile` (section 4, section 6, flow A step 4b). The host sees "N of M ready".

Also taken from the review's unverified list: the host seek poll is suppressed while the YouTube player is BUFFERING (section 8, marked unverified until tested in a real browser).

---

## 22. Review-finding responses (revision 4)

Responses to the third `design-review.md` (11 findings). All 11 are addressed as prescribed; none were backlogged or ignored. Revision 4 changes only the places named below.

1. **HIGH, viewer retry reuses a `PeerLink`.** Addressed. `rtc:signal` now carries `linkId` (section 4 client and server unions, `sendSignal` signature in section 5, validation row: string 1-32 chars, `[A-Za-z0-9_-]`, relayed unchanged). Section 9: the viewer generates a fresh `linkId` per `viewer-ready` (initial and retry) and closes and recreates its own `PeerLink` before sending it (flow step 2 and "Failure and ICE restart"); the sharer keeps `Map<viewerId, {linkId, link}>` keyed by `(viewerId, linkId)` and replaces its link on a new `linkId` (flow step 3); both sides drop any `description`/`candidate` with a non-current `linkId` (new "Link identity" paragraph and "Session guards"). `PeerLink` constructor takes `linkId`. Unit test row added in section 16 (retry makes a new `RTCPeerConnection` on both sides; late old-`linkId` candidate ignored).
2. **MEDIUM, `game:action` shape validation.** Addressed. New `parseGameAction(kind, raw)` with per-kind rules after the validation table in section 4; the table row now splits shape (`bad_request`) from rule errors (`invalid_state`/`forbidden`); `handlers/game.ts` calls it before `reduce` (section 12 server bullet). Garbage-payload tests in section 16; error-matrix row in section 6.
3. **MEDIUM, `hasFile` wiped by conversions.** Addressed with the prescribed choice. Section 6 `local:ready`: reset only when the file identity (name/size/lastModified, or media kind) changes; same-file/stream conversions keep it; `local:ready` accepted only for the current `rev`; the client re-sends `local:ready{rev: newRev}` whenever `media.rev` changes while its match holds. `Participant.hasFile` comment (section 4) and flow A step 4b (section 10) updated. Server test: `share:start file` then `share:stop` keeps `hasFile` true.
4. **MEDIUM, playback freeze has no broadcast.** Addressed. Section 6 "Host migration" now defines the "Playback freeze": server sets `{rev: media.rev, status:'paused', positionSec: expectedPosition, updatedAt: now}` and broadcasts `playback:state` (no `ref`) before `host:changed`. Section 8 bullet points to it. Server test added (migration while playing).
5. **MEDIUM, no recovery from 1008/4000 in a room.** Addressed. Section 5 transport rules: `ReconnectBanner` shows a "Reconnect" button for `closed` with a joined room; `reconnect()` always sends a resume `room:join` when a joined room is recorded and never a fresh join; `send()` while `closed` is dropped with a toast; `request()` rejects with `network`. Section 6 rate-limit bullet and error matrix row note the recovery. `WebSocketTransport` test row extended.
6. **NIT, scaffolding and `.gitignore`.** Addressed (section 3 "Scaffolding"; section 2 already pins Tailwind 3.4.x, section 3 now says so explicitly). No `create-next-app`; config files are hand-written or copied from a temp scaffold; existing `.gitignore` kept with additions `.env*.local`, `signaling-server/dist`, `.vercel` (plus `.next`, `node_modules`, `*.tsbuildinfo` if absent). The revision-3 statement that `.gitignore` un-ignores `.env.example` (item 10 of section 21) is superseded: no `!` negations are needed for this repo's `.gitignore`; the implementer confirms with `git check-ignore -v`.
7. **NIT, duplicate game types and `skipTurn` wording.** Addressed. `GameKind` and `GameAction` are defined once in `shared/games/types.ts` (section 4; garbled comment replaced); section 12 only refers to them. One wording everywhere: "`skipTurn` is dispatched only by the server sweep, never by a client, and never by the host" (section 4, Ludo action type, Disconnected turn owner bullet).
8. **NIT, server deps not installed.** Addressed. Root script `setup` (section 15 "Scripts") and README quick start; no `postinstall` because it would run on Vercel.
9. **NIT, small values.** Addressed. Ludo `log` capped at 20 (`LUDO_LOG_MAX`, section 12); `media:ended` with an empty queue uses `durationSec ?? expectedPosition` (section 6 Queue bullet); consecutive duplicate `queue:add` is `invalid_state` (section 6); `RoomPeek.count` counts connected participants only and the lobby copy for `room_full` explains reconnecting members (section 4 comment). Tests added in section 16.
10. **NIT, Strict Mode double effects.** Addressed in section 7: `attemptKeyRef` in `RoomProvider` with `beginAttempt(code)`, an `invalid_state` reply to a resume is ignored, and `leaveRoom()` is idempotent. Test row added.
11. **NIT, candidate size caps.** Addressed in the section 4 `rtc:signal` validation row: `candidate.candidate` ≤ 2048 chars, `sdpMid` and `usernameFragment` ≤ 256 chars, `sdpMLineIndex` integer 0..255 or null; dropped silently (debug log). Client also skips sending oversize candidates (section 9).

`design-verdict.json` lists the same 11 findings; there is no additional item beyond them.