import { describe, expect, it } from 'vitest';
import { makeCtx, profile } from './helpers';

type Ctx = ReturnType<typeof makeCtx>;
type Client = Awaited<ReturnType<typeof join>>;

const V1 = 'dQw4w9WgXcQ';
const V2 = 'aaaaaaaaaaa';

async function createRoom(t: Ctx, name = 'Host') {
  const c = t.connect();
  await t.send(c.conn, { type: 'room:create', name: 'Role room', theme: 'cloud', ...profile(name) });
  const joined = c.socket.last('room:joined')!;
  return { ...c, id: joined.selfId, code: joined.snapshot.code };
}

async function join(t: Ctx, code: string, name = 'Guest', extra: Record<string, unknown> = {}) {
  const c = t.connect();
  await t.send(c.conn, { type: 'room:join', code, ...profile(name, 'fox'), ...extra });
  return { ...c, id: c.socket.last('room:joined')!.selfId };
}

/** Host plus a co-host (promoted) and two members. Join order: host, co, m1, m2. */
async function setup(env: Record<string, string> = {}) {
  const t = makeCtx(env);
  const host = await createRoom(t);
  const co = await join(t, host.code, 'Co');
  const m1 = await join(t, host.code, 'M1');
  const m2 = await join(t, host.code, 'M2');
  await t.send(host.conn, { type: 'role:set', to: co.id, role: 'co_host' });
  const room = t.registry.get(host.code)!;
  const clear = () => [host, co, m1, m2].forEach((c) => c.socket.clear());
  clear();
  return { t, host, co, m1, m2, room, clear };
}

const lastError = (c: Client) => c.socket.last('error')?.code;

/** Sends `msg` and returns the error code the sender received, or undefined when it was accepted. */
async function codeOf(t: Ctx, c: Client, msg: Record<string, unknown>) {
  c.socket.clear();
  await t.send(c.conn, msg);
  return lastError(c);
}

describe('roles: assignment and snapshot', () => {
  it('first joiner is host, later joiners are members, and the snapshot carries roles and default settings', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    const snap = guest.socket.last('room:joined')!.snapshot;
    expect(snap.hostId).toBe(host.id);
    expect(snap.participants.map((p) => [p.id, p.role])).toEqual([
      [host.id, 'host'],
      [guest.id, 'member'],
    ]);
    expect(snap.settings).toEqual({ requireApproval: true, autoNext: true, coHostsCanKick: true });
  });

  it('a late joiner sees current roles', async () => {
    const { t, host, co, room } = await setup();
    const late = await join(t, host.code, 'Late');
    const roles = Object.fromEntries(late.socket.last('room:joined')!.snapshot.participants.map((p) => [p.id, p.role]));
    expect(roles[host.id]).toBe('host');
    expect(roles[co.id]).toBe('co_host');
    expect(roles[late.id]).toBe('member');
    expect(room.hostId).toBe(host.id);
  });

  it('ignores role and isHost fields in join, profile and queue messages', async () => {
    const { t, host, m1 } = await setup();
    const spoof = await join(t, host.code, 'Spoof', { role: 'host', isHost: true, hostId: 'x' });
    const room = t.registry.get(host.code)!;
    expect(room.roleOf(spoof.id)).toBe('member');
    expect(room.hostId).toBe(host.id);
    await t.send(m1.conn, { type: 'profile:update', displayName: 'Sneaky', role: 'host', isHost: true });
    expect(room.roleOf(m1.id)).toBe('member');
    await t.send(m1.conn, { type: 'queue:add', videoId: V2, role: 'host', addedBy: host.id });
    expect(room.queue.every((q) => q.addedBy !== host.id)).toBe(true);
    expect(room.participants.get(m1.id)!.participant.role).toBe('member');
  });

  it('rejects role:set with host or an unknown role at validation', async () => {
    const { t, host, m1 } = await setup();
    expect(await codeOf(t, host, { type: 'role:set', to: m1.id, role: 'host' })).toBe('bad_request');
    expect(await codeOf(t, host, { type: 'role:set', to: m1.id, role: 'admin' })).toBe('bad_request');
  });
});

