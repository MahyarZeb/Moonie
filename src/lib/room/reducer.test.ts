import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/permissions';
import type { Participant, RoomSnapshot, ServerMessage } from '@shared/protocol';
import { initialRoomState, roomReducer, type RoomClientState, type RoomEvent } from './reducer';

const p = (id: string, name = id, extra: Partial<Participant> = {}): Participant => ({
  id,
  name,
  avatar: 'cat',
  joinedAt: 1,
  connected: true,
  role: 'member',
  ...extra,
});

const snapshot = (over: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  code: 'ABCD23',
  name: 'Room',
  theme: 'cloud',
  hasPassword: false,
  hostId: 'a',
  settings: DEFAULT_SETTINGS,
  createdAt: 0,
  maxParticipants: 8,
  participants: [p('a'), p('b')],
  media: null,
  playback: { rev: 0, status: 'paused', positionSec: 0, updatedAt: 0 },
  queue: [],
  suggestions: [],
  game: null,
  chat: [],
  serverTime: 0,
  ...over,
});

const joined = (over: Partial<Extract<ServerMessage, { type: 'room:joined' }>> = {}): ServerMessage => ({
  type: 'room:joined',
  selfId: 'a',
  resumeToken: 't',
  snapshot: snapshot(),
  resumed: false,
  ...over,
});

const run = (events: RoomEvent[], start: RoomClientState = initialRoomState) => events.reduce(roomReducer, start);

describe('lobby state machine', () => {
  it('create: begin-join(enter:false) then room:joined lands in-room with entered false; enter flips it', () => {
    let s = run([{ type: 'begin-join', enter: false }, joined()]);
    expect(s).toMatchObject({ phase: 'in-room', entered: false, selfId: 'a' });
    s = roomReducer(s, { type: 'enter' });
    expect(s.entered).toBe(true);
  });

  it('guest: peek -> lobby, join(enter:true) -> in-room entered', () => {
    let s = run([{ type: 'begin-peek' }]);
    expect(s.phase).toBe('peeking');
    s = roomReducer(s, {
      type: 'room:info',
      peek: { code: 'ABCD23', name: 'R', theme: 'cloud', hasPassword: false, count: 1, max: 8, hostName: 'h' },
    });
    expect(s.phase).toBe('lobby');
    expect(s.peek?.name).toBe('R');
    s = run([{ type: 'begin-join', enter: true }], s);
    expect(s.phase).toBe('joining');
    s = roomReducer(s, joined());
    expect(s).toMatchObject({ phase: 'in-room', entered: true, peek: undefined });
  });

  it('a failed join returns to the lobby', () => {
    const s = run([
      { type: 'begin-peek' },
      { type: 'room:info', peek: { code: 'ABCD23', name: 'R', theme: 'cloud', hasPassword: true, count: 1, max: 8, hostName: 'h' } },
      { type: 'begin-join', enter: true },
      { type: 'join-failed' },
    ]);
    expect(s.phase).toBe('lobby');
  });

  it('reload resume lands entered; a reconnect resume keeps the previous entered value', () => {
    const reloaded = run([{ type: 'begin-join', enter: true }, joined({ resumed: true })]);
    expect(reloaded).toMatchObject({ phase: 'in-room', entered: true });

    const inLobby = run([{ type: 'begin-join', enter: false }, joined()]);
    const resumed = roomReducer(inLobby, joined({ resumed: true }));
    expect(resumed.entered).toBe(false);
  });

  it('room:closed{expired} goes back to the lobby and clears the room', () => {
    const s = run([{ type: 'begin-join', enter: true }, joined(), { type: 'room:closed', reason: 'expired' }]);
    expect(s).toMatchObject({ phase: 'lobby', entered: false, snapshot: undefined, selfId: undefined });
  });

  it('kicked ends the session', () => {
    const s = run([{ type: 'begin-join', enter: true }, joined(), { type: 'kicked' }]);
    expect(s).toMatchObject({ phase: 'ended', endedReason: 'kicked', snapshot: undefined });
  });

  it('reset returns to idle but keeps the connection status', () => {
    const s = run([{ type: 'connection', status: 'open' }, { type: 'begin-join', enter: true }, joined(), { type: 'reset' }]);
    expect(s).toMatchObject({ phase: 'idle', connection: 'open' });
    expect(s.snapshot).toBeUndefined();
  });

  it('peek-failed shows the error in the lobby', () => {
    const s = run([{ type: 'begin-peek' }, { type: 'peek-failed', error: { code: 'not_found', message: 'x' } }]);
    expect(s).toMatchObject({ phase: 'lobby', peekError: { code: 'not_found' } });
  });
});

