import { describe, expect, it } from 'vitest';
import { ConnectionLimiter } from '../src/rateLimit';
import { makeCtx, profile } from './helpers';

type Ctx = ReturnType<typeof makeCtx>;
const V1 = 'dQw4w9WgXcQ';
const V2 = 'aaaaaaaaaaa';
const V3 = 'bbbbbbbbbbb';
const V4 = 'ccccccccccc';

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

/** Host plus a promoted co-host and a member. */
async function trio(t: Ctx) {
  const host = await createRoom(t);
  const co = await join(t, host.code, 'Co');
  const member = await join(t, host.code, 'Member');
  await t.send(host.conn, { type: 'role:set', to: co.id, role: 'co_host' });
  return { host, co, member };
}

describe('suggestions', () => {
  it('member adds are suggestions by default and carry the server-side adder, not a spoofed one', async () => {
    const t = makeCtx();
    const { host, member } = await trio(t);
    await t.send(member.conn, { type: 'queue:add', videoId: V1, addedBy: host.id, role: 'host' });
    expect(room(t, host.code).suggestions).toMatchObject([{ videoId: V1, addedBy: member.id }]);
    expect(room(t, host.code).queue).toEqual([]);
  });

  it('approve moves a suggestion to the queue and does not start an idle room', async () => {
    const t = makeCtx();
    const { host, co, member } = await trio(t);
    await t.send(member.conn, { type: 'queue:add', videoId: V1 });
    const item = room(t, host.code).suggestions[0]!;
    member.socket.clear();
    await t.send(co.conn, { type: 'queue:approve', ref: 'a', itemId: item.id });
    expect(room(t, host.code).queue).toMatchObject([{ id: item.id, videoId: V1 }]);
    expect(room(t, host.code).suggestions).toEqual([]);
    expect(room(t, host.code).media).toBeNull();
    expect(co.socket.last('queue:updated')?.ref).toBe('a');
    expect(member.socket.last('queue:updated')?.queue).toHaveLength(1);
    expect(member.socket.last('suggestions:updated')?.suggestions).toEqual([]);
    expect(member.socket.of('media:state')).toHaveLength(0);
  });

  it('approve can put an item first in line', async () => {
    const t = makeCtx();
    const { host, member } = await trio(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(member.conn, { type: 'queue:add', videoId: V3 });
    await t.send(host.conn, { type: 'queue:approve', itemId: room(t, host.code).suggestions[0]!.id, position: 'next' });
    expect(room(t, host.code).queue.map((q) => q.videoId)).toEqual([V3, V2]);
  });

  it('members cannot approve, and a stale approve is not_found', async () => {
    const t = makeCtx();
    const { host, member } = await trio(t);
    await t.send(member.conn, { type: 'queue:add', videoId: V1 });
    const item = room(t, host.code).suggestions[0]!;
    await t.send(member.conn, { type: 'queue:approve', itemId: item.id });
    expect(member.socket.last('error')?.code).toBe('not_host');
    expect(room(t, host.code).suggestions).toHaveLength(1);
    await t.send(host.conn, { type: 'queue:approve', itemId: 'nope' });
    expect(host.socket.last('error')?.code).toBe('not_found');
  });

  it('controllers reject any suggestion; a member withdraws only their own', async () => {
    const t = makeCtx();
    const { host, co, member } = await trio(t);
    const other = await join(t, host.code, 'Other');
    await t.send(member.conn, { type: 'queue:add', videoId: V1 });
    await t.send(other.conn, { type: 'queue:add', videoId: V2 });
    const [a, b] = room(t, host.code).suggestions;
    await t.send(member.conn, { type: 'queue:remove', itemId: b!.id });
    expect(member.socket.last('error')?.code).toBe('forbidden');
    await t.send(member.conn, { type: 'queue:remove', itemId: a!.id });
    await t.send(co.conn, { type: 'queue:remove', itemId: b!.id });
    expect(room(t, host.code).suggestions).toEqual([]);
  });

  it('host and co-host adds skip approval; a controller add in an idle room starts it', async () => {
    const t = makeCtx();
    const { host, co } = await trio(t);
    await t.send(co.conn, { type: 'queue:add', videoId: V1 });
    expect(room(t, host.code).media).toMatchObject({ kind: 'youtube', videoId: V1, startedBy: co.id });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    expect(room(t, host.code).queue.map((q) => q.videoId)).toEqual([V2]);
    expect(room(t, host.code).suggestions).toEqual([]);
  });

  it('turning approval off sends member adds to the queue, still without starting playback', async () => {
    const t = makeCtx();
    const { host, member } = await trio(t);
    await t.send(host.conn, { type: 'room:settings', requireApproval: false });
    await t.send(member.conn, { type: 'queue:add', videoId: V1 });
    expect(room(t, host.code).queue).toMatchObject([{ videoId: V1, addedBy: member.id }]);
    expect(room(t, host.code).media).toBeNull();
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V2 } });
    await t.send(member.conn, { type: 'queue:add', videoId: V3 });
    expect(room(t, host.code).media).toMatchObject({ videoId: V2 });
  });

  it('rejects duplicates across current media, queue and suggestions', async () => {
    const t = makeCtx();
    const { host, member } = await trio(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(member.conn, { type: 'queue:add', videoId: V3 });
    for (const v of [V1, V2, V3]) {
      member.socket.clear();
      await t.send(member.conn, { type: 'queue:add', videoId: v });
      expect(member.socket.last('error')?.code).toBe('invalid_state');
    }
    expect(room(t, host.code).suggestions).toHaveLength(1);
  });

  it('limits a member to 5 waiting suggestions', async () => {
    const t = makeCtx();
    const { host, member } = await trio(t);
    for (let i = 0; i < 5; i++) await t.send(member.conn, { type: 'queue:add', videoId: `video${String(i).padStart(6, '0')}` });
    expect(room(t, host.code).suggestions).toHaveLength(5);
    await t.send(member.conn, { type: 'queue:add', videoId: V1 });
    expect(member.socket.last('error')?.code).toBe('forbidden');
  });

  it('late joiners get the suggestions in the snapshot', async () => {
    const t = makeCtx();
    const { host, member } = await trio(t);
    await t.send(member.conn, { type: 'queue:add', videoId: V1 });
    const late = await join(t, host.code, 'Late');
    expect(late.socket.last('room:joined')!.snapshot.suggestions).toMatchObject([{ videoId: V1, addedBy: member.id }]);
  });
});

