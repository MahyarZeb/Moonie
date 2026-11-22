import { describe, expect, it } from 'vitest';
import { REACTION_EMOJI } from '../../shared/constants';
import { ConnectionLimiter } from '../src/rateLimit';
import { makeCtx, profile } from './helpers';

type Ctx = ReturnType<typeof makeCtx>;

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

describe('chat', () => {
  it('broadcasts to everyone including the sender, with name and avatar', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    host.socket.clear();
    guest.socket.clear();
    await t.send(guest.conn, { type: 'chat:send', text: 'hello there' });
    for (const s of [host.socket, guest.socket]) {
      expect(s.of('chat:message')).toHaveLength(1);
      expect(s.last('chat:message')!.message).toMatchObject({
        kind: 'user',
        from: guest.id,
        name: 'Guest',
        avatar: 'fox',
        text: 'hello there',
      });
    }
  });

  it('truncates at 500 and strips control chars and newlines', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    await t.send(host.conn, { type: 'chat:send', text: `  a\u0000b\nc${'x'.repeat(600)}` });
    const text = host.socket.last('chat:message')!.message.text;
    expect(text.startsWith('ab c')).toBe(true);
    expect(text).toHaveLength(500);
    expect(text).not.toMatch(/[\u0000-\u001f]/);
  });

  it('rejects empty messages', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    host.socket.clear();
    await t.send(host.conn, { type: 'chat:send', text: ' \n\u0000 ' });
    expect(host.socket.of('chat:message')).toHaveLength(0);
    expect(host.socket.last('error')?.code).toBe('bad_request');
  });

  it('keeps a ring buffer of 100 that late joiners receive', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    for (let i = 0; i < 120; i++) t.registry.get(host.code)!.addChat(host.id, `m${i}`);
    const late = await join(t, host.code, 'Late');
    const chat = late.socket.last('room:joined')!.snapshot.chat;
    expect(chat).toHaveLength(100);
    expect(chat.some((m) => m.text === 'm119')).toBe(true);
    expect(chat.some((m) => m.text === 'm0')).toBe(false);
  });

  it('relays typing to others only and clears it on send and disconnect', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    host.socket.clear();
    guest.socket.clear();
    await t.send(guest.conn, { type: 'chat:typing', typing: true });
    expect(host.socket.last('chat:typing')).toEqual({ type: 'chat:typing', id: guest.id, typing: true });
    expect(guest.socket.of('chat:typing')).toHaveLength(0);

    host.socket.clear();
    await t.send(guest.conn, { type: 'chat:send', text: 'hi' });
    await t.send(guest.conn, { type: 'chat:typing', typing: false });
    expect(host.socket.of('chat:typing')).toHaveLength(0);

    await t.send(guest.conn, { type: 'chat:typing', typing: true });
    host.socket.clear();
    t.drop(guest);
    expect(host.socket.last('chat:typing')).toEqual({ type: 'chat:typing', id: guest.id, typing: false });
  });

  it('adds system lines for join and leave', async () => {
    const t = makeCtx();
    const host = await createRoom(t);
    const guest = await join(t, host.code);
    expect(host.socket.of('chat:message').map((m) => m.message.text)).toContain('Guest joined 🌙');
    await t.send(guest.conn, { type: 'room:leave' });
    const last = host.socket.last('chat:message')!.message;
    expect(last).toMatchObject({ kind: 'system', text: 'Guest left 👋' });
  });
});

/** Host, a promoted co-host, a second co-host and two members. */
async function team(t: Ctx) {
  const host = await createRoom(t);
  const co = await join(t, host.code, 'Co');
  const co2 = await join(t, host.code, 'Co2');
  const m1 = await join(t, host.code, 'M1');
  const m2 = await join(t, host.code, 'M2');
  await t.send(host.conn, { type: 'role:set', to: co.id, role: 'co_host' });
  await t.send(host.conn, { type: 'role:set', to: co2.id, role: 'co_host' });
  return { host, co, co2, m1, m2 };
}

const lastMessageId = (c: { socket: { last: (t: 'chat:message') => { message: { id: string } } | undefined } }) =>
  c.socket.last('chat:message')!.message.id;

