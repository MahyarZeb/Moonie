/**
 * Protocol smoke test against a running signaling server.
 *
 * Start the server first, for example:
 *   ALLOWED_ORIGINS=http://smoke.test TRUST_PROXY_HOPS=0 HOST_GRACE_MS=500 SWEEP_INTERVAL_MS=100 IDLE_MS=1000 \
 *   node dist/server.js
 * then run `npm run smoke`. Reads SMOKE_URL (ws or wss URL) and SMOKE_ORIGIN. Exits non-zero on failure.
 */
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '../../shared/protocol';

const URL_WS = process.env.SMOKE_URL ?? process.argv[2] ?? 'ws://127.0.0.1:8787';
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://smoke.test';
const URL_HTTP = URL_WS.replace(/^ws/, 'http');

const failures: string[] = [];
let checks = 0;
function check(cond: unknown, label: string): void {
  checks++;
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Msg = ServerMessage;

class Client {
  msgs: Msg[] = [];
  closeCode: number | null = null;
  private listeners: (() => void)[] = [];
  private refN = 0;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      this.msgs.push(JSON.parse(d.toString()) as Msg);
      this.listeners.forEach((l) => l());
    });
    ws.on('close', (code) => {
      this.closeCode = code;
      this.listeners.forEach((l) => l());
    });
  }

  static open(origin: string | null = ORIGIN): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(URL_WS, origin ? { origin } : {});
      ws.once('open', () => resolve(new Client(ws)));
      ws.once('error', reject);
    });
  }

  mark(): number {
    return this.msgs.length;
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Waits for a message after `since` that matches the predicate. */
  waitFor(pred: (m: Msg) => boolean, since = 0, ms = 3000): Promise<Msg | null> {
    return new Promise((resolve) => {
      const find = () => this.msgs.slice(since).find(pred);
      const hit = find();
      if (hit) return resolve(hit);
      const timer = setTimeout(done, ms);
      const listener = () => {
        const m = find();
        if (m) done(m);
      };
      function done(m?: Msg) {
        clearTimeout(timer);
        resolve(m ?? null);
      }
      this.listeners.push(listener);
    });
  }

  /** Sends a request with a ref and resolves with the first reply carrying it. */
  async request(msg: ClientMessage): Promise<Msg | null> {
    const ref = `r${++this.refN}`;
    const since = this.mark();
    this.send({ ...msg, ref } as ClientMessage);
    return this.waitFor((m) => 'ref' in m && m.ref === ref, since);
  }

  async waitClosed(ms = 3000): Promise<number | null> {
    const start = Date.now();
    while (this.closeCode === null && Date.now() - start < ms) await sleep(25);
    return this.closeCode;
  }

  close(): void {
    this.ws.close();
  }
}

const profile = (name: string) => ({ displayName: name, avatar: 'cat' as const });

async function createRoom(host: Client, opts: { password?: string; name?: string } = {}) {
  const reply = await host.request({
    type: 'room:create',
    name: opts.name ?? 'Smoke room',
    theme: 'cloud',
    ...profile('Host'),
    ...(opts.password ? { password: opts.password } : {}),
  });
  if (reply?.type !== 'room:joined') throw new Error(`create failed: ${JSON.stringify(reply)}`);
  return reply;
}

async function join(c: Client, code: string, name: string, password?: string) {
  return c.request({ type: 'room:join', code, ...profile(name), ...(password ? { password } : {}) });
}

