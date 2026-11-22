import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@shared/protocol';
import { TransportError } from './types';
import { WebSocketTransport, type WebSocketLike } from './WebSocketTransport';

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: ClientMessage[] = [];
  closedByClient: number | undefined;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close(code?: number) {
    this.closedByClient = code;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  serverSend(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  fail() {
    this.onerror?.({});
    this.serverClose(1006);
  }
}

const PROFILE = { displayName: 'Mochi', avatar: 'cat' as const };
const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

function makeTransport() {
  return new WebSocketTransport({
    url: 'ws://signal.test',
    createSocket: (url) => new FakeWebSocket(url),
    getProfile: () => PROFILE,
    random: () => 0.5, // jitter factor 1.0
  });
}

const joinedMsg = (ref?: string): ServerMessage => ({
  type: 'room:joined',
  selfId: 'me',
  resumeToken: 'tok-1',
  resumed: false,
  snapshot: { code: 'ABCD23' } as never,
  ...(ref ? { ref } : {}),
});

async function connectAndJoin(t: WebSocketTransport) {
  const p = t.connect();
  last().open();
  await p;
  last().serverSend(joinedMsg());
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('connect', () => {
  it('resolves when open and reports status changes', async () => {
    const t = makeTransport();
    const statuses: string[] = [];
    t.onStatus((s) => statuses.push(s));
    const p = t.connect();
    expect(t.status).toBe('connecting');
    last().open();
    await p;
    expect(t.status).toBe('open');
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('rejects when the first attempt fails and ends in failed', async () => {
    const t = makeTransport();
    const p = t.connect();
    const assertion = expect(p).rejects.toBeInstanceOf(TransportError);
    last().fail();
    await assertion;
    expect(t.status).toBe('failed');
  });

  it('rejects with a configuration error when the url is missing', async () => {
    const t = new WebSocketTransport({ url: null });
    await expect(t.connect()).rejects.toMatchObject({ code: 'network', message: 'Signaling server is not configured' });
    expect(t.status).toBe('failed');
  });
});

describe('reconnect rules', () => {
  it.each([1008, 4000, 4001])('does not auto-reconnect after close code %i', async (code) => {
    const t = makeTransport();
    await connectAndJoin(t);
    last().serverClose(code);
    expect(t.status).toBe('closed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('auto-reconnects after a network drop (1006) and resumes with the token', async () => {
    const t = makeTransport();
    await connectAndJoin(t);
    last().serverClose(1006);
    expect(t.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(600);
    expect(FakeWebSocket.instances).toHaveLength(2);
    last().open();
    await vi.advanceTimersByTimeAsync(0);
    const joins = last().sent.filter((m) => m.type === 'room:join');
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({ code: 'ABCD23', resumeToken: 'tok-1', displayName: 'Mochi', avatar: 'cat' });
  });

  it('a rejected resume becomes room:closed{expired} and never a fresh join', async () => {
    const t = makeTransport();
    const msgs: ServerMessage[] = [];
    t.onMessage((m) => msgs.push(m));
    await connectAndJoin(t);
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(600);
    last().open();
    await vi.advanceTimersByTimeAsync(0);
    const join = last().sent.find((m) => m.type === 'room:join')!;
    last().serverSend({ type: 'error', code: 'not_found', message: 'gone', ref: join.ref });
    await vi.advanceTimersByTimeAsync(0);
    expect(msgs.some((m) => m.type === 'room:closed' && m.reason === 'expired')).toBe(true);
    // Another drop must not trigger a second join attempt, because the session was cleared.
    last().serverClose(1006);
    expect(t.status).toBe('closed');
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances.flatMap((w) => w.sent).filter((m) => m.type === 'room:join' && !m.resumeToken)).toHaveLength(0);
  });

  it('ignores invalid_state as the reply to a resume (already joined)', async () => {
    const t = makeTransport();
    const msgs: ServerMessage[] = [];
    t.onMessage((m) => msgs.push(m));
    await connectAndJoin(t);
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(600);
    last().open();
    await vi.advanceTimersByTimeAsync(0);
    const join = last().sent.find((m) => m.type === 'room:join')!;
    last().serverSend({ type: 'error', code: 'invalid_state', message: 'already', ref: join.ref });
    await vi.advanceTimersByTimeAsync(0);
    expect(msgs.some((m) => m.type === 'room:closed')).toBe(false);
  });

  it('goes to failed after 8 consecutive failed attempts', async () => {
    const t = makeTransport();
    await connectAndJoin(t);
    last().serverClose(1006);
    for (let i = 0; i < 12 && t.status !== 'failed'; i++) {
      await vi.advanceTimersByTimeAsync(9000);
      if (t.status === 'reconnecting' && last().readyState === 0) last().fail();
    }
    expect(t.status).toBe('failed');
    // the original socket plus 8 failed retries
    expect(FakeWebSocket.instances).toHaveLength(9);
  });

  it('while joined, a 1008 close needs a manual reconnect() that sends exactly one resume join', async () => {
    const t = makeTransport();
    const closes: (number | undefined)[] = [];
    t.onStatus((s, info) => s === 'closed' && closes.push(info?.closeCode));
    await connectAndJoin(t);
    last().serverClose(1008);
    expect(t.status).toBe('closed');
    expect(closes).toEqual([1008]);

    const errors: string[] = [];
    t.onLocalError((m) => errors.push(m));
    t.send({ type: 'chat:send', text: 'hello' });
    expect(errors).toEqual(['Not connected. Reconnect to keep going.']);
    expect(last().sent.filter((m) => m.type === 'chat:send')).toHaveLength(0);

    t.reconnect();
    expect(FakeWebSocket.instances).toHaveLength(2);
    last().open();
    await vi.advanceTimersByTimeAsync(0);
    const joins = last().sent.filter((m) => m.type === 'room:join');
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({ resumeToken: 'tok-1' });
  });

  it('coalesces dropped-send notices to one per 5 seconds', async () => {
    const t = makeTransport();
    const errors: string[] = [];
    t.onLocalError((m) => errors.push(m));
    t.send({ type: 'chat:send', text: 'a' });
    t.send({ type: 'chat:send', text: 'b' });
    expect(errors).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5100);
    t.send({ type: 'chat:send', text: 'c' });
    expect(errors).toHaveLength(2);
  });

  it('does not reconnect after an intentional disconnect', async () => {
    const t = makeTransport();
    await connectAndJoin(t);
    t.disconnect();
    expect(t.status).toBe('closed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('request', () => {
  it('resolves with the reply carrying the same ref', async () => {
    const t = makeTransport();
    const p0 = t.connect();
    last().open();
    await p0;
    const p = t.request({ type: 'room:peek', code: 'ABCD23' });
    const sent = last().sent[0];
    expect(sent.ref).toBeTruthy();
    last().serverSend({ type: 'room:info', ref: sent.ref, peek: { code: 'ABCD23' } });
    await expect(p).resolves.toMatchObject({ type: 'room:info' });
  });

  it('rejects with the server error code', async () => {
    const t = makeTransport();
    const p0 = t.connect();
    last().open();
    await p0;
    const p = t.request({ type: 'room:peek', code: 'ABCD23' });
    last().serverSend({ type: 'error', code: 'not_found', message: 'nope', ref: last().sent[0].ref });
    await expect(p).rejects.toMatchObject({ code: 'not_found' });
  });

  it('times out after 10 seconds', async () => {
    const t = makeTransport();
    const p0 = t.connect();
    last().open();
    await p0;
    const p = t.request({ type: 'room:peek', code: 'ABCD23' });
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
  });

  it('rejects at once while not open', async () => {
    const t = makeTransport();
    await expect(t.request({ type: 'room:peek', code: 'ABCD23' })).rejects.toMatchObject({ code: 'network' });
  });

  it('peekRoom connects lazily and returns the peek', async () => {
    const t = makeTransport();
    const p = t.peekRoom('ABCD23');
    last().open();
    await vi.advanceTimersByTimeAsync(0);
    last().serverSend({ type: 'room:info', ref: last().sent[0].ref, peek: { code: 'ABCD23', name: 'x' } });
    await expect(p).resolves.toMatchObject({ code: 'ABCD23' });
  });
});

describe('liveness and errors', () => {
  it('never closes a silent socket by itself (no client watchdog)', async () => {
    const t = makeTransport();
    await connectAndJoin(t);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(t.status).toBe('open');
    expect(last().closedByClient).toBeUndefined();
  });

  it('ignores stale errors and dispatches other unref-ed errors', async () => {
    const t = makeTransport();
    const msgs: ServerMessage[] = [];
    t.onMessage((m) => msgs.push(m));
    const p0 = t.connect();
    last().open();
    await p0;
    last().serverSend({ type: 'error', code: 'stale', message: 's' });
    last().serverSend({ type: 'error', code: 'not_host', message: 'h' });
    expect(msgs.map((m) => m.type === 'error' && m.code)).toEqual(['not_host']);
  });

  it('computes the clock offset from sync pongs', async () => {
    const t = makeTransport();
    await connectAndJoin(t); // joining starts the ping loop
    const ping = last().sent.find((m) => m.type === 'sync:ping')!;
    if (ping.type !== 'sync:ping') throw new Error('no ping');
    last().serverSend({ type: 'sync:pong', t0: ping.t0, serverTime: ping.t0 + 5000 });
    expect(Math.round(t.getClockOffsetMs() / 100) * 100).toBe(5000);
  });

  it('sends room:leave once and stops pinging', async () => {
    const t = makeTransport();
    await connectAndJoin(t);
    t.leaveRoom();
    t.leaveRoom();
    expect(last().sent.filter((m) => m.type === 'room:leave')).toHaveLength(1);
    const before = last().sent.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(last().sent.length).toBe(before);
  });
});
