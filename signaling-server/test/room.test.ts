import { describe, expect, it } from 'vitest';
import type { MediaState } from '../../shared/protocol';
import { idleReason } from '../src/connection';
import { FakeSocket, makeCtx, profile } from './helpers';

type Ctx = ReturnType<typeof makeCtx>;

async function createRoom(t: Ctx, opts: { password?: string; name?: string } = {}) {
  const c = t.connect();
  await t.send(c.conn, {
    type: 'room:create',
    ref: 'c1',
    name: opts.name ?? 'Movie night',
    theme: 'cloud',
    ...profile('Host'),
    ...(opts.password ? { password: opts.password } : {}),
  });
  const joined = c.socket.last('room:joined')!;
  return { ...c, joined, code: joined.snapshot.code };
}

async function join(t: Ctx, code: string, name = 'Guest', extra: Record<string, unknown> = {}, ip?: string) {
  const c = t.connect(ip);
  await t.send(c.conn, { type: 'room:join', ref: 'j1', code, ...profile(name, 'fox'), ...extra });
  return c;
}

describe('create, peek and join', () => {
  it('creates a room, joins the creator as host and echoes the ref', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    expect(host.code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(host.joined.ref).toBe('c1');
    expect(host.joined.snapshot.hostId).toBe(host.joined.selfId);
    expect(host.joined.snapshot.hasPassword).toBe(false);
    expect(host.joined.snapshot.playback.status).toBe('paused');
    expect(host.joined.snapshot.media).toBeNull();
    expect(t.registry.size).toBe(1);
  });

  it('generates unique codes among live rooms', async () => {
    const t = makeCtx();
    const codes = new Set<string>();
    for (let i = 0; i < 30; i++) codes.add((await createRoom(t)).code);
    expect(codes.size).toBe(30);
  });

  it('peeks a room and reports not_found for an unknown one', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const peeker = t.connect();
    await t.send(peeker.conn, { type: 'room:peek', code: host.code, ref: 'p1' });
    const info = peeker.socket.last('room:info')!;
    expect(info.ref).toBe('p1');
    expect(info.peek).toMatchObject({ name: 'Movie night', count: 1, hostName: 'Host', hasPassword: false });
    expect(info.peek.participants).toEqual([{ name: 'Host', avatar: 'cat' }]);
    await t.send(peeker.conn, { type: 'room:peek', code: 'ZZZZZZ', ref: 'p2' });
    expect(peeker.socket.last('error')).toMatchObject({ code: 'not_found', ref: 'p2' });
  });

  it('late joiner receives the snapshot with participants and recent chat lines', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    const joined = guest.socket.last('room:joined')!;
    expect(joined.ref).toBe('j1');
    expect(joined.resumed).toBe(false);
    expect(joined.snapshot.participants.map((p) => p.name)).toEqual(['Host', 'Guest']);
    expect(joined.snapshot.chat.map((m) => m.text)).toEqual(['Host joined 🌙']);
    expect(host.socket.last('participant:joined')!.participant.name).toBe('Guest');
    expect(host.socket.last('chat:message')!.message.text).toBe('Guest joined 🌙');
  });

  it('rejects create and join while already in a room (invalid_state)', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'room:create', name: 'Again', theme: 'cloud', ...profile() });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
    await t.send(host.conn, { type: 'room:join', code: host.code, ...profile() });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
    expect(t.registry.size).toBe(1);
    expect(t.registry.get(host.code)!.participants.size).toBe(1);
  });

  it('returns server_busy when the room cap is reached', async () => {
    const t = makeCtx({ MAX_ROOMS: '1' });
    await createRoom(t);
    const c = t.connect();
    await t.send(c.conn, { type: 'room:create', name: 'x', theme: 'cloud', ...profile() });
    expect(c.socket.last('error')?.code).toBe('server_busy');
  });
});