describe('queue:notice', () => {
  it('a suggestion notifies controllers only, never the adder or other members', async () => {
    const t = makeCtx();
    const { host, co, member } = await trio(t);
    const other = await join(t, host.code, 'Other');
    for (const c of [host, co, member, other]) c.socket.clear();
    await t.send(member.conn, { type: 'queue:add', videoId: V1, title: 'Cats' });
    for (const c of [host, co]) {
      expect(c.socket.of('queue:notice')).toMatchObject([{ kind: 'suggested', by: 'Member', videoId: V1 }]);
    }
    expect(member.socket.of('queue:notice')).toHaveLength(0);
    expect(other.socket.of('queue:notice')).toHaveLength(0);
  });

  it('a queued add notifies everyone except the adder', async () => {
    const t = makeCtx();
    const { host, co, member } = await trio(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    for (const c of [host, co, member]) c.socket.clear();
    await t.send(co.conn, { type: 'queue:add', videoId: V2 });
    expect(host.socket.of('queue:notice')).toMatchObject([{ kind: 'added', by: 'Co' }]);
    expect(member.socket.of('queue:notice')).toMatchObject([{ kind: 'added', by: 'Co' }]);
    expect(co.socket.of('queue:notice')).toHaveLength(0);
  });

  it('is not part of the snapshot a late joiner receives', async () => {
    const t = makeCtx();
    const { host, member } = await trio(t);
    await t.send(member.conn, { type: 'queue:add', videoId: V1 });
    const late = await join(t, host.code, 'Late');
    expect(late.socket.of('queue:notice')).toHaveLength(0);
  });
});

describe('queue:skip', () => {
  it('a co-host skips to the next item; a member is refused', async () => {
    const t = makeCtx();
    const { host, co, member } = await trio(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(member.conn, { type: 'queue:skip' });
    expect(member.socket.last('error')?.code).toBe('not_host');
    await t.send(co.conn, { type: 'queue:skip', ref: 's' });
    expect(room(t, host.code).media).toMatchObject({ videoId: V2, rev: 2 });
    expect(room(t, host.code).queue).toEqual([]);
    expect(co.socket.last('media:state')?.ref).toBe('s');
  });

  it('with an empty queue it ends playback, and it is a no-op when idle', async () => {
    const t = makeCtx();
    const { host } = await trio(t);
    host.socket.clear();
    await t.send(host.conn, { type: 'queue:skip' });
    expect(host.socket.of('media:state')).toHaveLength(0);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:skip' });
    expect(room(t, host.code).media).toBeNull();
    expect(host.socket.last('media:state')!.playback.status).toBe('paused');
  });

  it('an empty-queue skip does not end a screen share', async () => {
    const t = makeCtx();
    const { host } = await trio(t);
    await t.send(host.conn, { type: 'share:start', source: 'screen', hasAudio: false });
    await t.send(host.conn, { type: 'queue:skip' });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
    expect(room(t, host.code).media?.kind).toBe('screen');
  });
});

describe('autoNext', () => {
  it('on (default): a controller reporting the end starts the next item', async () => {
    const t = makeCtx();
    const { host, co } = await trio(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(co.conn, { type: 'media:ended', rev: 1 });
    expect(room(t, host.code).media).toMatchObject({ videoId: V2 });
  });

  it('off: the end pauses in place and the queue is kept', async () => {
    const t = makeCtx();
    const { host, member } = await trio(t);
    await t.send(host.conn, { type: 'room:settings', autoNext: false });
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    member.socket.clear();
    await t.send(host.conn, { type: 'media:ended', rev: 1 });
    expect(room(t, host.code).media).toMatchObject({ videoId: V1 });
    expect(room(t, host.code).queue).toHaveLength(1);
    expect(member.socket.last('playback:state')!.playback.status).toBe('paused');
    expect(member.socket.of('media:state')).toHaveLength(0);
    // A controller can still move on with skip.
    await t.send(host.conn, { type: 'queue:skip' });
    expect(room(t, host.code).media).toMatchObject({ videoId: V2 });
  });

  it('a member cannot report the end of a video', async () => {
    const t = makeCtx();
    const { host, member } = await trio(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(host.conn, { type: 'queue:add', videoId: V2 });
    await t.send(member.conn, { type: 'media:ended', rev: 1 });
    expect(member.socket.last('error')?.code).toBe('not_host');
    expect(room(t, host.code).media).toMatchObject({ videoId: V1 });
  });
});

describe('queue management by roles', () => {
  it('a co-host reorders, plays and removes; a member cannot', async () => {
    const t = makeCtx();
    const { host, co, member } = await trio(t);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    for (const v of [V2, V3, V4]) await t.send(host.conn, { type: 'queue:add', videoId: v });
    const ids = room(t, host.code).queue.map((q) => q.id);
    await t.send(member.conn, { type: 'queue:reorder', itemId: ids[2]!, toIndex: 0 });
    expect(member.socket.last('error')?.code).toBe('not_host');
    await t.send(co.conn, { type: 'queue:reorder', itemId: ids[2]!, toIndex: 0 });
    expect(room(t, host.code).queue.map((q) => q.id)).toEqual([ids[2], ids[0], ids[1]]);
    await t.send(co.conn, { type: 'queue:remove', itemId: ids[0]! });
    await t.send(co.conn, { type: 'queue:play', itemId: ids[1]! });
    expect(room(t, host.code).media).toMatchObject({ videoId: V3 });
    expect(room(t, host.code).queue.map((q) => q.id)).toEqual([ids[2]]);
  });
});

describe('queue:add rate limit', () => {
  it('allows a burst of 5, then refills slowly', () => {
    const lim = new ConnectionLimiter(0);
    for (let i = 0; i < 5; i++) expect(lim.allow('queue:add', 0)).toBe(true);
    expect(lim.allow('queue:add', 0)).toBe(false);
    expect(lim.allow('queue:add', 2000)).toBe(false);
    expect(lim.allow('queue:add', 3100)).toBe(true);
  });
});