async function main() {
  console.log(`Smoke test against ${URL_WS} (origin ${ORIGIN})`);
  const open: Client[] = [];
  const mk = async () => {
    const c = await Client.open();
    open.push(c);
    return c;
  };

  console.log('health');
  const health = (await (await fetch(`${URL_HTTP}/health`)).json()) as { ok: boolean };
  check(health.ok === true, 'GET /health returns ok');

  console.log('create and peek');
  const host = await mk();
  const created = await createRoom(host);
  const code = created.snapshot.code;
  check(/^[A-HJKMNP-Z2-9]{6}$/.test(code), `room code looks right (${code})`);
  check(created.ref !== undefined && created.selfId === created.snapshot.hostId, 'creator is host and ref is echoed');
  const peeker = await mk();
  const info = await peeker.request({ type: 'room:peek', code });
  check(info?.type === 'room:info' && info.peek.name === 'Smoke room' && info.peek.count === 1, 'peek returns room info');
  const missing = await peeker.request({ type: 'room:peek', code: 'ZZZZZZ' });
  check(missing?.type === 'error' && missing.code === 'not_found', 'peek of an unknown room is not_found');

  console.log('room:create while joined');
  const dup = await host.request({ type: 'room:create', name: 'Again', theme: 'cloud', ...profile('Host') });
  check(dup?.type === 'error' && dup.code === 'invalid_state', 'create while joined returns invalid_state');

  console.log('password join');
  const pwHost = await mk();
  const pwRoom = await createRoom(pwHost, { password: 'sleepy1', name: 'Locked' });
  const pwCode = pwRoom.snapshot.code;
  const pwPeek = await peeker.request({ type: 'room:peek', code: pwCode });
  check(
    pwPeek?.type === 'room:info' && pwPeek.peek.hasPassword && pwPeek.peek.participants === undefined,
    'password room peek hides the participant list',
  );
  const g0 = await mk();
  const noPw = await join(g0, pwCode, 'NoPw');
  check(noPw?.type === 'error' && noPw.code === 'wrong_password', 'join without password is rejected');
  const wrongPw = await join(g0, pwCode, 'Wrong', 'not-the-one');
  check(wrongPw?.type === 'error' && wrongPw.code === 'wrong_password', 'join with a wrong password is rejected');
  const rightPw = await join(g0, pwCode, 'Right', 'sleepy1');
  check(rightPw?.type === 'room:joined' && rightPw.snapshot.participants.length === 2, 'join with the right password works');
  const badToken = await mk();
  const resume = await badToken.request({ type: 'room:join', code: pwCode, ...profile('X'), resumeToken: 'bogus' });
  check(resume?.type === 'error' && resume.code === 'not_found', 'a bad resume token is not_found, never a join');

  console.log('late-join snapshot');
  const late = await mk();
  const lateJoin = await join(late, code, 'Late');
  check(lateJoin?.type === 'room:joined', 'late joiner is accepted');
  if (lateJoin?.type === 'room:joined') {
    const s = lateJoin.snapshot;
    check(s.participants.length === 2 && s.hostId === created.selfId, 'snapshot lists participants and host');
    check(s.media === null && s.playback.status === 'paused' && Array.isArray(s.queue) && s.game === null, 'snapshot carries media, playback, queue, game');
    check(s.chat.some((m) => m.kind === 'system' && m.text.includes('Host joined')), 'snapshot carries chat history');
  }
  const hostSawJoin = await host.waitFor((m) => m.type === 'participant:joined' && m.participant.name === 'Late');
  check(!!hostSawJoin, 'host is told about the new participant');

  console.log('host controls');
  const lateId = lateJoin?.type === 'room:joined' ? lateJoin.selfId : '';
  const notHost = await late.request({ type: 'host:kick', id: created.selfId });
  check(notHost?.type === 'error' && notHost.code === 'not_host', 'non-host kick is not_host');
  const since = late.mark();
  host.send({ type: 'room:settings', name: 'Renamed', theme: 'starlight' });
  const settingsMsg = await late.waitFor((m) => m.type === 'room:settings' && m.name === 'Renamed', since);
  check(!!settingsMsg, 'settings change is broadcast');

  console.log('host migration');
  const hmHost = await mk();
  const hm = await createRoom(hmHost);
  await sleep(15);
  const hmG1 = await mk();
  const j1 = await join(hmG1, hm.snapshot.code, 'G1');
  await sleep(15);
  const hmG2 = await mk();
  await join(hmG2, hm.snapshot.code, 'G2');
  const g1Id = j1?.type === 'room:joined' ? j1.selfId : '';
  const t0 = hmG2.mark();
  hmHost.ws.terminate();
  const changed = await hmG2.waitFor((m) => m.type === 'host:changed', t0, 4000);
  check(
    changed?.type === 'host:changed' && changed.hostId === g1Id && changed.reason === 'timeout',
    'oldest connected participant becomes host after the grace period',
  );

  console.log('transfer and kick');
  const tHost = await mk();
  const tRoom = await createRoom(tHost);
  const tGuest = await mk();
  const tj = await join(tGuest, tRoom.snapshot.code, 'T');
  const tId = tj?.type === 'room:joined' ? tj.selfId : '';
  tHost.send({ type: 'host:transfer', to: tId });
  const tChanged = await tGuest.waitFor((m) => m.type === 'host:changed' && m.reason === 'transfer', 0);
  check(tChanged?.type === 'host:changed' && tChanged.hostId === tId, 'host transfer is broadcast');
  const k = await mk();
  const kj = await join(k, tRoom.snapshot.code, 'Kickme');
  const kId = kj?.type === 'room:joined' ? kj.selfId : '';
  tGuest.send({ type: 'host:kick', id: kId });
  const gotKicked = await k.waitFor((m) => m.type === 'kicked');
  check(!!gotKicked, 'kicked participant receives kicked');
  check((await k.waitClosed()) === 4001, 'kicked socket is closed with 4001');

  console.log('youtube playback and queue');
  const V1 = 'dQw4w9WgXcQ';
  const V2 = 'aaaaaaaaaaa';
  const V3 = 'bbbbbbbbbbb';
  const yHost = await mk();
  const yRoom = await createRoom(yHost);
  const yGuest = await mk();
  await join(yGuest, yRoom.snapshot.code, 'Y');
  const setReply = await yHost.request({ type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
  check(
    setReply?.type === 'media:state' && setReply.media?.kind === 'youtube' && setReply.playback.status === 'playing',
    'host media:set starts youtube playing and replies with media:state',
  );
  const rev = setReply?.type === 'media:state' && setReply.media ? setReply.media.rev : -1;
  const guestSawMedia = await yGuest.waitFor((m) => m.type === 'media:state' && m.media?.kind === 'youtube');
  check(!!guestSawMedia && !('ref' in guestSawMedia && guestSawMedia.ref), 'guest receives media:state without a ref');

  const gMark = yGuest.mark();
  yHost.send({ type: 'playback:command', rev, action: 'seek', positionSec: 42 });
  const seekMsg = await yGuest.waitFor((m) => m.type === 'playback:state' && m.playback.positionSec === 42, gMark);
  check(!!seekMsg, 'host playback:command is accepted and broadcast');

  const denied = await yGuest.request({ type: 'playback:command', rev, action: 'pause', positionSec: 1 });
  check(denied?.type === 'error' && denied.code === 'not_host', 'non-host playback:command returns not_host');
  const stillPlaying = await mk();
  const sj = await join(stillPlaying, yRoom.snapshot.code, 'Check');
  check(
    sj?.type === 'room:joined' && sj.snapshot.playback.status === 'playing' && sj.snapshot.playback.positionSec >= 42,
    'state is unchanged after the rejected command',
  );

  const q1 = await yGuest.request({ type: 'queue:add', videoId: V2, title: 'Second' });
  check(q1?.type === 'suggestions:updated' && q1.suggestions.length === 1, 'a member queue:add becomes a suggestion');
  const approved = await yHost.request({ type: 'queue:approve', itemId: q1?.type === 'suggestions:updated' ? (q1.suggestions[0]?.id ?? '') : '' });
  check(approved?.type === 'queue:updated' && approved.queue.length === 1, 'queue:approve moves it into the queue');
  const q2 = await yHost.request({ type: 'queue:add', videoId: V3 });
  check(q2?.type === 'queue:updated' && q2.queue.length === 2, 'host can queue another video');
  const dupAdd = await yHost.request({ type: 'queue:add', videoId: V3 });
  check(dupAdd?.type === 'error' && dupAdd.code === 'invalid_state', 'consecutive duplicate queue:add is invalid_state');

  const lateY = await mk();
  const lj = await join(lateY, yRoom.snapshot.code, 'LateY');
  check(
    lj?.type === 'room:joined' &&
      lj.snapshot.media?.kind === 'youtube' &&
      lj.snapshot.playback.status === 'playing' &&
      lj.snapshot.playback.positionSec >= 42 &&
      lj.snapshot.queue.length === 2,
    'late joiner snapshot has media, position and queue',
  );

  const queued = q2?.type === 'queue:updated' ? q2.queue : [];
  const playReply = await yHost.request({ type: 'queue:play', itemId: queued[1]?.id ?? '' });
  check(
    playReply?.type === 'media:state' &&
      playReply.media?.kind === 'youtube' &&
      playReply.media.videoId === V3 &&
      playReply.queue.length === 1,
    'queue:play removes the item and makes it current',
  );
  const rmReply = await yHost.request({ type: 'queue:remove', itemId: queued[0]?.id ?? '' });
  check(rmReply?.type === 'queue:updated' && rmReply.queue.length === 0, 'queue:remove empties the queue');

  console.log('chat');
  const cHost = await mk();
  const cRoom = await createRoom(cHost);
  const cGuest = await mk();
  await join(cGuest, cRoom.snapshot.code, 'Chatty');
  const cMark = cHost.mark();
  const cgMark = cGuest.mark();
  cGuest.send({ type: 'chat:send', text: 'hello moonie' });
  const isHello = (m: Msg) => m.type === 'chat:message' && m.message.text === 'hello moonie';
  const hostGot = await cHost.waitFor(isHello, cMark);
  const senderGot = await cGuest.waitFor(isHello, cgMark);
  check(!!hostGot && !!senderGot, 'chat:send is broadcast to everyone including the sender');
  check(
    senderGot?.type === 'chat:message' && senderGot.message.kind === 'user' && senderGot.message.name === 'Chatty' && !!senderGot.message.avatar,
    'chat message carries sender name and avatar',
  );
  const longMark = cHost.mark();
  cGuest.send({ type: 'chat:send', text: `a\u0000b\nc${'z'.repeat(700)}` });
  const longMsg = await cHost.waitFor((m) => m.type === 'chat:message' && m.message.text.startsWith('ab c'), longMark);
  check(
    longMsg?.type === 'chat:message' && longMsg.message.text.length === 500 && !/[\u0000-\u001f]/.test(longMsg.message.text),
    'chat text is truncated at 500 with control chars stripped',
  );
  const typMark = cHost.mark();
  cGuest.send({ type: 'chat:typing', typing: true });
  check(!!(await cHost.waitFor((m) => m.type === 'chat:typing' && m.typing, typMark)), 'typing is relayed to others');
  const cLate = await mk();
  const cLateJoin = await join(cLate, cRoom.snapshot.code, 'LateChat');
  check(
    cLateJoin?.type === 'room:joined' && cLateJoin.snapshot.chat.some((m) => m.text === 'hello moonie'),
    'late joiner snapshot has recent chat messages',
  );
  check(
    cLateJoin?.type === 'room:joined' && cLateJoin.snapshot.chat.some((m) => m.kind === 'system' && m.text.includes('Chatty joined')),
    'join system line is in chat history',
  );
  const leaveMark = cHost.mark();
  cGuest.send({ type: 'room:leave' });
  check(
    !!(await cHost.waitFor((m) => m.type === 'chat:message' && m.message.kind === 'system' && m.message.text.includes('Chatty left'), leaveMark)),
    'leave system line is broadcast',
  );
  console.log('host migration while playing');
  const mpHost = await mk();
  const mpRoom = await createRoom(mpHost);
  const mpGuest = await mk();
  await join(mpGuest, mpRoom.snapshot.code, 'MP');
  await mpHost.request({ type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
  const mpMark = mpGuest.mark();
  mpHost.ws.terminate();
  await mpGuest.waitFor((m) => m.type === 'host:changed', mpMark, 4000);
  const mpTypes = mpGuest.msgs.slice(mpMark).map((m) => m.type);
  const pIdx = mpGuest.msgs.slice(mpMark).findIndex((m) => m.type === 'playback:state' && m.playback.status === 'paused');
  check(pIdx >= 0 && pIdx < mpTypes.indexOf('host:changed'), 'paused playback:state is broadcast before host:changed');

  console.log('screen share signaling');
  const sHost = await mk();
  const sRoom = await createRoom(sHost);
  const sA = await mk();
  const sB = await mk();
  const sAj = await join(sA, sRoom.snapshot.code, 'A');
  const sBj = await join(sB, sRoom.snapshot.code, 'B');
  const aId = sAj?.type === 'room:joined' ? sAj.selfId : '';
  const bId = sBj?.type === 'room:joined' ? sBj.selfId : '';
  const shareReply = await sHost.request({ type: 'share:start', source: 'screen', hasAudio: false });
  const screen = shareReply?.type === 'media:state' && shareReply.media?.kind === 'screen' ? shareReply.media : null;
  check(!!screen && screen.sharerId === sRoom.selfId, 'share:start screen replies with screen media');
  const sid = screen?.sessionId ?? '';
  const aSawShare = await sA.waitFor((m) => m.type === 'media:state' && m.media?.kind === 'screen');
  check(!!aSawShare, 'viewers receive the screen media');

  const sMark = { host: sHost.mark(), a: sA.mark(), b: sB.mark() };
  sA.send({ type: 'rtc:signal', to: sRoom.selfId, sessionId: sid, linkId: 'linkA', data: { t: 'viewer-ready' } });
  const gotReady = await sHost.waitFor((m) => m.type === 'rtc:signal' && m.from === aId && m.linkId === 'linkA', sMark.host);
  check(!!gotReady, 'viewer-ready reaches the sharer with from and linkId');
  sHost.send({ type: 'rtc:signal', to: aId, sessionId: sid, linkId: 'linkA', data: { t: 'candidate', candidate: null } });
  const gotCand = await sA.waitFor((m) => m.type === 'rtc:signal' && m.from === sRoom.selfId, sMark.a);
  check(!!gotCand, 'sharer signal reaches the targeted viewer');
  sA.send({ type: 'rtc:signal', to: bId, sessionId: sid, linkId: 'linkA', data: { t: 'viewer-ready' } });
  await sleep(300);
  const leaked = (c: Client, since: number) => c.msgs.slice(since).some((m) => m.type === 'rtc:signal');
  check(!leaked(sB, sMark.b), 'the third client receives no signals, and viewer-to-viewer is dropped');

  const tMark = sHost.mark();
  sHost.send({ type: 'host:transfer', to: aId });
  // The old host is now a co-host and keeps sharing; the new host (a controller) can stop it.
  await sleep(200);
  check(!sHost.msgs.slice(tMark).some((m) => m.type === 'media:state'), 'host:transfer keeps the old host sharing as co-host');
  sA.send({ type: 'share:stop' });
  const oldHostMedia = await sHost.waitFor((m) => m.type === 'media:state', tMark);
  check(
    oldHostMedia?.type === 'media:state' && oldHostMedia.media === null && !('sessionId' in oldHostMedia),
    'old host receives media:state with media null after the new host stops the share',
  );

  const sh2 = await sA.request({ type: 'share:start', source: 'screen', hasAudio: false });
  check(sh2?.type === 'media:state' && sh2.media?.kind === 'screen', 'the new host can start a share');
  const dMark = sB.mark();
  sA.ws.terminate();
  const closedShare = await sB.waitFor((m) => m.type === 'media:state' && m.media === null, dMark, 2000);
  check(!!closedShare, 'share teardown is broadcast when the sharer socket closes');

  console.log('local file flow');
  const lfMeta = { name: 'movie.mp4', size: 1234, lastModified: 99, mime: 'video/mp4', durationSec: 60 };
  const lHost = await mk();
  const lRoom = await createRoom(lHost);
  const lGuest = await mk();
  const lgj = await join(lGuest, lRoom.snapshot.code, 'LG');
  const lgId = lgj?.type === 'room:joined' ? lgj.selfId : '';
  const lSet = await lHost.request({ type: 'media:set', media: { kind: 'local', file: lfMeta, delivery: 'same-file' } });
  check(
    lSet?.type === 'media:state' && lSet.media?.kind === 'local' && lSet.playback.status === 'paused' && lSet.playback.positionSec === 0,
    'local media is accepted and starts paused at 0',
  );
  const lRev = lSet?.type === 'media:state' && lSet.media ? lSet.media.rev : -1;
  const lMark = lHost.mark();
  lGuest.send({ type: 'local:ready', rev: lRev, ready: true });
  const readyMsg = await lHost.waitFor((m) => m.type === 'participant:updated' && m.participant.id === lgId && m.participant.hasFile === true, lMark);
  check(!!readyMsg, 'local:ready sets hasFile and broadcasts participant:updated');
  const lShare = await lHost.request({ type: 'share:start', source: 'file', hasAudio: true, file: lfMeta });
  check(
    lShare?.type === 'media:state' && lShare.media?.kind === 'local' && lShare.media.delivery === 'stream' && !!lShare.media.sessionId,
    'share:start file converts the media to a stream',
  );
  const lStop = await lHost.request({ type: 'share:stop' });
  void lStop;
  const lLate = await mk();
  const llj = await join(lLate, lRoom.snapshot.code, 'LL');
  check(
    llj?.type === 'room:joined' &&
      llj.snapshot.media?.kind === 'local' &&
      llj.snapshot.media.delivery === 'same-file' &&
      llj.snapshot.participants.find((p) => p.id === lgId)?.hasFile === true,
    'share:stop falls back to same-file and keeps hasFile',
  );
  // The server allows 20 connections per IP and this script keeps every client open, so free these early.
  for (const c of [lHost, lGuest, lLate]) c.ws.terminate();
  await sleep(100);

  // Free connections first: the server allows 20 per IP.
  for (const c of open) c.ws.terminate();
  open.length = 0;
  await sleep(150);

  console.log('games');
  const gHost = await mk();
  const gRoom = await createRoom(gHost);
  const gA = await mk();
  const gB = await mk();
  await join(gA, gRoom.snapshot.code, 'GA');
  await join(gB, gRoom.snapshot.code, 'GB');
  const lastGame = (c: Client) => {
    const m = [...c.msgs].reverse().find((x) => x.type === 'game:state');
    return m?.type === 'game:state' ? m.game : undefined;
  };
  const gameMark = gB.mark();
  gHost.send({ type: 'game:open', kind: 'tictactoe' });
  check((await gB.waitFor((m) => m.type === 'game:state' && m.game?.kind === 'tictactoe', gameMark))?.type === 'game:state', 'game:open reaches everyone');
  const reopen = await gA.waitFor((m) => m.type === 'game:state');
  check(!!reopen, 'participants receive the opened game');
  gHost.send({ type: 'game:action', action: { type: 'sit', mark: 'X' } });
  gA.send({ type: 'game:action', action: { type: 'sit', mark: 'O' } });
  await gB.waitFor((m) => m.type === 'game:state' && m.game?.kind === 'tictactoe' && m.game.status === 'playing', gameMark);
  gHost.send({ type: 'game:action', action: { type: 'move', index: 4 } });
  await gB.waitFor((m) => m.type === 'game:state' && m.game?.kind === 'tictactoe' && m.game.board[4] === 'X', gameMark);
  const legal = lastGame(gB);
  check(legal?.kind === 'tictactoe' && legal.board[4] === 'X' && legal.turn === 'O', 'a legal TTT move is applied and broadcast');

  await sleep(100);
  const snapshotOf = (g: unknown) => JSON.stringify(g);
  const before = snapshotOf(lastGame(gB));
  const emarkA = gA.mark();
  const emarkB = gB.mark();
  const illegal = await gA.request({ type: 'game:action', action: { type: 'move', index: 4 } });
  check(illegal?.type === 'error' && illegal.code === 'invalid_state', 'a move on an occupied square is invalid_state');
  const wrongTurn = await gHost.request({ type: 'game:action', action: { type: 'move', index: 0 } });
  check(wrongTurn?.type === 'error' && wrongTurn.code === 'invalid_state', 'a move out of turn is invalid_state');
  const spectator = await gB.request({ type: 'game:action', action: { type: 'move', index: 0 } });
  check(spectator?.type === 'error' && spectator.code === 'forbidden', 'a spectator move is forbidden');
  for (const action of [{ type: 'move', index: '1' }, { type: 'move', index: 12 }, { type: 'skipTurn' }, { type: 'roll' }, { type: 'sit', color: 'red' }]) {
    const r = await gA.request({ type: 'game:action', action } as unknown as ClientMessage);
    check(r?.type === 'error' && r.code === 'bad_request', `garbage action ${JSON.stringify(action)} is bad_request`);
  }
  await sleep(150);
  check(
    snapshotOf(lastGame(gB)) === before &&
      !gA.msgs.slice(emarkA).some((m) => m.type === 'game:state') &&
      !gB.msgs.slice(emarkB).some((m) => m.type === 'game:state'),
    'rejected game actions leave the state unchanged and broadcast nothing',
  );

  gHost.send({ type: 'game:close' });
  await gB.waitFor((m) => m.type === 'game:state' && m.game === null, emarkB);
  check(lastGame(gB) === null, 'game:close clears the game for everyone');

  console.log('rps hidden picks');
  gHost.send({ type: 'game:open', kind: 'rps' });
  gHost.send({ type: 'game:action', action: { type: 'join' } });
  gA.send({ type: 'game:action', action: { type: 'join' } });
  await gB.waitFor((m) => m.type === 'game:state' && m.game?.kind === 'rps' && m.game.players.length === 2, emarkB);
  gHost.send({ type: 'game:action', action: { type: 'start' } });
  await gB.waitFor((m) => m.type === 'game:state' && m.game?.kind === 'rps' && m.game.phase === 'choosing', emarkB);
  const pickMark = gB.mark();
  gHost.send({ type: 'game:action', action: { type: 'pick', choice: 'rock' } });
  const hostPicked = await gA.waitFor((m) => m.type === 'game:state' && m.game?.kind === 'rps' && m.game.picks[gRoom.selfId] === 'locked', emarkA);
  check(!!hostPicked, "another player sees the host's pick as locked");
  await sleep(100);
  check(!gB.msgs.slice(pickMark).some((m) => JSON.stringify(m).includes('rock')), 'a spectator never receives the hidden pick');
  check(!gA.msgs.slice(emarkA).some((m) => m.type === 'game:state' && JSON.stringify(m).includes('rock')), 'the other player never receives the hidden pick before the reveal');
  const gLate = await mk();
  const gLateJoin = await join(gLate, gRoom.snapshot.code, 'GL');
  check(
    gLateJoin?.type === 'room:joined' && gLateJoin.snapshot.game?.kind === 'rps' && !JSON.stringify(gLateJoin.snapshot.game).includes('rock'),
    'a late joiner snapshot does not reveal the pick',
  );
  gA.send({ type: 'game:action', action: { type: 'pick', choice: 'scissors' } });
  const revealed = await gB.waitFor((m) => m.type === 'game:state' && m.game?.kind === 'rps' && m.game.phase === 'revealed', pickMark);
  check(
    revealed?.type === 'game:state' && revealed.game?.kind === 'rps' && revealed.game.picks[gRoom.selfId] === 'rock' && revealed.game.result?.winners[0] === gRoom.selfId,
    'picks are revealed to everyone once all have chosen',
  );
  gHost.send({ type: 'game:close' });

  console.log('ludo turn order');
  gHost.send({ type: 'game:open', kind: 'ludo' });
  gHost.send({ type: 'game:action', action: { type: 'sit', color: 'red' } });
  gA.send({ type: 'game:action', action: { type: 'sit', color: 'green' } });
  await gB.waitFor((m) => m.type === 'game:state' && m.game?.kind === 'ludo' && m.game.seats.filter((s) => s.playerId).length === 2, pickMark);
  gHost.send({ type: 'game:action', action: { type: 'start' } });
  await gB.waitFor((m) => m.type === 'game:state' && m.game?.kind === 'ludo' && m.game.phase === 'playing', pickMark);
  const outOfTurn = await gA.request({ type: 'game:action', action: { type: 'roll' } });
  check(outOfTurn?.type === 'error' && outOfTurn.code === 'invalid_state', 'a Ludo roll out of turn is rejected');
  const ludoBefore = lastGame(gB);
  check(ludoBefore?.kind === 'ludo' && ludoBefore.turn === 'red' && ludoBefore.rollId === 0, 'Ludo state is unchanged after the rejection');
  const rollMark = gA.mark();
  gHost.send({ type: 'game:action', action: { type: 'roll', dice: 6 } } as unknown as ClientMessage); // extra field is dropped
  const rolled = await gA.waitFor((m) => m.type === 'game:state' && m.game?.kind === 'ludo' && m.game.rollId === 1, rollMark);
  check(
    rolled?.type === 'game:state' && rolled.game?.kind === 'ludo' && rolled.game.lastRoll?.color === 'red' && rolled.game.lastRoll.value >= 1 && rolled.game.lastRoll.value <= 6,
    'the server rolls the dice for the turn owner',
  );
  for (const c of open) c.ws.terminate();
  open.length = 0;
  await sleep(150);

  console.log('roles, co-host playback, moderation and reactions');
  const rHost = await mk();
  const rRoom = await createRoom(rHost);
  const rCo = await mk();
  const rMem = await mk();
  const rcj = await join(rCo, rRoom.snapshot.code, 'Co');
  const rmj = await join(rMem, rRoom.snapshot.code, 'Mem');
  const coId = rcj?.type === 'room:joined' ? rcj.selfId : '';
  const memId = rmj?.type === 'room:joined' ? rmj.selfId : '';
  check(rmj?.type === 'room:joined' && rmj.snapshot.participants.find((p) => p.id === memId)?.role === 'member', 'joiners are members');

  const spoof = await rMem.request({ type: 'role:set', to: memId, role: 'co_host' });
  check(spoof?.type === 'error' && spoof.code === 'not_host', 'a member cannot promote itself');
  const promoted = await rHost.waitFor((m) => m.type === 'participant:updated', rHost.mark(), 50);
  void promoted;
  const pMark = rMem.mark();
  rHost.send({ type: 'role:set', to: coId, role: 'co_host' });
  const sawPromo = await rMem.waitFor((m) => m.type === 'participant:updated' && m.participant.id === coId && m.participant.role === 'co_host', pMark);
  check(!!sawPromo, 'promotion is broadcast with the new role');

  const coSet = await rCo.request({ type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
  check(coSet?.type === 'media:state' && coSet.media?.kind === 'youtube', 'a co-host can set the video');
  const rRev = coSet?.type === 'media:state' && coSet.media ? coSet.media.rev : -1;
  const coPlay = await rCo.request({ type: 'playback:command', rev: rRev, action: 'seek', positionSec: 12 });
  void coPlay;
  const seen = await rHost.waitFor((m) => m.type === 'playback:state' && m.playback.positionSec === 12 && m.playback.by === coId);
  check(!!seen, 'a co-host seek reaches the host stamped with the co-host id (echo guard)');
  const memPlay = await rMem.request({ type: 'playback:command', rev: rRev, action: 'play', positionSec: 0 });
  check(memPlay?.type === 'error' && memPlay.code === 'not_host', 'a member cannot control playback');
  const memSkip = await rMem.request({ type: 'queue:skip' });
  check(memSkip?.type === 'error', 'a member cannot skip');
  const coSettings = await rCo.request({ type: 'room:settings', autoNext: false });
  check(coSettings?.type === 'error', 'a co-host cannot change room settings');
  const coRole = await rCo.request({ type: 'role:set', to: memId, role: 'co_host' });
  check(coRole?.type === 'error', 'a co-host cannot manage roles');
  const coXfer = await rCo.request({ type: 'host:transfer', to: memId });
  check(coXfer?.type === 'error', 'a co-host cannot transfer the host');

  const chat1 = await rHost.request({ type: 'chat:send', text: 'to be deleted' });
  void chat1;
  const delTarget = await rMem.waitFor((m) => m.type === 'chat:message' && m.message.text === 'to be deleted');
  const delId = delTarget?.type === 'chat:message' ? delTarget.message.id : '';
  const coDelHost = await rCo.request({ type: 'chat:delete', messageId: delId });
  check(coDelHost?.type === 'error', 'a co-host cannot delete the host\'s message');
  const memMark = rMem.mark();
  const hostDel = await rHost.request({ type: 'chat:delete', messageId: delId });
  void hostDel;
  check(!!(await rMem.waitFor((m) => m.type === 'chat:deleted' && m.id === delId, memMark)), 'chat:delete is broadcast');
  const rLate = await mk();
  const rlj = await join(rLate, rRoom.snapshot.code, 'Late');
  check(rlj?.type === 'room:joined' && !rlj.snapshot.chat.some((m) => m.id === delId), 'a late joiner does not see the deleted message');
  check(rlj?.type === 'room:joined' && rlj.snapshot.participants.some((p) => p.id === coId && p.role === 'co_host'), 'a late joiner sees current roles');

  const coMute = await rCo.request({ type: 'chat:mute', id: memId, muted: true });
  void coMute;
  check(!!(await rMem.waitFor((m) => m.type === 'participant:updated' && m.participant.id === memId && m.participant.muted === true)), 'a co-host can mute a member');
  const mutedChat = await rMem.request({ type: 'chat:send', text: 'can you hear me' });
  check(mutedChat?.type === 'error' && mutedChat.code === 'forbidden', 'a muted member cannot chat');
  const rxMark = rHost.mark();
  rMem.send({ type: 'reaction:send', emoji: '\u{1F525}' });
  check(!!(await rHost.waitFor((m) => m.type === 'reaction' && m.from === memId, rxMark)), 'a muted member can still react');
  rMem.send({ type: 'reaction:send', emoji: 'not-allowed' });
  await sleep(150);
  check(!rHost.msgs.some((m) => m.type === 'reaction' && m.emoji === 'not-allowed'), 'an emoji outside the list is not relayed');
  const hostMuteCo = await rHost.request({ type: 'chat:mute', id: rRoom.selfId, muted: true });
  check(hostMuteCo?.type === 'error', 'nobody can mute the host');

  const sugMark = rHost.mark();
  const sug = await rMem.request({ type: 'queue:add', videoId: V2 });
  check(sug?.type === 'suggestions:updated', 'a member add is a suggestion and does not start playback');
  const sNotice = await rHost.waitFor((m) => m.type === 'queue:notice' && m.kind === 'suggested', sugMark);
  check(!!sNotice, 'controllers get a suggestion notice');
  const coResume = await rCo.request({ type: 'playback:command', rev: rRev, action: 'play', positionSec: 12 });
  void coResume;
  check(rHost.msgs.slice(sugMark).every((m) => m.type !== 'media:state' || m.media?.kind === 'youtube'), 'the suggestion did not change the current media');

  const xMark = rMem.mark();
  rHost.send({ type: 'host:transfer', to: coId });
  check(!!(await rMem.waitFor((m) => m.type === 'host:changed' && m.hostId === coId, xMark)), 'host transfer is broadcast');
  const oldHost = await rHost.request({ type: 'room:settings', autoNext: false });
  check(oldHost?.type === 'error', 'the former host is now a co-host and cannot change settings');
  const newHostSettings = await rCo.request({ type: 'room:settings', autoNext: false });
  check(newHostSettings?.type !== 'error', 'the new host can change settings');
  const lMark2 = rMem.mark();
  rCo.ws.terminate();
  const succ = await rMem.waitFor((m) => m.type === 'host:changed', lMark2, 4000);
  check(succ?.type === 'host:changed' && succ.hostId === rRoom.selfId, 'when the host drops, the longest-connected co-host takes over');
  for (const c of [rHost, rCo, rMem, rLate]) c.ws.terminate();
  await sleep(100);
  console.log('transport rules');
  const evil = await new Promise<number>((resolve) => {
    const ws = new WebSocket(URL_WS, { origin: 'http://evil.example' });
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.once('open', () => resolve(101));
    ws.once('error', () => resolve(-1));
  });
  check(evil === 403, 'a disallowed Origin is rejected with 403');

  const big = await mk();
  big.ws.send(JSON.stringify({ type: 'chat:send', text: 'x'.repeat(70 * 1024) }));
  check((await big.waitClosed()) === 1009, 'a frame over 64 KiB closes the socket with 1009');

  const bad = await mk();
  bad.ws.send('not json');
  const badJson = await bad.waitFor((m) => m.type === 'error' && m.code === 'bad_request');
  check(!!badJson, 'invalid JSON gets bad_request and the connection stays open');
  const afterJson = bad.mark();
  bad.send({ type: 'nope' } as unknown as ClientMessage);
  const unknown = await bad.waitFor((m) => m.type === 'error' && m.code === 'bad_request', afterJson);
  check(!!unknown && bad.closeCode === null, 'unknown message type gets bad_request');

  console.log('idle rule (IDLE_MS=1000)');
  const active = await mk();
  const silent = await mk();
  for (let i = 0; i < 6; i++) {
    active.send({ type: 'room:peek', code });
    await sleep(400);
  }
  check(active.closeCode === null, 'a socket that keeps peeking survives past IDLE_MS');
  check((await silent.waitClosed(1500)) === 1008, 'a silent socket is closed with 1008');

  open.forEach((c) => c.ws.terminate());
}

main()
  .catch((err) => {
    console.error(err);
    failures.push(`unexpected error: ${String(err)}`);
  })
  .finally(() => {
    console.log(`\n${checks - failures.length}/${checks} checks passed`);
    if (failures.length) {
      console.error(`Failed:\n - ${failures.join('\n - ')}`);
      process.exit(1);
    }
    process.exit(0);
  });
