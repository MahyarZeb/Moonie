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
