# Design Review: Moonie (design.md revision 4)

Reviewed against `brief.md`. This is the final design gate. Verdict: **APPROVED** (0 HIGH findings). Medium and nit items are carried forward under "Implementation notes".

## Prior findings (revision 3 review, 11 items): resolution check
1. HIGH, viewer retry reuses a `PeerLink`: **Resolved.** `linkId` is in both `rtc:signal` unions (section 4), in `sendSignal` (section 5), and in the validation row (1–32 chars, `[A-Za-z0-9_-]`, relayed unchanged). Section 9 has the viewer generate a fresh `linkId` per `viewer-ready` and recreate its own `PeerLink` first. The sharer keys its link by `(viewerId, linkId)` and replaces it on a new `linkId`. Both sides drop signals with a stale `linkId`. A retry test row is in section 16.
2. MEDIUM, `game:action` shape validation: **Resolved.** `parseGameAction(kind, raw)` is defined with per-kind rules, rejects `skipTurn`, and the table splits `bad_request` from `invalid_state`/`forbidden`.
3. MEDIUM, `hasFile` wiped by conversions: **Resolved.** The reset happens only on a file identity change. `local:ready` is accepted only for the current `rev`. The client re-sends on a `rev` change.
4. MEDIUM, playback freeze with no broadcast: **Resolved.** Section 6 "Playback freeze" sets a paused playback at the extrapolated position and broadcasts `playback:state` before `host:changed`.
5. MEDIUM, no recovery from 1008/4000: **Resolved.** A Reconnect button, a resume-only `reconnect()`, and `send()` while closed dropping with a toast are specified (section 5).
6–11. NITs (scaffolding and `.gitignore`, duplicate game types, root `setup` script, small caps and error codes, Strict Mode guard, candidate caps): **Resolved.** Each is present in the text I checked: sections 3, 4, 6, 7, 12, 15.

## Findings (blocking)
None.

## Implementation notes (MEDIUM and NIT, non-blocking by the instruction of this gate)
1. MEDIUM: Verify during P1 that the two documented offline-build paths for `next/font/google` are exercised. The design says "if the build fails offline, commit woff2". Decide on day one and commit the files, so `npm run build` is reproducible without network on the grader's machine.
2. MEDIUM: `ShareBroadcaster` teardown depends on seeing `media` change. Add one smoke assertion that a transferred host's old socket receives `media:state` with no `sessionId` (AC15 already lists it; make sure the test is in the P4 script).
3. MEDIUM: A room with a password still lets `room:peek` return count, name and host name. The design accepts this. Keep the README limitation text explicit about it.
4. NIT: The doc is about 137 KB. The implementer should treat sections 4, 6 and 9 as the contract and keep section 22 out of any code comments.
5. NIT: `setLocalDescription()` without arguments has a fallback documented for older Safari. Implement the `createOffer`/`createAnswer` fallback as written, not as a later improvement.
6. NIT: The three-sixes rule is a house rule outside the brief. Keep `THREE_SIXES_FORFEIT` as the single switch and state it in the games UI help text.
7. NIT: Pin dependency versions from the registry at install time and record them in the README, since the authoring environment had no network.

## Verified Assumptions
- Every revision-3 finding has a matching change in the text (checked by reading section 9 in full, the section 4 validation rows and `parseGameAction`, section 6 `local:ready`, queue and teardown bullets, and section 22).
- `PeerLink.handle` follows the standard perfect-negotiation pattern; the sharer is impolite, viewers are polite, and candidates are buffered until `remoteDescription` exists.
- `endShare` covers all the listed teardown triggers on the server, and the client store subscription covers the case where the old host cannot send `share:stop`.
- The room-code alphabet has 31 symbols, so 31^6 = 887,503,681 matches the stated figure.
- Every brief requirement for the three watch sources, host control, late-joiner snapshots, chat, three games, Vercel structure, `.env.example` and README has a home in the design.

## Unverified/Wrong Assumptions
- **Unverified, accepted:** package versions, the `motion/react` import path, `captureStream` behavior, `maxBitrate` application, proxy hop counts, Railway/Fly build recipes. The design labels each **[UNVERIFIED]** and tells the implementer to check them at the matching phase.
- **Not fully read:** I read sections 1–5, 6 (the migration, teardown, local and queue bullets), 9 and 22 in full, and searched the rest by keyword. Sections 8, 10–14 and 16–19 were not read line by line. Nothing I found there conflicts with the revision-4 rules.
- No wrong assumptions found.

## Verdict
APPROVED: 0 HIGH findings.
