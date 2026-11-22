import { describe, expect, it } from 'vitest';
import { makeCtx, profile } from './helpers';

type Ctx = ReturnType<typeof makeCtx>;

const file = { name: 'a.mp4', size: 10, lastModified: 5, mime: 'video/mp4' };

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
const hasFile = (t: Ctx, code: string, id: string) => room(t, code).participants.get(id)!.participant.hasFile;

async function setup() {
  const t = makeCtx();
  const host = await createRoom(t);
  const guest = await join(t, host.code);
  await t.send(host.conn, { type: 'media:set', media: { kind: 'local', file, delivery: 'same-file' } });
  const rev = room(t, host.code).media!.rev;
  return { t, host, guest, rev };
}

describe('local:ready', () => {
  it('sets hasFile for the current revision and broadcasts participant:updated once', async () => {
    const { t, host, guest, rev } = await setup();
    host.socket.clear();
    await t.send(guest.conn, { type: 'local:ready', rev, ready: true });
    expect(hasFile(t, host.code, guest.id)).toBe(true);
    expect(host.socket.of('participant:updated')).toHaveLength(1);
    await t.send(guest.conn, { type: 'local:ready', rev, ready: true });
    expect(host.socket.of('participant:updated')).toHaveLength(1);
    await t.send(guest.conn, { type: 'local:ready', rev, ready: false });
    expect(hasFile(t, host.code, guest.id)).toBe(false);
  });

  it('ignores a stale revision and non same-file media', async () => {
    const { t, host, guest, rev } = await setup();
    await t.send(guest.conn, { type: 'local:ready', rev: rev - 1, ready: true });
    expect(hasFile(t, host.code, guest.id)).toBeFalsy();
    await t.send(host.conn, { type: 'media:set', media: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' } });
    await t.send(guest.conn, { type: 'local:ready', rev: room(t, host.code).media!.rev, ready: true });
    expect(hasFile(t, host.code, guest.id)).toBeFalsy();
  });

  it('keeps hasFile across stream conversions and resets it when the file changes', async () => {
    const { t, host, guest, rev } = await setup();
    await t.send(guest.conn, { type: 'local:ready', rev, ready: true });
    await t.send(host.conn, { type: 'share:start', source: 'file', hasAudio: true, file });
    expect(room(t, host.code).media).toMatchObject({ delivery: 'stream' });
    expect(hasFile(t, host.code, guest.id)).toBe(true);
    await t.send(host.conn, { type: 'share:stop' });
    expect(room(t, host.code).media).toMatchObject({ delivery: 'same-file' });
    expect(hasFile(t, host.code, guest.id)).toBe(true);
    await t.send(host.conn, { type: 'media:set', media: { kind: 'local', file: { ...file, size: 11 }, delivery: 'same-file' } });
    expect(hasFile(t, host.code, guest.id)).toBe(false);
  });

  it('does not reset hasFile when the host picks the same file again', async () => {
    const { t, host, guest, rev } = await setup();
    await t.send(guest.conn, { type: 'local:ready', rev, ready: true });
    await t.send(host.conn, { type: 'media:set', media: { kind: 'local', file, delivery: 'same-file' } });
    expect(hasFile(t, host.code, guest.id)).toBe(true);
  });
});

describe('local stream', () => {
  it('stores playback commands during a stream and falls back to same-file at the stored position', async () => {
    const { t, host } = await setup();
    await t.send(host.conn, { type: 'share:start', source: 'file', hasAudio: false, file });
    const streamRev = room(t, host.code).media!.rev;
    await t.send(host.conn, { type: 'playback:command', rev: streamRev, action: 'seek', positionSec: 7 });
    await t.send(host.conn, { type: 'playback:command', rev: streamRev, action: 'pause', positionSec: 7 });
    expect(room(t, host.code).playback).toMatchObject({ status: 'paused', positionSec: 7, rev: streamRev });
    await t.send(host.conn, { type: 'share:stop' });
    expect(room(t, host.code).media).toMatchObject({ kind: 'local', delivery: 'same-file' });
    expect(room(t, host.code).playback).toMatchObject({ status: 'paused', positionSec: 7 });
  });

  it('rejects share:start file with mismatched meta', async () => {
    const { t, host } = await setup();
    await t.send(host.conn, { type: 'share:start', ref: 'x', source: 'file', hasAudio: false, file: { ...file, lastModified: 6 } });
    expect(host.socket.last('error')).toMatchObject({ code: 'invalid_state', ref: 'x' });
    expect(room(t, host.code).shareSession).toBeNull();
  });
});
