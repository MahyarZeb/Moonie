import { describe, expect, it } from 'vitest';
import type { GameView, LudoState, RpsView, TttState } from '../../shared/games/types';
import { makeCtx, profile, type FakeSocket } from './helpers';

type Ctx = ReturnType<typeof makeCtx>;

async function createRoom(t: Ctx) {
  const c = t.connect();
  await t.send(c.conn, { type: 'room:create', name: 'Game night', theme: 'cloud', ...profile('Host') });
  const joined = c.socket.last('room:joined')!;
  return { ...c, id: joined.selfId, code: joined.snapshot.code };
}
async function join(t: Ctx, code: string, name = 'Guest') {
  const c = t.connect();
  await t.send(c.conn, { type: 'room:join', code, ...profile(name, 'fox') });
  return { ...c, id: c.socket.last('room:joined')!.selfId };
}
const lastGame = (c: { socket: FakeSocket }): GameView | null | undefined => c.socket.last('game:state')?.game;

async function setup(env: Record<string, string> = {}) {
  const t = makeCtx(env);
  const host = await createRoom(t);
  const guest = await join(t, host.code);
  const watcher = await join(t, host.code, 'Watcher');
  const room = t.registry.get(host.code)!;
  return { t, host, guest, watcher, room };
}
const act = (t: Ctx, c: { conn: Parameters<Ctx['send']>[0] }, action: unknown) => t.send(c.conn, { type: 'game:action', action });

