import { describe, expect, it } from 'vitest';
import {
  BASE_COORDS,
  FINISH_COORDS,
  HOME_COLUMN_COORDS,
  LUDO_LOG_MAX,
  SAFE_SQUARES,
  START,
  THREE_SIXES_FORFEIT,
  TRACK_COORDS,
  legalMoves,
  pieceCoord,
} from './ludo';
import { LINES } from './tictactoe';
import { createGame, ludo, reduceGame, removeGamePlayer, rps, seatedIds, ttt, viewGame } from './index';
import type { Actor, Choice, Color, LudoAction, LudoState, Result, RpsAction, RpsState, TttAction, TttState } from './types';

const actor = (id: string, isHost = false): Actor => ({ id, name: id.toUpperCase(), avatar: 'cat', isHost });
const A = actor('a', true);
const B = actor('b');
const C = actor('c');
const D = actor('d');
const dice = (...values: number[]) => {
  const q = [...values];
  return () => ((q.shift() ?? 1) - 1) / 6 + 0.01;
};
const never = () => {
  throw new Error('rng must not be called');
};

function okState<S>(r: Result<S>): S {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.state;
}

// ---------------------------------------------------------------- Tic-Tac-Toe

function tttSeated(): TttState {
  let s = ttt.create();
  s = okState(ttt.reduce(s, { type: 'sit', mark: 'X' }, A));
  s = okState(ttt.reduce(s, { type: 'sit', mark: 'O' }, B));
  return s;
}
const tMove = (s: TttState, who: Actor, index: number) => ttt.reduce(s, { type: 'move', index }, who);

describe('tic-tac-toe', () => {
  it('starts playing when both seats are filled', () => {
    const s = ttt.create();
    expect(s.status).toBe('waiting');
    expect(tttSeated().status).toBe('playing');
  });

  it('rejects a double seat and a taken seat', () => {
    let s = ttt.create();
    s = okState(ttt.reduce(s, { type: 'sit', mark: 'X' }, A));
    expect(ttt.reduce(s, { type: 'sit', mark: 'O' }, A).ok).toBe(false);
    expect(ttt.reduce(s, { type: 'sit', mark: 'X' }, B).ok).toBe(false);
  });

  it.each(LINES.map((l) => [l.join('-'), l] as const))('X wins on line %s', (_name, line) => {
    const others = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => !line.includes(i)).slice(0, 2);
    let s = tttSeated();
    const order: [Actor, number][] = [
      [A, line[0]],
      [B, others[0]!],
      [A, line[1]],
      [B, others[1]!],
      [A, line[2]],
    ];
    for (const [who, i] of order) s = okState(tMove(s, who, i));
    expect(s.status).toBe('won');
    expect(s.winner).toBe('X');
    expect(s.line).toEqual([...line]);
    expect(s.scores.X).toBe(1);
  });

  it('detects a draw', () => {
    // X O X / X O O / O X X
    let s = tttSeated();
    const moves: [Actor, number][] = [
      [A, 0], [B, 1], [A, 2], [B, 4], [A, 3], [B, 5], [A, 7], [B, 6], [A, 8],
    ];
    for (const [who, i] of moves) s = okState(tMove(s, who, i));
    expect(s.status).toBe('draw');
    expect(s.winner).toBeNull();
    expect(s.scores.draws).toBe(1);
  });

  it('rejects an occupied cell, wrong turn, spectator, bad index and moves after the end', () => {
    let s = tttSeated();
    s = okState(tMove(s, A, 4));
    expect(tMove(s, B, 4).ok).toBe(false);
    expect(tMove(s, A, 0).ok).toBe(false);
    const spectator = tMove(s, C, 0);
    expect(spectator.ok).toBe(false);
    if (!spectator.ok) expect(spectator.code).toBe('forbidden');
    expect(tMove(s, B, 9).ok).toBe(false);
    expect(tMove(s, B, 1.5).ok).toBe(false);
    expect(tMove(ttt.create(), A, 0).ok).toBe(false);
  });

  it('alternates the starter on restart and keeps scores and seats', () => {
    let s = tttSeated();
    for (const [who, i] of [[A, 0], [B, 3], [A, 1], [B, 4], [A, 2]] as [Actor, number][]) s = okState(tMove(s, who, i));
    expect(s.status).toBe('won');
    s = okState(ttt.reduce(s, { type: 'restart' }, B));
    expect(s.board.every((c) => c === null)).toBe(true);
    expect(s.starter).toBe('O');
    expect(s.turn).toBe('O');
    expect(s.status).toBe('playing');
    expect(s.scores.X).toBe(1);
    expect(s.seats.X?.playerId).toBe('a');
    s = okState(ttt.reduce(s, { type: 'restart' }, A));
    expect(s.starter).toBe('X');
    expect(ttt.reduce(s, { type: 'restart' }, C).ok).toBe(false);
  });

  it('awards the win to the opponent when a seated player leaves mid-game', () => {
    const s = ttt.removePlayer(tttSeated(), 'a');
    expect(s.status).toBe('won');
    expect(s.winner).toBe('O');
    expect(s.seats.X).toBeNull();
    expect(s.scores.O).toBe(1);
    expect(ttt.removePlayer(s, 'zzz')).toBe(s);
  });

  it('leaveSeat while waiting frees the seat', () => {
    let s = okState(ttt.reduce(ttt.create(), { type: 'sit', mark: 'X' }, A));
    s = okState(ttt.reduce(s, { type: 'leaveSeat' }, A));
    expect(s.seats.X).toBeNull();
  });
});

