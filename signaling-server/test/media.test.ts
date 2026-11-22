import { describe, expect, it } from 'vitest';
import { makeCtx, profile } from './helpers';

type Ctx = ReturnType<typeof makeCtx>;

const V1 = 'dQw4w9WgXcQ';
const V2 = 'aaaaaaaaaaa';
const V3 = 'bbbbbbbbbbb';

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

describe('media:set', () => {
  it('starts youtube playing at 0 and broadcasts media:state with a ref copy for the host', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(host.conn, { type: 'media:set', ref: 'm1', media: { kind: 'youtube', videoId: V1 } });
    const hostMsg = host.socket.last('media:state')!;
    expect(hostMsg.ref).toBe('m1');
    expect(hostMsg.media).toMatchObject({ kind: 'youtube', videoId: V1, rev: 1, startedBy: host.id });
    expect(hostMsg.playback).toMatchObject({ rev: 1, status: 'playing', positionSec: 0 });
    const guestMsg = guest.socket.last('media:state')!;
    expect(guestMsg.ref).toBeUndefined();
    expect(guestMsg.media).toEqual(hostMsg.media);
  });

  it('local same-file media starts paused at 0', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const file = { name: 'a.mp4', size: 10, lastModified: 5, mime: 'video/mp4' };
    await t.send(host.conn, { type: 'media:set', media: { kind: 'local', file, delivery: 'same-file' } });
    expect(host.socket.last('media:state')!.playback).toMatchObject({ status: 'paused', positionSec: 0 });
  });

  it('rejects a non-host with not_host and leaves state unchanged', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(guest.conn, { type: 'media:set', ref: 'x', media: { kind: 'youtube', videoId: V1 } });
    expect(guest.socket.last('error')).toMatchObject({ code: 'not_host', ref: 'x' });
    expect(room(t, host.code).media).toBeNull();
  });

  it('identical media is a no-op success that replies only to the requester', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    host.socket.clear();
    guest.socket.clear();
    await t.send(host.conn, { type: 'media:set', ref: 'again', media: { kind: 'youtube', videoId: V1 } });
    expect(host.socket.last('media:state')?.ref).toBe('again');
    expect(guest.socket.sent).toEqual([]);
    expect(room(t, host.code).mediaRev).toBe(1);
  });

  it('media:set null clears media and pauses', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'media:set', media: null });
    const msg = host.socket.last('media:state')!;
    expect(msg.media).toBeNull();
    expect(msg.playback.status).toBe('paused');
  });
});