describe('passwords', () => {
  it('requires the right password and does not leak the participant list', async () => {
    const t = makeCtx();
    const host = await createRoom(t, { password: 'sleepy1' });
    expect(host.joined.snapshot.hasPassword).toBe(true);

    const peeker = t.connect();
    await t.send(peeker.conn, { type: 'room:peek', code: host.code });
    const peek = peeker.socket.last('room:info')!.peek;
    expect(peek.hasPassword).toBe(true);
    expect(peek.participants).toBeUndefined();
    expect(peek.count).toBe(1);

    const none = await join(t, host.code);
    expect(none.socket.last('error')?.code).toBe('wrong_password');
    const wrong = await join(t, host.code, 'G', { password: 'nope-nope' });
    expect(wrong.socket.last('error')?.code).toBe('wrong_password');
    expect(t.registry.get(host.code)!.participants.size).toBe(1);

    const right = await join(t, host.code, 'G', { password: 'sleepy1' });
    expect(right.socket.last('room:joined')).toBeTruthy();
  });

  it('locks out after 5 wrong attempts from the same ip', async () => {
    const t = makeCtx();
    const host = await createRoom(t, { password: 'sleepy1' });
    for (let i = 0; i < 5; i++) await join(t, host.code, 'G', { password: 'bad-pass' }, '9.9.9.9');
    const locked = await join(t, host.code, 'G', { password: 'sleepy1' }, '9.9.9.9');
    expect(locked.socket.last('error')?.code).toBe('locked_out');
    const other = await join(t, host.code, 'G', { password: 'sleepy1' }, '8.8.8.8');
    expect(other.socket.last('room:joined')).toBeTruthy();
    t.clock.advance(31_000);
    const later = await join(t, host.code, 'G', { password: 'sleepy1' }, '9.9.9.9');
    expect(later.socket.last('room:joined')).toBeTruthy();
  });

  it('host can set and clear the password', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'room:settings', password: 'newpass' });
    expect(host.socket.last('room:settings')?.hasPassword).toBe(true);
    expect((await join(t, host.code)).socket.last('error')?.code).toBe('wrong_password');
    await t.send(host.conn, { type: 'room:settings', password: null });
    expect(host.socket.last('room:settings')?.hasPassword).toBe(false);
    expect((await join(t, host.code)).socket.last('room:joined')).toBeTruthy();
  });
});

describe('capacity', () => {
  it('rejects with room_full counting disconnected-in-grace participants, while peek counts connected only', async () => {
    const t = makeCtx({ ROOM_MAX_PARTICIPANTS: '2' });
    const host = await createRoom(t);
    const g1 = await join(t, host.code, 'G1');
    t.drop(g1);
    const peeker = t.connect();
    await t.send(peeker.conn, { type: 'room:peek', code: host.code });
    expect(peeker.socket.last('room:info')!.peek.count).toBe(1);
    const g2 = await join(t, host.code, 'G2');
    expect(g2.socket.last('error')?.code).toBe('room_full');
  });
});

describe('resume', () => {
  it('resumes with the token, keeps the id and closes the old socket with 4000', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    const { selfId, resumeToken } = guest.socket.last('room:joined')!;
    t.drop(guest);
    expect(host.socket.last('participant:updated')!.participant.connected).toBe(false);

    const back = t.connect();
    await t.send(back.conn, { type: 'room:join', code: host.code, resumeToken, ...profile('Guest', 'fox'), ref: 'r1' });
    const joined = back.socket.last('room:joined')!;
    expect(joined).toMatchObject({ resumed: true, selfId, ref: 'r1' });
    expect(host.socket.last('participant:updated')!.participant.connected).toBe(true);
    expect(t.registry.get(host.code)!.participants.size).toBe(2);
  });

  it('closes a still-open old socket with 4000 when another socket resumes', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    const { resumeToken } = guest.socket.last('room:joined')!;
    const back = t.connect();
    await t.send(back.conn, { type: 'room:join', code: host.code, resumeToken, ...profile() });
    expect(guest.socket.closed?.code).toBe(4000);
    t.drop(guest); // the replaced socket closing must not disconnect the participant
    expect(t.registry.get(host.code)!.participants.size).toBe(2);
    expect([...t.registry.get(host.code)!.participants.values()].every((p) => p.participant.connected)).toBe(true);
  });

  it('a bad token never creates a participant, even without a password', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const bad = await join(t, host.code, 'X', { resumeToken: 'not-a-token' });
    expect(bad.socket.last('error')?.code).toBe('not_found');
    expect(bad.socket.last('room:joined')).toBeUndefined();
    expect(t.registry.get(host.code)!.participants.size).toBe(1);
  });

  it('a kicked participant token is revoked', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    const { selfId, resumeToken } = guest.socket.last('room:joined')!;
    await t.send(host.conn, { type: 'host:kick', id: selfId });
    expect(guest.socket.last('kicked')).toBeTruthy();
    expect(guest.socket.closed?.code).toBe(4001);
    const again = await join(t, host.code, 'G', { resumeToken });
    expect(again.socket.last('error')?.code).toBe('not_found');
  });
});

