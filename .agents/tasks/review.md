# Review: Moonie

**Verdict**: APPROVED

Phases P1-P7 are implemented (commits for landing/rooms/signaling, YouTube, screen share, local video, chat, games, polish/deploy prep, plus verification). All FEAT-001..008 are recorded.

## Checks run by the reviewer
- Root: typecheck, lint, vitest (18 files, 252 tests) and `next build` all pass. Routes: `/`, `/_not-found`, `/icon.svg` static, `/room/[code]` dynamic.
- signaling-server: typecheck, vitest (7 files, 103 tests) and build (`dist/server.js`) pass.
- The smoke script (80/80 checks) and Playwright console-error check come from verification.md. I did not re-run them.

## Requirement audit
- No DB, auth or persistent storage: no database or ORM code found. Server state is in memory only. The browser stores only identity and theme.
- No hardcoded localhost in app code. It appears only in `.env.development`, `signaling-server/src/dev.ts`, a comment in `src/lib/webrtc/support.ts`, tests and the README.
- No TODO, placeholder or "coming soon" text in src, shared or signaling-server/src.
- Host-only playback is enforced server-side in `room.ts`: setMedia, playback control, queue reorder/play, share start/stop, kick, transfer and settings all fail with `not_host` for non-hosts.
- `rtc:signal` is targeted: `relaySignal` forwards only to the named, connected target. It checks the sessionId, rejects self-targets and drops invalid targets silently.
- Game moves are validated server-side by shared pure reducers, with unit tests and smoke coverage of garbage payloads.
- README.md, signaling-server/README.md, `.env.example` and `signaling-server/.env.example` are present.

## Findings (non-blocking)
- Not verified (as verification.md says): cross-network screen share and TURN, real YouTube playback, `captureStream`, `.mov`, mobile devices, two-browser interactive flows, and the actual Vercel deploy.
- Only the host can start a screen share. This matches the brief's decision and has a host-transfer path.
