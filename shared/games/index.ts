import * as ludo from './ludo';
import * as rps from './rps';
import * as ttt from './tictactoe';
import type { Actor, GameAction, GameKind, GameView, LudoAction, LudoState, Result, RpsAction, RpsState, TttAction, TttState } from './types';

export type GameState = LudoState | TttState | RpsState;

export { ludo, rps, ttt };

export function createGame(kind: GameKind): GameState {
  switch (kind) {
    case 'ludo':
      return ludo.create();
    case 'tictactoe':
      return ttt.create();
    case 'rps':
      return rps.create();
  }
}

/** Applies an action that `parseGameAction` already validated for `state.kind`. */
export function reduceGame(state: GameState, action: GameAction, actor: Actor, rng: () => number): Result<GameState> {
  switch (state.kind) {
    case 'ludo':
      return ludo.reduce(state, action as LudoAction, actor, rng);
    case 'tictactoe':
      return ttt.reduce(state, action as TttAction, actor);
    case 'rps':
      return rps.reduce(state, action as RpsAction, actor);
  }
}

export function removeGamePlayer(state: GameState, playerId: string): GameState {
  switch (state.kind) {
    case 'ludo':
      return ludo.removePlayer(state, playerId);
    case 'tictactoe':
      return ttt.removePlayer(state, playerId);
    case 'rps':
      return rps.removePlayer(state, playerId);
  }
}

/** The per-recipient (redacted) view of a game. */
export function viewGame(state: GameState, viewerId: string): GameView {
  return state.kind === 'rps' ? rps.view(state, viewerId) : state;
}

/** Ids of everyone seated in the game. */
export function seatedIds(state: GameState): string[] {
  switch (state.kind) {
    case 'ludo':
      return state.seats.flatMap((s) => (s.playerId ? [s.playerId] : []));
    case 'tictactoe':
      return [state.seats.X?.playerId, state.seats.O?.playerId].filter((x): x is string => !!x);
    case 'rps':
      return state.players.map((p) => p.id);
  }
}
