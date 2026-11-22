import { describe, expect, it } from 'vitest';
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