// ------------------------------------------------------------------------ RPS

const CH: Choice[] = ['rock', 'paper', 'scissors'];
const beats = (a: Choice, b: Choice) =>
  (a === 'rock' && b === 'scissors') || (a === 'paper' && b === 'rock') || (a === 'scissors' && b === 'paper');

function rpsLobby(players: Actor[]): RpsState {
  let s = rps.create();
  for (const p of players) s = okState(rps.reduce(s, { type: 'join' }, p));
  return s;
}
function rpsRound(players: Actor[], picks: Choice[]): RpsState {
  let s = okState(rps.reduce(rpsLobby(players), { type: 'start' }, players[0]!));
  players.forEach((p, i) => {
    s = okState(rps.reduce(s, { type: 'pick', choice: picks[i]! }, p));
  });
  return s;
}

describe('rock paper scissors', () => {
  it('resolves the 2-player matrix', () => {
    for (const x of CH) {
      for (const y of CH) {
        const s = rpsRound([A, B], [x, y]);
        expect(s.phase).toBe('revealed');
        if (x === y) {
          expect(s.result?.draw).toBe(true);
          expect(s.players.map((p) => p.score)).toEqual([0, 0]);
        } else if (beats(x, y)) {
          expect(s.result?.winners).toEqual(['a']);
          expect(s.result?.losers).toEqual(['b']);
          expect(s.players.map((p) => p.score)).toEqual([1, 0]);
        } else {
          expect(s.result?.winners).toEqual(['b']);
          expect(s.players.map((p) => p.score)).toEqual([0, 1]);
        }
      }
    }
  });

  it('resolves all 27 triples of 3 picks', () => {
    for (const x of CH) {
      for (const y of CH) {
        for (const z of CH) {
          const picks = [x, y, z];
          const s = rpsRound([A, B, C], picks);
          const distinct = new Set(picks);
          const r = s.result!;
          if (distinct.size !== 2) {
            expect(r.draw, picks.join()).toBe(true);
            expect(r.winners).toEqual([]);
            expect(r.winningChoice).toBeNull();
            expect(s.players.every((p) => p.score === 0)).toBe(true);
          } else {
            const [p, q] = [...distinct] as [Choice, Choice];
            const win = beats(p, q) ? p : q;
            expect(r.draw).toBe(false);
            expect(r.winningChoice).toBe(win);
            const expected = ['a', 'b', 'c'].filter((_id, i) => picks[i] === win);
            expect(r.winners, picks.join()).toEqual(expected);
            expect(r.losers.length + r.winners.length).toBe(3);
            expect(s.players.filter((pl) => pl.score === 1).map((pl) => pl.id)).toEqual(expected);
          }
        }
      }
    }
  });

  it('hides other picks in view until revealed', () => {
    let s = okState(rps.reduce(rpsLobby([A, B, C]), { type: 'start' }, A));
    s = okState(rps.reduce(s, { type: 'pick', choice: 'rock' }, A));
    const forB = rps.view(s, 'b');
    expect(forB.picks).toEqual({ a: 'locked', b: 'none', c: 'none' });
    const forA = rps.view(s, 'a');
    expect(forA.picks).toEqual({ a: 'rock', b: 'none', c: 'none' });
    expect(JSON.stringify(rps.view(s, 'spectator'))).not.toContain('rock');
    expect(JSON.stringify(forB)).not.toContain('rock');
    s = okState(rps.reduce(s, { type: 'pick', choice: 'paper' }, B));
    s = okState(rps.reduce(s, { type: 'pick', choice: 'paper' }, C));
    expect(s.phase).toBe('revealed');
    expect(rps.view(s, 'b').picks).toEqual({ a: 'rock', b: 'paper', c: 'paper' });
  });

  it('lets a player change a pick until everyone has picked', () => {
    let s = okState(rps.reduce(rpsLobby([A, B]), { type: 'start' }, A));
    s = okState(rps.reduce(s, { type: 'pick', choice: 'rock' }, A));
    s = okState(rps.reduce(s, { type: 'pick', choice: 'paper' }, A));
    expect(s.picks.a).toBe('paper');
    expect(s.phase).toBe('choosing');
  });

  it('enforces join, start, pick and next rules', () => {
    expect(rps.reduce(rps.create(), { type: 'start' }, A).ok).toBe(false);
    const lobby = rpsLobby([A]);
    expect(rps.reduce(lobby, { type: 'join' }, A).ok).toBe(false);
    expect(rps.reduce(lobby, { type: 'start' }, A).ok).toBe(false); // only one player
    expect(rps.reduce(rpsLobby([A, B]), { type: 'start' }, C).ok).toBe(false); // not a player
    const choosing = okState(rps.reduce(rpsLobby([A, B]), { type: 'start' }, A));
    expect(choosing.round).toBe(1);
    expect(rps.reduce(choosing, { type: 'join' }, C).ok).toBe(false);
    expect(rps.reduce(choosing, { type: 'pick', choice: 'rock' }, C).ok).toBe(false);
    expect(rps.reduce(choosing, { type: 'next' }, A).ok).toBe(false);
    const done = rpsRound([A, B], ['rock', 'scissors']);
    const next = okState(rps.reduce(done, { type: 'next' }, B));
    expect(next.phase).toBe('choosing');
    expect(next.round).toBe(2);
    expect(next.picks).toEqual({});
    expect(next.result).toBeNull();
    const joined = okState(rps.reduce(done, { type: 'join' }, C));
    expect(joined.players).toHaveLength(3);
    const reset = okState(rps.reduce(done, { type: 'resetScores' }, A));
    expect(reset.players.every((p) => p.score === 0)).toBe(true);
  });

  it('caps the table at 8 players', () => {
    const many = Array.from({ length: 8 }, (_, i) => actor(`p${i}`));
    const s = rpsLobby(many);
    expect(rps.reduce(s, { type: 'join' }, actor('p9')).ok).toBe(false);
  });

  it('handles a player leaving mid-round', () => {
    let s = okState(rps.reduce(rpsLobby([A, B, C]), { type: 'start' }, A));
    s = okState(rps.reduce(s, { type: 'pick', choice: 'rock' }, A));
    s = okState(rps.reduce(s, { type: 'pick', choice: 'scissors' }, B));
    const afterC = rps.removePlayer(s, 'c'); // C had not picked, A and B are done
    expect(afterC.phase).toBe('revealed');
    expect(afterC.result?.winners).toEqual(['a']);
    const dropA = rps.removePlayer(s, 'a'); // A's pick is dropped, C still pending
    expect(dropA.phase).toBe('choosing');
    expect(dropA.picks).toEqual({ b: 'scissors' });
    const alone = rps.removePlayer(rps.removePlayer(s, 'a'), 'b');
    expect(alone.phase).toBe('lobby');
    expect(alone.picks).toEqual({});
    expect(alone.result).toBeNull();
  });
});