describe('chat:delete', () => {
  it('removes the message for everyone and from the history late joiners get', async () => {
    const t = makeCtx();
    const { host, co, m1, m2 } = await team(t);
    await t.send(m1.conn, { type: 'chat:send', text: 'rude' });
    const id = lastMessageId(m1);
    for (const c of [host, co, m1, m2]) c.socket.clear();
    await t.send(co.conn, { type: 'chat:delete', messageId: id });
    for (const c of [host, co, m1, m2]) expect(c.socket.of('chat:deleted')).toEqual([{ type: 'chat:deleted', id }]);
    expect(t.registry.get(host.code)!.chat.some((m) => m.id === id)).toBe(false);
    const late = await join(t, host.code, 'Late');
    expect(late.socket.last('room:joined')!.snapshot.chat.some((m) => m.id === id)).toBe(false);
  });

  it('members cannot delete, and a missing id is not_found', async () => {
    const t = makeCtx();
    const { host, m1, m2 } = await team(t);
    await t.send(m1.conn, { type: 'chat:send', text: 'hello' });
    const id = lastMessageId(m1);
    await t.send(m2.conn, { type: 'chat:delete', messageId: id });
    expect(m2.socket.last('error')?.code).toBe('not_host');
    expect(t.registry.get(host.code)!.chat.some((m) => m.id === id)).toBe(true);
    await t.send(host.conn, { type: 'chat:delete', messageId: 'missing' });
    expect(host.socket.last('error')?.code).toBe('not_found');
  });

  it('a co-host cannot delete the host or another co-host message, but can delete their own', async () => {
    const t = makeCtx();
    const { host, co, co2 } = await team(t);
    await t.send(host.conn, { type: 'chat:send', text: 'from host' });
    const hostMsg = lastMessageId(host);
    await t.send(co2.conn, { type: 'chat:send', text: 'from co2' });
    const co2Msg = lastMessageId(co2);
    await t.send(co.conn, { type: 'chat:send', text: 'from co' });
    const coMsg = lastMessageId(co);
    await t.send(co.conn, { type: 'chat:delete', messageId: hostMsg });
    expect(co.socket.last('error')?.code).toBe('forbidden');
    await t.send(co.conn, { type: 'chat:delete', messageId: co2Msg });
    expect(co.socket.last('error')?.code).toBe('forbidden');
    await t.send(co.conn, { type: 'chat:delete', messageId: coMsg });
    expect(host.socket.last('chat:deleted')?.id).toBe(coMsg);
    // The host can remove a co-host message.
    await t.send(host.conn, { type: 'chat:delete', messageId: co2Msg });
    expect(host.socket.last('chat:deleted')?.id).toBe(co2Msg);
  });

  it('system lines cannot be deleted', async () => {
    const t = makeCtx();
    const { host } = await team(t);
    const sys = t.registry.get(host.code)!.chat.find((m) => m.kind === 'system')!;
    await t.send(host.conn, { type: 'chat:delete', messageId: sys.id });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
  });
});