describe('host actions', () => {
  it('enforces host-only actions with not_host', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    const hostId = host.joined.selfId;
    const guestId = guest.socket.last('room:joined')!.selfId;
    await t.send(guest.conn, { type: 'host:kick', id: hostId });
    expect(guest.socket.last('error')?.code).toBe('not_host');
    await t.send(guest.conn, { type: 'host:transfer', to: guestId });
    expect(guest.socket.last('error')?.code).toBe('not_host');
    await t.send(guest.conn, { type: 'room:settings', name: 'Mine now' });
    expect(guest.socket.last('error')?.code).toBe('not_host');
    expect(t.registry.get(host.code)!.name).toBe('Movie night');
  });

  it('transfers host and rejects self, unknown and disconnected targets', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    const dropped = await join(t, host.code, 'Gone');
    const hostId = host.joined.selfId;
    const guestId = guest.socket.last('room:joined')!.selfId;
    const droppedId = dropped.socket.last('room:joined')!.selfId;
    t.drop(dropped);
    await t.send(host.conn, { type: 'host:transfer', to: hostId });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
    await t.send(host.conn, { type: 'host:transfer', to: 'nobody' });
    expect(host.socket.last('error')?.code).toBe('not_found');
    await t.send(host.conn, { type: 'host:transfer', to: droppedId });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
    await t.send(host.conn, { type: 'host:kick', id: hostId });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
    await t.send(host.conn, { type: 'host:transfer', to: guestId });
    expect(guest.socket.last('host:changed')).toMatchObject({ hostId: guestId, reason: 'transfer' });
    expect(t.registry.get(host.code)!.hostId).toBe(guestId);
  });

  it('changes name and theme live and updates profiles', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    await t.send(host.conn, { type: 'room:settings', name: 'Sleepover', theme: 'starlight' });
    expect(guest.socket.last('room:settings')).toMatchObject({ name: 'Sleepover', theme: 'starlight' });
    await t.send(guest.conn, { type: 'profile:update', displayName: 'Mochi2', avatar: 'bunny' });
    expect(host.socket.last('participant:updated')!.participant).toMatchObject({ name: 'Mochi2', avatar: 'bunny' });
  });

  it('answers sync:ping with the server time', async () => {
    const t = makeCtx();
    const c = t.connect();
    await t.send(c.conn, { type: 'sync:ping', t0: 42 });
    expect(c.socket.last('sync:pong')).toMatchObject({ t0: 42, serverTime: t.clock.now() });
  });

  it('replies invalid_state to room messages sent outside a room', async () => {
    const t = makeCtx();
    const c = t.connect();
    await t.send(c.conn, { type: 'host:kick', id: 'x', ref: 'k' });
    expect(c.socket.last('error')).toMatchObject({ code: 'invalid_state', ref: 'k' });
  });
});