// ---------------------------------------------------------------------- Ludo

function ludoSeated(...who: [Color, Actor][]): LudoState {
  let s = ludo.create();
  for (const [color, a] of who) s = okState(ludo.reduce(s, { type: 'sit', color }, a, never));
  return s;
}
function ludoPlaying(): LudoState {
  return okState(ludo.reduce(ludoSeated(['red', A], ['green', B]), { type: 'start' }, A, never));
}
const withPieces = (s: LudoState, patch: Partial<Record<Color, number[]>>): LudoState => ({
  ...s,
  pieces: { ...s.pieces, ...(patch as Record<Color, [number, number, number, number]>) },
});
const lr = (s: LudoState, a: LudoAction, who: Actor, rng: () => number = never) => ludo.reduce(s, a, who, rng);

describe('ludo seats and start', () => {
  it('seats players, one seat each, and needs two to start', () => {
    let s = ludoSeated(['red', A]);
    expect(lr(s, { type: 'sit', color: 'green' }, A).ok).toBe(false);
    expect(lr(s, { type: 'sit', color: 'red' }, B).ok).toBe(false);
    expect(lr(s, { type: 'start' }, A).ok).toBe(false);
    s = okState(lr(s, { type: 'sit', color: 'yellow' }, B));
    const spectatorStart = lr(s, { type: 'start' }, C);
    expect(spectatorStart.ok).toBe(false);
    s = okState(lr(s, { type: 'start' }, B));
    expect(s.phase).toBe('playing');
    expect(s.turn).toBe('red');
    expect(s.seats.filter((x) => x.active).map((x) => x.color)).toEqual(['red', 'yellow']);
    expect(lr(s, { type: 'sit', color: 'blue' }, C).ok).toBe(false);
  });

  it('lets the host start without a seat', () => {
    const s = ludoSeated(['red', B], ['green', C]);
    expect(lr(s, { type: 'start' }, A).ok).toBe(true);
  });
});

