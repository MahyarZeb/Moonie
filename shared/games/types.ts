import type { AvatarId } from '../protocol';

// Game types shared by the server, the client and the pure reducers in this folder.
export type GameKind = 'ludo' | 'tictactoe' | 'rps';
export type Color = 'red' | 'green' | 'yellow' | 'blue';
export type Choice = 'rock' | 'paper' | 'scissors';

export interface Seat {
  playerId: string;
  name: string;
  avatar: AvatarId;
}

export interface Actor {
  id: string;
  name: string;
  avatar: AvatarId;
  isHost: boolean;
}

/** `code` is `forbidden` when the actor may not act at all (not seated); otherwise a failure means `invalid_state`. */
export type Result<S> = { ok: true; state: S } | { ok: false; error: string; code?: 'forbidden' };

export interface LudoState {
  kind: 'ludo';
  phase: 'lobby' | 'playing' | 'finished';
  seats: { color: Color; playerId: string | null; name: string; avatar: AvatarId; active: boolean }[];
  pieces: Record<Color, [number, number, number, number]>;
  turn: Color | null;
  dice: number | null;
  rollId: number;
  sixesInRow: number;
  winner: Color | null;
  /** The most recent roll, kept after an automatic pass so everyone can see the dice. */
  lastRoll: { color: Color; value: number } | null;
  lastMove: {
    color: Color;
    piece: number;
    from: number;
    to: number;
    captured: { color: Color; piece: number }[];
  } | null;
  log: string[];
}

export interface TttState {
  kind: 'tictactoe';
  board: (null | 'X' | 'O')[];
  seats: { X: Seat | null; O: Seat | null };
  turn: 'X' | 'O';
  status: 'waiting' | 'playing' | 'won' | 'draw';
  winner: 'X' | 'O' | null;
  line: number[] | null;
  scores: { X: number; O: number; draws: number };
  starter: 'X' | 'O';
}

export interface RpsState {
  kind: 'rps';
  phase: 'lobby' | 'choosing' | 'revealed';
  round: number;
  players: { id: string; name: string; avatar: AvatarId; score: number }[];
  picks: Record<string, Choice>;
  result: null | {
    winners: string[];
    losers: string[];
    winningChoice: Choice | null;
    draw: boolean;
    reveal: Record<string, Choice>;
  };
}

export type LudoAction =
  | { type: 'sit'; color: Color }
  | { type: 'leaveSeat' }
  | { type: 'start' }
  | { type: 'roll' }
  | { type: 'move'; piece: number }
  | { type: 'restart' }
  | { type: 'skipTurn' };
export type TttAction =
  | { type: 'sit'; mark: 'X' | 'O' }
  | { type: 'leaveSeat' }
  | { type: 'move'; index: number }
  | { type: 'restart' };
export type RpsAction =
  | { type: 'join' }
  | { type: 'leave' }
  | { type: 'start' }
  | { type: 'pick'; choice: Choice }
  | { type: 'next' }
  | { type: 'resetScores' };

export type GameAction = LudoAction | TttAction | RpsAction;

export type RpsView = Omit<RpsState, 'picks' | 'result'> & {
  picks: Record<string, 'none' | 'locked' | Choice>;
  result: RpsState['result'];
};
export type GameView = LudoState | TttState | RpsView;
