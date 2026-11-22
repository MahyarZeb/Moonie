import type { Actor, Choice, Result, RpsAction, RpsState, RpsView } from './types';

export const RPS_MAX_PLAYERS = 8;
export const CHOICES: readonly Choice[] = ['rock', 'paper', 'scissors'];
const BEATS: Record<Choice, Choice> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export function create(): RpsState {
  return { kind: 'rps', phase: 'lobby', round: 0, players: [], picks: {}, result: null };
}

const fail = (error: string, code?: 'forbidden'): Result<RpsState> =>
  code ? { ok: false, error, code } : { ok: false, error };

type Outcome = NonNullable<RpsState['result']>;

/** Pure round resolution. One or three distinct choices is a draw, otherwise the beating choice wins. */
export function resolveRound(picks: Record<string, Choice>): Outcome {
  const ids = Object.keys(picks);
  const distinct = [...new Set(Object.values(picks))];
  const reveal = { ...picks };
  if (distinct.length !== 2) return { winners: [], losers: [], winningChoice: null, draw: true, reveal };
  const [a, b] = distinct as [Choice, Choice];
  const winningChoice = BEATS[a] === b ? a : b;
  return {
    winners: ids.filter((id) => picks[id] === winningChoice),
    losers: ids.filter((id) => picks[id] !== winningChoice),
    winningChoice,
    draw: false,
    reveal,
  };
}

const clone = (s: RpsState): RpsState => ({
  ...s,
  players: s.players.map((p) => ({ ...p })),
  picks: { ...s.picks },
  result: s.result ? { ...s.result } : null,
});

function resolve(s: RpsState): void {
  const result = resolveRound(s.picks);
  for (const id of result.winners) {
    const p = s.players.find((x) => x.id === id);
    if (p) p.score += 1;
  }
  s.result = result;
  s.phase = 'revealed';
}

function backToLobby(s: RpsState): void {
  s.phase = 'lobby';
  s.picks = {};
  s.result = null;
}

export function reduce(state: RpsState, action: RpsAction, actor: Actor): Result<RpsState> {
  const s = clone(state);
  const isPlayer = s.players.some((p) => p.id === actor.id);

  switch (action.type) {
    case 'join': {
      if (s.phase === 'choosing') return fail('Wait for this round to finish');
      if (isPlayer) return fail('You already joined');
      if (s.players.length >= RPS_MAX_PLAYERS) return fail('The table is full');
      s.players.push({ id: actor.id, name: actor.name, avatar: actor.avatar, score: 0 });
      return { ok: true, state: s };
    }

    case 'leave': {
      if (!isPlayer) return fail('You are not playing', 'forbidden');
      return { ok: true, state: removePlayer(s, actor.id) };
    }

    case 'start': {
      if (s.phase !== 'lobby') return fail('A round is already running');
      if (!isPlayer) return fail('Join the game first', 'forbidden');
      if (s.players.length < 2) return fail('Rock Paper Scissors needs at least 2 players');
      s.phase = 'choosing';
      s.round += 1;
      s.picks = {};
      s.result = null;
      return { ok: true, state: s };
    }

    case 'pick': {
      if (s.phase !== 'choosing') return fail('Nothing to pick right now');
      if (!isPlayer) return fail('You are not playing', 'forbidden');
      if (!CHOICES.includes(action.choice)) return fail('Pick rock, paper or scissors');
      s.picks[actor.id] = action.choice;
      if (s.players.every((p) => s.picks[p.id] !== undefined)) resolve(s);
      return { ok: true, state: s };
    }

    case 'next': {
      if (s.phase !== 'revealed') return fail('The round is not over yet');
      if (!isPlayer) return fail('You are not playing', 'forbidden');
      if (s.players.length < 2) return fail('Rock Paper Scissors needs at least 2 players');
      s.phase = 'choosing';
      s.round += 1;
      s.picks = {};
      s.result = null;
      return { ok: true, state: s };
    }

    case 'resetScores': {
      if (!isPlayer) return fail('You are not playing', 'forbidden');
      if (s.phase === 'choosing') return fail('Wait for this round to finish');
      for (const p of s.players) p.score = 0;
      return { ok: true, state: s };
    }

    default:
      return fail('Unknown action');
  }
}

/** A participant left. Their pick is dropped and the round may resolve or fall back to the lobby. */
export function removePlayer(state: RpsState, playerId: string): RpsState {
  if (!state.players.some((p) => p.id === playerId)) return state;
  const s = clone(state);
  s.players = s.players.filter((p) => p.id !== playerId);
  delete s.picks[playerId];
  if (s.players.length < 2) {
    backToLobby(s);
  } else if (s.phase === 'choosing' && s.players.every((p) => s.picks[p.id] !== undefined)) {
    resolve(s);
  }
  return s;
}

/** Hides other players' picks until the round is revealed. */
export function view(state: RpsState, viewerId: string): RpsView {
  const picks: RpsView['picks'] = {};
  if (state.phase === 'revealed') {
    Object.assign(picks, state.picks);
  } else if (state.phase === 'choosing') {
    for (const p of state.players) {
      const pick = state.picks[p.id];
      picks[p.id] = pick === undefined ? 'none' : p.id === viewerId ? pick : 'locked';
    }
  }
  return { ...state, picks };
}