describe('roles: promote and demote', () => {
  it('only the host can promote and demote, and every client is told', async () => {
    const { t, host, co, m1, m2, room, clear } = await setup();
    await t.send(host.conn, { type: 'role:set', to: m1.id, role: 'co_host' });
    expect(room.roleOf(m1.id)).toBe('co_host');
    for (const c of [host, co, m1, m2]) {
      expect(c.socket.last('participant:updated')?.participant).toMatchObject({ id: m1.id, role: 'co_host' });
    }
    clear();
    await t.send(host.conn, { type: 'role:set', to: m1.id, role: 'member' });
    expect(room.roleOf(m1.id)).toBe('member');
    expect(m2.socket.last('participant:updated')?.participant).toMatchObject({ id: m1.id, role: 'member' });
  });

  it('members and co-hosts cannot change roles', async () => {
    const { t, co, m1, m2, room } = await setup();
    expect(await codeOf(t, m1, { type: 'role:set', to: m1.id, role: 'co_host' })).toBe('not_host');
    expect(await codeOf(t, m1, { type: 'role:set', to: m2.id, role: 'co_host' })).toBe('not_host');
    expect(await codeOf(t, co, { type: 'role:set', to: m2.id, role: 'co_host' })).toBe('not_host');
    expect(await codeOf(t, co, { type: 'role:set', to: co.id, role: 'member' })).toBe('not_host');
    expect(room.roleOf(m1.id)).toBe('member');
    expect(room.roleOf(m2.id)).toBe('member');
    expect(room.roleOf(co.id)).toBe('co_host');
  });

  it('the host cannot change their own role or target a missing participant', async () => {
    const { t, host, room } = await setup();
    expect(await codeOf(t, host, { type: 'role:set', to: host.id, role: 'member' })).toBe('invalid_state');
    expect(await codeOf(t, host, { type: 'role:set', to: 'nobody', role: 'co_host' })).toBe('not_found');
    expect(room.roleOf(host.id)).toBe('host');
  });

  it('demoting a co-host who is sharing ends the share', async () => {
    const { t, host, co, m1, room } = await setup();
    await t.send(co.conn, { type: 'share:start', source: 'screen', hasAudio: false });
    expect(room.shareSession?.sharerId).toBe(co.id);
    m1.socket.clear();
    await t.send(host.conn, { type: 'role:set', to: co.id, role: 'member' });
    expect(room.shareSession).toBeNull();
    expect(room.media).toBeNull();
    expect(m1.socket.last('media:state')?.media).toBeNull();
  });
});