describe('leave, host migration and cleanup', () => {
  it('migrates host to the oldest connected participant when the host leaves', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    t.clock.advance(10);
    const g1 = await join(t, host.code, 'G1');
    t.clock.advance(10);
    const g2 = await join(t, host.code, 'G2');
    await t.send(host.conn, { type: 'room:leave' });
    const g1Id = g1.socket.last('room:joined')!.selfId;
    expect(g2.socket.last('host:changed')).toMatchObject({ hostId: g1Id, reason: 'left' });
    expect(g2.socket.last('participant:left')).toMatchObject({ id: host.joined.selfId, reason: 'left' });
  });

  it('migrates host after the grace period when the host socket stays down', async () => {
    const t = makeCtx({ HOST_GRACE_MS: '500', SWEEP_INTERVAL_MS: '100' });
    const host = await createRoom(t);
    t.clock.advance(5);
    const guest = await join(t, host.code);
    t.drop(host);
    t.clock.advance(300);
    t.registry.sweep();
    expect(t.registry.get(host.code)!.hostId).toBe(host.joined.selfId);
    t.clock.advance(250);
    t.registry.sweep();
    const guestId = guest.socket.last('room:joined')!.selfId;
    expect(guest.socket.last('host:changed')).toMatchObject({ hostId: guestId, reason: 'timeout' });
  });

  it('a host that returns within the grace keeps the role', async () => {
    const t = makeCtx({ HOST_GRACE_MS: '500' });
    const host = await createRoom(t);
    await join(t, host.code);
    const { resumeToken, selfId } = host.joined;
    t.drop(host);
    t.clock.advance(200);
    const back = t.connect();
    await t.send(back.conn, { type: 'room:join', code: host.code, resumeToken, ...profile('Host') });
    t.clock.advance(1000);
    t.registry.sweep();
    expect(t.registry.get(host.code)!.hostId).toBe(selfId);
  });

  it('removes a participant after the reconnect grace and announces it', async () => {
    const t = makeCtx({ RECONNECT_GRACE_MS: '1000' });
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    const guestId = guest.socket.last('room:joined')!.selfId;
    t.drop(guest);
    t.clock.advance(1100);
    t.registry.sweep();
    expect(host.socket.last('participant:left')).toMatchObject({ id: guestId, reason: 'timeout' });
    expect(t.registry.get(host.code)!.participants.size).toBe(1);
  });

  it('deletes an empty room after the TTL and expired rooms after max age', async () => {
    const t = makeCtx({ EMPTY_ROOM_TTL_MS: '60000', RECONNECT_GRACE_MS: '1000' });
    const a = await createRoom(t);
    await t.send(a.conn, { type: 'room:leave' });
    t.clock.advance(30_000);
    t.registry.sweep();
    expect(t.registry.get(a.code)).toBeDefined();
    t.clock.advance(31_000);
    t.registry.sweep();
    expect(t.registry.get(a.code)).toBeUndefined();

    const b = await createRoom(t);
    t.clock.advance(12 * 60 * 60 * 1000 + 1);
    t.registry.sweep();
    expect(b.socket.last('room:closed')?.reason).toBe('expired');
    expect(t.registry.get(b.code)).toBeUndefined();
  });

  it('a creator who reloaded after everyone left becomes host again on fresh join', async () => {
    const t = makeCtx({ EMPTY_ROOM_TTL_MS: '60000' });
    const a = await createRoom(t);
    await t.send(a.conn, { type: 'room:leave' });
    const again = await join(t, a.code, 'New');
    const joined = again.socket.last('room:joined')!;
    expect(joined.snapshot.hostId).toBe(joined.selfId);
  });

  it('disconnect of a replaced or unknown socket is ignored', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const room = t.registry.get(host.code)!;
    room.disconnect(host.joined.selfId, new FakeSocket());
    expect(room.participants.get(host.joined.selfId)!.participant.connected).toBe(true);
  });
});

