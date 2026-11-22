import type { Actor, Result, TttAction, TttState } from './types';

type Mark = 'X' | 'O';

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function create(): TttState {
  return {
    kind: 'tictactoe',
    board: Array<null>(9).fill(null),
    seats: { X: null, O: null },
    turn: 'X',
    status: 'waiting',
    winner: null,
    line: null,
    scores: { X: 0, O: 0, draws: 0 },
    starter: 'X',
  };
}

const clone = (s: TttState): TttState => ({
  ...s,
  board: [...s.board],
  seats: { ...s.seats },
  scores: { ...s.scores },
});

const fail = (error: string, code?: 'forbidden'): Result<TttState> =>
  code ? { ok: false, error, code } : { ok: false, error };

const markOf = (s: TttState, id: string): Mark | null =>
  s.seats.X?.playerId === id ? 'X' : s.seats.O?.playerId === id ? 'O' : null;

export function winningLine(board: (null | Mark)[]): { mark: Mark; line: number[] } | null {
  for (const [a, b, c] of LINES) {
    const m = board[a];
    if (m && m === board[b] && m === board[c]) return { mark: m, line: [a, b, c] };
  }
  return null;
}

export function reduce(state: TttState, action: TttAction, actor: Actor): Result<TttState> {
  const s = clone(state);
  const mine = markOf(s, actor.id);

  switch (action.type) {
    case 'sit': {
      if (action.mark !== 'X' && action.mark !== 'O') return fail('Pick X or O');
      if (mine) return fail('You already have a seat');
      if (s.seats[action.mark]) return fail('That seat is taken');
      s.seats[action.mark] = { playerId: actor.id, name: actor.name, avatar: actor.avatar };
      if (s.status === 'waiting' && s.seats.X && s.seats.O) s.status = 'playing';
      return { ok: true, state: s };
    }

    case 'leaveSeat': {
      if (!mine) return fail('You are not seated', 'forbidden');
      return { ok: true, state: removePlayer(s, actor.id) };
    }

    case 'move': {
      if (s.status !== 'playing') return fail('The game is not running');
      if (!mine) return fail('You are not seated', 'forbidden');
      if (mine !== s.turn) return fail("It's not your turn");
      const i = action.index;
      if (!Number.isInteger(i) || i < 0 || i > 8) return fail('That is not a square');
      if (s.board[i] !== null) return fail('That square is taken');
      s.board[i] = mine;
      const win = winningLine(s.board);
      if (win) {
        s.status = 'won';
        s.winner = win.mark;
        s.line = win.line;
        s.scores[win.mark] += 1;
      } else if (s.board.every((c) => c !== null)) {
        s.status = 'draw';
        s.scores.draws += 1;
      } else {
        s.turn = mine === 'X' ? 'O' : 'X';
      }
      return { ok: true, state: s };
    }

    case 'restart': {
      if (!mine && !actor.isHost) return fail('Only the host or a seated player can restart', 'forbidden');
      s.board = Array<null>(9).fill(null);
      s.starter = s.starter === 'X' ? 'O' : 'X';
      s.turn = s.starter;
      s.winner = null;
      s.line = null;
      s.status = s.seats.X && s.seats.O ? 'playing' : 'waiting';
      return { ok: true, state: s };
    }

    default:
      return fail('Unknown action');
  }
}

/** A participant left. A seated player who leaves mid-game forfeits to the opponent. */
export function removePlayer(state: TttState, playerId: string): TttState {
  const mark = markOf(state, playerId);
  if (!mark) return state;
  const s = clone(state);
  s.seats[mark] = null;
  if (s.status === 'playing') {
    const other: Mark = mark === 'X' ? 'O' : 'X';
    s.status = 'won';
    s.winner = other;
    s.line = null;
    s.scores[other] += 1;
  }
  return s;
}

export function view(state: TttState): TttState {
  return state;
}