describe('playback:command', () => {
  async function playing() {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    host.socket.clear();
    guest.socket.clear();
    return { t, host, guest };
  }

  it('non-host command returns not_host and leaves state unchanged', async () => {
    const { t, host, guest } = await playing();
    const before = { ...room(t, host.code).playback };
    await t.send(guest.conn, { type: 'playback:command', rev: 1, action: 'pause', positionSec: 30 });
    expect(guest.socket.last('error')?.code).toBe('not_host');
    expect(room(t, host.code).playback).toEqual(before);
    expect(host.socket.sent).toEqual([]);
  });

  it('host pause and seek are broadcast to everyone', async () => {
    const { t, host, guest } = await playing();
    t.clock.advance(1000);
    await t.send(host.conn, { type: 'playback:command', rev: 1, action: 'pause', positionSec: 12 });
    expect(guest.socket.last('playback:state')!.playback).toMatchObject({ status: 'paused', positionSec: 12, rev: 1 });
    await t.send(host.conn, { type: 'playback:command', rev: 1, action: 'seek', positionSec: 40 });
    expect(guest.socket.last('playback:state')!.playback).toMatchObject({ status: 'paused', positionSec: 40 });
    await t.send(host.conn, { type: 'playback:command', rev: 1, action: 'play', positionSec: 40 });
    expect(host.socket.last('playback:state')!.playback.status).toBe('playing');
  });

  it('uses hostServerTime within the 2 s clamp', async () => {
    const { t, host } = await playing();
    t.clock.advance(5000);
    const now = t.clock.now();
    await t.send(host.conn, { type: 'playback:command', rev: 1, action: 'play', positionSec: 8, hostServerTime: now - 500 });
    expect(room(t, host.code).playback.updatedAt).toBe(now - 500);
    await t.send(host.conn, { type: 'playback:command', rev: 1, action: 'play', positionSec: 8, hostServerTime: now - 9000 });
    expect(room(t, host.code).playback.updatedAt).toBe(now - 2000);
  });

  it('a stale rev gets stale and changes nothing', async () => {
    const { t, host } = await playing();
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V2 } });
    const before = { ...room(t, host.code).playback };
    await t.send(host.conn, { type: 'playback:command', rev: 1, action: 'pause', positionSec: 3 });
    expect(host.socket.last('error')?.code).toBe('stale');
    expect(room(t, host.code).playback).toEqual(before);
  });

  it('is invalid_state with no media', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'playback:command', rev: 0, action: 'play', positionSec: 0 });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
  });

  it('late joiner snapshot carries media, extrapolatable position and queue', async () => {
    const { t, host } = await playing();
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(host.conn, { type: 'playback:command', rev: 1, action: 'seek', positionSec: 20 });
    const late = await join(t, host.code, 'Late');
    const snap = late.socket.last('room:joined')!.snapshot;
    expect(snap.media).toMatchObject({ kind: 'youtube', videoId: V1 });
    expect(snap.playback).toMatchObject({ status: 'playing', positionSec: 20 });
    expect(snap.queue.map((q) => q.videoId)).toEqual([V2]);
  });

  it('host migration while playing broadcasts a paused playback:state before host:changed', async () => {
    const { t, host, guest } = await playing();
    t.clock.advance(4000);
    await t.send(host.conn, { type: 'room:leave' });
    const types = guest.socket.sent.map((m) => m.type);
    expect(types.indexOf('playback:state')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('playback:state')).toBeLessThan(types.indexOf('host:changed'));
    expect(guest.socket.last('playback:state')!.playback).toMatchObject({ status: 'paused', positionSec: 4 });
    const late = await join(t, host.code, 'Late');
    expect(late.socket.last('room:joined')!.snapshot.playback).toMatchObject({ status: 'paused', positionSec: 4 });
  });
});