describe('endShare', () => {
  const file = { name: 'a.mp4', size: 5, lastModified: 1, mime: 'video/mp4', durationSec: 100 };
  it('screen share ends with media null and a broadcast; stream falls back to same-file paused', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    const room = t.registry.get(host.code)!;
    const hostId = host.joined.selfId;

    room.mediaRev = 3;
    room.media = { kind: 'screen', rev: 3, sharerId: hostId, sessionId: 's1', hasAudio: false };
    room.shareSession = { sessionId: 's1', sharerId: hostId };
    room.endShare();
    expect(room.media).toBeNull();
    expect(room.shareSession).toBeNull();
    expect(guest.socket.last('media:state')).toMatchObject({ media: null, playback: { status: 'paused', rev: 4 } });

    const stream: MediaState = {
      kind: 'local', rev: 4, file, delivery: 'stream', sharerId: hostId, sessionId: 's2', hasAudio: true,
    };
    room.media = stream;
    room.shareSession = { sessionId: 's2', sharerId: hostId };
    room.playback = { rev: 4, status: 'paused', positionSec: 33, updatedAt: t.clock.now() };
    room.endShare();
    expect(room.media).toMatchObject({ kind: 'local', delivery: 'same-file', rev: 5 });
    expect(room.playback).toMatchObject({ status: 'paused', positionSec: 33, rev: 5 });
  });

  it('runs on sharer socket close and host migration; a transfer keeps the old host (now co-host) sharing', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    const room = t.registry.get(host.code)!;
    const hostId = host.joined.selfId;
    const guestId = guest.socket.last('room:joined')!.selfId;
    const share = () => {
      room.media = { kind: 'screen', rev: room.mediaRev, sharerId: room.hostId, sessionId: 's', hasAudio: false };
      room.shareSession = { sessionId: 's', sharerId: room.hostId };
    };
    share();
    await t.send(host.conn, { type: 'host:transfer', to: guestId });
    expect(room.roleOf(hostId)).toBe('co_host');
    expect(room.shareSession).not.toBeNull();
    expect(room.media?.kind).toBe('screen');
    room.endShare();

    share();
    t.drop(guest); // guest is now the sharer and host
    expect(room.shareSession).toBeNull();
    expect(room.hostId).toBe(guestId);
    expect(hostId).not.toBe(guestId);
  });
});

describe('playback freeze on host migration', () => {
  it('pauses at the extrapolated position and broadcasts before host:changed', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    const room = t.registry.get(host.code)!;
    room.mediaRev = 1;
    room.media = { kind: 'youtube', rev: 1, videoId: 'dQw4w9WgXcQ', startedBy: host.joined.selfId };
    room.playback = { rev: 1, status: 'playing', positionSec: 10, updatedAt: t.clock.now() };
    t.clock.advance(5000);
    guest.socket.clear();
    await t.send(host.conn, { type: 'room:leave' });
    const types = guest.socket.sent.map((m) => m.type);
    expect(types.indexOf('playback:state')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('playback:state')).toBeLessThan(types.indexOf('host:changed'));
    expect(guest.socket.last('playback:state')!.playback).toMatchObject({ status: 'paused', positionSec: 15, rev: 1 });
    expect(room.snapshot().playback).toMatchObject({ status: 'paused', positionSec: 15 });
  });

  it('does not broadcast when already paused', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    guest.socket.clear();
    await t.send(host.conn, { type: 'room:leave' });
    expect(guest.socket.last('playback:state')).toBeUndefined();
  });
});

describe('idle sockets', () => {
  const config = { idleMs: 30_000, unjoinedMaxMs: 600_000 };
  it('closes after 30 s without any message, and a peek counts as activity', () => {
    const conn = { room: null, connectedAt: 0, lastMessageAt: 0 };
    expect(idleReason(conn, 29_999, config)).toBeNull();
    expect(idleReason(conn, 30_000, config)).toBe('idle');
    conn.lastMessageAt = 25_000; // a room:peek arrived
    expect(idleReason(conn, 40_000, config)).toBeNull();
  });
  it('caps an unjoined socket at 10 minutes even when it stays active', () => {
    expect(idleReason({ room: null, connectedAt: 0, lastMessageAt: 599_000 }, 600_000, config)).toBe('too_old');
  });
  it('never applies to sockets in a room', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    expect(idleReason(host.conn, 10 ** 9, config)).toBeNull();
  });
});