describe('chat:mute', () => {
  it('a co-host mutes a member; the muted member is forbidden to chat but can react', async () => {
    const t = makeCtx();
    const { host, co, m1, m2 } = await team(t);
    for (const c of [host, co, m1, m2]) c.socket.clear();
    await t.send(co.conn, { type: 'chat:mute', id: m1.id, muted: true });
    for (const c of [host, co, m1, m2]) {
      expect(c.socket.last('participant:updated')!.participant).toMatchObject({ id: m1.id, muted: true });
    }
    await t.send(m1.conn, { type: 'chat:send', ref: 'c', text: 'still here?' });
    expect(m1.socket.last('error')).toMatchObject({ code: 'forbidden', ref: 'c' });
    expect(host.socket.of('chat:message').some((m) => m.message.text === 'still here?')).toBe(false);
    await t.send(m1.conn, { type: 'reaction:send', emoji: REACTION_EMOJI[0] });
    expect(host.socket.last('reaction')).toEqual({ type: 'reaction', from: m1.id, emoji: REACTION_EMOJI[0] });
    // Others are unaffected.
    await t.send(m2.conn, { type: 'chat:send', text: 'me too' });
    expect(host.socket.last('chat:message')!.message.text).toBe('me too');
  });

  it('unmute restores chat', async () => {
    const t = makeCtx();
    const { host, m1 } = await team(t);
    await t.send(host.conn, { type: 'chat:mute', id: m1.id, muted: true });
    await t.send(host.conn, { type: 'chat:mute', id: m1.id, muted: false });
    expect(host.socket.last('participant:updated')!.participant.muted).toBeUndefined();
    await t.send(m1.conn, { type: 'chat:send', text: 'back' });
    expect(host.socket.last('chat:message')!.message.text).toBe('back');
  });

  it('co-hosts cannot mute the host or another co-host; members cannot mute anyone', async () => {
    const t = makeCtx();
    const { host, co, co2, m1, m2 } = await team(t);
    await t.send(co.conn, { type: 'chat:mute', id: host.id, muted: true });
    expect(co.socket.last('error')?.code).toBe('forbidden');
    await t.send(co.conn, { type: 'chat:mute', id: co2.id, muted: true });
    expect(co.socket.last('error')?.code).toBe('forbidden');
    await t.send(m1.conn, { type: 'chat:mute', id: m2.id, muted: true });
    expect(m1.socket.last('error')?.code).toBe('not_host');
    for (const id of [host.id, co2.id, m2.id]) {
      expect(t.registry.get(host.code)!.participants.get(id)!.participant.muted).toBeUndefined();
    }
  });

  it('the host can mute a co-host but nobody can mute the host or themselves', async () => {
    const t = makeCtx();
    const { host, co } = await team(t);
    await t.send(host.conn, { type: 'chat:mute', id: co.id, muted: true });
    expect(t.registry.get(host.code)!.participants.get(co.id)!.participant.muted).toBe(true);
    await t.send(host.conn, { type: 'chat:mute', id: host.id, muted: true });
    expect(host.socket.last('error')?.code).toBe('invalid_state');
    // Promoting or demoting clears a mute so it cannot linger on a controller.
    await t.send(host.conn, { type: 'role:set', to: co.id, role: 'member' });
    await t.send(host.conn, { type: 'chat:mute', id: co.id, muted: true });
    await t.send(host.conn, { type: 'role:set', to: co.id, role: 'co_host' });
    expect(t.registry.get(host.code)!.participants.get(co.id)!.participant.muted).toBeUndefined();
  });

  it('a mute survives a reconnect and shows in the late-joiner snapshot', async () => {
    const t = makeCtx();
    const { host, m1 } = await team(t);
    await t.send(host.conn, { type: 'chat:mute', id: m1.id, muted: true });
    const late = await join(t, host.code, 'Late');
    const seen = late.socket.last('room:joined')!.snapshot.participants.find((p) => p.id === m1.id);
    expect(seen?.muted).toBe(true);
  });
});

describe('reaction:send', () => {
  it('broadcasts to everyone including the sender, and is not stored', async () => {
    const t = makeCtx();
    const { host, m1, m2 } = await team(t);
    for (const c of [host, m1, m2]) c.socket.clear();
    await t.send(m1.conn, { type: 'reaction:send', emoji: REACTION_EMOJI[2] });
    for (const c of [host, m1, m2]) {
      expect(c.socket.of('reaction')).toEqual([{ type: 'reaction', from: m1.id, emoji: REACTION_EMOJI[2] }]);
    }
    const late = await join(t, host.code, 'Late');
    expect(late.socket.of('reaction')).toHaveLength(0);
    expect(JSON.stringify(late.socket.last('room:joined')!.snapshot)).not.toContain('reaction');
  });

  it('only the fixed emoji list is accepted', async () => {
    const t = makeCtx();
    const { host, m1 } = await team(t);
    expect(REACTION_EMOJI).toHaveLength(6);
    host.socket.clear();
    for (const emoji of ['x', '<script>', '', 'a'.repeat(500), 42]) {
      await t.send(m1.conn, { type: 'reaction:send', emoji });
    }
    expect(host.socket.of('reaction')).toHaveLength(0);
    expect(m1.socket.last('error')?.code).toBe('bad_request');
  });

  it('is rate limited to a burst of 5 then 2 per second', () => {
    const lim = new ConnectionLimiter(0);
    for (let i = 0; i < 5; i++) expect(lim.allow('reaction:send', 0)).toBe(true);
    expect(lim.allow('reaction:send', 0)).toBe(false);
    expect(lim.allow('reaction:send', 600)).toBe(true);
    expect(lim.allow('reaction:send', 600)).toBe(false);
  });
});