describe('queue', () => {
  it('the first add by the host with no media starts playing and replies media:state', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(host.conn, { type: 'queue:add', ref: 'q1', videoId: V1 });
    expect(host.socket.last('media:state')).toMatchObject({ ref: 'q1', media: { kind: 'youtube', videoId: V1, startedBy: host.id } });
    expect(guest.socket.last('media:state')?.ref).toBeUndefined();
    expect(room(t, host.code).queue).toEqual([]);
  });

  it('a member add in an idle room becomes a suggestion and never starts playback', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(guest.conn, { type: 'queue:add', ref: 'q1', videoId: V1 });
    expect(guest.socket.last('suggestions:updated')).toMatchObject({ ref: 'q1' });
    expect(host.socket.last('suggestions:updated')?.ref).toBeUndefined();
    expect(room(t, host.code).media).toBeNull();
    expect(room(t, host.code).queue).toEqual([]);
    expect(room(t, host.code).suggestions).toMatchObject([{ videoId: V1, addedBy: guest.id }]);
  });

  it('later member adds wait for approval and the requester gets the ref copy', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(guest.conn, { type: 'queue:add', ref: 'q2', videoId: V2, title: 'Cats' });
    expect(guest.socket.last('suggestions:updated')!.ref).toBe('q2');
    expect(host.socket.last('suggestions:updated')!.ref).toBeUndefined();
    expect(host.socket.last('suggestions:updated')!.suggestions[0]).toMatchObject({ videoId: V2, title: 'Cats', addedBy: guest.id });
    expect(room(t, host.code).queue).toEqual([]);
  });

  it('with approval off a member add goes to the queue and does not start an idle room', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    room(t, host.code).settings.requireApproval = false;
    await t.send(guest.conn, { type: 'queue:add', ref: 'q3', videoId: V2 });
    expect(guest.socket.last('queue:updated')!.ref).toBe('q3');
    expect(host.socket.last('queue:updated')!.queue[0]).toMatchObject({ videoId: V2, addedBy: guest.id });
    expect(room(t, host.code).media).toBeNull();
  });
  it('rejects a consecutive duplicate and a duplicate of the current media', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V1 });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
    expect(room(t, host.code).queue).toHaveLength(1);
  });

  it('limits a user to 10 pending items', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    for (let i = 0; i < 10; i++) await t.send(host.conn, { type: 'queue:add', videoId: `video${String(i).padStart(6, '0')}` });
    expect(room(t, host.code).queue).toHaveLength(10);
    await t.send(host.conn, { type: 'queue:add', videoId: V3 });
    expect(host.socket.last('error')?.code).toBe('forbidden');
  });

  it('queue:play removes the item and makes it the current media', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(host.conn, { type: 'queue:add', videoId: V3 });
    const [first, second] = room(t, host.code).queue;
    await t.send(host.conn, { type: 'queue:play', ref: 'p', itemId: second!.id });
    const msg = host.socket.last('media:state')!;
    expect(msg.ref).toBe('p');
    expect(msg.media).toMatchObject({ videoId: V3, rev: 2 });
    expect(msg.queue.map((q) => q.id)).toEqual([first!.id]);
  });

  it('queue:play by a non-host is not_host', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(guest.conn, { type: 'queue:play', itemId: room(t, host.code).queue[0]!.id });
    expect(guest.socket.last('error')?.code).toBe('not_host');
    expect(room(t, host.code).queue).toHaveLength(1);
  });

  it('remove: host or adder only', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const a = await join(t, host.code, 'A');
    const b = await join(t, host.code, 'B');
    room(t, host.code).settings.requireApproval = false;
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(a.conn, { type: 'queue:add', videoId: V2 });
    await t.send(a.conn, { type: 'queue:add', videoId: V3 });
    const [x, y] = room(t, host.code).queue;
    await t.send(b.conn, { type: 'queue:remove', itemId: x!.id });
    expect(b.socket.last('error')?.code).toBe('forbidden');
    await t.send(a.conn, { type: 'queue:remove', itemId: x!.id });
    await t.send(host.conn, { type: 'queue:remove', itemId: y!.id });
    expect(room(t, host.code).queue).toEqual([]);
    await t.send(host.conn, { type: 'queue:remove', itemId: y!.id });
    expect(host.socket.last('error')?.code).toBe('not_found');
  });

  it('reorder: host only, and the same index is a requester-only no-op reply', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(host.conn, { type: 'queue:add', videoId: V3 });
    const [x, y] = room(t, host.code).queue;
    await t.send(guest.conn, { type: 'queue:reorder', itemId: x!.id, toIndex: 1 });
    expect(guest.socket.last('error')?.code).toBe('not_host');
    await t.send(host.conn, { type: 'queue:reorder', ref: 'r', itemId: y!.id, toIndex: 0 });
    expect(room(t, host.code).queue.map((q) => q.id)).toEqual([y!.id, x!.id]);
    expect(host.socket.last('queue:updated')?.ref).toBe('r');
    host.socket.clear();
    guest.socket.clear();
    await t.send(host.conn, { type: 'queue:reorder', ref: 'same', itemId: y!.id, toIndex: 0 });
    expect(host.socket.last('queue:updated')?.ref).toBe('same');
    expect(guest.socket.sent).toEqual([]);
  });
});

describe('media:ended and media:error', () => {
  it('auto-advances to the first queue item', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(host.conn, { type: 'media:ended', rev: 1 });
    const msg = guest.socket.last('media:state')!;
    expect(msg.media).toMatchObject({ videoId: V2, rev: 2 });
    expect(msg.playback).toMatchObject({ status: 'playing', positionSec: 0, rev: 2 });
    expect(msg.queue).toEqual([]);
  });

  it('with an empty queue it pauses in place', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    t.clock.advance(7000);
    await t.send(host.conn, { type: 'media:ended', rev: 1 });
    expect(host.socket.last('playback:state')!.playback).toMatchObject({ status: 'paused', positionSec: 7 });
    expect(room(t, host.code).media).toMatchObject({ videoId: V1 });
  });

  it('ignores a stale rev and rejects non-hosts', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(host.conn, { type: 'media:ended', rev: 99 });
    expect(host.socket.last('error')?.code).toBe('stale');
    await t.send(guest.conn, { type: 'media:ended', rev: 1 });
    expect(guest.socket.last('error')?.code).toBe('not_host');
    expect(room(t, host.code).queue).toHaveLength(1);
  });

  it('media:error skips like ended and adds a chat line', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(host.conn, { type: 'media:error', rev: 1, code: 150 });
    expect(host.socket.last('media:state')!.media).toMatchObject({ videoId: V2 });
    expect(room(t, host.code).chat.at(-1)?.text).toContain("Skipped a video that couldn't be played");
  });
});
