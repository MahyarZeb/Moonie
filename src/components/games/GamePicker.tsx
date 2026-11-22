'use client';

import type { GameKind } from '@shared/games/types';
import { useGameActions } from './useGameActions';

const GAMES: { kind: GameKind; emoji: string; title: string; text: string }[] = [
  { kind: 'ludo', emoji: '🎲', title: 'Ludo', text: '2 to 4 players. Race your pieces home.' },
  { kind: 'tictactoe', emoji: '❌', title: 'Tic-Tac-Toe', text: 'Two players, three in a row.' },
  { kind: 'rps', emoji: '✊', title: 'Rock Paper Scissors', text: 'Everyone picks at once.' },
];

/** Shown when no game is open. Anyone in the room can start one. */
export function GamePicker() {
  const { open } = useGameActions();
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">Pick a game for the room. Everyone sees it and can join in.</p>
      <ul className="space-y-2">
        {GAMES.map((g) => (
          <li key={g.kind}>
            <button
              type="button"
              onClick={() => open(g.kind)}
              className="flex w-full items-center gap-3 rounded-3xl bg-surface-2 p-3 text-left transition hover:-translate-y-0.5 hover:shadow-soft"
            >
              <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-pink/50 to-sky/50 text-2xl">
                {g.emoji}
              </span>
              <span>
                <span className="block font-display font-bold">{g.title}</span>
                <span className="block text-sm text-ink-soft">{g.text}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
