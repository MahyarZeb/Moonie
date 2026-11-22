import type { Actor, Color, LudoAction, LudoState, Result } from './types';

/**
 * House rule: rolling three sixes in a row forfeits the move and passes the turn.
 * This is the single switch for the rule. Set it to false to turn the rule off everywhere.
 */
export const THREE_SIXES_FORFEIT = true;

export const LUDO_LOG_MAX = 20;
export const COLORS: readonly Color[] = ['red', 'green', 'yellow', 'blue'];
export const START: Record<Color, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
/** The four start squares and `start + 8` of each. */
export const SAFE_SQUARES: readonly number[] = [0, 8, 13, 21, 26, 34, 39, 47];
export const TRACK_LEN = 52;
export const IN_BASE = -1;
export const HOME_START = 52;
export const FINISHED = 57;

export interface Point {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Board geometry on a 15x15 grid (cell coordinates, 0..14)
// ---------------------------------------------------------------------------

function run(out: Point[], x: number, y: number, dx: number, dy: number, n: number): Point[] {
  for (let i = 0; i < n; i++) out.push({ x: x + dx * i, y: y + dy * i });
  return out;
}

function buildTrack(): Point[] {
  const t: Point[] = [];
  run(t, 1, 6, 1, 0, 5); // 0-4
  run(t, 6, 5, 0, -1, 6); // 5-10
  run(t, 7, 0, 1, 0, 2); // 11-12
  run(t, 8, 1, 0, 1, 5); // 13-17
  run(t, 9, 6, 1, 0, 6); // 18-23
  run(t, 14, 7, 0, 1, 2); // 24-25
  run(t, 13, 8, -1, 0, 5); // 26-30
  run(t, 8, 9, 0, 1, 6); // 31-36
  run(t, 7, 14, -1, 0, 2); // 37-38
  run(t, 6, 13, 0, -1, 5); // 39-43
  run(t, 5, 8, -1, 0, 6); // 44-49
  run(t, 0, 7, 0, -1, 2); // 50-51
  return t;
}

/** The 52 main-track squares, clockwise from red's start square. */
export const TRACK_COORDS: readonly Point[] = buildTrack();

export const HOME_COLUMN_COORDS: Record<Color, readonly Point[]> = {
  red: run([], 1, 7, 1, 0, 5),
  green: run([], 7, 1, 0, 1, 5),
  yellow: run([], 13, 7, -1, 0, 5),
  blue: run([], 7, 13, 0, -1, 5),
};

export const FINISH_COORDS: Record<Color, Point> = {
  red: { x: 6, y: 7 },
  green: { x: 7, y: 6 },
  yellow: { x: 8, y: 7 },
  blue: { x: 7, y: 8 },
};

const BASE_SPOTS: readonly Point[] = [
  { x: 1.9, y: 1.9 },
  { x: 4.1, y: 1.9 },
  { x: 1.9, y: 4.1 },
  { x: 4.1, y: 4.1 },
];
const BASE_OFFSET: Record<Color, Point> = {
  red: { x: 0, y: 0 },
  green: { x: 9, y: 0 },
  yellow: { x: 9, y: 9 },
  blue: { x: 0, y: 9 },
};

/** Base spots are centers in grid units, already offset per color. */
export const BASE_COORDS: Record<Color, readonly Point[]> = Object.fromEntries(
  COLORS.map((c) => [c, BASE_SPOTS.map((s) => ({ x: s.x + BASE_OFFSET[c].x, y: s.y + BASE_OFFSET[c].y }))]),
) as unknown as Record<Color, readonly Point[]>;

/** Absolute track square for a piece progress on the main track (0..51), else null. */
export function absoluteSquare(color: Color, p: number): number | null {
  return p >= 0 && p < TRACK_LEN ? (START[color] + p) % TRACK_LEN : null;
}

/** Center of a piece in grid units (cell centers are x + 0.5). */
export function pieceCoord(color: Color, piece: number, p: number): Point {
  if (p === IN_BASE) return BASE_COORDS[color][piece] ?? BASE_COORDS[color][0]!;
  let cell: Point;
  if (p < TRACK_LEN) cell = TRACK_COORDS[(START[color] + p) % TRACK_LEN]!;
  else if (p < FINISHED) cell = HOME_COLUMN_COORDS[color][p - HOME_START]!;
  else cell = FINISH_COORDS[color];
  return { x: cell.x + 0.5, y: cell.y + 0.5 };
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

const fresh = (): Record<Color, [number, number, number, number]> => ({
  red: [-1, -1, -1, -1],
  green: [-1, -1, -1, -1],
  yellow: [-1, -1, -1, -1],
  blue: [-1, -1, -1, -1],
});

export function create(): LudoState {
  return {
    kind: 'ludo',
    phase: 'lobby',
    seats: COLORS.map((color) => ({ color, playerId: null, name: '', avatar: 'cat' as const, active: false })),
    pieces: fresh(),
    turn: null,
    dice: null,
    rollId: 0,
    sixesInRow: 0,
    winner: null,
    lastRoll: null,
    lastMove: null,
    log: [],
  };
}

const clone = (s: LudoState): LudoState => ({
  ...s,
  seats: s.seats.map((x) => ({ ...x })),
  pieces: {
    red: [...s.pieces.red],
    green: [...s.pieces.green],
    yellow: [...s.pieces.yellow],
    blue: [...s.pieces.blue],
  },
  log: [...s.log],
});

function pushLog(s: LudoState, line: string): void {
  s.log.push(line);
  if (s.log.length > LUDO_LOG_MAX) s.log.splice(0, s.log.length - LUDO_LOG_MAX);
}

const seatOf = (s: LudoState, color: Color) => s.seats.find((x) => x.color === color)!;
const seatByPlayer = (s: LudoState, id: string) => s.seats.find((x) => x.playerId === id);
const nameOf = (s: LudoState, color: Color) => seatOf(s, color).name || color;
const cap = (c: Color) => c[0]!.toUpperCase() + c.slice(1);

/** The next active color after `from` in turn order, or null when none is active. */
function nextActive(s: LudoState, from: Color): Color | null {
  const start = COLORS.indexOf(from);
  for (let i = 1; i <= COLORS.length; i++) {
    const c = COLORS[(start + i) % COLORS.length]!;
    if (seatOf(s, c).active) return c;
  }
  return null;
}

function firstActive(s: LudoState): Color | null {
  return COLORS.find((c) => seatOf(s, c).active) ?? null;
}

/** Player id whose turn it is, or null. */
export function turnOwner(s: LudoState): string | null {
  return s.phase === 'playing' && s.turn ? seatOf(s, s.turn).playerId : null;
}

/** Piece indexes the color may move with `value`. */
export function legalMoves(s: LudoState, color: Color, value: number): number[] {
  const out: number[] = [];
  s.pieces[color].forEach((p, i) => {
    if (p === IN_BASE) {
      if (value === 6) out.push(i);
    } else if (p + value <= FINISHED) out.push(i);
  });
  return out;
}

const fail = (error: string, code?: 'forbidden'): Result<LudoState> =>
  code ? { ok: false, error, code } : { ok: false, error };

function passTurn(s: LudoState): void {
  s.dice = null;
  s.sixesInRow = 0;
  s.turn = s.turn ? nextActive(s, s.turn) : null;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reduce(state: LudoState, action: LudoAction, actor: Actor, rng: () => number): Result<LudoState> {
  const s = clone(state);
  const mine = seatByPlayer(s, actor.id);

  switch (action.type) {
    case 'sit': {
      if (s.phase !== 'lobby') return fail('The game already started');
      if (!COLORS.includes(action.color)) return fail('Pick a color');
      if (mine) return fail('You already have a seat');
      const seat = seatOf(s, action.color);
      if (seat.playerId) return fail('That seat is taken');
      seat.playerId = actor.id;
      seat.name = actor.name;
      seat.avatar = actor.avatar;
      return { ok: true, state: s };
    }

    case 'leaveSeat': {
      if (!mine) return fail('You are not seated', 'forbidden');
      return { ok: true, state: removePlayer(s, actor.id) };
    }

    case 'start': {
      if (s.phase !== 'lobby') return fail('The game already started');
      if (!mine && !actor.isHost) return fail('Only the host or a seated player can start', 'forbidden');
      const occupied = s.seats.filter((x) => x.playerId);
      if (occupied.length < 2) return fail('Ludo needs at least 2 players');
      return { ok: true, state: begin(s) };
    }

    case 'roll': {
      if (s.phase !== 'playing' || !s.turn) return fail('The game is not running');
      if (!mine) return fail('You are not seated', 'forbidden');
      if (mine.color !== s.turn) return fail("It's not your turn");
      if (s.dice !== null) return fail('Move a piece first');
      const color = s.turn;
      const value = 1 + Math.floor(rng() * 6);
      s.rollId += 1;
      s.lastRoll = { color, value };
      s.lastMove = null;
      if (value === 6) s.sixesInRow += 1;
      if (THREE_SIXES_FORFEIT && s.sixesInRow >= 3) {
        pushLog(s, `${nameOf(s, color)} rolled a third 6 in a row and loses the move`);
        passTurn(s);
        return { ok: true, state: s };
      }
      if (legalMoves(s, color, value).length === 0) {
        pushLog(s, `${nameOf(s, color)} rolled a ${value} and has no move`);
        passTurn(s);
        return { ok: true, state: s };
      }
      s.dice = value;
      pushLog(s, `${nameOf(s, color)} rolled a ${value}`);
      return { ok: true, state: s };
    }

    case 'move': {
      if (s.phase !== 'playing' || !s.turn) return fail('The game is not running');
      if (!mine) return fail('You are not seated', 'forbidden');
      if (mine.color !== s.turn) return fail("It's not your turn");
      if (s.dice === null) return fail('Roll the dice first');
      const color = s.turn;
      const dice = s.dice;
      if (!Number.isInteger(action.piece) || !legalMoves(s, color, dice).includes(action.piece)) {
        return fail("That piece can't move");
      }
      const from = s.pieces[color][action.piece]!;
      const to = from === IN_BASE ? 0 : from + dice;
      s.pieces[color][action.piece] = to;
      const captured: { color: Color; piece: number }[] = [];
      const abs = absoluteSquare(color, to);
      if (abs !== null && !SAFE_SQUARES.includes(abs)) {
        for (const other of COLORS) {
          if (other === color || !seatOf(s, other).active) continue;
          s.pieces[other].forEach((q, i) => {
            if (absoluteSquare(other, q) === abs) {
              s.pieces[other][i] = IN_BASE;
              captured.push({ color: other, piece: i });
            }
          });
        }
      }
      s.lastMove = { color, piece: action.piece, from, to, captured };
      if (captured.length > 0) {
        pushLog(s, `${nameOf(s, color)} sent ${captured.map((c) => cap(c.color)).join(' and ')} home`);
      }
      if (s.pieces[color].every((p) => p === FINISHED)) {
        s.phase = 'finished';
        s.winner = color;
        s.turn = color;
        s.dice = null;
        pushLog(s, `${nameOf(s, color)} wins! 🎉`);
        return { ok: true, state: s };
      }
      if (dice === 6) {
        s.dice = null; // same player rolls again; sixesInRow keeps counting
      } else {
        passTurn(s);
      }
      return { ok: true, state: s };
    }

    case 'restart': {
      if (s.phase === 'lobby') return fail('The game has not started');
      if (!actor.isHost && !(mine && s.phase === 'finished')) {
        return fail(mine ? 'Finish the game first' : 'Only the host or a seated player can restart', mine ? undefined : 'forbidden');
      }
      for (const seat of s.seats) seat.active = seat.playerId !== null;
      if (s.seats.filter((x) => x.active).length < 2) return { ok: true, state: toLobby(s) };
      return { ok: true, state: begin(s) };
    }

    case 'skipTurn': {
      if (s.phase !== 'playing' || !s.turn) return fail('The game is not running');
      pushLog(s, `${nameOf(s, s.turn)} was away, turn skipped`);
      s.lastMove = null;
      passTurn(s);
      return { ok: true, state: s };
    }

    default:
      return fail('Unknown action');
  }
}

function begin(s: LudoState): LudoState {
  for (const seat of s.seats) seat.active = seat.playerId !== null;
  s.pieces = fresh();
  s.phase = 'playing';
  s.turn = firstActive(s);
  s.dice = null;
  s.sixesInRow = 0;
  s.winner = null;
  s.lastRoll = null;
  s.lastMove = null;
  s.log = [];
  pushLog(s, `${nameOf(s, s.turn!)} goes first`);
  return s;
}

function toLobby(s: LudoState): LudoState {
  s.phase = 'lobby';
  s.pieces = fresh();
  s.turn = null;
  s.dice = null;
  s.sixesInRow = 0;
  s.winner = null;
  s.lastRoll = null;
  s.lastMove = null;
  for (const seat of s.seats) seat.active = false;
  return s;
}

/** A participant left the room or gave up their seat. */
export function removePlayer(state: LudoState, playerId: string): LudoState {
  const seat = seatByPlayer(state, playerId);
  if (!seat) return state;
  const s = clone(state);
  const mine = seatOf(s, seat.color);
  const name = mine.name;
  mine.playerId = null;
  mine.name = '';
  if (s.phase === 'lobby' || s.phase === 'finished') {
    mine.active = false;
    return s;
  }
  mine.active = false;
  s.pieces[mine.color] = [-1, -1, -1, -1];
  const wasTurn = s.turn === mine.color;
  const active = s.seats.filter((x) => x.active);
  if (active.length === 0) return toLobby(s);
  if (active.length === 1) {
    const w = active[0]!;
    s.phase = 'finished';
    s.winner = w.color;
    s.turn = w.color;
    s.dice = null;
    s.lastMove = null;
    pushLog(s, `${name || cap(mine.color)} left, ${w.name || cap(w.color)} wins 🎉`);
    return s;
  }
  pushLog(s, `${name || cap(mine.color)} left the game`);
  if (wasTurn) {
    s.lastMove = null;
    s.turn = nextActive(s, mine.color);
    s.dice = null;
    s.sixesInRow = 0;
  }
  return s;
}

export function view(state: LudoState): LudoState {
  return state;
}