describe('game handlers', () => {
  it('opens a game for everyone, once, and closes it', async () => {
    const { t, host, guest, room } = await setup();
    await t.send(host.conn, { type: 'game:open', kind: 'tictactoe' });
    expect(lastGame(guest)?.kind).toBe('tictactoe');
    expect(room.gameState?.kind).toBe('tictactoe');
    guest.socket.clear();
    await t.send(guest.conn, { type: 'game:open', kind: 'ludo' });
    expect(guest.socket.last('error')?.code).toBe('invalid_state');
    expect(room.gameState?.kind).toBe('tictactoe');

    const outsider = await join(t, host.code, 'Outsider');
    outsider.socket.clear();
    await t.send(outsider.conn, { type: 'game:close' });
    expect(outsider.socket.last('error')?.code).toBe('forbidden');
    expect(room.gameState).not.toBeNull();

    await t.send(host.conn, { type: 'game:close' });
    expect(room.gameState).toBeNull();
    expect(guest.socket.last('game:state')?.game).toBeNull();
  });

  it('game actions with no open game are invalid_state', async () => {
    const { t, guest } = await setup();
    await act(t, guest, { type: 'sit', mark: 'X' });
    expect(guest.socket.last('error')?.code).toBe('invalid_state');
  });

  it('plays tic-tac-toe, rejecting illegal moves without changing or broadcasting state', async () => {
    const { t, host, guest, watcher, room } = await setup();
    await t.send(host.conn, { type: 'game:open', kind: 'tictactoe' });
    await act(t, host, { type: 'sit', mark: 'X' });
    await act(t, guest, { type: 'sit', mark: 'O' });
    expect((lastGame(watcher) as TttState).status).toBe('playing');

    await act(t, host, { type: 'move', index: 4 });
    const before = JSON.stringify(room.gameState);
    watcher.socket.clear();
    host.socket.clear();
    guest.socket.clear();

    await act(t, host, { type: 'move', index: 0 }); // not X's turn
    expect(host.socket.last('error')?.code).toBe('invalid_state');
    await act(t, guest, { type: 'move', index: 4 }); // occupied
    expect(guest.socket.last('error')?.code).toBe('invalid_state');
    await act(t, watcher, { type: 'move', index: 0 }); // spectator
    expect(watcher.socket.last('error')?.code).toBe('forbidden');
    await act(t, guest, { type: 'move', index: '1' }); // garbage
    expect(guest.socket.last('error')?.code).toBe('bad_request');
    await act(t, guest, { type: 'move', index: 99 });
    await act(t, guest, { type: 'skipTurn' });
    await act(t, guest, { type: 'roll' }); // an action from another game
    await act(t, guest, null);
    await act(t, guest, 'x');
    expect(JSON.stringify(room.gameState)).toBe(before);
    for (const c of [host, guest, watcher]) expect(c.socket.of('game:state')).toHaveLength(0);

    await act(t, guest, { type: 'move', index: 0 });
    expect((lastGame(host) as TttState).board[0]).toBe('O');
  });

  it('hides RPS picks from other clients and from late joiners until the reveal', async () => {
    const { t, host, guest, watcher } = await setup();
    await t.send(host.conn, { type: 'game:open', kind: 'rps' });
    await act(t, host, { type: 'join' });
    await act(t, guest, { type: 'join' });
    await act(t, host, { type: 'start' });
    await act(t, host, { type: 'pick', choice: 'rock' });
    expect(JSON.stringify(lastGame(guest))).not.toContain('rock');
    expect(JSON.stringify(lastGame(watcher))).not.toContain('rock');
    expect((lastGame(host) as RpsView).picks[host.id]).toBe('rock');
    expect((lastGame(guest) as RpsView).picks[host.id]).toBe('locked');

    const late = await join(t, host.code, 'Late');
    const snap = late.socket.last('room:joined')!.snapshot.game;
    expect(JSON.stringify(snap)).not.toContain('rock');
    const hostRejoin = t.registry.get(host.code)!.snapshot(host.id).game as RpsView;
    expect(hostRejoin.picks[host.id]).toBe('rock');

    await act(t, guest, { type: 'pick', choice: 'scissors' });
    const revealed = lastGame(watcher) as RpsView;
    expect(revealed.phase).toBe('revealed');
    expect(revealed.picks[host.id]).toBe('rock');
    expect(revealed.result?.winners).toEqual([host.id]);
  });

  it('runs a Ludo game with server-side dice and rejects out-of-turn actions', async () => {
    const { t, host, guest, watcher, room } = await setup();
    room.rng = () => 0.99; // always a 6
    await t.send(host.conn, { type: 'game:open', kind: 'ludo' });
    await act(t, host, { type: 'sit', color: 'red' });
    await act(t, guest, { type: 'sit', color: 'green' });
    await act(t, watcher, { type: 'start' });
    expect(watcher.socket.last('error')?.code).toBe('forbidden');
    await act(t, guest, { type: 'start' });
    expect((lastGame(host) as LudoState).turn).toBe('red');

    guest.socket.clear();
    await act(t, guest, { type: 'roll' });
    expect(guest.socket.last('error')?.code).toBe('invalid_state');
    expect((room.gameState as LudoState).rollId).toBe(0);
    await act(t, guest, { type: 'move', piece: 9 });
    expect(guest.socket.last('error')?.code).toBe('bad_request');
    await act(t, guest, { type: 'skipTurn' });
    expect(guest.socket.last('error')?.code).toBe('bad_request');
    expect((room.gameState as LudoState).turn).toBe('red');

    await act(t, host, { type: 'roll', dice: 1 }); // extra fields are dropped, the server rolls
    const s = lastGame(guest) as LudoState;
    expect(s.dice).toBe(6);
    expect(s.rollId).toBe(1);
    await act(t, host, { type: 'move', piece: 0 });
    expect((room.gameState as LudoState).pieces.red[0]).toBe(0);
  });

  it('removes a leaver from the game and forfeits to the last player', async () => {
    const { t, host, guest, watcher } = await setup();
    await t.send(host.conn, { type: 'game:open', kind: 'ludo' });
    await act(t, host, { type: 'sit', color: 'red' });
    await act(t, guest, { type: 'sit', color: 'blue' });
    await act(t, host, { type: 'start' });
    watcher.socket.clear();
    await t.send(guest.conn, { type: 'room:leave' });
    const s = lastGame(watcher) as LudoState;
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('red');
  });

  it('skips the turn of a Ludo player who stays disconnected past TURN_SKIP_MS', async () => {
    const { t, host, guest, watcher, room } = await setup({ TURN_SKIP_MS: '1000', RECONNECT_GRACE_MS: '60000' });
    await t.send(host.conn, { type: 'game:open', kind: 'ludo' });
    await act(t, host, { type: 'sit', color: 'red' });
    await act(t, guest, { type: 'sit', color: 'green' });
    await act(t, host, { type: 'start' });
    t.drop(host);
    t.clock.advance(500);
    t.registry.sweep();
    expect((room.gameState as LudoState).turn).toBe('red');
    t.clock.advance(600);
    t.registry.sweep();
    const s = lastGame(watcher) as LudoState;
    expect(s.turn).toBe('green');
    expect(s.seats[0]!.playerId).toBe(host.id); // the seat stays occupied
  });
});
