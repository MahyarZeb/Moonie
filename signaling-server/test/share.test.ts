import { describe, expect, it } from 'vitest';
import { makeCtx, profile } from './helpers';

type Ctx = ReturnType<typeof makeCtx>;

const V1 = 'dQw4w9WgXcQ';

async function createRoom(t: Ctx) {
  const c = t.connect();
  await t.send(c.conn, { type: 'room:create', name: 'Movie night', theme: 'cloud', ...profile('Host') });
  const joined = c.socket.last('room:joined')!;
  return { ...c, id: joined.selfId, code: joined.snapshot.code };
}

async function join(t: Ctx, code: string, name = 'Guest') {
  const c = t.connect();
  await t.send(c.conn, { type: 'room:join', code, ...profile(name, 'fox') });
  return { ...c, id: c.socket.last('room:joined')!.selfId };
}

const room = (t: Ctx, code: string) => t.registry.get(code)!;

async function startScreen(t: Ctx, host: Awaited<ReturnType<typeof createRoom>>) {
  await t.send(host.conn, { type: 'share:start', ref: 's1', source: 'screen', hasAudio: true });
  const msg = host.socket.last('media:state')!;
  if (msg.media?.kind !== 'screen') throw new Error('share did not start');
  return msg.media;
}

const signal = (to: string, sessionId: string, linkId = 'link1') =>
  ({ type: 'rtc:signal', to, sessionId, linkId, data: { t: 'viewer-ready' } }) as const;

describe('share:start screen', () => {
  it('sets screen media, replies with a ref and broadcasts without one', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    const media = await startScreen(t, host);
    expect(media).toMatchObject({ kind: 'screen', sharerId: host.id, hasAudio: true, rev: 1 });
    expect(host.socket.last('media:state')!.ref).toBe('s1');
    expect(guest.socket.last('media:state')!.ref).toBeUndefined();
    expect(room(t, host.code).shareSession).toEqual({ sessionId: media.sessionId, sharerId: host.id });
    expect(room(t, host.code).playback).toMatchObject({ status: 'paused', positionSec: 0, rev: 1 });
  });

  it('leaves the queue untouched when replacing youtube', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: 'aaaaaaaaaaa' });
    await startScreen(t, host);
    expect(room(t, host.code).queue).toHaveLength(1);
    expect(room(t, host.code).media?.kind).toBe('screen');
  });

  it('rejects non-hosts and a second share', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(guest.conn, { type: 'share:start', ref: 'x', source: 'screen', hasAudio: false });
    expect(guest.socket.last('error')).toMatchObject({ code: 'not_host', ref: 'x' });
    await startScreen(t, host);
    await t.send(host.conn, { type: 'share:start', ref: 'y', source: 'screen', hasAudio: false });
    expect(host.socket.last('error')).toMatchObject({ code: 'invalid_state', ref: 'y' });
  });

  it('share:stop ends the share; non-host share:stop is not_host', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await startScreen(t, host);
    await t.send(guest.conn, { type: 'share:stop' });
    expect(guest.socket.last('error')?.code).toBe('not_host');
    await t.send(host.conn, { type: 'share:stop' });
    expect(room(t, host.code).shareSession).toBeNull();
    expect(guest.socket.last('media:state')).toMatchObject({ media: null });
  });

  it('media:set ends the share first', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    await startScreen(t, host);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    expect(room(t, host.code).shareSession).toBeNull();
    expect(room(t, host.code).media).toMatchObject({ kind: 'youtube', rev: 3 });
  });

  it('streams a local file only when it matches the same-file media', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const file = { name: 'a.mp4', size: 10, lastModified: 5, mime: 'video/mp4' };
    await t.send(host.conn, { type: 'share:start', ref: 'f0', source: 'file', hasAudio: true, file });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
    await t.send(host.conn, { type: 'media:set', media: { kind: 'local', file, delivery: 'same-file' } });
    await t.send(host.conn, { type: 'share:start', ref: 'f1', source: 'file', hasAudio: true, file: { ...file, size: 11 } });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
    await t.send(host.conn, { type: 'share:start', ref: 'f2', source: 'file', hasAudio: true, file });
    expect(room(t, host.code).media).toMatchObject({ kind: 'local', delivery: 'stream', sharerId: host.id });
    expect(room(t, host.code).shareSession).not.toBeNull();
  });
});

describe('rtc:signal relay', () => {
  it('reaches only its target, in both directions between sharer and viewer', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const a = await join(t, host.code, 'A');
    const b = await join(t, host.code, 'B');
    const { sessionId } = await startScreen(t, host);
    [host, a, b].forEach((c) => c.socket.clear());

    await t.send(a.conn, signal(host.id, sessionId, 'linkA'));
    expect(host.socket.last('rtc:signal')).toEqual({
      type: 'rtc:signal',
      from: a.id,
      sessionId,
      linkId: 'linkA',
      data: { t: 'viewer-ready' },
    });
    expect(b.socket.of('rtc:signal')).toHaveLength(0);

    await t.send(host.conn, { ...signal(a.id, sessionId, 'linkA'), data: { t: 'candidate', candidate: null } });
    expect(a.socket.of('rtc:signal')).toHaveLength(1);
    expect(b.socket.of('rtc:signal')).toHaveLength(0);
  });

  it('drops viewer-to-viewer, wrong session, self, unknown and disconnected targets', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const a = await join(t, host.code, 'A');
    const b = await join(t, host.code, 'B');
    const { sessionId } = await startScreen(t, host);
    [host, a, b].forEach((c) => c.socket.clear());

    await t.send(a.conn, signal(b.id, sessionId));
    await t.send(a.conn, signal(host.id, 'wrong-session'));
    await t.send(a.conn, signal(a.id, sessionId));
    await t.send(a.conn, signal('nobody', sessionId));
    t.drop(b);
    await t.send(host.conn, signal(b.id, sessionId));
    for (const c of [host, a, b]) {
      expect(c.socket.of('rtc:signal')).toHaveLength(0);
      expect(c.socket.of('error')).toHaveLength(0);
    }
  });

  it('is dropped when no share is active', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const a = await join(t, host.code, 'A');
    a.socket.clear();
    await t.send(host.conn, signal(a.id, 'whatever'));
    expect(a.socket.of('rtc:signal')).toHaveLength(0);
  });
});

describe('share teardown', () => {
  it('host:transfer keeps the old host sharing because a co-host may share', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await startScreen(t, host);
    host.socket.clear();
    await t.send(host.conn, { type: 'host:transfer', to: guest.id });
    expect(host.socket.of('media:state')).toHaveLength(0);
    expect(room(t, host.code).shareSession).toMatchObject({ sharerId: host.id });
    expect(room(t, host.code).roleOf(host.id)).toBe('co_host');
    await t.send(host.conn, { type: 'share:stop' });
    expect(host.socket.last('media:state')?.media).toBeNull();
  });

  it('sharer socket close ends the share immediately', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await startScreen(t, host);
    guest.socket.clear();
    t.drop(host);
    expect(guest.socket.last('media:state')?.media).toBeNull();
    expect(room(t, host.code).shareSession).toBeNull();
  });
});