describe('ludo rolling and moving', () => {
  it('only the turn owner rolls, and only once before moving', () => {
    const s = ludoPlaying();
    expect(lr(s, { type: 'roll' }, B, never).ok).toBe(false);
    const spectator = lr(s, { type: 'roll' }, C, never);
    expect(spectator.ok).toBe(false);
    if (!spectator.ok) expect(spectator.code).toBe('forbidden');
    const rolled = okState(lr(s, { type: 'roll' }, A, dice(6)));
    expect(rolled.dice).toBe(6);
    expect(rolled.rollId).toBe(1);
    expect(lr(rolled, { type: 'roll' }, A, dice(3)).ok).toBe(false);
  });

  it('needs a 6 to leave base and auto-passes when nothing can move', () => {
    const s = ludoPlaying();
    const passed = okState(lr(s, { type: 'roll' }, A, dice(3)));
    expect(passed.dice).toBeNull();
    expect(passed.turn).toBe('green');
    expect(passed.lastRoll).toEqual({ color: 'red', value: 3 });
    expect(passed.lastMove).toBeNull();
    const out = okState(lr(okState(lr(s, { type: 'roll' }, A, dice(6))), { type: 'move', piece: 2 }, A));
    expect(out.pieces.red).toEqual([-1, -1, 0, -1]);
    expect(out.turn).toBe('red'); // a six rolls again
    expect(out.dice).toBeNull();
  });

  it('rejects illegal moves', () => {
    const s = ludoPlaying();
    expect(lr(s, { type: 'move', piece: 0 }, A).ok).toBe(false); // no roll yet
    const rolled = okState(lr(withPieces(s, { red: [10, -1, -1, -1] }), { type: 'roll' }, A, dice(4)));
    expect(lr(rolled, { type: 'move', piece: 1 }, A).ok).toBe(false); // in base, not a 6
    expect(lr(rolled, { type: 'move', piece: 7 }, A).ok).toBe(false);
    expect(lr(rolled, { type: 'move', piece: 0 }, B).ok).toBe(false); // wrong turn
    expect(lr(rolled, { type: 'move', piece: 0.5 }, A).ok).toBe(false);
  });

  it('passes the turn after a normal move', () => {
    const s = withPieces(ludoPlaying(), { red: [10, -1, -1, -1] });
    const moved = okState(lr(okState(lr(s, { type: 'roll' }, A, dice(4))), { type: 'move', piece: 0 }, A));
    expect(moved.pieces.red[0]).toBe(14);
    expect(moved.turn).toBe('green');
    expect(moved.lastMove).toMatchObject({ color: 'red', piece: 0, from: 10, to: 14, captured: [] });
  });

  it('requires an exact roll to finish', () => {
    const s = withPieces(ludoPlaying(), { red: [55, -1, -1, -1] });
    expect(legalMoves(s, 'red', 3)).toEqual([]);
    expect(legalMoves(s, 'red', 2)).toEqual([0]);
    expect(legalMoves(s, 'red', 6)).toEqual([1, 2, 3]);
    const overshoot = okState(lr(s, { type: 'roll' }, A, dice(3)));
    expect(overshoot.turn).toBe('green'); // auto-pass, no legal move
    expect(overshoot.pieces.red[0]).toBe(55);
  });

  it('captures an opponent on a normal square', () => {
    // red p=5 -> square 5. Green piece at green p=44 -> (13+44)%52 = 5.
    const s = withPieces(ludoPlaying(), { red: [3, -1, -1, -1], green: [44, -1, -1, -1] });
    const after = okState(lr(okState(lr(s, { type: 'roll' }, A, dice(2))), { type: 'move', piece: 0 }, A));
    expect(after.pieces.green[0]).toBe(-1);
    expect(after.lastMove?.captured).toEqual([{ color: 'green', piece: 0 }]);
  });

  it('does not capture on safe squares', () => {
    // square 8 is safe. red p=6 + 2 -> 8. Green p=47 -> (13+47)%52 = 8.
    const s = withPieces(ludoPlaying(), { red: [6, -1, -1, -1], green: [47, -1, -1, -1] });
    const after = okState(lr(okState(lr(s, { type: 'roll' }, A, dice(2))), { type: 'move', piece: 0 }, A));
    expect(after.pieces.green[0]).toBe(47);
    expect(after.lastMove?.captured).toEqual([]);
    expect(SAFE_SQUARES).toHaveLength(8);
    for (const c of Object.keys(START) as Color[]) {
      expect(SAFE_SQUARES).toContain(START[c]);
      expect(SAFE_SQUARES).toContain(START[c] + 8);
    }
  });

  it('does not capture in the home column', () => {
    const s = withPieces(ludoPlaying(), { red: [50, -1, -1, -1], green: [52, -1, -1, -1] });
    const after = okState(lr(okState(lr(s, { type: 'roll' }, A, dice(3))), { type: 'move', piece: 0 }, A));
    expect(after.pieces.red[0]).toBe(53);
    expect(after.pieces.green[0]).toBe(52);
  });

  it('allows stacking on a friendly piece', () => {
    const s = withPieces(ludoPlaying(), { red: [10, 12, -1, -1] });
    const after = okState(lr(okState(lr(s, { type: 'roll' }, A, dice(2))), { type: 'move', piece: 0 }, A));
    expect(after.pieces.red.slice(0, 2)).toEqual([12, 12]);
  });

  it.runIf(THREE_SIXES_FORFEIT)('forfeits the move on a third six in a row', () => {
    let s = withPieces(ludoPlaying(), { red: [10, -1, -1, -1] });
    s = okState(lr(s, { type: 'roll' }, A, dice(6)));
    s = okState(lr(s, { type: 'move', piece: 0 }, A));
    s = okState(lr(s, { type: 'roll' }, A, dice(6)));
    s = okState(lr(s, { type: 'move', piece: 0 }, A));
    expect(s.sixesInRow).toBe(2);
    const pos = s.pieces.red[0];
    s = okState(lr(s, { type: 'roll' }, A, dice(6)));
    expect(s.turn).toBe('green');
    expect(s.dice).toBeNull();
    expect(s.sixesInRow).toBe(0);
    expect(s.pieces.red[0]).toBe(pos);
    expect(s.lastRoll).toEqual({ color: 'red', value: 6 });
  });

  it('announces the winner when all four pieces finish, then restarts', () => {
    const s = withPieces(ludoPlaying(), { red: [57, 57, 57, 55] });
    let won = okState(lr(okState(lr(s, { type: 'roll' }, A, dice(2))), { type: 'move', piece: 3 }, A));
    expect(won.phase).toBe('finished');
    expect(won.winner).toBe('red');
    expect(lr(won, { type: 'roll' }, A, dice(1)).ok).toBe(false);
    expect(lr(won, { type: 'restart' }, C).ok).toBe(false);
    won = okState(lr(won, { type: 'restart' }, B)); // seated player after finish
    expect(won.phase).toBe('playing');
    expect(won.winner).toBeNull();
    expect(won.pieces.red).toEqual([-1, -1, -1, -1]);
    expect(won.turn).toBe('red');
    expect(won.seats.filter((x) => x.playerId).length).toBe(2);
  });

  it('only the host can restart a running game', () => {
    const s = ludoPlaying();
    expect(lr(s, { type: 'restart' }, B).ok).toBe(false);
    expect(lr(s, { type: 'restart' }, A).ok).toBe(true);
    expect(lr(ludo.create(), { type: 'restart' }, A).ok).toBe(false);
  });

  it('skipTurn passes the turn, and the reducer knows who owns it', () => {
    const s = ludoPlaying();
    expect(ludo.turnOwner(s)).toBe('a');
    const skipped = okState(lr(s, { type: 'skipTurn' }, A));
    expect(skipped.turn).toBe('green');
    expect(ludo.turnOwner(skipped)).toBe('b');
  });

  it('caps the log at 20 lines', () => {
    let s = ludoPlaying();
    for (let i = 0; i < 40; i++) s = okState(lr(s, { type: 'skipTurn' }, A));
    expect(s.log.length).toBe(LUDO_LOG_MAX);
  });
});