describe('room events', () => {
  const inRoom = () => run([{ type: 'begin-join', enter: true }, joined()]);

  it('room:joined replaces the state', () => {
    const s = roomReducer(inRoom(), joined({ selfId: 'b', snapshot: snapshot({ name: 'Other' }) }));
    expect(s.snapshot?.name).toBe('Other');
    expect(s.selfId).toBe('b');
  });

  it('applies participant events and host change', () => {
    let s = inRoom();
    s = roomReducer(s, { type: 'participant:joined', participant: p('c') });
    expect(s.snapshot?.participants.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    s = roomReducer(s, { type: 'participant:joined', participant: p('c', 'renamed') });
    expect(s.snapshot?.participants).toHaveLength(3);
    s = roomReducer(s, { type: 'participant:updated', participant: p('b', 'Bee', { connected: false }) });
    expect(s.snapshot?.participants.find((x) => x.id === 'b')).toMatchObject({ name: 'Bee', connected: false });
    s = roomReducer(s, { type: 'host:changed', hostId: 'b', reason: 'transfer' });
    expect(s.snapshot?.hostId).toBe('b');
    s = roomReducer(s, { type: 'participant:left', id: 'c', reason: 'left' });
    expect(s.snapshot?.participants.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('applies settings, media, playback and queue updates', () => {
    let s = inRoom();
    s = roomReducer(s, { type: 'room:settings', name: 'New', theme: 'starlight', hasPassword: true, settings: { ...DEFAULT_SETTINGS, autoNext: false } });
    expect(s.snapshot).toMatchObject({ name: 'New', theme: 'starlight', hasPassword: true, settings: { ...DEFAULT_SETTINGS, autoNext: false } });
    const playback = { rev: 1, status: 'playing' as const, positionSec: 3, updatedAt: 9 };
    s = roomReducer(s, { type: 'media:state', media: null, playback, queue: [] });
    expect(s.snapshot?.playback).toEqual(playback);
    s = roomReducer(s, { type: 'playback:state', playback: { ...playback, status: 'paused' } });
    expect(s.snapshot?.playback.status).toBe('paused');
  });

  it('keeps chat capped at 100 lines and clears typing for the sender', () => {
    let s = inRoom();
    s = roomReducer(s, { type: 'chat:typing', id: 'b', typing: true });
    expect(Object.keys(s.typing)).toEqual(['b']);
    for (let i = 0; i < 120; i++) {
      s = roomReducer(s, { type: 'chat:message', message: { id: String(i), kind: 'user', from: 'b', text: 'hi', ts: i } });
    }
    expect(s.snapshot?.chat).toHaveLength(100);
    expect(s.typing).toEqual({});
  });

  it('applies suggestion updates', () => {
    let s = inRoom();
    const item = { id: 'i1', videoId: 'aaaaaaaaaaa', addedBy: 'b', addedAt: 1 };
    s = roomReducer(s, { type: 'suggestions:updated', suggestions: [item] });
    expect(s.snapshot?.suggestions).toEqual([item]);
  });
  it('applies chat deletions', () => {
    let s = inRoom();
    const msg = { id: 'm1', kind: 'user' as const, text: 'hi', ts: 1 };
    s = roomReducer(s, { type: 'chat:message', message: msg });
    s = roomReducer(s, { type: 'chat:deleted', id: 'm1' });
    expect(s.snapshot?.chat).toEqual([]);
  });
  it('expires typing entries', () => {
    let s = inRoom();
    s = { ...s, typing: { b: 1000, c: 9000 } };
    s = roomReducer(s, { type: 'typing-expire', now: 2000 });
    expect(s.typing).toEqual({ c: 9000 });
  });

  it('records errors but ignores stale', () => {
    let s = inRoom();
    expect(roomReducer(s, { type: 'error', code: 'stale', message: 'x' })).toBe(s);
    s = roomReducer(s, { type: 'error', code: 'not_host', message: 'Only the host' });
    expect(s.lastError).toMatchObject({ code: 'not_host' });
    expect(roomReducer(s, { type: 'clear-error' }).lastError).toBeUndefined();
  });

  it('ignores room events before a room is joined', () => {
    const s = roomReducer(initialRoomState, { type: 'host:changed', hostId: 'x', reason: 'left' });
    expect(s).toBe(initialRoomState);
  });

  it('tracks the connection status', () => {
    const s = roomReducer(initialRoomState, { type: 'connection', status: 'closed', closeCode: 1008 });
    expect(s).toMatchObject({ connection: 'closed', closeCode: 1008 });
    expect(roomReducer(s, { type: 'connection', status: 'open' }).closeCode).toBeUndefined();
  });
});