describe('roles: co-host abilities', () => {
  it('co-host can control playback and change media; members cannot', async () => {
    const { t, host, co, m1, room } = await setup();
    await t.send(co.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    expect(room.media).toMatchObject({ kind: 'youtube', videoId: V1, startedBy: co.id });
    const rev = room.media!.rev;
    expect(await codeOf(t, co, { type: 'playback:command', rev, action: 'pause', positionSec: 5 })).toBeUndefined();
    expect(room.playback.status).toBe('paused');
    expect(await codeOf(t, co, { type: 'playback:command', rev, action: 'seek', positionSec: 30 })).toBeUndefined();
    expect(room.playback.positionSec).toBe(30);

    expect(await codeOf(t, m1, { type: 'playback:command', rev, action: 'play', positionSec: 0 })).toBe('not_host');
    expect(await codeOf(t, m1, { type: 'media:set', media: { kind: 'youtube', videoId: V2 } })).toBe('not_host');
    expect(await codeOf(t, m1, { type: 'media:ended', rev })).toBe('not_host');
    expect(room.media).toMatchObject({ videoId: V1 });
    expect(room.playback.positionSec).toBe(30);
    expect(host.socket.last('error')).toBeUndefined();
  });

  it('co-host can manage the whole queue', async () => {
    const { t, co, m1, m2, room } = await setup();
    await t.send(co.conn, { type: 'media:set', media: { kind: 'youtube', videoId: V1 } });
    await t.send(m1.conn, { type: 'queue:add', videoId: V2 });
    await t.send(co.conn, { type: 'queue:add', videoId: 'bbbbbbbbbbb' });
    await t.send(co.conn, { type: 'queue:add', videoId: 'ccccccccccc' });
    const [a, b, c] = room.queue;
    expect(room.queue.length).toBeGreaterThanOrEqual(2);
    // Members can neither reorder nor start items, and can remove only their own.
    expect(await codeOf(t, m2, { type: 'queue:reorder', itemId: b!.id, toIndex: 0 })).toBe('not_host');
    expect(await codeOf(t, m2, { type: 'queue:play', itemId: b!.id })).toBe('not_host');
    expect(await codeOf(t, m2, { type: 'queue:remove', itemId: b!.id })).toBe('forbidden');
    // Co-host can do all three on anyone's items.
    expect(await codeOf(t, co, { type: 'queue:reorder', itemId: b!.id, toIndex: 0 })).toBeUndefined();
    expect(room.queue[0]!.id).toBe(b!.id);
    expect(await codeOf(t, co, { type: 'queue:remove', itemId: a!.id })).toBeUndefined();
    expect(room.queue.some((q) => q.id === a!.id)).toBe(false);
    const target = c ?? room.queue[0]!;
    expect(await codeOf(t, co, { type: 'queue:play', itemId: target.id })).toBeUndefined();
    expect(room.media).toMatchObject({ kind: 'youtube', videoId: target.videoId });
  });

  it('co-host can start a share, and stop a share started by the host; members cannot', async () => {
    const { t, host, co, m1, room } = await setup();
    expect(await codeOf(t, m1, { type: 'share:start', source: 'screen', hasAudio: false })).toBe('not_host');
    await t.send(host.conn, { type: 'share:start', source: 'screen', hasAudio: false });
    expect(room.shareSession?.sharerId).toBe(host.id);
    expect(await codeOf(t, m1, { type: 'share:stop' })).toBe('not_host');
    expect(room.shareSession).not.toBeNull();
    expect(await codeOf(t, co, { type: 'share:stop' })).toBeUndefined();
    expect(room.shareSession).toBeNull();
    expect(await codeOf(t, co, { type: 'share:start', source: 'screen', hasAudio: true })).toBeUndefined();
    expect(room.media).toMatchObject({ kind: 'screen', sharerId: co.id });
  });

  it('co-host can open and close games, and its game actions carry host powers; members cannot open', async () => {
    const { t, host, co, m1, m2, room } = await setup();
    expect(await codeOf(t, m1, { type: 'game:open', kind: 'tictactoe' })).toBe('not_host');
    expect(room.gameState).toBeNull();
    expect(await codeOf(t, co, { type: 'game:open', kind: 'tictactoe' })).toBeUndefined();
    await t.send(host.conn, { type: 'game:action', action: { type: 'sit', mark: 'X' } });
    await t.send(m1.conn, { type: 'game:action', action: { type: 'sit', mark: 'O' } });
    // m2 is not seated, so it may not restart. The co-host (not seated either) may.
    expect(await codeOf(t, m2, { type: 'game:action', action: { type: 'restart' } })).toBe('forbidden');
    expect(await codeOf(t, co, { type: 'game:action', action: { type: 'restart' } })).toBeUndefined();
    expect(await codeOf(t, m2, { type: 'game:close' })).toBe('forbidden');
    expect(await codeOf(t, co, { type: 'game:close' })).toBeUndefined();
    expect(room.gameState).toBeNull();
  });

  it('members still take part in games', async () => {
    const { t, host, m1, m2, room } = await setup();
    await t.send(host.conn, { type: 'game:open', kind: 'tictactoe' });
    expect(await codeOf(t, m1, { type: 'game:action', action: { type: 'sit', mark: 'X' } })).toBeUndefined();
    expect(await codeOf(t, m2, { type: 'game:action', action: { type: 'sit', mark: 'O' } })).toBeUndefined();
    expect(await codeOf(t, m1, { type: 'game:action', action: { type: 'move', index: 0 } })).toBeUndefined();
    expect(room.gameState?.kind).toBe('tictactoe');
    expect(await codeOf(t, m1, { type: 'game:close' })).toBeUndefined(); // seated player may close
  });

  it('co-host can remove a member but never the host or another co-host', async () => {
    const { t, host, co, m1, m2, room } = await setup();
    await t.send(host.conn, { type: 'role:set', to: m2.id, role: 'co_host' });
    expect(await codeOf(t, co, { type: 'host:kick', id: host.id })).toBe('forbidden');
    expect(await codeOf(t, co, { type: 'host:kick', id: m2.id })).toBe('forbidden');
    expect(await codeOf(t, co, { type: 'host:kick', id: co.id })).toBe('invalid_state');
    expect(room.participants.has(host.id) && room.participants.has(m2.id)).toBe(true);
    expect(await codeOf(t, co, { type: 'host:kick', id: m1.id })).toBeUndefined();
    expect(room.participants.has(m1.id)).toBe(false);
    expect(m1.socket.closed?.code).toBe(4001);
  });

  it('coHostsCanKick off stops co-host kicks but not the host', async () => {
    const { t, host, co, m1, m2, room } = await setup();
    await t.send(host.conn, { type: 'room:settings', coHostsCanKick: false });
    expect(room.settings.coHostsCanKick).toBe(false);
    expect(await codeOf(t, co, { type: 'host:kick', id: m1.id })).toBe('not_host');
    expect(room.participants.has(m1.id)).toBe(true);
    expect(await codeOf(t, host, { type: 'host:kick', id: m2.id })).toBeUndefined();
    expect(room.participants.has(m2.id)).toBe(false);
  });

  it('members cannot kick anyone', async () => {
    const { t, host, m1, m2, room } = await setup();
    expect(await codeOf(t, m1, { type: 'host:kick', id: m2.id })).toBe('not_host');
    expect(await codeOf(t, m1, { type: 'host:kick', id: host.id })).toBe('not_host');
    expect(room.participants.size).toBe(4);
  });
});

describe('roles: settings and ownership', () => {
  it('only the host changes settings; the result is broadcast with the new settings', async () => {
    const { t, host, co, m1, room } = await setup();
    expect(await codeOf(t, co, { type: 'room:settings', name: 'Co name' })).toBe('not_host');
    expect(await codeOf(t, co, { type: 'room:settings', autoNext: false })).toBe('not_host');
    expect(await codeOf(t, m1, { type: 'room:settings', requireApproval: false })).toBe('not_host');
    expect(room.settings).toEqual({ requireApproval: true, autoNext: true, coHostsCanKick: true });
    expect(await codeOf(t, host, { type: 'room:settings', autoNext: false, requireApproval: false })).toBeUndefined();
    expect(room.settings).toEqual({ requireApproval: false, autoNext: false, coHostsCanKick: true });
    expect(m1.socket.last('room:settings')?.settings).toEqual({ requireApproval: false, autoNext: false, coHostsCanKick: true });
    expect(room.snapshot().settings.autoNext).toBe(false);
  });

  it('rejects non-boolean settings at validation', async () => {
    const { t, host, room } = await setup();
    expect(await codeOf(t, host, { type: 'room:settings', autoNext: 'no' })).toBe('bad_request');
    expect(room.settings.autoNext).toBe(true);
  });

  it('only the host can transfer ownership; the old host becomes co-host and there is one host', async () => {
    const { t, host, co, m1, room } = await setup();
    expect(await codeOf(t, co, { type: 'host:transfer', to: m1.id })).toBe('not_host');
    expect(await codeOf(t, m1, { type: 'host:transfer', to: m1.id })).toBe('not_host');
    expect(room.hostId).toBe(host.id);
    expect(await codeOf(t, host, { type: 'host:transfer', to: m1.id })).toBeUndefined();
    expect(room.hostId).toBe(m1.id);
    expect(room.roleOf(m1.id)).toBe('host');
    expect(room.roleOf(host.id)).toBe('co_host');
    expect(room.roleOf(co.id)).toBe('co_host');
    const hosts = [...room.participants.values()].filter((p) => p.participant.role === 'host');
    expect(hosts).toHaveLength(1);
    expect(m1.socket.last('host:changed')).toMatchObject({ hostId: m1.id, reason: 'transfer' });
    // The former host lost host-only rights.
    expect(await codeOf(t, host, { type: 'room:settings', autoNext: false })).toBe('not_host');
  });

  it('transfer to a disconnected participant fails', async () => {
    const { t, host, m1, room } = await setup();
    t.drop(m1);
    expect(await codeOf(t, host, { type: 'host:transfer', to: m1.id })).toBe('invalid_state');
    expect(room.hostId).toBe(host.id);
  });
});

describe('roles: host leaves', () => {
  it('promotes the longest-connected co-host, not an older member', async () => {
    const { t, host, co, m1, room } = await setup();
    await t.send(host.conn, { type: 'room:leave' });
    expect(room.hostId).toBe(co.id);
    expect(room.roleOf(co.id)).toBe('host');
    expect(room.roleOf(m1.id)).toBe('member');
    expect(room.participants.has(host.id)).toBe(false);
    expect(m1.socket.last('host:changed')).toMatchObject({ hostId: co.id, reason: 'left' });
  });

  it('prefers the earliest-joined co-host when there are several', async () => {
    const { t, host, co, m1, m2, room } = await setup();
    await t.send(host.conn, { type: 'role:set', to: m2.id, role: 'co_host' });
    await t.send(host.conn, { type: 'role:set', to: m1.id, role: 'co_host' });
    await t.send(host.conn, { type: 'room:leave' });
    expect(room.hostId).toBe(co.id);
  });

  it('with no co-host, promotes the longest-connected member', async () => {
    const { t, host, co, m1, room } = await setup();
    await t.send(host.conn, { type: 'role:set', to: co.id, role: 'member' });
    await t.send(host.conn, { type: 'room:leave' });
    expect(room.hostId).toBe(co.id); // joined before m1
    expect(room.roleOf(co.id)).toBe('host');
    expect(room.roleOf(m1.id)).toBe('member');
  });

  it('skips a disconnected co-host', async () => {
    const { t, host, co, m1, room } = await setup();
    t.drop(co);
    await t.send(host.conn, { type: 'room:leave' });
    expect(room.hostId).toBe(m1.id);
    expect(room.roleOf(co.id)).toBe('co_host'); // still waiting to resume
  });

  it('host disconnect timeout: successor takes over and the former host returns as co-host', async () => {
    const { t, host, co, room } = await setup({ HOST_GRACE_MS: '1000', RECONNECT_GRACE_MS: '60000' });
    t.drop(host);
    t.clock.advance(1500);
    room.sweep();
    expect(room.hostId).toBe(co.id);
    expect(room.roleOf(host.id)).toBe('co_host');
    expect(room.roleOf(co.id)).toBe('host');
    const hosts = [...room.participants.values()].filter((p) => p.participant.role === 'host');
    expect(hosts).toHaveLength(1);
  });

  it('a sharing host who leaves ends the share', async () => {
    const { t, host, co, room } = await setup();
    await t.send(host.conn, { type: 'share:start', source: 'screen', hasAudio: false });
    await t.send(host.conn, { type: 'room:leave' });
    expect(room.shareSession).toBeNull();
    expect(room.hostId).toBe(co.id);
  });

  it('a late joiner after a handover sees the new roles', async () => {
    const { t, host, co } = await setup();
    await t.send(host.conn, { type: 'room:leave' });
    const late = await join(t, host.code, 'Late');
    const snap = late.socket.last('room:joined')!.snapshot;
    expect(snap.hostId).toBe(co.id);
    expect(snap.participants.find((p) => p.id === co.id)?.role).toBe('host');
  });
});