describe('ludo leaving', () => {
  it('forfeits to the last player standing', () => {
    const s = ludo.removePlayer(ludoPlaying(), 'a');
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('green');
  });

  it('passes the turn and clears pieces when someone leaves a 3-player game', () => {
    let s = okState(lr(ludoSeated(['red', A], ['green', B], ['yellow', C]), { type: 'start' }, A));
    s = withPieces(s, { red: [4, 5, -1, -1] });
    const after = ludo.removePlayer(s, 'a');
    expect(after.phase).toBe('playing');
    expect(after.turn).toBe('green');
    expect(after.pieces.red).toEqual([-1, -1, -1, -1]);
    expect(after.seats[0]).toMatchObject({ playerId: null, active: false });
    const rolled = okState(lr(after, { type: 'roll' }, B, dice(5)));
    expect(rolled.turn).toBe('yellow');
  });

  it('frees a seat in the lobby', () => {
    const s = ludo.removePlayer(ludoSeated(['red', A], ['green', B]), 'a');
    expect(s.seats[0]!.playerId).toBeNull();
    expect(ludo.removePlayer(s, 'zzz')).toBe(s);
  });

  it('leaveSeat during play behaves like leaving', () => {
    const s = okState(lr(ludoPlaying(), { type: 'leaveSeat' }, B));
    expect(s.winner).toBe('red');
  });
});

describe('ludo geometry', () => {
  it('has 52 distinct track squares, each adjacent (or diagonal at a corner) to the next', () => {
    expect(TRACK_COORDS).toHaveLength(52);
    expect(new Set(TRACK_COORDS.map((p) => `${p.x},${p.y}`)).size).toBe(52);
    for (let i = 0; i < 52; i++) {
      const a = TRACK_COORDS[i]!;
      const b = TRACK_COORDS[(i + 1) % 52]!;
      expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBe(1);
    }
  });

  it('maps every color and progress to a unique, in-bounds spot per track square', () => {
    const colors: Color[] = ['red', 'green', 'yellow', 'blue'];
    const seen = new Map<string, string>();
    for (const c of colors) {
      for (let p = 0; p < 52; p++) {
        const { x, y } = pieceCoord(c, 0, p);
        const key = `${x},${y}`;
        seen.set(key, `${c}${p}`);
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(15);
      }
      expect(HOME_COLUMN_COORDS[c]).toHaveLength(5);
      expect(BASE_COORDS[c]).toHaveLength(4);
    }
    // 4 colors cover the same 52 squares, so only 52 distinct spots exist on the track.
    expect(seen.size).toBe(52);
    const all = new Set<string>();
    for (const c of colors) {
      for (let p = 52; p <= 57; p++) all.add(JSON.stringify(pieceCoord(c, 0, p)));
      for (let i = 0; i < 4; i++) all.add(JSON.stringify(pieceCoord(c, i, -1)));
    }
    expect(all.size).toBe(4 * 6 + 4 * 4);
    expect(pieceCoord('red', 0, 0)).toEqual({ x: 1.5, y: 6.5 });
    expect(pieceCoord('green', 0, 0)).toEqual({ x: TRACK_COORDS[13]!.x + 0.5, y: TRACK_COORDS[13]!.y + 0.5 });
    expect(pieceCoord('red', 0, 57)).toEqual({ x: FINISH_COORDS.red.x + 0.5, y: FINISH_COORDS.red.y + 0.5 });
  });
});

// --------------------------------------------------------------------- index

describe('game dispatch', () => {
  it('creates, reduces, removes and redacts per kind', () => {
    for (const kind of ['ludo', 'tictactoe', 'rps'] as const) expect(createGame(kind).kind).toBe(kind);
    let g = createGame('tictactoe');
    g = okState(reduceGame(g, { type: 'sit', mark: 'X' } satisfies TttAction, A, never));
    expect(seatedIds(g)).toEqual(['a']);
    expect(removeGamePlayer(g, 'a')).toMatchObject({ seats: { X: null } });

    let r = createGame('rps');
    r = okState(reduceGame(r, { type: 'join' } satisfies RpsAction, A, never));
    r = okState(reduceGame(r, { type: 'join' } satisfies RpsAction, B, never));
    r = okState(reduceGame(r, { type: 'start' }, A, never));
    r = okState(reduceGame(r, { type: 'pick', choice: 'rock' }, A, never));
    expect(JSON.stringify(viewGame(r, 'b'))).not.toContain('rock');
    expect(JSON.stringify(viewGame(r, 'a'))).toContain('rock');

    const l = createGame('ludo');
    expect(viewGame(l, 'a')).toBe(l);
    expect(D.id).toBe('d');
  });
});
